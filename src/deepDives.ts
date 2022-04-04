import { BaseUpdate } from "./shared.types";

interface DeepDiveIssueUpdate extends BaseUpdate {
    dueDate: string; // ISO
    highPriority?: boolean;
    missingFields?: {
        leader?: boolean;
        notetaker?: boolean;
    };
    missingUpdates?: {
        pastDue?: boolean;
        needsRecording?: boolean;
        needsNotes?: boolean;
    };
    title: string;
    url: string;
}

const oneDayMs = 1000 * 60 * 60 * 24;

const getDueDateFromDeepDiveBody = (issueBody: string): string => {
    const regex = /## Timing(?s)(.*)\[Google Event/g
    const [dueDateUnformatted] = issueBody.match(regex);
    if (!dueDateUnformatted) {
        throw new Error('No date found for Deep Dive');
    }
    return (new Date(dueDateUnformatted)).toISOString();
}

const getMissingFieldsFromDeepDiveBody = (issueBody: string): DeepDiveIssueUpdate['missingFields'] => {
    const notetakerRegex = /Notetaker:(?s)(.*)?/g;
    const leaderRegex = /Leader:(?s)(.*)Notetaker/g;

    const [notetaker] = issueBody.match(notetakerRegex);
    const [leader] = issueBody.match(leaderRegex);

    return { notetaker: !!notetaker, leader: !!leader };
}

const getMissingUpdates = async (kit, { dueDate, issueId, owner, repo }): Promise<DeepDiveIssueUpdate['missingUpdates']> => {
    // if it happened yesterday or earlier, it's past due
    const pastDue = (((new Date(dueDate)).getTime()) - ((new Date()).getTime())) <= oneDayMs;
    // if it's not pastDue, return early to avoid unneeded api call
    if (!pastDue) {
        return { pastDue };
    }
    
    // grab comments on the issue
    const comments = await kit.paginate('GET /repos/{owner}/{repo}/issues/{issue_number}/comments', {
        issue_number: issueId,
        owner,
        repo,
    });

    let needsRecording = true;
    let needsNotes = true;
    comments.forEach(({ body }) => {
        // if there's a link with "github.rewatch" inside, it doesn't need a recording
        if (body.includes('github.rewatch.com')) {
            needsRecording = false;
        }
    
        // if there's a link to notes, it doesn't need notes
        if (body.includes('/accessibility/blob/main/docs/deep-dive-notes/')) {
            needsNotes = false;
        }
    });

    return { needsRecording, needsNotes, pastDue };
}

export const getDeepDiveIssues = async (kit, { owner, repo }): Promise<DeepDiveIssueUpdate[]> => {
    const labels = "Deep-dive";
    const allIssues = await kit.paginate('GET /repos/{owner}/{repo}/issues', {
        owner,
        repo,
        labels,
        state: 'open'
    }).map(async issue => {
        const dueDate = getDueDateFromDeepDiveBody(issue.body);
        const missingUpdates: DeepDiveIssueUpdate['missingUpdates'] = await getMissingUpdates(kit, { dueDate, issueId: issue.id, owner, repo });
        const mappedIssue: DeepDiveIssueUpdate = {
            dueDate,
            id: issue.id,
            url: issue.url,
            missingFields: getMissingFieldsFromDeepDiveBody(issue.body),
            missingUpdates,
            title: issue.title,
        };

        // check for high priority status
        const isTomorrow = ((new Date(dueDate).getTime()) - (new Date().getTime())) <= oneDayMs;

        if (isTomorrow && (mappedIssue.missingFields.leader || mappedIssue.missingFields.leader)) {
           mappedIssue.highPriority = true;
        }

        return mappedIssue;
    });

    return allIssues;
}

export const formatDeepDiveUpdate = (deepDiveUpdate: DeepDiveIssueUpdate): string => {
    const reason = (() => {
        if (deepDiveUpdate.highPriority) {
            if (deepDiveUpdate.missingFields.leader) {
                return `Needs a leader ${deepDiveUpdate.missingFields.notetaker ? 'and a notetaker' : ''} to volunteer`;
            }
            if (deepDiveUpdate.missingFields.notetaker) {
                return 'Needs a notetaker to volunteer';
            }
        }
        
        if (deepDiveUpdate.missingUpdates.pastDue) {
            if (deepDiveUpdate.missingUpdates.needsNotes) {
                return 'Needs notes';
            }
            if (deepDiveUpdate.missingUpdates.needsRecording) {
                return 'Needs a rewatch recording';
            }
        } 
    })();
    return `${deepDiveUpdate.highPriority ? ':warning: Tomorrow\'s ' : ''}[${deepDiveUpdate.title}](${deepDiveUpdate.url}): ${reason}`;
}

async function getAndFormatDeepDiveUpdates(kit, { owner, repo }): Promise<string> {
    const allIssues = await getDeepDiveIssues(kit, { owner, repo });
    const updatesArray = allIssues.map(formatDeepDiveUpdate);

    return updatesArray.length
        ? `<li>${updatesArray.join('</li>\n')}`
        : '';
}
export default getAndFormatDeepDiveUpdates;

// Reference dataset shown on the demo page — the same channel-aware cleanup cases
// the cloud pipeline is eval'd against (services/pyai-proxy/eval/dataset.json).
// Kept as a small web-local copy (curated for display: raw → polished, without the
// machine-checkable assertions) so the marketing site stays self-contained and does
// not import across workspaces. Keep in sync with that dataset when cases change.
//
// `channel` here is the RESOLVED style (the eval dataset's `assert.resolvesTo`),
// not the raw alias a caller might send — so the demo groups by what the pipeline
// actually does. `app` still names the real source app (Outlook, Teams, VS Code…).

export type ExampleChannel = "gmail" | "slack" | "notes" | "docs" | "code" | "default";

export type DemoExample = {
  id: string;
  app: string;
  channel: ExampleChannel;
  useCase: string;
  raw: string;
  expected: string;
};

export const DATASET_EXAMPLES: DemoExample[] = [
  {
    id: "gmail-meeting-followup",
    app: "Gmail",
    channel: "gmail",
    useCase: "Formal email — follow-up after a meeting",
    raw: "hey um so it was really nice to meet you the other day uh i was wondering when can we meet next like maybe sometime next week",
    expected:
      "Hi,\n\nIt was really nice to meet you the other day. When could we meet next — perhaps sometime next week?\n\nThanks,",
  },
  {
    id: "email-alias-report-request",
    app: "Outlook",
    channel: "gmail",
    useCase: 'Formal email via the desktop "email" alias (maps to the email style)',
    raw: "can you please send me the q3 report by friday i need it for the board deck thanks",
    expected:
      "Hi,\n\nCould you please send me the Q3 report by Friday? I need it for the board deck.\n\nThanks,",
  },
  {
    id: "slack-fix-update",
    app: "Slack",
    channel: "slack",
    useCase: "Casual chat — quick teammate update, no greeting or sign-off",
    raw: "um yeah i just pushed the fix for the login bug it should be good now can you take a look when you get a sec",
    expected:
      "Just pushed the fix for the login bug — should be good now. Can you take a look when you get a sec?",
  },
  {
    id: "slack-teams-alias-standup",
    app: "Microsoft Teams",
    channel: "slack",
    useCase: 'Casual chat via the "teams" alias (maps to the Slack style)',
    raw: "hey are we still on for the standup at ten this morning",
    expected: "Are we still on for the standup at 10 this morning?",
  },
  {
    id: "notes-todo-list",
    app: "Apple Notes",
    channel: "notes",
    useCase: "Notes — a run-on to-do list becomes bullets",
    raw: "okay so i need to do a few things i need to email sarah and then i have to update the deck and also book the flights for the offsite",
    expected: "- Email Sarah\n- Update the deck\n- Book the flights for the offsite",
  },
  {
    id: "notes-notion-alias-takeaway",
    app: "Notion",
    channel: "notes",
    useCase: 'Notes via the "notion" alias — terse takeaway',
    raw: "meeting takeaway so basically the launch is getting pushed to march because of the api dependency that isn't ready yet",
    expected: "Launch pushed to March — API dependency not ready.",
  },
  {
    id: "docs-goal-prose",
    app: "Google Docs",
    channel: "docs",
    useCase: "Docs — clean prose, no email framing",
    raw: "um so basically the goal of this project is to reduce latency and uh we want to do that by caching and also by moving to a cdn",
    expected:
      "The goal of this project is to reduce latency, achieved through caching and by moving to a CDN.",
  },
  {
    id: "code-comment",
    app: "VS Code",
    channel: "code",
    useCase: 'Code via the "vscode" alias — terse technical comment',
    raw: "um this function retries the request three times with exponential backoff before giving up",
    expected: "Retries the request three times with exponential backoff before giving up.",
  },
  {
    id: "default-plain-cleanup",
    app: "TextEdit / unknown",
    channel: "default",
    useCase: "Default — plain cleanup, no target-app rewrite",
    raw: "um so i think we should uh probably go with the second option since it's cheaper",
    expected: "I think we should probably go with the second option since it's cheaper.",
  },
];

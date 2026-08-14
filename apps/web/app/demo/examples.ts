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

// Two longer, realistic dictation rambles — each shown across notes / slack / email
// so the SAME words visibly diverge by target: scannable bullets, a casual flowing
// message, or a formal structured email with greeting + sign-off. Shared here to keep
// the three renderings honestly identical in input.
const LAUNCH_UPDATE_RAW =
  "okay so um quick update on the mobile app launch uh we finished the payment integration yesterday and QA has been running through it since this morning there are still two bugs open one is the crash on the checkout screen when the coupon field is empty and the other is the slow load on the order history page um marketing wants to go live on the fifteenth but honestly i don't think we should ship until both of those are fixed we also need someone to update the app store screenshots before submission and i still have to write the release notes so that's roughly where we are let me know if you have any questions";

const OFFSITE_PLAN_RAW =
  "hey so i wanted to share some thoughts on the team offsite next month um i was thinking we could do it the week of the tenth somewhere close by so people don't have to travel too far ideally a place with good wifi since we'll run a couple of working sessions the rough plan is day one is strategy and planning day two is more hands on building and then we wrap up with a dinner in the evening i still need to get a rough headcount figure out the budget and check that everyone is okay with those dates so if you could reply with whether the week of the tenth works for you that would be super helpful thanks";

export const DATASET_EXAMPLES: DemoExample[] = [
  // ── Showcase: one long update, three destinations ──────────────────────────
  {
    id: "launch-update-notes",
    app: "Apple Notes",
    channel: "notes",
    useCase: "Notes — a long status ramble collapses to scannable bullets",
    raw: LAUNCH_UPDATE_RAW,
    expected:
      "Mobile app launch — status\n- Payment integration finished yesterday\n- QA running since this morning\n- Bug: checkout screen crashes when the coupon field is empty\n- Bug: order history page loads slowly\n- Marketing wants go-live on the 15th — hold until both bugs are fixed\n- Update App Store screenshots before submission\n- Write the release notes",
  },
  {
    id: "launch-update-slack",
    app: "Slack",
    channel: "slack",
    useCase: "Slack — same update, casual and flowing, no greeting or sign-off",
    raw: LAUNCH_UPDATE_RAW,
    expected:
      "Quick update on the mobile app launch 👇 Payment integration landed yesterday and QA's been running through it since this morning. Two bugs still open: the checkout screen crashes when the coupon field is empty, and the order history page loads slowly. Marketing wants to go live on the 15th, but I don't think we should ship until both are fixed. We also need someone to refresh the App Store screenshots, and I still have to write the release notes. Let me know if you have questions!",
  },
  {
    id: "launch-update-email",
    app: "Gmail",
    channel: "gmail",
    useCase: "Email — same update, formal with greeting, structure, and sign-off",
    raw: LAUNCH_UPDATE_RAW,
    expected:
      "Hi,\n\nHere's a quick update on the mobile app launch. We completed the payment integration yesterday, and QA has been testing since this morning.\n\nTwo issues remain open:\n- The checkout screen crashes when the coupon field is empty.\n- The order history page loads slowly.\n\nMarketing would like to go live on the 15th; however, I'd recommend we hold until both issues are resolved. We also need to update the App Store screenshots before submission, and I still need to write the release notes.\n\nPlease let me know if you have any questions.\n\nBest,",
  },
  // ── Showcase: one offsite plan, three destinations ─────────────────────────
  {
    id: "offsite-plan-notes",
    app: "Notion",
    channel: "notes",
    useCase: "Notes — a planning ramble becomes a tight outline",
    raw: OFFSITE_PLAN_RAW,
    expected:
      "Team offsite — next month\n- Proposed: week of the 10th, nearby venue (minimal travel)\n- Needs good wifi for working sessions\n- Day 1: strategy & planning\n- Day 2: hands-on building\n- Evening: wrap-up dinner\n- To do: get headcount, set budget, confirm dates with the team",
  },
  {
    id: "offsite-plan-slack",
    app: "Slack",
    channel: "slack",
    useCase: "Slack — same plan, conversational with a direct ask",
    raw: OFFSITE_PLAN_RAW,
    expected:
      "Some thoughts on the team offsite next month 🎉 I'm thinking the week of the 10th, somewhere close by so nobody has to travel far — ideally a spot with good wifi since we'll run a couple of working sessions. Rough plan: day 1 is strategy and planning, day 2 is hands-on building, and we wrap up with dinner. I still need a headcount, a budget, and to confirm the dates. Could you reply with whether the week of the 10th works for you? 🙏",
  },
  {
    id: "offsite-plan-email",
    app: "Outlook",
    channel: "gmail",
    useCase: "Email — same plan, formal invite with itinerary and sign-off",
    raw: OFFSITE_PLAN_RAW,
    expected:
      "Hi,\n\nI wanted to share some thoughts on the team offsite next month. I'm proposing the week of the 10th at a nearby venue, so no one has to travel far — ideally somewhere with reliable wifi, as we'll be running a couple of working sessions.\n\nThe rough plan is:\n- Day 1: strategy and planning\n- Day 2: hands-on building\n- Evening: a wrap-up dinner\n\nI still need to gather a headcount, set the budget, and confirm the dates. Could you let me know whether the week of the 10th works for you?\n\nThanks,",
  },
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

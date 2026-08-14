// Channel-aware dictation cleanup ("reads the room").
//
// The app resolves the OS's frontmost application at dictation start and maps it
// to a delivery *channel*. The cleanup prompt then adapts its tone to the
// channel — terse for notes, casual for chat, formal for email — so what lands
// at the cursor matches where it is going. See getCleanupSystemPrompt().

export type DictationChannel = "slack" | "email" | "notes" | "default";

export interface FrontmostApp {
  bundleId?: string | null;
  name?: string | null;
  /** Active tab URL when the frontmost app is a browser — tells us what it shows. */
  url?: string | null;
}

// Exact bundle-id → channel is the most reliable signal on macOS.
const BUNDLE_CHANNELS: Record<string, DictationChannel> = {
  // Chat / messaging → informal
  "com.tinyspeck.slackmacgap": "slack",
  "com.hnc.Discord": "slack",
  "com.microsoft.teams2": "slack",
  "com.microsoft.teams": "slack",
  "WhatsApp": "slack",
  "net.whatsapp.WhatsApp": "slack",
  "com.apple.MobileSMS": "slack", // Messages

  // Email → formal
  "com.apple.mail": "email",
  "com.microsoft.Outlook": "email",
  "com.readdle.smartemail-Mac": "email", // Spark
  "com.airmailapp.mac.airmail": "email",
  "com.CanaryMail": "email",

  // Notes / docs → short & precise
  "com.apple.Notes": "notes",
  "md.obsidian": "notes",
  "notion.id": "notes",
  "net.shinyfrog.bear": "notes",
  "com.agiletortoise.Drafts-OSX": "notes",
  "com.microsoft.onenote.mac": "notes",
};

// Web apps (Gmail, Outlook web, Slack web, Notion…) run inside a browser, so the
// app name is just "Google Chrome"/"Safari". The active tab URL's host tells us
// the real service. Matched as substrings on the lowercased URL.
const URL_RULES: { channel: DictationChannel; needles: string[] }[] = [
  {
    channel: "email",
    needles: [
      "mail.google.com",
      "outlook.office.com",
      "outlook.office365.com",
      "outlook.live.com",
      "mail.proton.me",
      "mail.yahoo.com",
      "fastmail.com",
      "mail.zoho.com",
      "app.hey.com",
    ],
  },
  {
    channel: "slack",
    needles: [
      "slack.com",
      "discord.com",
      "teams.microsoft.com",
      "teams.live.com",
      "chat.google.com",
      "web.whatsapp.com",
      "web.telegram.org",
      "messenger.com",
    ],
  },
  {
    channel: "notes",
    needles: [
      "notion.so",
      ".notion.site",
      "docs.google.com",
      "keep.google.com",
      "evernote.com",
      "coda.io",
      ".atlassian.net",
      "onenote.com",
    ],
  },
];

// Substring fallbacks on the localized app name, for native apps not pinned above.
const NAME_RULES: { channel: DictationChannel; needles: string[] }[] = [
  { channel: "slack", needles: ["slack", "discord", "teams", "whatsapp", "telegram", "messages", "messenger"] },
  { channel: "email", needles: ["mail", "outlook", "spark", "airmail", "canary", "postbox"] },
  { channel: "notes", needles: ["notes", "obsidian", "notion", "bear", "drafts", "onenote", "craft", "logseq"] },
];

export function classifyChannel(app: FrontmostApp | null | undefined): DictationChannel {
  if (!app) return "default";

  // Browser tab URL wins — it's the only reliable signal for web apps, and it
  // overrides the (generic) browser bundle id.
  const url = (app.url ?? "").toLowerCase();
  if (url) {
    for (const rule of URL_RULES) {
      if (rule.needles.some((n) => url.includes(n))) return rule.channel;
    }
  }

  const bundleId = app.bundleId ?? "";
  if (bundleId && BUNDLE_CHANNELS[bundleId]) return BUNDLE_CHANNELS[bundleId];

  const name = (app.name ?? "").toLowerCase();
  if (name) {
    for (const rule of NAME_RULES) {
      if (rule.needles.some((n) => name.includes(n))) return rule.channel;
    }
  }
  return "default";
}

// Tone guidance appended to the cleanup system prompt per channel. Kept as
// additive instructions so the base cleanup contract (never answer, preserve
// meaning, keep the speaker's words) still governs.
const CHANNEL_TONE: Record<DictationChannel, string> = {
  slack:
    "\n\nDELIVERY CONTEXT — the cleaned text is being written into a chat/messaging app (e.g. Slack). " +
    "Match that register: casual, warm, and conversational, the way a colleague messages a teammate. " +
    "Contractions are natural; light informality is fine. Do NOT add greetings, sign-offs, or extra pleasantries the speaker didn't say.",
  email:
    "\n\nDELIVERY CONTEXT — the cleaned text is an EMAIL, so format it as a complete, professional email. " +
    "IMPORTANT: for this email context ONLY, the general rule against adding words the speaker didn't say is RELAXED for email framing — " +
    "you MUST add a brief greeting on its own line at the top (use \"Hi,\" — add the recipient's name only if the speaker said it) " +
    "and a short courteous sign-off on its own line at the bottom (e.g. \"Thanks,\" or \"Best,\"), even when the speaker didn't dictate them. " +
    "Write the body in a polished, professional, courteous register with complete sentences and correct grammar. " +
    "Do NOT invent a subject line, a signature or full name, or any facts, names, or numbers the speaker didn't say.",
  notes:
    "\n\nDELIVERY CONTEXT — the cleaned text is being written into a notes/docs app. " +
    "Keep it short, precise, and terse: trim redundancy and filler, favor compact phrasing, and drop conversational padding — " +
    "while preserving every fact, name, and number exactly.",
  default: "",
};

export function getChannelToneSuffix(channel: DictationChannel): string {
  return CHANNEL_TONE[channel] ?? "";
}

// Transient channel for the in-flight dictation. Set at recording start (once
// the frontmost app resolves) and read when the cleanup prompt is built. Renderer
// is single-window for cleanup, so a module-level value is sufficient and avoids
// threading a new field through the whole reasoning config.
let activeChannel: DictationChannel = "default";

export function setActiveDictationChannel(channel: DictationChannel): void {
  activeChannel = channel;
}

export function getActiveDictationChannel(): DictationChannel {
  return activeChannel;
}

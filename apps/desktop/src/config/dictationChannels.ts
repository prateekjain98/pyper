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

// Substring fallbacks on the localized app name, for apps not pinned above.
const NAME_RULES: { channel: DictationChannel; needles: string[] }[] = [
  { channel: "slack", needles: ["slack", "discord", "teams", "whatsapp", "telegram", "messages", "messenger"] },
  { channel: "email", needles: ["mail", "outlook", "spark", "airmail", "canary", "postbox"] },
  { channel: "notes", needles: ["notes", "obsidian", "notion", "bear", "drafts", "onenote", "craft", "logseq"] },
];

export function classifyChannel(app: FrontmostApp | null | undefined): DictationChannel {
  if (!app) return "default";

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
    "\n\nDELIVERY CONTEXT — the cleaned text is being written into an email. " +
    "Use a polished, professional, and courteous register with complete sentences and correct grammar. " +
    "Do NOT invent a greeting, subject line, or sign-off unless the speaker dictated one.",
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

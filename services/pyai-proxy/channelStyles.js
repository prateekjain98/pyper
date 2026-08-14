// Channel-aware cleanup styles for the PyAI proxy /cleanup pipeline.
//
// Cleanup runs a two-part system prompt: the base transcript-cleanup rules
// (mirroring the desktop app), plus an optional per-target-app REWRITE that
// adapts the cleaned text for where it is headed (Slack vs email vs notes …).
// Extracted into its own module so the eval suite (eval/run.mjs) can validate
// the routing without booting the HTTP server.

// Per-target-app tone. The rewrite (applyChannelStyle) OVERRIDES the base
// "output exactly the cleaned transcript" rule, so a style may add/drop
// greetings, reflow into bullets, and shift formality — never the facts.
export const CHANNEL_STYLES = {
  slack:
    "a casual, friendly Slack message — conversational and relaxed, contractions and a warm tone welcome, no greeting or sign-off, kept short",
  gmail:
    'a formal, respectful email — professional and courteous, in complete sentences, with an appropriate greeting on its own line (e.g. "Hi,") and a courteous sign-off on its own line (e.g. "Thanks," or "Best,"); add the greeting and sign-off even if the speaker didn\'t dictate them',
  notes:
    "concise notes — the shortest form that preserves the meaning: terse fragments or bullet points, with pleasantries and filler dropped",
  docs:
    "clear document prose — well-structured full sentences and short paragraphs, with headings or bullet lists where the content naturally calls for them; professional but not stiff, no email greeting or sign-off",
  code:
    "a concise, technical code comment or commit-style note — imperative and minimal, no greeting, sign-off, or marketing tone; keep identifiers and code terms verbatim",
};

// Callers name the target app differently (desktop sends "email"; browsers/apps
// vary). Normalize common aliases onto the CHANNEL_STYLES keys so, e.g., a Gmail
// tab and an Outlook desktop client both get the email style.
export const CHANNEL_ALIASES = {
  email: "gmail",
  outlook: "gmail",
  mail: "gmail",
  spark: "gmail",
  chat: "slack",
  teams: "slack",
  discord: "slack",
  messages: "slack",
  message: "slack",
  imessage: "slack",
  whatsapp: "slack",
  telegram: "slack",
  note: "notes",
  notion: "notes",
  obsidian: "notes",
  bear: "notes",
  doc: "docs",
  document: "docs",
  "google docs": "docs",
  word: "docs",
  editor: "code",
  ide: "code",
  vscode: "code",
  terminal: "code",
};

// Resolve a caller-supplied channel to a CHANNEL_STYLES key, or "" for
// unknown/empty (→ base cleanup, no rewrite).
export function normalizeChannel(channel) {
  const c = String(channel || "").trim().toLowerCase();
  if (!c) return "";
  if (CHANNEL_STYLES[c]) return c;
  return CHANNEL_ALIASES[c] || c;
}

// Build the full cleanup system prompt for a channel: the base prompt, plus the
// target-app rewrite when the channel maps to a known style. Unknown/empty
// channel → base prompt unchanged (backward compatible with { text } callers).
export function applyChannelStyle(basePrompt, channel) {
  const style = CHANNEL_STYLES[normalizeChannel(channel)];
  if (!style) return basePrompt;
  return `${basePrompt}

TARGET-APP REWRITE — this section OVERRIDES the "keep the speaker's voice/formality" rule and the "output exactly the cleaned transcript and nothing else" rule above. After cleaning, rewrite the message so it reads naturally as ${style}. You may add or drop greetings and sign-offs, reflow into bullet points, and shift wording, length, and formality to fit — but never change the facts, names, numbers, or the speaker's intent. Output only the rewritten message.`;
}

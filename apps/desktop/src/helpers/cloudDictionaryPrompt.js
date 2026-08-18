// Carry the user's custom dictionary across the Pyper Cloud IPC boundary.
//
// THE BUG THIS FIXES: the renderer computed the dictionary hint for every
// transcription route (audioManager.getWhisperPrompt) and handed it to the main
// process, but the two Pyper Cloud handlers threw it away:
//   * "cloud-transcribe" read only opts.language off `opts` and posted raw WAV
//     to the PyAI proxy — opts.prompt never left the machine.
//   * "cloud-reason" (promptMode "cleanup") posted only { text, channel,
//     translateTo } — opts.customDictionary never left the machine.
// Local Whisper (initialPrompt -> whisperServer) and BYOK OpenAI (multipart
// "prompt" field) always forwarded it, so the dictionary appeared to work
// everywhere EXCEPT Pyper Cloud — which is the default transcription mode.
//
// Transport notes:
//   * /transcribe's body is the raw audio, so the prompt has to ride on a
//     header. Dictionary words are user content (real names), so they must not
//     go in the query string, where Cloud Run logs full request URLs.
//   * HTTP header values are ISO-8859-1; a Hindi/Chinese/accented name in a raw
//     header makes fetch throw. The value is therefore base64(UTF-8), which the
//     proxy decodes.
//   * The proxy's STT waterfall can land on Groq whisper-large-v3, whose prompt
//     ceiling is 224 tokens (~890 chars) — the tightest engine in the chain, so
//     it sets the cap for everyone.

const CLOUD_PROMPT_HEADER = "x-pyper-prompt-b64";

// Matches the Groq branch of MAX_PROMPT_CHARS in audioManager.processWithOpenAIAPI.
const MAX_CLOUD_PROMPT_CHARS = 890;

/**
 * Trim a dictionary prompt to the engine ceiling on a comma boundary so the cap
 * never slices a name in half ("Prateek, Sriva" teaches the model a non-word).
 *
 * @param {unknown} prompt
 * @param {number} [maxChars]
 * @returns {string} the trimmed prompt, or "" when there is nothing to send
 */
function truncateCloudPrompt(prompt, maxChars = MAX_CLOUD_PROMPT_CHARS) {
  if (typeof prompt !== "string") return "";
  const trimmed = prompt.trim();
  if (trimmed.length <= maxChars) return trimmed;
  const cut = trimmed.slice(0, maxChars);
  const lastComma = cut.lastIndexOf(",");
  return (lastComma > 0 ? cut.slice(0, lastComma) : cut).trim();
}

/**
 * Headers for a POST /transcribe call to the PyAI proxy. Returns the audio
 * content-type alone when there is no dictionary, so a user with an empty
 * dictionary produces the exact request shape as before.
 *
 * @param {unknown} prompt comma-joined dictionary hint (audioManager.getWhisperPrompt)
 * @returns {Record<string, string>}
 */
function buildCloudTranscribeHeaders(prompt) {
  const headers = { "content-type": "audio/wav" };
  const value = truncateCloudPrompt(prompt);
  if (!value) return headers;
  headers[CLOUD_PROMPT_HEADER] = Buffer.from(value, "utf8").toString("base64");
  return headers;
}

/**
 * Inverse of buildCloudTranscribeHeaders — used by the proxy and by tests to
 * prove a word survives the trip. Never throws on a malformed header.
 *
 * @param {Record<string, unknown> | undefined | null} headers
 * @returns {string} the decoded prompt, or ""
 */
function readCloudTranscribePrompt(headers) {
  const raw = headers?.[CLOUD_PROMPT_HEADER];
  if (typeof raw !== "string" || !raw) return "";
  try {
    return Buffer.from(raw, "base64").toString("utf8").trim();
  } catch {
    return "";
  }
}

/**
 * Body for a POST /cleanup call to the PyAI proxy. `dictionary` is omitted
 * entirely when empty so the request stays byte-identical to the old shape.
 *
 * @param {{ text: string, channel?: unknown, translateTo?: unknown,
 *           customDictionary?: unknown }} opts
 * @returns {{ text: string, channel: unknown, translateTo: unknown,
 *             dictionary?: string[] }}
 */
function buildCloudCleanupBody({ text, channel, translateTo, customDictionary } = {}) {
  const body = { text, channel, translateTo };
  const words = Array.isArray(customDictionary)
    ? customDictionary.filter((w) => typeof w === "string" && w.trim()).map((w) => w.trim())
    : [];
  if (words.length > 0) body.dictionary = words;
  return body;
}

module.exports = {
  CLOUD_PROMPT_HEADER,
  MAX_CLOUD_PROMPT_CHARS,
  truncateCloudPrompt,
  buildCloudTranscribeHeaders,
  readCloudTranscribePrompt,
  buildCloudCleanupBody,
};

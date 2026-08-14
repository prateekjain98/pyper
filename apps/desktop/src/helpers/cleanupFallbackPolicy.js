// Decides when a failed BYOK dictation-cleanup call should fall through to Pyper
// Cloud cleanup (which itself runs the server-side waterfall Ollama → Anthropic →
// OpenAI) before the final soft-fail to the raw transcript. Kept free of electron
// imports so the rules stay unit-testable (see cleanupFallbackPolicy.test.js).
//
// This is the desktop half of the "run out of credits → default to the next
// provider" waterfall: the shared proxy handles the cloud chain; here a user's
// own (BYOK) cloud key falling over hands off to that cloud chain instead of
// silently dropping to the un-cleaned transcript.

// Providers whose text already leaves the machine for a third-party cloud, so
// handing off to Pyper Cloud crosses no new privacy boundary. Deliberately
// EXCLUDES local, lan, custom (self-hosted / private endpoints) and the
// enterprise providers (bedrock/azure/vertex) — those must never be redirected
// to Pyper Cloud, both for privacy and for enterprise policy compliance.
export const CLOUD_FALLBACK_PROVIDERS = new Set([
  "openai",
  "anthropic",
  "gemini",
  "groq",
  "tinfoil",
  "corti",
  "openrouter",
]);

// Error codes/phrases that mean "this provider can't serve right now" — a rate
// limit, an exhausted balance, or a server fault — the cases a waterfall exists
// to route around. A 4xx that isn't 402/429 is a deterministic rejection (bad
// request, auth) and is NOT worth a fallback; it would fail the same way.
const FALLOVER_CODES = new Set([
  "PROVIDER_RATE_LIMITED",
  "LIMIT_REACHED",
  "insufficient_quota",
]);

const FALLOVER_MESSAGE_RE =
  /rate limit|rate-limit|too many requests|insufficient_quota|exceeded your current quota|quota exceeded|out of credits|credit balance is too low|payment required|billing_hard_limit|insufficient (funds|balance|credits?)|overloaded|service unavailable/i;

export function isCleanupFalloverError(error) {
  if (!error) return false;
  const status = error.status ?? error.statusCode ?? error.response?.status;
  if (typeof status === "number") {
    if (status === 429 || status === 402) return true;
    if (status >= 500 && status < 600) return true;
    // Any other explicit HTTP status is a deterministic rejection: don't fall over.
    if (status >= 400) return false;
  }
  if (error.code && FALLOVER_CODES.has(String(error.code))) return true;
  return FALLOVER_MESSAGE_RE.test(String(error.message || ""));
}

// Whether a fallen-over BYOK cleanup may hand off to Pyper Cloud. Only cloud
// providers with no self-hosted endpoint qualify; a remote/LAN URL means the
// user pointed cleanup at their own box and must not be redirected.
export function shouldTryCloudCleanupFallback({
  provider,
  mode,
  hasRemoteUrl = false,
  enabled = true,
} = {}) {
  if (!enabled) return false;
  if (hasRemoteUrl) return false;
  if (mode === "self-hosted" || mode === "local" || mode === "enterprise") return false;
  return CLOUD_FALLBACK_PROVIDERS.has(provider);
}

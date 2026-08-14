// Engine adapter for the live demo — a provider + API-key SWITCH.
//
// Every supported engine is OpenAI-compatible, so the whole pipeline reduces to
// selecting { baseUrl, apiKey, model } per role:
//   • STT     → POST {baseUrl}/audio/transcriptions   (multipart, model=sttModel)
//   • cleanup → POST {baseUrl}/chat/completions        (model=chatModel)
//
// Swapping engines is env-only, no code changes:
//   STT_PROVIDER      (default "pyai")  — engine used to transcribe
//   CLEANUP_PROVIDER  (default "pyai")  — engine used to clean up the transcript
//   STT_MODEL / CLEANUP_MODEL           — optional global model overrides
//   <PROVIDER>_BASE_URL                 — optional per-provider base-URL override
//   <PROVIDER>_STT_MODEL / _CLEANUP_MODEL — optional per-provider model override
// Keys always come from each provider's own apiKeyEnv (e.g. PYAI_API_KEY).
//
// NOTE: PyAI (Pyper's own cloud engine, api.pyai.com) is VOICE-ONLY — its catalog
// is pyai-hear / pyai-voice / pyai-omni-realtime / pyai-amd and it exposes no
// /chat/completions. So `pyai.chatModel` is null: with the default
// CLEANUP_PROVIDER=pyai the demo transcribes but reports cleanup as
// "not configured" (rather than calling a chat endpoint that 404s). Point
// CLEANUP_PROVIDER at a chat-capable engine (e.g. openai) to enable cleanup.

export interface EngineDef {
  id: string;
  /** Default OpenAI-compatible base URL; overridable via <PROVIDER>_BASE_URL. */
  baseUrl: string;
  /** Env var that holds this provider's API key. */
  apiKeyEnv: string;
  /** Default speech-to-text model id (empty for cleanup-only engines). */
  sttModel: string;
  /** Default chat model for cleanup, or null when the provider has no chat model. */
  chatModel: string | null;
  /** True when the provider needs no API key (e.g. a bare self-hosted Ollama). */
  keyOptional?: boolean;
}

export const ENGINES: Record<string, EngineDef> = {
  // Pyper's own cloud engine. Voice-only — no chat model, so never usable for cleanup.
  pyai: {
    id: "pyai",
    baseUrl: "https://api.pyai.com/v1",
    apiKeyEnv: "PYAI_API_KEY",
    sttModel: "pyai-hear",
    chatModel: null,
  },
  // Self-hosted / hosted Ollama — OpenAI-compatible chat under /v1. No public
  // default base (must be provided); key optional (bare Ollama is unauthenticated).
  ollama: {
    id: "ollama",
    baseUrl: "",
    apiKeyEnv: "OLLAMA_API_KEY",
    sttModel: "",
    chatModel: "llama3.1",
    keyOptional: true,
  },
  // Anthropic via its OpenAI-compatibility endpoint (/v1/chat/completions, Bearer key).
  anthropic: {
    id: "anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    apiKeyEnv: "ANTHROPIC_API_KEY",
    sttModel: "",
    chatModel: "claude-haiku-4-5",
  },
  openai: {
    id: "openai",
    baseUrl: "https://api.openai.com/v1",
    apiKeyEnv: "OPENAI_API_KEY",
    sttModel: "gpt-4o-transcribe",
    chatModel: "gpt-4o-mini",
  },
  groq: {
    id: "groq",
    baseUrl: "https://api.groq.com/openai/v1",
    apiKeyEnv: "GROQ_API_KEY",
    sttModel: "whisper-large-v3",
    chatModel: "llama-3.3-70b-versatile",
  },
};

/** Cleanup waterfall order when CLEANUP_PROVIDERS / CLEANUP_PROVIDER are unset. */
export const DEFAULT_CLEANUP_CHAIN = ["ollama", "anthropic", "openai"];

export type EngineRole = "stt" | "cleanup";

export interface ResolvedEngine {
  id: string;
  baseUrl: string;
  apiKey: string | undefined;
  apiKeyEnv: string;
  /** Resolved STT model (always present). */
  sttModel: string;
  /** Resolved chat model, or null when this provider has no chat model. */
  chatModel: string | null;
  /** True when the provider needs no API key. */
  keyOptional: boolean;
}

/** Uppercase, env-safe prefix for a provider id (e.g. "pyai" → "PYAI"). */
function prefix(id: string): string {
  return id.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
}

// A lone legacy CLEANUP_PROVIDER lets the old global CLEANUP_MODEL still apply.
const legacySingleCleanup = () =>
  !process.env.CLEANUP_PROVIDERS && !!process.env.CLEANUP_PROVIDER;

/** Resolve a single engine id to concrete config, applying env overrides. */
function resolveEngineById(id: string): ResolvedEngine | null {
  const def = ENGINES[id];
  if (!def) return null;
  const px = prefix(id);
  const baseUrl = (process.env[`${px}_BASE_URL`] || def.baseUrl).replace(/\/+$/, "");
  const sttModel =
    process.env.STT_MODEL ||
    process.env[`${px}_STT_MODEL`] ||
    process.env[`${px}_TRANSCRIBE_MODEL`] ||
    def.sttModel;
  const chatModel =
    process.env[`${px}_CLEANUP_MODEL`] ||
    (legacySingleCleanup() ? process.env.CLEANUP_MODEL : undefined) ||
    def.chatModel;
  return {
    id,
    baseUrl,
    apiKey: process.env[def.apiKeyEnv],
    apiKeyEnv: def.apiKeyEnv,
    sttModel,
    chatModel,
    keyOptional: !!def.keyOptional,
  };
}

/** The provider id selected for a role via env. STT defaults to "pyai". */
export function selectedProviderId(role: EngineRole): string {
  if (role === "stt") return (process.env.STT_PROVIDER || "pyai").trim().toLowerCase();
  return selectedCleanupChainIds()[0] ?? "pyai";
}

/** A cleanup engine is usable only with a base URL, a chat model, and a key
 *  (unless keyOptional). Unusable links are skipped in the waterfall. */
export function isCleanupUsable(e: ResolvedEngine | null | undefined): e is ResolvedEngine {
  return !!e && !!e.baseUrl && !!e.chatModel && (e.keyOptional || !!e.apiKey);
}

/** The ordered cleanup provider ids from CLEANUP_PROVIDERS / CLEANUP_PROVIDER,
 *  falling back to the default waterfall. */
export function selectedCleanupChainIds(): string[] {
  return (
    process.env.CLEANUP_PROVIDERS ||
    process.env.CLEANUP_PROVIDER ||
    DEFAULT_CLEANUP_CHAIN.join(",")
  )
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((id) => ENGINES[id]);
}

/** The full resolved cleanup waterfall (every configured id, in order). */
export function resolveCleanupChain(): ResolvedEngine[] {
  return selectedCleanupChainIds()
    .map(resolveEngineById)
    .filter((e): e is ResolvedEngine => !!e);
}

/** Only the links usable right now — the live waterfall /api/cleanup runs. */
export function usableCleanupChain(): ResolvedEngine[] {
  return resolveCleanupChain().filter(isCleanupUsable);
}

/**
 * Resolve the engine for a role. For "stt" this is the single STT provider; for
 * "cleanup" it is the first USABLE link in the waterfall (or, if none is usable,
 * the first configured link so callers can report why it isn't ready).
 * Returns null when the selected provider id is not in the registry.
 */
export function resolveEngine(role: EngineRole): ResolvedEngine | null {
  if (role === "cleanup") {
    return usableCleanupChain()[0] ?? resolveCleanupChain()[0] ?? null;
  }
  return resolveEngineById(selectedProviderId("stt"));
}

export const KNOWN_PROVIDER_IDS = Object.keys(ENGINES);

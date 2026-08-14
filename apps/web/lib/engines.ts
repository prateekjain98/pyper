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
  /** Default speech-to-text model id. */
  sttModel: string;
  /** Default chat model for cleanup, or null when the provider has no chat model. */
  chatModel: string | null;
}

export const ENGINES: Record<string, EngineDef> = {
  // Pyper's own cloud engine. Voice-only — no chat model.
  pyai: {
    id: "pyai",
    baseUrl: "https://api.pyai.com/v1",
    apiKeyEnv: "PYAI_API_KEY",
    sttModel: "pyai-hear",
    chatModel: null,
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
}

/** Uppercase, env-safe prefix for a provider id (e.g. "pyai" → "PYAI"). */
function prefix(id: string): string {
  return id.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
}

/** The provider id selected for a role via env, defaulting to "pyai". */
export function selectedProviderId(role: EngineRole): string {
  const raw = role === "stt" ? process.env.STT_PROVIDER : process.env.CLEANUP_PROVIDER;
  return (raw || "pyai").trim().toLowerCase();
}

/**
 * Resolve the engine for a role, applying env overrides for base URL, models and
 * key. Returns null when the selected provider id is not in the registry.
 */
export function resolveEngine(role: EngineRole): ResolvedEngine | null {
  const id = selectedProviderId(role);
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
    process.env.CLEANUP_MODEL || process.env[`${px}_CLEANUP_MODEL`] || def.chatModel;

  return {
    id,
    baseUrl,
    apiKey: process.env[def.apiKeyEnv],
    apiKeyEnv: def.apiKeyEnv,
    sttModel,
    chatModel,
  };
}

export const KNOWN_PROVIDER_IDS = Object.keys(ENGINES);

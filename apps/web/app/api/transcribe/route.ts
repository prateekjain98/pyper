// Server-side speech-to-text proxy for the live demo. Resolves the STT engine
// from env (STT_PROVIDER, default "pyai" = Pyper's own cloud engine) via the
// OpenAI-compatible adapter in lib/engines.ts, then POSTs the audio to
// {baseUrl}/audio/transcriptions. Runs on the server so the browser has no CORS
// problem and the API key never reaches the client.
//
// Swap engines with env only — e.g. STT_PROVIDER=openai + OPENAI_API_KEY — no
// code changes. See apps/web/.env.example.
import { resolveEngine, selectedProviderId, KNOWN_PROVIDER_IDS } from "@/lib/engines";

export const runtime = "nodejs";

// Lightweight config probe (no upstream call) so the UI can show which engine is
// wired and whether transcription is ready, before the user records anything.
export async function GET(): Promise<Response> {
  const engine = resolveEngine("stt");
  return Response.json({
    available: !!(engine && engine.apiKey),
    provider: engine?.id ?? selectedProviderId("stt"),
    model: engine?.sttModel ?? null,
    apiKeyEnv: engine?.apiKeyEnv ?? null,
  });
}

export async function POST(req: Request): Promise<Response> {
  const engine = resolveEngine("stt");
  if (!engine) {
    return Response.json(
      {
        error: `Unknown STT_PROVIDER "${selectedProviderId("stt")}". Known providers: ${KNOWN_PROVIDER_IDS.join(", ")}.`,
        code: "STT_PROVIDER_UNKNOWN",
      },
      { status: 501 },
    );
  }
  if (!engine.apiKey) {
    return Response.json(
      {
        error: `Transcription engine "${engine.id}" is not configured — set ${engine.apiKeyEnv} on the server.`,
        code: "STT_NOT_CONFIGURED",
      },
      { status: 501 },
    );
  }

  const inForm = await req.formData();
  const file = inForm.get("file");
  if (!(file instanceof Blob)) {
    return Response.json({ error: "No audio uploaded." }, { status: 400 });
  }
  const language = (inForm.get("language") as string) || undefined;

  const form = new FormData();
  form.append("file", file, "dictation.webm");
  form.append("model", engine.sttModel);
  form.append("response_format", "json");
  if (language) form.append("language", language);

  let upstream: Response;
  try {
    upstream = await fetch(`${engine.baseUrl}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${engine.apiKey}` },
      body: form,
    });
  } catch (e) {
    return Response.json(
      { error: `Could not reach the transcription engine: ${(e as Error).message}` },
      { status: 502 },
    );
  }

  if (!upstream.ok) {
    const detail = (await upstream.text()).slice(0, 300);
    return Response.json(
      { error: `Transcription failed (${upstream.status}).`, detail },
      { status: 502 },
    );
  }

  // OpenAI-compatible STT returns { text }. Fall back to joining segment/result
  // text for verbose-style payloads, so diarizing engines still yield a string.
  const data = (await upstream.json()) as {
    text?: string;
    segments?: { text?: string }[];
    results?: { text?: string }[];
  };
  let text = (data.text ?? "").trim();
  if (!text && Array.isArray(data.segments)) {
    text = data.segments.map((s) => s.text ?? "").join(" ").trim();
  }
  if (!text && Array.isArray(data.results)) {
    text = data.results.map((s) => s.text ?? "").join(" ").trim();
  }
  return Response.json({ text, provider: engine.id, model: engine.sttModel });
}

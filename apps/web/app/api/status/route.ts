// Backend status feed for the /status page. Fetches the Cloud Run proxy's deep
// /status probe (which is where the API keys live, so it's the only place that
// can tell whether a key is out of credits) and normalizes it, adding the
// proxy's own reachability + latency as measured from the web host.
//
// Kept server-side so the browser talks only to same-origin /api/status — no
// dependence on the proxy's CORS allowlist, and one place to shape the payload.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Same default as the demo (apps/web/app/demo/page.tsx). The proxy base is the
// transcribe URL minus the /transcribe suffix; /status lives alongside /health.
const PROXY_BASE = (
  process.env.NEXT_PUBLIC_TRANSCRIBE_URL ||
  "https://pyai-proxy-772208668555.us-central1.run.app/transcribe"
)
  .replace(/\/transcribe\/?$/, "")
  .replace(/\/+$/, "");

const TIMEOUT_MS = 15_000;

type ProxyPayload = {
  generatedAt?: string;
  overall?: string;
  anyOutOfCredits?: boolean;
  outOfCreditsKeys?: string[];
  cleanup?: Record<string, unknown>;
  services?: unknown[];
  proxy?: Record<string, unknown>;
  cached?: boolean;
  cacheAgeMs?: number;
};

function unreachable(base: string, extra: Record<string, unknown>): Response {
  // Always 200 so the client renders the outage cleanly from the payload rather
  // than throwing on a non-OK fetch.
  return Response.json(
    {
      ok: false,
      generatedAt: new Date().toISOString(),
      overall: "major_outage",
      anyOutOfCredits: false,
      outOfCreditsKeys: [],
      services: [],
      proxy: { status: "unreachable", base, ...extra },
    },
    { status: 200 },
  );
}

export async function GET(req: Request): Promise<Response> {
  const force = new URL(req.url).searchParams.get("force") === "1";
  const url = `${PROXY_BASE}/status${force ? "?force=1" : ""}`;

  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { cache: "no-store", signal: ctrl.signal });
    const latencyMs = Date.now() - started;
    if (!r.ok) {
      const detail = (await r.text()).slice(0, 200);
      return unreachable(PROXY_BASE, { httpStatus: r.status, latencyMs, detail });
    }
    const data = (await r.json()) as ProxyPayload;
    return Response.json(
      {
        ok: true,
        ...data,
        proxy: {
          status: "operational",
          base: PROXY_BASE,
          latencyMs,
          ...(data.proxy ?? {}),
        },
      },
      { status: 200 },
    );
  } catch (e) {
    const latencyMs = Date.now() - started;
    const timedOut = (e as Error)?.name === "AbortError";
    return unreachable(PROXY_BASE, {
      latencyMs,
      detail: timedOut ? "proxy timed out" : (e as Error).message,
    });
  } finally {
    clearTimeout(timer);
  }
}

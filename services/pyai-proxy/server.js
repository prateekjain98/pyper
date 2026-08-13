// pyai-proxy — a tiny Cloud Run service that fronts Pyper's PyAI transcription
// engine for the public /demo. It holds the PyAI key (mounted from GCP Secret
// Manager), so the browser can call it directly (CORS-gated) and Vercel needs
// NO secret. Browser → this proxy → api.pyai.com.
//
// Body: raw audio (audio/wav) in the POST body. Response: PyAI's {text} JSON.
// Node 20+ built-ins only (http, fetch, FormData, Blob) — no dependencies.
import http from "node:http";

const PORT = process.env.PORT || 8080;
const PYAI_BASE = (process.env.PYAI_BASE_URL || "https://api.pyai.com/v1").replace(/\/+$/, "");
const KEY = process.env.PYAI_API_KEY;
const STT_MODEL = process.env.PYAI_STT_MODEL || "pyai-hear";
const MAX_BYTES = 25 * 1024 * 1024;

// Origin allowlist — bounds browser abuse of the shared key. Extend via
// ALLOW_ORIGINS (comma-separated); *.vercel.app previews are always allowed.
const ALLOWED = (process.env.ALLOW_ORIGINS || "http://localhost:3000,https://pyper.work")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function allowOrigin(origin) {
  if (!origin) return null;
  if (ALLOWED.includes(origin)) return origin;
  if (/^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin)) return origin;
  return null;
}

function json(res, status, obj, origin) {
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(obj));
}

const server = http.createServer(async (req, res) => {
  const origin = allowOrigin(req.headers.origin);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "GET" && (req.url === "/" || req.url.startsWith("/health"))) {
    json(res, 200, { ok: true, provider: "pyai", model: STT_MODEL, configured: Boolean(KEY) }, origin);
    return;
  }

  if (req.method === "POST" && req.url.startsWith("/transcribe")) {
    // Reject cross-site browser calls (has an Origin we don't allow). Non-browser
    // clients send no Origin; the shared key is a limited test key.
    if (req.headers.origin && !origin) {
      json(res, 403, { error: "Origin not allowed." }, null);
      return;
    }
    if (!KEY) {
      json(res, 501, { error: "PYAI_API_KEY not configured on the proxy." }, origin);
      return;
    }
    try {
      const chunks = [];
      let size = 0;
      for await (const c of req) {
        size += c.length;
        if (size > MAX_BYTES) {
          json(res, 413, { error: "Audio too large." }, origin);
          req.destroy();
          return;
        }
        chunks.push(c);
      }
      const audio = Buffer.concat(chunks);
      const form = new FormData();
      form.append("file", new Blob([audio], { type: req.headers["content-type"] || "audio/wav" }), "dictation.wav");
      form.append("model", STT_MODEL);
      form.append("response_format", "json");

      const up = await fetch(`${PYAI_BASE}/audio/transcriptions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${KEY}` },
        body: form,
      });
      const text = await up.text();
      if (up.ok) {
        if (origin) res.setHeader("Access-Control-Allow-Origin", origin);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(text);
      } else {
        json(res, 502, { error: `Transcription failed (${up.status}).`, detail: text.slice(0, 300) }, origin);
      }
    } catch (e) {
      json(res, 502, { error: `Proxy error: ${e?.message || String(e)}` }, origin);
    }
    return;
  }

  json(res, 404, { error: "Not found." }, origin);
});

server.listen(PORT, () => console.log(`pyai-proxy listening on :${PORT}`));

/**
 * Response helpers that reproduce the exact envelope the desktop transport
 * expects (apps/desktop/src/helpers/cloudApiRequest.js):
 *   - success  → BARE JSON body (the transport wraps it as { success, data }).
 *   - error    → read as { error: {message} | string, code, data }.
 *   - HTTP 401 → mapped to AUTH_EXPIRED regardless of body.
 *   - HTTP 409 conflicts carry { code, data: { note | folder } }.
 */
export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body ?? null), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function apiError(message: string, status: number, code?: string, data?: unknown): Response {
  return json({ error: { message }, code, data }, status);
}

export const unauthorized = () => apiError("Session expired", 401, "AUTH_EXPIRED");

/** 501 for sync endpoints not yet ported — see README entity checklist. */
export const notImplemented = (path: string) =>
  apiError(`Not implemented on Convex yet: ${path}`, 501, "NOT_IMPLEMENTED");

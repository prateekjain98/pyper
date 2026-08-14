'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

// The desktop app's OAuth loopback flow (apps/desktop/src/helpers/oauthLoopbackFlow.js)
// redirects the browser here after it has already exchanged the code and saved
// the tokens locally. This page is purely a human-facing confirmation — the
// connection itself is complete by the time it loads. One provider entry per
// loopback OAuth flow; success/error param names mirror `errorParam` there.
const PROVIDERS = [
  { connectedParam: 'gcal_connected', errorParam: 'gcal_error', label: 'Google Calendar' },
  { connectedParam: 'mcal_connected', errorParam: 'mcal_error', label: 'Microsoft Calendar' },
] as const;

type Status =
  | { kind: 'success'; label: string }
  | { kind: 'error'; label: string; code: string }
  | { kind: 'unknown' };

function resolveStatus(params: URLSearchParams): Status {
  for (const p of PROVIDERS) {
    if (params.get(p.connectedParam) === 'true') return { kind: 'success', label: p.label };
    const err = params.get(p.errorParam);
    if (err) return { kind: 'error', label: p.label, code: err };
  }
  return { kind: 'unknown' };
}

const cardStyle: React.CSSProperties = {
  maxWidth: 460,
  margin: '0 auto',
  padding: '40px 32px',
  background: 'var(--card)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
  textAlign: 'center',
};

export function DesktopCallbackStatus() {
  const params = useSearchParams();
  const status = resolveStatus(params);
  // `protocol` is the app's custom scheme (pyper / pyper-staging / pyper-dev),
  // used to offer a best-effort "reopen the app" deep link.
  const protocol = params.get('protocol');
  const reopenHref =
    protocol && /^pyper(-(dev|staging))?$/.test(protocol) ? `${protocol}://` : null;

  if (status.kind === 'error') {
    return (
      <div style={cardStyle}>
        <div style={{ fontSize: 40, lineHeight: 1 }} aria-hidden>
          ⚠️
        </div>
        <h1 style={{ margin: '16px 0 8px', fontSize: 22, color: 'var(--text)' }}>
          Couldn&apos;t connect {status.label}
        </h1>
        <p style={{ margin: '0 0 8px', color: 'var(--muted)' }}>
          Something went wrong during authorization. You can close this tab and try again from
          Pyper.
        </p>
        <p style={{ margin: 0, color: 'var(--muted)', fontSize: 13 }}>
          Error: <code>{status.code}</code>
        </p>
        {reopenHref ? (
          <p style={{ marginTop: 24 }}>
            <Link className="btn btn-primary" href={reopenHref}>
              Reopen Pyper
            </Link>
          </p>
        ) : null}
      </div>
    );
  }

  if (status.kind === 'success') {
    return (
      <div style={cardStyle}>
        <div style={{ fontSize: 40, lineHeight: 1 }} aria-hidden>
          ✅
        </div>
        <h1 style={{ margin: '16px 0 8px', fontSize: 22, color: 'var(--text)' }}>
          {status.label} connected
        </h1>
        <p style={{ margin: 0, color: 'var(--muted)' }}>
          You&apos;re all set — you can close this tab and return to Pyper.
        </p>
        {reopenHref ? (
          <p style={{ marginTop: 24 }}>
            <Link className="btn btn-primary" href={reopenHref}>
              Return to Pyper
            </Link>
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div style={cardStyle}>
      <h1 style={{ margin: '0 0 8px', fontSize: 22, color: 'var(--text)' }}>Authorization complete</h1>
      <p style={{ margin: 0, color: 'var(--muted)' }}>
        You can close this tab and return to Pyper.
      </p>
    </div>
  );
}

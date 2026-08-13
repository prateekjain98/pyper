'use client';

import React from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  Clock,
  CreditCard,
  RefreshCw,
  Server,
  XCircle,
} from 'lucide-react';

// ── Types (mirror /api/status → proxy /status) ───────────────────────────────
type ServiceStatus =
  | 'operational'
  | 'out_of_credits'
  | 'rate_limited'
  | 'degraded'
  | 'invalid_key'
  | 'provider_down'
  | 'unreachable'
  | 'not_configured';

type CreditState = 'ok' | 'exhausted' | 'unknown';

interface Service {
  id: string;
  label: string;
  description?: string;
  provider: string;
  model?: string | null;
  endpoint?: string;
  keyName?: string;
  configured?: boolean;
  status: ServiceStatus;
  credits?: CreditState;
  httpStatus?: number;
  latencyMs?: number;
  detail?: string;
}

interface StatusPayload {
  ok?: boolean;
  generatedAt?: string;
  overall?: 'operational' | 'degraded' | 'major_outage';
  anyOutOfCredits?: boolean;
  outOfCreditsKeys?: string[];
  services?: Service[];
  proxy?: {
    status?: string;
    base?: string;
    region?: string;
    latencyMs?: number;
    detail?: string;
    httpStatus?: number;
  };
  cached?: boolean;
  cacheAgeMs?: number;
}

type Tone = 'ok' | 'warn' | 'bad' | 'muted';

const STATUS_META: Record<ServiceStatus, { label: string; tone: Tone }> = {
  operational: { label: 'Operational', tone: 'ok' },
  out_of_credits: { label: 'Out of credits', tone: 'bad' },
  rate_limited: { label: 'Rate limited', tone: 'warn' },
  degraded: { label: 'Degraded', tone: 'warn' },
  invalid_key: { label: 'Invalid key', tone: 'bad' },
  provider_down: { label: 'Provider down', tone: 'bad' },
  unreachable: { label: 'Unreachable', tone: 'bad' },
  not_configured: { label: 'Not configured', tone: 'muted' },
};

const TONE: Record<Tone, { dot: string; text: string; chip: string; ring: string }> = {
  ok: {
    dot: 'bg-emerald-400',
    text: 'text-emerald-300',
    chip: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/25',
    ring: 'border-emerald-500/40',
  },
  warn: {
    dot: 'bg-amber-400',
    text: 'text-amber-300',
    chip: 'bg-amber-500/10 text-amber-300 border-amber-500/25',
    ring: 'border-amber-500/40',
  },
  bad: {
    dot: 'bg-red-400',
    text: 'text-red-300',
    chip: 'bg-red-500/10 text-red-300 border-red-500/25',
    ring: 'border-red-500/40',
  },
  muted: {
    dot: 'bg-slate-500',
    text: 'text-slate-400',
    chip: 'bg-slate-500/10 text-slate-300 border-slate-500/20',
    ring: 'border-line',
  },
};

function toneFor(status: ServiceStatus): Tone {
  return STATUS_META[status]?.tone ?? 'muted';
}

function StatusIcon({ tone, className }: { tone: Tone; className?: string }) {
  if (tone === 'ok') return <CheckCircle2 className={className} />;
  if (tone === 'warn') return <AlertTriangle className={className} />;
  if (tone === 'bad') return <XCircle className={className} />;
  return <CircleDashed className={className} />;
}

function StatusChip({ status }: { status: ServiceStatus }) {
  const meta = STATUS_META[status] ?? { label: status, tone: 'muted' as Tone };
  const tone = TONE[meta.tone];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${tone.chip}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
      {meta.label}
    </span>
  );
}

function CreditsBadge({ credits }: { credits?: CreditState }) {
  if (credits === 'exhausted') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-300">
        <CreditCard className="h-3.5 w-3.5" /> Out of credits
      </span>
    );
  }
  if (credits === 'ok') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-300/90">
        <CreditCard className="h-3.5 w-3.5" /> Credits OK
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs font-medium text-muted"
      title="A billable probe would be needed to verify credit balance for this engine."
    >
      <CreditCard className="h-3.5 w-3.5" /> Credits not checked
    </span>
  );
}

function relTime(iso?: string, now?: number): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '—';
  const secs = Math.max(0, Math.round(((now ?? Date.now()) - t) / 1000));
  if (secs < 5) return 'just now';
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ${secs % 60}s ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m ago`;
}

const POLL_MS = 30_000;

export function StatusBoard() {
  const [data, setData] = React.useState<StatusPayload | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [now, setNow] = React.useState<number>(() => 0);

  const load = React.useCallback(async (force = false) => {
    setRefreshing(true);
    try {
      const r = await fetch(`/api/status${force ? '?force=1' : ''}`, { cache: 'no-store' });
      const json = (await r.json()) as StatusPayload;
      setData(json);
      setError(null);
    } catch (e) {
      setError((e as Error).message || 'Failed to load status');
    } finally {
      setLoading(false);
      setRefreshing(false);
      setNow(Date.now());
    }
  }, []);

  // Initial load + polling.
  React.useEffect(() => {
    void load();
    const poll = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(poll);
  }, [load]);

  // Tick the "last checked" label without refetching.
  React.useEffect(() => {
    setNow(Date.now());
    const tick = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(tick);
  }, []);

  const proxyReachable = data?.proxy?.status !== 'unreachable';
  const services = data?.services ?? [];
  const outOfCreditsKeys = data?.outOfCreditsKeys ?? [];

  // Overall banner.
  const overall = !proxyReachable ? 'major_outage' : data?.overall ?? 'operational';
  const banner =
    overall === 'operational'
      ? { tone: 'ok' as Tone, title: 'All systems operational' }
      : overall === 'major_outage'
        ? {
            tone: 'bad' as Tone,
            title: proxyReachable ? 'Major outage' : 'Backend proxy unreachable',
          }
        : {
            tone: 'warn' as Tone,
            title: data?.anyOutOfCredits ? 'Degraded — an API key is out of credits' : 'Some systems degraded',
          };
  const bannerTone = TONE[banner.tone];

  return (
    <div className="mx-auto w-full max-w-[900px]">
      {/* Overall banner */}
      <div
        className={`flex flex-col gap-4 rounded-2xl border ${bannerTone.ring} bg-surface/70 p-5 sm:flex-row sm:items-center sm:justify-between`}
      >
        <div className="flex items-center gap-3.5">
          <span className="relative flex h-3 w-3">
            {banner.tone !== 'ok' && (
              <span className={`absolute inline-flex h-full w-full animate-ping rounded-full ${bannerTone.dot} opacity-60`} />
            )}
            <span className={`relative inline-flex h-3 w-3 rounded-full ${bannerTone.dot}`} />
          </span>
          <div>
            <div className={`text-lg font-bold ${bannerTone.text}`}>{banner.title}</div>
            <div className="text-sm text-muted">
              Live backend health for Pyper's cloud dictation APIs
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right text-xs text-muted">
            <div className="inline-flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" />
              {loading ? 'Checking…' : `Updated ${relTime(data?.generatedAt, now)}`}
            </div>
            <div className="mt-0.5">Auto-refreshes every 30s</div>
          </div>
          <button
            type="button"
            onClick={() => void load(true)}
            disabled={refreshing}
            className="inline-flex items-center gap-2 rounded-lg border border-line bg-paper-2 px-3 py-2 text-sm font-semibold text-ink transition-colors hover:border-brand/60 disabled:opacity-60"
            aria-label="Refresh status now"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Out-of-credits callout */}
      {outOfCreditsKeys.length > 0 && (
        <div className="mt-4 flex items-start gap-3 rounded-xl border border-red-500/40 bg-red-500/10 p-4">
          <CreditCard className="mt-0.5 h-5 w-5 shrink-0 text-red-300" />
          <div className="text-sm text-red-100/90">
            <span className="font-bold text-red-200">
              {outOfCreditsKeys.length === 1 ? 'An API key is out of credits.' : 'API keys are out of credits.'}
            </span>{' '}
            Top up{' '}
            {outOfCreditsKeys.map((k, i) => (
              <React.Fragment key={k}>
                {i > 0 && ', '}
                <code className="rounded bg-red-500/15 px-1.5 py-0.5 font-mono text-red-200">{k}</code>
              </React.Fragment>
            ))}{' '}
            to restore the affected engine{outOfCreditsKeys.length > 1 ? 's' : ''}.
          </div>
        </div>
      )}

      {/* Proxy reachability */}
      {data?.proxy && (
        <div className="mt-6">
          <div
            className={`flex items-center justify-between gap-3 rounded-xl border ${proxyReachable ? 'border-line' : TONE.bad.ring} bg-surface/60 p-4`}
          >
            <div className="flex items-center gap-3">
              <Server className={`h-5 w-5 ${proxyReachable ? 'text-brand' : 'text-red-300'}`} />
              <div>
                <div className="text-sm font-semibold text-ink">API gateway (Cloud Run)</div>
                <div className="font-mono text-xs text-muted">
                  pyai-proxy{data.proxy.region ? ` · ${data.proxy.region}` : ''}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-4">
              {typeof data.proxy.latencyMs === 'number' && (
                <span className="hidden text-xs text-muted sm:inline">{data.proxy.latencyMs} ms</span>
              )}
              <StatusChip status={proxyReachable ? 'operational' : 'unreachable'} />
            </div>
          </div>
        </div>
      )}

      {/* Service cards */}
      <div className="mt-4 grid grid-cols-1 gap-4">
        {loading && services.length === 0 && (
          <div className="rounded-xl border border-line bg-surface/60 p-6 text-center text-sm text-muted">
            <Activity className="mx-auto mb-2 h-5 w-5 animate-pulse text-brand" />
            Probing backend engines…
          </div>
        )}

        {!loading && !proxyReachable && (
          <div className="rounded-xl border border-line bg-surface/60 p-6 text-sm text-muted">
            The backend proxy could not be reached, so per-engine health is
            unavailable. {data?.proxy?.detail ? <span className="text-ink-soft">({data.proxy.detail})</span> : null}
          </div>
        )}

        {services.map((s) => {
          const tone = toneFor(s.status);
          return (
            <div
              key={s.id}
              className={`rounded-xl border ${TONE[tone].ring} bg-surface/60 p-5 transition-colors`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <StatusIcon tone={tone} className={`mt-0.5 h-5 w-5 shrink-0 ${TONE[tone].text}`} />
                  <div>
                    <div className="text-base font-semibold text-ink">{s.label}</div>
                    {s.description && <div className="mt-0.5 text-sm text-muted">{s.description}</div>}
                  </div>
                </div>
                <StatusChip status={s.status} />
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line/70 pt-3 text-xs">
                <span className="text-muted">
                  Provider{' '}
                  <span className="font-mono text-ink-soft">{s.provider}</span>
                  {s.model ? <span className="font-mono text-ink-soft"> · {s.model}</span> : null}
                </span>
                {s.endpoint && (
                  <span className="font-mono text-muted">{s.endpoint}</span>
                )}
                {s.keyName && (
                  <span className="text-muted">
                    Key <code className="rounded bg-paper-2 px-1.5 py-0.5 font-mono text-ink-soft">{s.keyName}</code>
                  </span>
                )}
                <CreditsBadge credits={s.credits} />
                {typeof s.latencyMs === 'number' && (
                  <span className="text-muted">{s.latencyMs} ms</span>
                )}
              </div>

              {s.detail && s.status !== 'operational' && (
                <div className="mt-3 rounded-lg bg-paper-2 px-3 py-2 font-mono text-xs text-ink-soft break-words">
                  {s.detail}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {error && (
        <div className="mt-4 rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200">
          Couldn&apos;t reach the status feed: {error}
        </div>
      )}

      {/* Legend */}
      <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted">
        <span className="font-semibold text-ink-soft">Legend:</span>
        {(['operational', 'degraded', 'out_of_credits', 'not_configured'] as ServiceStatus[]).map((st) => {
          const meta = STATUS_META[st];
          return (
            <span key={st} className="inline-flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-full ${TONE[meta.tone].dot}`} />
              {meta.label}
            </span>
          );
        })}
      </div>
    </div>
  );
}

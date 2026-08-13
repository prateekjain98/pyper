interface WpmGaugeProps {
  value: number;
  /** Full-scale WPM the arc represents. */
  max?: number;
  available?: boolean;
  /** Localized "no data" text shown in place of the number when unavailable. */
  emptyLabel?: string;
}

// Semicircle sweeping left→right; radius 88 centered at (100,100).
const ARC_PATH = "M 12 100 A 88 88 0 0 1 188 100";

/**
 * A semicircular gauge (plain SVG, no deps) whose primary-colored arc fills to
 * `value / max`. `pathLength={100}` normalizes the arc so the dash array is a
 * straight percentage.
 */
export default function WpmGauge({
  value,
  max = 200,
  available = true,
  emptyLabel = "--",
}: WpmGaugeProps) {
  const fraction = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const filled = available ? fraction * 100 : 0;

  return (
    <div className="relative mx-auto w-full max-w-[220px]">
      <svg viewBox="0 0 200 108" className="w-full" fill="none" aria-hidden="true">
        <path
          d={ARC_PATH}
          className="text-border/70 dark:text-white/10"
          stroke="currentColor"
          strokeWidth={13}
          strokeLinecap="round"
        />
        <path
          d={ARC_PATH}
          className="text-primary transition-[stroke-dasharray] duration-700 ease-out"
          stroke="currentColor"
          strokeWidth={13}
          strokeLinecap="round"
          pathLength={100}
          strokeDasharray={`${filled} 100`}
        />
      </svg>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-center">
        <span className="text-4xl font-bold leading-none tracking-tight tabular-nums text-foreground">
          {available ? value.toLocaleString() : emptyLabel}
        </span>
      </div>
    </div>
  );
}

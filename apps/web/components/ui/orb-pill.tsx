'use client';

/**
 * Orb pill — a faithful web port of the shipped Pyper desktop dictation widget.
 *
 * Ported from (do NOT import across workspaces — this is a copy):
 *   - apps/desktop/src/components/ui/OrbPill.tsx  (PillShell / StatusPill /
 *     CommandPill / Expander, and the `toast-surface` treatment)
 *   - apps/desktop/src/App.jsx  (the orb button itself: `getMicButtonProps`
 *     ~L351-389 and the orb markup ~L640-712)
 *   - apps/desktop/src/components/ui/KeyGlyphs.tsx  (the key caps)
 *   - apps/desktop/src/index.css  (`.toast-surface`, ~L421)
 *
 * The real widget is ONE horizontal pill: the 56px orb is the edge-side cap and
 * the dark stadium body erupts inward out of it. Body geometry is preserved
 * exactly — `rounded-[28px]`, `h-14`, `pl-4 pr-11` (the cap-side padding that
 * keeps text clear of the overlapping orb) and a -28px overlap (= orb radius)
 * so orb and body merge into one continuous pill.
 */

import * as React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, X } from 'lucide-react';
import { ThinkingOrb } from '@/components/ui/thinking-orbs';
import type { OrbState } from '@/components/ui/thinking-orbs';
import { cn } from '@/lib/utils';

/* ------------------------------------------------------------------ */
/* Tokens copied verbatim from the desktop build                      */
/* ------------------------------------------------------------------ */

/**
 * `.toast-surface` from apps/desktop/src/index.css — an opaque dark HUD
 * surface, identical in light and dark mode. Inlined rather than added to
 * globals.css so this component stays self-contained.
 */
const TOAST_SURFACE: React.CSSProperties = {
  background: 'oklch(0.15 0.006 260)',
  border: '1px solid oklch(0.25 0.006 260)',
  // Tight, low-spread shadow — the desktop pill sits at the transparent
  // overlay-window boundary, so a big elevated shadow gets hard-clipped.
  boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.06), 0 1px 3px oklch(0 0 0 / 0.35)',
};

/** Which side of the pill the orb caps. "right" → body expands left. */
export type OrbSide = 'left' | 'right';
export type PillTone = 'default' | 'destructive' | 'success' | 'info';

const TONE_DOT: Record<PillTone, string> = {
  default: 'bg-white/40',
  destructive: 'bg-red-400',
  success: 'bg-emerald-400',
  info: 'bg-sky-400',
};

/** The desktop Expander's animation budget. */
const TRANSITION_MS = 220;
/** Tailwind's `ease-out` curve, so the motion matches the desktop CSS. */
const EASE_OUT = [0, 0, 0.2, 1] as const;
const SPRING = { duration: TRANSITION_MS / 1000, ease: EASE_OUT } as const;

/* ------------------------------------------------------------------ */
/* The real dictation states (App.jsx `getMicState`)                   */
/* ------------------------------------------------------------------ */

/** Mirrors the desktop `micState` machine exactly. */
export type OrbPillState =
  | 'idle'
  | 'hover'
  | 'recording'
  | 'processing'
  | 'unavailable';

/** micState → ThinkingOrb state, exactly as App.jsx maps it. */
const ORB_STATE: Record<Exclude<OrbPillState, 'unavailable'>, OrbState> = {
  idle: 'breathing',
  hover: 'searching',
  recording: 'listening',
  processing: 'working',
};

/* ------------------------------------------------------------------ */
/* Pieces                                                              */
/* ------------------------------------------------------------------ */

/**
 * The visible dark stadium body. When `capped`, its cap-side edge tucks under
 * the orb (28px = orb radius) so the two merge into one continuous pill.
 */
function PillShell({
  orbSide,
  capped,
  className,
  children,
}: {
  orbSide: OrbSide;
  capped: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={TOAST_SURFACE}
      className={cn(
        'flex min-h-14 items-center rounded-[28px]',
        // Extra padding on the cap side keeps text clear of the overlapping orb.
        orbSide === 'right'
          ? capped
            ? 'pl-4 pr-11'
            : 'px-4'
          : capped
            ? 'pl-11 pr-4'
            : 'px-4',
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * Key "caps" with real macOS glyphs — a port of KeyGlyphs.tsx. The desktop
 * default hotkey is `GLOBE`, which renders as a single `fn` cap.
 */
function KeyGlyphs({
  tokens,
  className,
}: {
  tokens: readonly string[];
  className?: string;
}) {
  if (tokens.length === 0) return null;
  return (
    <span className={cn('inline-flex items-center gap-0.5', className)}>
      {tokens.map((token, i) => (
        <kbd
          key={`${token}-${i}`}
          className={cn(
            'inline-flex h-[17px] min-w-[17px] items-center justify-center rounded-[5px] px-1',
            'border border-white/15 bg-white/10 text-white/85',
            'font-sans text-[10px] font-semibold leading-none',
          )}
        >
          {token}
        </kbd>
      ))}
    </span>
  );
}

/** A non-dismissible status label (Recording…, Processing…) with cancel. */
function StatusPill({
  orbSide,
  capped,
  tone = 'default',
  text,
  live,
  cancelLabel,
}: {
  orbSide: OrbSide;
  capped: boolean;
  tone?: PillTone;
  text: string;
  live?: boolean;
  cancelLabel?: string;
}) {
  return (
    <PillShell orbSide={orbSide} capped={capped} className="h-14 gap-2 py-2">
      <span
        className={cn(
          'size-1.5 shrink-0 rounded-full',
          TONE_DOT[tone],
          live && 'animate-pulse',
        )}
      />
      <span className="whitespace-nowrap text-xs font-medium text-white/90">
        {text}
      </span>
      {cancelLabel && (
        <span
          aria-hidden="true"
          title={cancelLabel}
          className={cn(
            'flex size-5 shrink-0 items-center justify-center rounded-full',
            'border border-white/10 bg-white/5 text-white/50',
            'transition-colors duration-150 hover:border-red-400/60 hover:bg-red-500/80 hover:text-white',
            orbSide === 'right' ? 'order-first' : 'order-last',
          )}
        >
          <X className="size-2.5" strokeWidth={2.5} />
        </span>
      )}
    </PillShell>
  );
}

/** The primary Wispr-style command hint: "Start listening  fn ⌄". */
function CommandPill({
  orbSide,
  label,
  hotkey,
}: {
  orbSide: OrbSide;
  label: string;
  hotkey: readonly string[];
}) {
  return (
    <PillShell orbSide={orbSide} capped className="h-14 gap-1.5 py-2">
      <span className="whitespace-nowrap text-xs font-medium text-white/90">
        {label}
      </span>
      <KeyGlyphs tokens={hotkey} className="ml-0.5" />
      <ChevronDown
        className="ml-0.5 size-3.5 shrink-0 text-white/50"
        strokeWidth={2.25}
      />
    </PillShell>
  );
}

/**
 * The orb — the fixed edge-side cap of the pill. Classes come straight from
 * `getMicButtonProps()` + the orb markup in App.jsx: a 56px circle, 2px white
 * border, near-black fill, with the ThinkingOrb canvas forced to 48px.
 */
function Orb({ state }: { state: OrbPillState }) {
  const hovered = state === 'hover';
  return (
    <div
      className={cn(
        'relative flex h-14 w-14 items-center justify-center overflow-hidden rounded-full border-2 border-white/70',
        state === 'unavailable' ? 'bg-amber-500' : 'bg-neutral-900/90',
      )}
      style={{
        transition:
          'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1), background-color 0.25s ease-out',
      }}
    >
      {/* Background effects */}
      <div
        className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent transition-opacity duration-150"
        style={{ opacity: hovered ? 0.8 : 0 }}
      />
      <div
        className="absolute inset-0 transition-colors duration-150"
        style={{ backgroundColor: hovered ? 'rgba(0,0,0,0.1)' : 'transparent' }}
      />

      {state === 'unavailable' ? (
        <span className="text-base font-bold text-white">!</span>
      ) : (
        <span className="flex items-center justify-center [&_canvas]:!size-12">
          <ThinkingOrb
            state={ORB_STATE[state]}
            size={64}
            theme="dark"
            paused={false}
          />
        </span>
      )}

      {/* State indicator rings */}
      {state === 'recording' && (
        <div className="absolute inset-0 animate-pulse rounded-full border-2 border-brand/50" />
      )}
      {state === 'unavailable' && (
        <div className="absolute inset-0 animate-pulse rounded-full border-2 border-amber-200/70" />
      )}
      {state === 'processing' && (
        <div className="absolute inset-0 rounded-full border-2 border-brand/30 opacity-50" />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Public component                                                    */
/* ------------------------------------------------------------------ */

export interface OrbPillProps {
  /** Which dictation state to render. */
  state: OrbPillState;
  /** Which side the orb caps. Desktop default is top-right → "right". */
  orbSide?: OrbSide;
  /** Key caps for the hover hint. Desktop's macOS default is GLOBE → "fn". */
  hotkey?: readonly string[];
  className?: string;
}

/** The pill body for a state — `null` at idle, exactly like the desktop. */
function pillFor(
  state: OrbPillState,
  orbSide: OrbSide,
  hotkey: readonly string[],
) {
  switch (state) {
    case 'hover':
      return (
        <CommandPill orbSide={orbSide} label="Start listening" hotkey={hotkey} />
      );
    case 'recording':
      return (
        <StatusPill
          orbSide={orbSide}
          capped
          tone="destructive"
          live
          text="Recording..."
          cancelLabel="Cancel recording"
        />
      );
    case 'processing':
      return (
        <StatusPill
          orbSide={orbSide}
          capped
          tone="info"
          live
          text="Processing..."
          cancelLabel="Cancel processing"
        />
      );
    case 'unavailable':
      return (
        <StatusPill
          orbSide={orbSide}
          capped
          tone="info"
          live
          text="Waiting for microphone…"
          cancelLabel="Cancel recording"
        />
      );
    default:
      return null;
  }
}

/**
 * One orb + its pill body, laid out the way the desktop lays them out: the body
 * sits beside the orb and is pulled 28px (the orb radius) under it, with the orb
 * on top (z-10) so it reads as the pill's rounded cap.
 */
export function OrbPill({
  state,
  orbSide = 'right',
  hotkey = ['fn'],
  className,
}: OrbPillProps) {
  const body = pillFor(state, orbSide, hotkey);
  const pull = orbSide === 'right' ? '-mr-7' : '-ml-7';

  const pillNode = body && (
    <motion.div
      key={state}
      layout
      initial={{
        opacity: 0,
        x: orbSide === 'right' ? 10 : -10,
      }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: orbSide === 'right' ? 10 : -10 }}
      transition={SPRING}
      className={cn('shrink-0', pull)}
    >
      {body}
    </motion.div>
  );

  return (
    <motion.div
      layout
      transition={SPRING}
      className={cn('relative flex items-center', className)}
    >
      {orbSide === 'right' && (
        <AnimatePresence mode="popLayout" initial={false}>
          {pillNode}
        </AnimatePresence>
      )}
      <motion.div layout transition={SPRING} className="relative z-10">
        <Orb state={state} />
      </motion.div>
      {orbSide === 'left' && (
        <AnimatePresence mode="popLayout" initial={false}>
          {pillNode}
        </AnimatePresence>
      )}
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* Auto-cycling showcase                                               */
/* ------------------------------------------------------------------ */

/** One full dictation round-trip, with the dwell time the real app has. */
const CYCLE: readonly { state: OrbPillState; ms: number }[] = [
  { state: 'idle', ms: 1800 },
  { state: 'hover', ms: 2600 },
  { state: 'recording', ms: 3200 },
  { state: 'processing', ms: 2400 },
];

export interface OrbPillShowcaseProps {
  className?: string;
  orbSide?: OrbSide;
  hotkey?: readonly string[];
}

/**
 * The widget, cycling through the real dictation states. The row is a fixed
 * height and horizontally centred, so nothing on the page reflows as the pill
 * body grows and collapses — only the composite re-centres.
 */
export function OrbPillShowcase({
  className,
  orbSide = 'right',
  hotkey = ['fn'],
}: OrbPillShowcaseProps) {
  const [step, setStep] = React.useState(0);
  const [reduced, setReduced] = React.useState(false);

  React.useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  React.useEffect(() => {
    if (reduced) return;
    const timer = setTimeout(
      () => setStep((s) => (s + 1) % CYCLE.length),
      CYCLE[step].ms,
    );
    return () => clearTimeout(timer);
  }, [step, reduced]);

  // Reduced motion parks on the most representative state instead of cycling.
  const state = reduced ? 'recording' : CYCLE[step].state;

  return (
    <div
      className={cn('flex h-16 items-center justify-center', className)}
      role="img"
      aria-label="The Pyper dictation orb, cycling through its live states"
    >
      <OrbPill state={state} orbSide={orbSide} hotkey={hotkey} />
    </div>
  );
}

export default OrbPill;

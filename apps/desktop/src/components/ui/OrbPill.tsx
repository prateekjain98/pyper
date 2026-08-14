import * as React from "react";
import { X, ChevronDown, ChevronUp, Copy, Check } from "lucide-react";
import { cn } from "../lib/utils";
import type { ToastItem } from "./useToast";
import { KeyGlyphs } from "./KeyGlyphs";

/**
 * The dictation-panel orb renders every status/error as ONE horizontal pill
 * that erupts out of the orb — the orb is the edge-side cap, the message body
 * grows inward (away from the screen edge). This file owns that pill body; the
 * orb itself stays in App.jsx. See {@link OrbPillRegion}.
 */

/** Which side of the pill the orb caps. "right" → body expands left, etc. */
export type OrbSide = "left" | "right";
export type PillTone = "default" | "destructive" | "success" | "info";

/** Content for the prominent, orb-capped pill nearest the orb. */
export type PrimaryContent =
  | { kind: "toast"; toast: ToastItem }
  | {
      kind: "status";
      tone?: PillTone;
      text: string;
      live?: boolean;
      onCancel?: () => void;
      cancelLabel?: string;
    }
  | { kind: "command"; label: string; hotkey?: string | null; onActivate?: () => void };

const TONE_DOT: Record<PillTone, string> = {
  default: "bg-white/40",
  destructive: "bg-red-400",
  success: "bg-emerald-400",
  info: "bg-sky-400",
};

const TRANSITION_MS = 220;

/**
 * Animates its child open/closed by growing a grid column from 0fr → 1fr (a
 * smooth, measurement-free width animation), with a fade + slight slide toward
 * the orb so the body reads as erupting out of it. Content is retained through
 * the closing transition so it doesn't vanish before it has collapsed.
 */
function Expander({
  open,
  orbSide,
  className,
  children,
  widthReveal = false,
}: {
  open: boolean;
  orbSide: OrbSide;
  className?: string;
  children: React.ReactNode;
  widthReveal?: boolean;
}) {
  // `visible` drives the fade + slide; `frozen` keeps the last body mounted
  // through the close so it fades out instead of blanking instantly.
  const [visible, setVisible] = React.useState(false);
  const [frozen, setFrozen] = React.useState<React.ReactNode>(null);
  // Track the most recent non-null body while open, so the fade-out has
  // something to show even though `children` goes null the moment it closes.
  const lastShown = React.useRef<React.ReactNode>(null);
  if (open && children != null) lastShown.current = children;

  // Keyed on `open` only — `children` changes identity every render, so keying
  // on it too would re-fire this effect in a loop.
  React.useEffect(() => {
    if (open) {
      setFrozen(null);
      // Reveal on the next frame so the opacity/transform transition animates.
      // rAF alone stalls in a non-focusable / occluded overlay window (Chromium
      // throttles rAF while it's unfocused), which would leave the pill stuck
      // invisible — a timer backstops it so the body always appears.
      const raf = requestAnimationFrame(() => setVisible(true));
      const timer = setTimeout(() => setVisible(true), 60);
      return () => {
        cancelAnimationFrame(raf);
        clearTimeout(timer);
      };
    }
    setFrozen(lastShown.current);
    setVisible(false);
    const timer = setTimeout(() => setFrozen(null), TRANSITION_MS + 40);
    return () => clearTimeout(timer);
  }, [open]);

  const content = open ? children : frozen;

  // Center-only: reveal by animating the body's width 0→its natural width. The
  // target is measured off an intrinsic-width (w-max) inner div, since CSS can't
  // transition to width:auto. Because the orb + body sit in a horizontally
  // centered flex unit (OrbPillRegion `centered`), growing this width slides the
  // orb left while the body opens right — one smooth motion. The reveal wrapper
  // needs shrink-0 or flex-shrink collapses the overflow-hidden box to 0.
  const innerRef = React.useRef<HTMLDivElement>(null);
  const [naturalW, setNaturalW] = React.useState(0);
  React.useLayoutEffect(() => {
    if (widthReveal && innerRef.current) {
      const w = innerRef.current.scrollWidth;
      setNaturalW((prev) => (w !== prev ? w : prev));
    }
  });

  if (content == null) return null;

  if (widthReveal) {
    return (
      <div
        className={cn("shrink-0 overflow-hidden ease-out", className)}
        style={{
          width: visible ? naturalW : 0,
          transitionProperty: "width",
          transitionDuration: `${TRANSITION_MS}ms`,
        }}
      >
        <div ref={innerRef} className="w-max shrink-0">
          {content}
        </div>
      </div>
    );
  }

  // Corners: render the pill at its NATURAL width — the region is absolutely
  // anchored to the orb and free to overhang the transparent window — and reveal
  // it with a fade + slide out of the orb. (The old 0fr→1fr grid width-reveal
  // collapsed here: the anchor container is shrink-to-fit and much narrower than
  // the pill, so `1fr` resolved to ~28px and clipped the body away.)
  return (
    <div
      className={cn(
        "transition-[opacity,transform] ease-out will-change-[opacity,transform]",
        visible
          ? "opacity-100 translate-x-0"
          : cn("opacity-0", orbSide === "right" ? "translate-x-2" : "-translate-x-2"),
        className
      )}
      style={{ transitionDuration: `${TRANSITION_MS}ms` }}
    >
      {content}
    </div>
  );
}

/**
 * The visible dark stadium body. When `capped`, its cap-side edge tucks under
 * the orb (28px = orb radius) so the two merge into one continuous pill; the
 * orb (drawn on top in App.jsx) becomes the rounded cap.
 */
function PillShell({
  orbSide,
  capped,
  className,
  children,
  onMouseEnter,
  onMouseLeave,
}: {
  orbSide: OrbSide;
  capped: boolean;
  className?: string;
  children: React.ReactNode;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}) {
  return (
    <div
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={cn(
        "toast-surface pointer-events-auto flex min-h-14 items-center rounded-[28px]",
        // Extra padding on the cap side keeps text clear of the overlapping orb.
        orbSide === "right"
          ? capped
            ? "pl-4 pr-11"
            : "px-4"
          : capped
            ? "pl-11 pr-4"
            : "px-4",
        className
      )}
    >
      {children}
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          /* clipboard unavailable — nothing to recover */
        }
      }}
      className="mt-px shrink-0 rounded-xs p-0.5 text-white/30 transition-colors duration-150 hover:bg-white/6 hover:text-white/70"
      aria-label="Copy error"
    >
      {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
    </button>
  );
}

/** A toast rendered as an orb pill: short label when collapsed, expandable to
 * the full detail, with a close button and a pause-on-hover auto-dismiss bar. */
function ToastPill({
  toast,
  orbSide,
  capped,
  onDismiss,
  onPause,
  onResume,
}: {
  toast: ToastItem;
  orbSide: OrbSide;
  capped: boolean;
  onDismiss: (id: string) => void;
  onPause: (id: string) => void;
  onResume: (id: string, remaining: number) => void;
}) {
  const { id, title, description, action, variant = "default", duration = 3500, createdAt } = toast;
  const isDestructive = variant === "destructive";
  const tone: PillTone = isDestructive ? "destructive" : variant === "success" ? "success" : "default";

  const message = title || description;
  const detail = title && description ? description : undefined;
  const canExpand = Boolean(detail);

  const [expanded, setExpanded] = React.useState(false);
  const [hovered, setHovered] = React.useState(false);
  const pausedAtRef = React.useRef<number | null>(null);

  const handleEnter = () => {
    setHovered(true);
    pausedAtRef.current = Date.now();
    onPause(id);
  };
  const handleLeave = () => {
    setHovered(false);
    if (pausedAtRef.current && duration > 0) {
      const elapsed = pausedAtRef.current - createdAt;
      onResume(id, Math.max(duration - elapsed, 500));
    }
    pausedAtRef.current = null;
  };

  const ChevronIcon = expanded ? ChevronUp : ChevronDown;

  // The close button lives INSIDE the pill on the outward (screen-edge) side —
  // a corner overhang would be clipped by the Expander's overflow during the
  // open/close animation.
  const closeButton = (
    <button
      onClick={() => onDismiss(id)}
      className={cn(
        "flex size-5 shrink-0 items-center justify-center rounded-full",
        "text-white/40 transition-colors duration-150 hover:bg-white/10 hover:text-white",
        "focus:outline-none focus-visible:ring-1 focus-visible:ring-white/30",
        orbSide === "right" ? "order-first" : "order-last"
      )}
    >
      <X className="size-3.5" />
      <span className="sr-only">Close</span>
    </button>
  );

  return (
    <PillShell
      orbSide={orbSide}
      capped={capped}
      // A comfortable width floor is load-bearing: the region is absolutely
      // anchored to the orb, whose ancestor is shrink-to-fit (~orb-width), so
      // without a min-width the flex-1/min-w-0 text column collapses to
      // min-content and the title wraps one word per line. The min-width holds
      // the pill open at a tidy shape; max-width keeps a long description
      // wrapping to a couple of lines well within the overlay window.
      className="min-w-[18rem] max-w-[22rem] gap-2 py-2"
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
    >
      {closeButton}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className={cn("size-1.5 shrink-0 rounded-full", TONE_DOT[tone])} />
          <span
            className={cn(
              "min-w-0 flex-1 text-xs font-medium leading-tight text-white/90",
              expanded ? "whitespace-normal" : "truncate"
            )}
          >
            {message}
          </span>
          {canExpand && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="shrink-0 rounded-full p-0.5 text-white/40 transition-colors duration-150 hover:bg-white/10 hover:text-white/80"
              aria-label={expanded ? "Hide details" : "Show details"}
              aria-expanded={expanded}
            >
              <ChevronIcon className="size-3.5" />
            </button>
          )}
        </div>
        {expanded && detail && (
          <div
            className={cn(
              "mt-1 text-xs leading-snug",
              isDestructive
                ? "flex items-start justify-between gap-1.5 rounded-[3px] border border-white/6 bg-white/4 px-1.5 py-1 font-mono text-red-300/80"
                : "text-white/45"
            )}
          >
            <span className="min-w-0 select-all wrap-break-word">{detail}</span>
            {isDestructive && <CopyButton text={detail} />}
          </div>
        )}
        {duration > 0 && !toast.isExiting && (
          <div className="mt-1.5 h-px overflow-hidden rounded-full">
            <div
              className={cn("h-full", isDestructive ? "bg-red-400/30" : "bg-white/15")}
              style={{
                animation: `toast-progress ${duration}ms linear forwards`,
                animationPlayState: hovered ? "paused" : "running",
              }}
            />
          </div>
        )}
      </div>
      {action && <div className="shrink-0 self-center">{action}</div>}
    </PillShell>
  );
}

/** A non-dismissible status label (Recording…, Processing…, Waiting for mic…),
 * with an optional inline cancel control. */
function StatusPill({
  orbSide,
  capped,
  tone = "default",
  text,
  live,
  onCancel,
  cancelLabel,
}: {
  orbSide: OrbSide;
  capped: boolean;
  tone?: PillTone;
  text: string;
  live?: boolean;
  onCancel?: () => void;
  cancelLabel?: string;
}) {
  return (
    <PillShell orbSide={orbSide} capped={capped} className="h-14 gap-2 py-2">
      <span className={cn("size-1.5 shrink-0 rounded-full", TONE_DOT[tone], live && "animate-pulse")} />
      <span className="whitespace-nowrap text-xs font-medium text-white/90">{text}</span>
      {onCancel && (
        <button
          onClick={onCancel}
          aria-label={cancelLabel}
          className={cn(
            "flex size-5 shrink-0 items-center justify-center rounded-full",
            "border border-white/10 bg-white/5 text-white/50",
            "transition-colors duration-150 hover:border-red-400/60 hover:bg-red-500/80 hover:text-white",
            "focus:outline-none focus-visible:ring-1 focus-visible:ring-white/30",
            orbSide === "right" ? "order-first" : "order-last"
          )}
        >
          <X className="size-2.5" strokeWidth={2.5} />
        </button>
      )}
    </PillShell>
  );
}

/** The primary Wispr-style command hint: "Dictate  ⇧ …" — click to expand the
 * command menu. */
function CommandPill({
  orbSide,
  label,
  hotkey,
  chevron,
  onActivate,
}: {
  orbSide: OrbSide;
  label: string;
  hotkey?: string | null;
  chevron: React.ReactNode;
  onActivate?: () => void;
}) {
  const inner = (
    <>
      <span className="whitespace-nowrap text-xs font-medium text-white/90">{label}</span>
      {hotkey ? <KeyGlyphs hotkey={hotkey} className="ml-0.5" /> : null}
      {chevron}
    </>
  );

  if (!onActivate) {
    return (
      <PillShell orbSide={orbSide} capped className="h-14 gap-1.5 py-2">
        {inner}
      </PillShell>
    );
  }

  return (
    <button
      type="button"
      onClick={onActivate}
      className="flex rounded-[28px] focus:outline-none focus-visible:ring-1 focus-visible:ring-white/30"
    >
      <PillShell
        orbSide={orbSide}
        capped
        className="h-14 gap-1.5 py-2 transition-colors duration-150 hover:brightness-125"
      >
        {inner}
      </PillShell>
    </button>
  );
}

export interface OrbPillRegionProps {
  orbSide: OrbSide;
  verticalAnchor: "top" | "bottom";
  primary: PrimaryContent | null;
  secondary: ToastItem[];
  onDismiss: (id: string) => void;
  onPauseToast: (id: string) => void;
  onResumeToast: (id: string, remaining: number) => void;
  /** Bottom-center: the orb + pill form one horizontally-centered unit, so the
   * body opens right while the orb slides left (a measured width reveal), instead
   * of the corner behavior (orb pinned at its edge, body erupts inward). */
  centered?: boolean;
}

/**
 * Absolutely-anchored to the orb, this renders the primary orb-capped pill plus
 * any additional toasts stacked inward. It never affects the orb's own position
 * (the orb stays pinned at its corner); the pill bodies overlay the transparent
 * window area that opens up when the window resizes.
 */
export function OrbPillRegion({
  orbSide,
  verticalAnchor,
  primary,
  secondary,
  onDismiss,
  onPauseToast,
  onResumeToast,
  centered = false,
}: OrbPillRegionProps) {
  const isTop = verticalAnchor === "top";
  const ChevronExpand = isTop ? ChevronDown : ChevronUp;

  // The primary pill stays open unless it's an auto-dismissing toast mid-exit.
  const primaryOpen =
    primary != null && !(primary.kind === "toast" && primary.toast.isExiting);

  const primaryNode = React.useMemo(() => {
    if (!primary) return null;
    if (primary.kind === "toast") {
      return (
        <ToastPill
          toast={primary.toast}
          orbSide={orbSide}
          capped
          onDismiss={onDismiss}
          onPause={onPauseToast}
          onResume={onResumeToast}
        />
      );
    }
    if (primary.kind === "status") {
      return (
        <StatusPill
          orbSide={orbSide}
          capped
          tone={primary.tone}
          text={primary.text}
          live={primary.live}
          onCancel={primary.onCancel}
          cancelLabel={primary.cancelLabel}
        />
      );
    }
    return (
      <CommandPill
        orbSide={orbSide}
        label={primary.label}
        hotkey={primary.hotkey}
        onActivate={primary.onActivate}
        chevron={
          <ChevronExpand className="ml-0.5 size-3.5 shrink-0 text-white/50" strokeWidth={2.25} />
        }
      />
    );
  }, [primary, orbSide, onDismiss, onPauseToast, onResumeToast, ChevronExpand]);

  // Bottom-center: the orb + primary body are one horizontally-centered flex unit
  // (the panel is full-width + justify-center in App.jsx). The body reveals by
  // animating its width (Expander widthReveal), so as it opens right the centered
  // unit grows and the orb slides left — a single smooth motion. The body tucks
  // 28px under the orb (-ml-7) so the orb reads as its rounded cap.
  if (centered) {
    return (
      <div className="pointer-events-none relative flex items-center">
        <Expander open={primaryOpen} orbSide={orbSide} widthReveal className="-ml-7">
          {primaryNode}
        </Expander>
        {secondary.length > 0 && (
          <div
            className={cn(
              "pointer-events-none absolute left-0 flex gap-1.5",
              isTop ? "top-full mt-1.5 flex-col" : "bottom-full mb-1.5 flex-col-reverse"
            )}
          >
            {secondary.map((toast) => (
              <Expander key={toast.id} open={!toast.isExiting} orbSide={orbSide}>
                <ToastPill
                  toast={toast}
                  orbSide={orbSide}
                  capped={false}
                  onDismiss={onDismiss}
                  onPause={onPauseToast}
                  onResume={onResumeToast}
                />
              </Expander>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "pointer-events-none absolute flex gap-1.5",
        isTop ? "top-0 flex-col" : "bottom-0 flex-col-reverse",
        orbSide === "right" ? "right-7 items-end" : "left-7 items-start"
      )}
    >
      <Expander open={primaryOpen} orbSide={orbSide}>
        {primaryNode}
      </Expander>

      {secondary.map((toast) => (
        <Expander key={toast.id} open={!toast.isExiting} orbSide={orbSide}>
          <ToastPill
            toast={toast}
            orbSide={orbSide}
            capped={false}
            onDismiss={onDismiss}
            onPause={onPauseToast}
            onResume={onResumeToast}
          />
        </Expander>
      ))}
    </div>
  );
}

export default OrbPillRegion;

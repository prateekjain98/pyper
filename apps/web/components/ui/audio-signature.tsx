"use client";

import React from "react";
import { generateSpectrogramData } from "@/lib/generateWaveform";

/**
 * The audio signature from the desktop app's referral card
 * (apps/desktop/src/components/referral-cards/SpectrogramCard.tsx), ported to
 * the web. The grid IS the sound: each row is a frequency band driving a sine
 * oscillator, each column a moment in time driving that band's gain. Same
 * constants, same synthesis, so a given code sounds identical in both places.
 */

const COLS = 48;
const ROWS = 14;
const STEP = 9;
const CELL = 6;
const CELL_RADIUS = 1.2;
const SVG_W = COLS * STEP;
const SVG_H = ROWS * STEP;
const OFFSET = (STEP - CELL) / 2;
const DURATION = 2.5;

const FREQ_MIN = 150;
const FREQ_MAX = 4000;
const FREQUENCIES = Array.from({ length: ROWS }, (_, i) => {
  const t = i / (ROWS - 1);
  return FREQ_MIN * Math.pow(FREQ_MAX / FREQ_MIN, t);
});

function spectrogramColor(value: number): string {
  if (value < 0.05) return "transparent";
  const a = (0.1 + value * 0.8).toFixed(3);
  return `oklch(0.72 0.22 260 / ${a})`;
}

function createAudio(data: number[][]): { stop: () => void } | null {
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    const ctx = new Ctx();
    void ctx.resume().catch(() => {});

    const now = ctx.currentTime;
    const master = ctx.createGain();
    const lpf = ctx.createBiquadFilter();

    lpf.type = "lowpass";
    lpf.frequency.value = 3500;
    lpf.Q.value = 0.7;
    lpf.connect(master);
    master.connect(ctx.destination);

    master.gain.setValueAtTime(0, now);
    master.gain.linearRampToValueAtTime(0.15, now + 0.08);
    master.gain.setValueAtTime(0.15, now + DURATION - 0.15);
    master.gain.linearRampToValueAtTime(0, now + DURATION);

    const oscillators: OscillatorNode[] = [];

    for (let band = 0; band < ROWS; band++) {
      const row = data[band];
      if (!row) continue;
      const osc = ctx.createOscillator();
      const bandGain = ctx.createGain();

      osc.type = "sine";
      osc.frequency.value = FREQUENCIES[band];
      osc.detune.value = (Math.random() - 0.5) * 4;

      bandGain.gain.setValueAtTime(0, now);
      for (let col = 0; col < row.length; col++) {
        const t = now + (col / (row.length - 1)) * DURATION;
        const val = (row[col] ?? 0) * 0.08;
        if (Number.isFinite(t) && Number.isFinite(val))
          bandGain.gain.linearRampToValueAtTime(val, t);
      }
      bandGain.gain.linearRampToValueAtTime(0, now + DURATION);

      osc.connect(bandGain);
      bandGain.connect(lpf);
      osc.start(now);
      osc.stop(now + DURATION);
      oscillators.push(osc);
    }

    return {
      stop() {
        oscillators.forEach((o) => {
          try {
            o.stop();
          } catch {
            /* already stopped */
          }
        });
        void ctx.close().catch(() => {});
      },
    };
  } catch {
    return null;
  }
}

export function AudioSignature({ code = "PYPER" }: { code?: string }) {
  const data = React.useMemo(
    () => generateSpectrogramData(code, COLS, ROWS),
    [code],
  );
  const [playing, setPlaying] = React.useState(false);
  const handle = React.useRef<{ stop: () => void } | null>(null);
  const timer = React.useRef<number | null>(null);

  const stop = React.useCallback(() => {
    handle.current?.stop();
    handle.current = null;
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
    setPlaying(false);
  }, []);

  React.useEffect(() => stop, [stop]);

  const play = () => {
    if (playing) return stop();
    handle.current = createAudio(data);
    if (!handle.current) return; // Web Audio unavailable — stay silent, no error state
    setPlaying(true);
    timer.current = window.setTimeout(stop, DURATION * 1000);
  };

  return (
    <button
      type="button"
      onClick={play}
      aria-label={
        playing ? "Stop the audio signature" : "Play the audio signature"
      }
      className="group inline-flex cursor-pointer appearance-none flex-col items-start gap-3 rounded-2xl border border-line bg-[#0b0e14] p-5 text-left transition hover:border-brand/40"
    >
      <svg
        viewBox={`0 0 ${SVG_W} ${SVG_H}`}
        className="w-full max-w-[420px]"
        role="img"
        aria-hidden="true"
      >
        {data.map((row, r) =>
          row.map((v, c) => (
            <rect
              key={`${r}-${c}`}
              x={c * STEP + OFFSET}
              y={r * STEP + OFFSET}
              width={CELL}
              height={CELL}
              rx={CELL_RADIUS}
              fill={spectrogramColor(v)}
              style={{
                transition: "opacity .25s ease",
                opacity: playing ? 1 : 0.75,
              }}
            />
          )),
        )}
      </svg>

      <span className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.16em] text-muted transition group-hover:text-ink">
        <span
          className={`h-1.5 w-1.5 rounded-full ${playing ? "animate-pulse bg-brand" : "bg-white/25"}`}
        />
        {playing ? "playing…" : "hear your signature"}
      </span>
    </button>
  );
}

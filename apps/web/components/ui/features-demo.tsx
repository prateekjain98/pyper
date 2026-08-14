'use client';

import React from 'react';

// Hero demo: waveform (listening) -> messy transcript with fillers struck
// through (cleaning up) -> clean final text (done). Loops on a calm cadence and
// respects prefers-reduced-motion by holding the clean end state.
type Phase = 'listening' | 'cleaning' | 'done';

const RAW: { t: string; strike?: boolean }[] = [
  { t: 'so ' },
  { t: 'um', strike: true },
  { t: ' can we ' },
  { t: 'uh', strike: true },
  { t: ' push the release to friday' },
];
const CLEAN = 'Can we push the release to Friday?';

const STATE_LABEL: Record<Phase, string> = {
  listening: 'listening',
  cleaning: 'cleaning up',
  done: 'done',
};

export function FeaturesDemo() {
  // Default to the clean end state so no-JS / first paint shows a meaningful
  // result; the effect drives the animation once mounted.
  const [phase, setPhase] = React.useState<Phase>('done');

  React.useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setPhase('done');
      return;
    }

    let cleaning: number;
    let done: number;
    const run = () => {
      setPhase('listening');
      cleaning = window.setTimeout(() => setPhase('cleaning'), 1800);
      done = window.setTimeout(() => setPhase('done'), 3000);
    };
    run();
    const loop = window.setInterval(run, 6000);

    return () => {
      clearTimeout(cleaning);
      clearTimeout(done);
      clearInterval(loop);
    };
  }, []);

  return (
    <div className="fx-demo">
      <div className="fx-demo__label">
        <span>Live in Slack</span>
        <span>{STATE_LABEL[phase]}</span>
      </div>

      {phase !== 'done' && (
        <div className="fx-wave" aria-hidden="true">
          {Array.from({ length: 22 }).map((_, i) => (
            <span key={i} />
          ))}
        </div>
      )}

      <div className="fx-transcript" aria-live="polite">
        {phase === 'listening' && <span className="fx-caret" aria-hidden="true" />}
        {phase === 'cleaning' && (
          <span>
            {RAW.map((w, i) =>
              w.strike ? (
                <span key={i} className="fx-strike">
                  {w.t}
                </span>
              ) : (
                <span key={i}>{w.t}</span>
              ),
            )}
          </span>
        )}
        {phase === 'done' && <span className="fx-clean">{CLEAN}</span>}
      </div>
    </div>
  );
}

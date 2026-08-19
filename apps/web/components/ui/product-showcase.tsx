import { DictionaryDemo, SnippetsDemo, InsightsDemo } from "./feature-demos";

/**
 * Alternating rows, each carrying a LIVE demo rather than a screenshot — the
 * mis-hearing being learned, the trigger expanding, the numbers accruing.
 */
const ROWS = [
  {
    Demo: DictionaryDemo,
    title: "It learns your words",
    body: "Add the names, brands and jargon it keeps getting wrong. Every dictation after that spells them right — you never correct the same word twice.",
  },
  {
    Demo: SnippetsDemo,
    title: "It stops you retyping",
    body: "Say a short trigger and the whole block lands — the intro, the sign-off, the link you paste ten times a day.",
  },
  {
    Demo: InsightsDemo,
    title: "It keeps score",
    body: "Speaking pace, words dictated and the fixes it quietly made for you — all computed on your machine, never uploaded.",
  },
];

export function ProductShowcase() {
  return (
    <div className="space-y-20 lg:space-y-28">
      {ROWS.map(({ Demo, title, body }, i) => (
        <div
          key={title}
          className="grid items-center gap-10 lg:grid-cols-[1.25fr_1fr] lg:gap-16"
        >
          <div className={`relative ${i % 2 ? "lg:order-2" : ""}`}>
            <div
              aria-hidden
              className="pointer-events-none absolute -inset-6 -z-10 translate-y-6 rounded-[36px] bg-brand/15 blur-[60px]"
            />
            <Demo />
          </div>
          <div className={i % 2 ? "lg:order-1" : ""}>
            <h3 className="text-[clamp(1.35rem,2.4vw,1.75rem)] font-semibold leading-tight tracking-[-0.015em] text-ink">
              {title}
            </h3>
            <p className="mt-4 max-w-md text-[15px] leading-relaxed text-muted">
              {body}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

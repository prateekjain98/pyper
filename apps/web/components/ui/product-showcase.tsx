import { AppFrame } from "./app-frame";

/**
 * Alternating rows. Screenshots are pre-cropped to the app's content region and
 * presented inside a window frame so they read as the product, not as pictures.
 */
const ROWS = [
  {
    src: "/shots/dictionary-2.png",
    alt: "The Pyper dictionary listing saved terms so transcription stops mishearing them",
    label: "Pyper — Dictionary",
    title: "It learns your words",
    body: "Add the names, brands and jargon it keeps getting wrong. Every dictation after that spells them right — you never correct the same word twice.",
  },
  {
    src: "/shots/snippets-2.png",
    alt: "Pyper snippets mapping a short trigger phrase to a longer expansion",
    label: "Pyper — Snippets",
    title: "It stops you retyping",
    body: "Say a short trigger and the whole block lands — the intro, the sign-off, the link you paste ten times a day.",
  },
  {
    src: "/shots/insights-2.png",
    alt: "Pyper Insights: words per minute, fixes made and total words dictated",
    label: "Pyper — Insights",
    title: "It keeps score",
    body: "Speaking pace, words dictated, the fixes it quietly made for you and the streak you are on — all computed on your machine.",
    height: 700,
  },
];

export function ProductShowcase() {
  return (
    <div className="space-y-24 lg:space-y-32">
      {ROWS.map((r, i) => (
        <div
          key={r.title}
          className="grid items-center gap-10 lg:grid-cols-[1.35fr_1fr] lg:gap-16"
        >
          <AppFrame
            src={r.src}
            alt={r.alt}
            label={r.label}
            height={r.height}
            className={i % 2 ? "lg:order-2" : ""}
          />
          <div className={i % 2 ? "lg:order-1" : ""}>
            <h3 className="text-[clamp(1.35rem,2.4vw,1.75rem)] font-semibold leading-tight tracking-[-0.015em] text-ink">
              {r.title}
            </h3>
            <p className="mt-4 max-w-md text-[15px] leading-relaxed text-muted">
              {r.body}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

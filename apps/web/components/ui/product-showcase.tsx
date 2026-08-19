import Image from "next/image";

/**
 * Alternating rows rather than a 3-up grid: app screenshots need real width to
 * stay legible. The PNGs are pre-cropped to the app's content region (no window
 * chrome, no sidebar), so they render at natural aspect.
 */
const ROWS = [
  {
    src: "/shots/dictionary-2.png",
    alt: "The Pyper dictionary listing saved terms so transcription stops mishearing them",
    title: "It learns your words",
    body: "Add the names, brands and jargon it keeps getting wrong. Every dictation after that spells them right — no correcting the same word twice.",
  },
  {
    src: "/shots/snippets-2.png",
    alt: "Pyper snippets mapping a short trigger phrase to a longer expansion",
    title: "It stops you retyping",
    body: "Say a short trigger and the whole block lands — the intro, the sign-off, the link you paste ten times a day.",
  },
  {
    src: "/shots/insights-2.png",
    alt: "Pyper Insights: words per minute, fixes made and total words dictated",
    title: "It keeps score",
    body: "Speaking pace, words dictated, the fixes it made for you and the streak you are on — all computed on your machine.",
  },
];

export function ProductShowcase() {
  return (
    <div className="space-y-4">
      {ROWS.map((r, i) => (
        <div
          key={r.title}
          className="grid items-center gap-8 overflow-hidden rounded-2xl bg-[#0f131c] p-6 ring-1 ring-line sm:p-8 lg:grid-cols-[1.45fr_1fr]"
        >
          <div
            className={`overflow-hidden rounded-xl ring-1 ring-line ${i % 2 ? "lg:order-2" : ""}`}
          >
            <Image
              src={r.src}
              alt={r.alt}
              width={1300}
              height={620}
              className="h-auto w-full"
            />
          </div>
          <div className={i % 2 ? "lg:order-1" : ""}>
            <h3 className="text-[1.35rem] font-semibold tracking-[-0.01em] text-ink">
              {r.title}
            </h3>
            <p className="mt-3 text-[15px] leading-relaxed text-muted">
              {r.body}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

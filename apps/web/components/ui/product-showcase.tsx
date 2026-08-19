import Image from "next/image";

/**
 * Product glimpses, not full-window dumps. Each shot is cropped to its top
 * region at a fixed height — that is where the meaningful UI lives (title, the
 * stat cards, the word list) — so the app reads at a glance instead of being
 * shrunk to illegible 8px text.
 */
const SHOTS = [
  {
    src: "/shots/dictionary.png",
    alt: "The Pyper dictionary listing saved terms so transcription stops mishearing them",
    title: "It learns your words",
    body: "Add the names and jargon it keeps getting wrong. Every dictation after that spells them right.",
  },
  {
    src: "/shots/snippets.png",
    alt: "Pyper snippets mapping a short trigger phrase to a longer expansion",
    title: "It stops you retyping",
    body: "Say a short trigger; the whole block lands — intros, sign-offs, links you type all day.",
  },
  {
    src: "/shots/insights.png",
    alt: "Pyper Insights: words per minute, fixes made and total words dictated",
    title: "It keeps score",
    body: "Speaking pace, words dictated and your streak — computed on your machine.",
  },
];

export function ProductShowcase() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {SHOTS.map((s) => (
        <figure
          key={s.title}
          className="flex flex-col overflow-hidden rounded-2xl bg-[#0f131c] ring-1 ring-line"
        >
          {/* fixed-height window onto the top of the shot */}
          <div className="relative h-[190px] overflow-hidden border-b border-line">
            <Image
              src={s.src}
              alt={s.alt}
              width={1600}
              height={1066}
              className="absolute left-0 top-0 w-[150%] max-w-none"
            />
          </div>
          <figcaption className="p-5">
            <h3 className="text-[15px] font-semibold text-ink">{s.title}</h3>
            <p className="mt-1.5 text-[14px] leading-relaxed text-muted">
              {s.body}
            </p>
          </figcaption>
        </figure>
      ))}
    </div>
  );
}

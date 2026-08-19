import Image from "next/image";

/**
 * Real screenshots from the shipping macOS app. Rendered at natural aspect —
 * no object-cover — so nothing is zoomed or clipped, and with a hairline ring
 * rather than a light border (which read as a white outline on the dark page).
 */
const SIDE = [
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
];

export function ProductShowcase() {
  return (
    <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
      {/* the app, at natural aspect */}
      <figure className="overflow-hidden rounded-2xl bg-[#0f131c] ring-1 ring-line">
        <Image
          src="/shots/insights.png"
          alt="Pyper Insights: words per minute, fixes made, total words dictated and a dictation streak heatmap"
          width={1600}
          height={1066}
          className="w-full"
          priority
        />
        <figcaption className="border-t border-line px-6 py-5">
          <h3 className="text-[15px] font-semibold text-ink">
            And it keeps score
          </h3>
          <p className="mt-1.5 text-[14px] leading-relaxed text-muted">
            Words dictated, speaking pace, the streak you&rsquo;re on — all
            computed from your own history, on your machine.
          </p>
        </figcaption>
      </figure>

      <div className="grid gap-4">
        {SIDE.map((s) => (
          <figure
            key={s.title}
            className="overflow-hidden rounded-2xl bg-[#0f131c] ring-1 ring-line"
          >
            <Image
              src={s.src}
              alt={s.alt}
              width={1600}
              height={1066}
              className="w-full"
            />
            <figcaption className="border-t border-line px-6 py-5">
              <h3 className="text-[15px] font-semibold text-ink">{s.title}</h3>
              <p className="mt-1.5 text-[14px] leading-relaxed text-muted">
                {s.body}
              </p>
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}

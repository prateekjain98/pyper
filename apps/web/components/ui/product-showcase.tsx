import Image from "next/image";

/**
 * Real product screenshots, captured from the shipping macOS app (1.9.2).
 * Layout follows tailark's features/eight block (MIT): one wide card carrying
 * the app shot behind a bottom mask fade, with supporting shots beside it.
 */
const SHOTS = [
  {
    src: "/shots/dictionary.png",
    alt: "Pyper custom dictionary listing saved terms",
    title: "Custom dictionary",
    body: "Teach it the names and jargon it keeps mishearing.",
  },
  {
    src: "/shots/snippets.png",
    alt: "Pyper snippets mapping a trigger phrase to expanded text",
    title: "Snippets",
    body: "A short trigger expands into the text you retype all day.",
  },
];

export function ProductShowcase() {
  return (
    <div className="grid gap-px overflow-hidden rounded-2xl border border-line bg-line lg:grid-cols-2">
      {/* wide hero shot */}
      <div className="bg-[#0f131c] p-6 pb-0 lg:col-span-2 lg:p-8 lg:pb-0">
        <div className="max-w-xl">
          <h3 className="text-lg font-semibold text-ink">
            One window, the whole workflow
          </h3>
          <p className="mt-2 text-[15px] leading-relaxed text-muted">
            Dictation history, meeting notes, your dictionary and snippets — in
            a desktop app that stays out of the way until you press the hotkey.
          </p>
        </div>
        <div className="relative mt-8 [mask-image:linear-gradient(to_bottom,black_78%,transparent)]">
          <Image
            src="/shots/dashboard.png"
            alt="The Pyper desktop app showing the dictation dashboard and sidebar"
            width={1406}
            height={1500}
            className="w-full rounded-t-xl border border-white/10 border-b-0 object-cover object-top"
            style={{
              maxHeight: 420,
              objectFit: "cover",
              objectPosition: "top left",
            }}
          />
        </div>
      </div>

      {/* supporting shots */}
      {SHOTS.map((s) => (
        <div key={s.title} className="bg-[#0f131c] p-6 lg:p-8">
          <h3 className="text-[15px] font-semibold text-ink">{s.title}</h3>
          <p className="mt-1.5 text-[14px] leading-relaxed text-muted">
            {s.body}
          </p>
          <div className="relative mt-5 overflow-hidden rounded-xl border border-white/10">
            <Image
              src={s.src}
              alt={s.alt}
              width={1600}
              height={1066}
              className="w-full object-cover object-left-top"
              style={{
                maxHeight: 260,
                objectFit: "cover",
                objectPosition: "left top",
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

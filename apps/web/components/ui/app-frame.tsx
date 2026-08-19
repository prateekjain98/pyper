import Image from "next/image";

/**
 * Presents a screenshot as the app, not as a raw image: macOS window chrome,
 * a brand glow bloom behind it, and a lift shadow. Without the frame the shots
 * read as flat pasted pictures.
 */
export function AppFrame({
  src,
  alt,
  label,
  width = 1300,
  height = 620,
  className = "",
}: {
  src: string;
  alt: string;
  label: string;
  width?: number;
  height?: number;
  className?: string;
}) {
  return (
    <div className={`relative ${className}`}>
      {/* ambient bloom — sits behind and slightly below, so the window lifts */}
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-6 -z-10 translate-y-6 rounded-[36px] bg-brand/20 blur-[60px]"
      />
      <div className="overflow-hidden rounded-xl bg-[#0b0e14] shadow-[0_28px_70px_-24px_rgba(0,0,0,0.85)] ring-1 ring-white/10">
        {/* title bar */}
        <div className="flex items-center gap-2 border-b border-white/[0.07] bg-white/[0.035] px-3.5 py-2.5">
          <span className="flex gap-1.5" aria-hidden>
            <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
          </span>
          <span className="ml-1.5 font-mono text-[10.5px] uppercase tracking-[0.14em] text-white/35">
            {label}
          </span>
        </div>
        <Image
          src={src}
          alt={alt}
          width={width}
          height={height}
          className="h-auto w-full"
        />
      </div>
    </div>
  );
}

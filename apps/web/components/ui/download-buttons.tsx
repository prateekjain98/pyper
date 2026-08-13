"use client";

// OS-detecting download buttons. The primary button links straight at the public
// installer for the visitor's platform, so clicking downloads the actual file.
// Other platforms link directly too, or show "(soon)" until built.
import { DOWNLOADS, PLATFORM_LABEL, type Platform, useDownload } from "@/lib/useDownload";

function DownloadIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 3v11m0 0 4-4m-4 4-4-4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M4 16v2.5A2.5 2.5 0 0 0 6.5 21h11a2.5 2.5 0 0 0 2.5-2.5V16"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function DownloadButtons(_props: { releasesUrl?: string }) {
  const { os, href, label } = useDownload();

  // The platform the primary button actually offers (macOS when the detected
  // OS build isn't ready), so we don't also list it under "Also for".
  const primaryPlatform: Platform = os !== "unknown" && DOWNLOADS[os as Platform] ? (os as Platform) : "mac";
  const others = (Object.keys(PLATFORM_LABEL) as Platform[]).filter((p) => p !== primaryPlatform);

  return (
    <>
      <div className="cta-row">
        <a className="btn btn-primary" href={href} download>
          <DownloadIcon />
          {label}
        </a>
      </div>
      <p className="platforms">
        Also for{" "}
        {others.map((p, i) => (
          <span key={p}>
            {i > 0 ? " · " : ""}
            {DOWNLOADS[p] ? (
              <a className="platform-link" href={DOWNLOADS[p]} download>
                {PLATFORM_LABEL[p]}
              </a>
            ) : (
              <span style={{ opacity: 0.55 }}>{PLATFORM_LABEL[p]} (soon)</span>
            )}
          </span>
        ))}
      </p>
    </>
  );
}

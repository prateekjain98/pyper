"use client";

// OS-detecting download buttons. The primary button points straight at the
// installer for the visitor's platform (resolved at runtime from the latest
// GitHub release), so a click downloads immediately. Other platforms link to
// the Releases page.
import { PLATFORM_LABEL, RELEASES_PAGE, useDownload } from "@/lib/useDownload";

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

export function DownloadButtons({ releasesUrl = RELEASES_PAGE }: { releasesUrl?: string }) {
  const { os, href, ready } = useDownload();

  const primaryLabel = os === "unknown" ? "Download" : `Download for ${PLATFORM_LABEL[os]}`;

  const others = (
    Object.keys(PLATFORM_LABEL) as Array<Exclude<typeof os, "unknown">>
  ).filter((p) => p !== os);

  return (
    <>
      <div className="cta-row">
        <a className="btn btn-primary" href={href} download={ready || undefined}>
          <DownloadIcon />
          {primaryLabel}
        </a>
      </div>
      <p className="platforms">
        {os === "unknown" ? "Available for " : "Also available for "}
        {others.map((p, i) => (
          <span key={p}>
            {i > 0 ? " · " : ""}
            <a className="platform-link" href={releasesUrl}>
              {PLATFORM_LABEL[p]}
            </a>
          </span>
        ))}
      </p>
    </>
  );
}

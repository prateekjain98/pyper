"use client";

// OS-detecting download buttons for the desktop app. The primary button relabels
// itself for the visitor's platform; every link lands on the GitHub Releases
// "latest" page, because Pyper's release assets embed the version in their file
// names and so can't be deep-linked with a stable URL.
import { useEffect, useState } from "react";

type OS = "mac" | "windows" | "linux" | "unknown";

const PLATFORM_LABEL: Record<Exclude<OS, "unknown">, string> = {
  mac: "macOS",
  windows: "Windows",
  linux: "Linux",
};

function detectOS(): OS {
  if (typeof navigator === "undefined") return "unknown";
  const ua = navigator.userAgent.toLowerCase();
  // Phones/tablets can't run the desktop app; don't mislabel them (Android's UA
  // contains "linux", so bail before the platform checks below).
  if (ua.includes("android") || /iphone|ipad|ipod/.test(ua)) return "unknown";

  const uaPlatform = (navigator as { userAgentData?: { platform?: string } })
    .userAgentData?.platform;
  const platform = (uaPlatform || navigator.platform || "").toLowerCase();

  if (platform.includes("mac") || ua.includes("mac os x")) return "mac";
  if (platform.includes("win") || ua.includes("windows")) return "windows";
  if (platform.includes("linux") || ua.includes("linux")) return "linux";
  return "unknown";
}

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

export function DownloadButtons({ releasesUrl }: { releasesUrl: string }) {
  // Start "unknown" so the server-rendered and first client-rendered markup
  // match; the real OS is filled in after mount.
  const [os, setOs] = useState<OS>("unknown");

  useEffect(() => {
    setOs(detectOS());
  }, []);

  const primaryLabel =
    os === "unknown" ? "Download" : `Download for ${PLATFORM_LABEL[os]}`;

  const others = (
    Object.keys(PLATFORM_LABEL) as Array<Exclude<OS, "unknown">>
  ).filter((p) => p !== os);

  return (
    <>
      <div className="cta-row">
        <a className="btn btn-primary" href={releasesUrl}>
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

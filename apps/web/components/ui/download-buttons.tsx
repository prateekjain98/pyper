"use client";

// OS-detecting download buttons.
//
// The installers are hosted on public cloud storage (GCS) and linked directly,
// so clicking a button downloads the actual file. (The GitHub repo is private,
// so its release assets 404 for anonymous visitors — hence public hosting.)
import { useEffect, useState } from "react";

type OS = "mac" | "windows" | "linux" | "unknown";
type Platform = Exclude<OS, "unknown">;

const PLATFORM_LABEL: Record<Platform, string> = {
  mac: "macOS",
  windows: "Windows",
  linux: "Linux",
};

// Public, directly-downloadable installer URLs. Empty string = not built yet.
const DOWNLOADS: Record<Platform, string> = {
  mac: "https://storage.googleapis.com/pyper-desktop-downloads/Pyper-1.8.3-arm64.dmg",
  windows: "",
  linux: "",
};

function detectOS(): OS {
  if (typeof navigator === "undefined") return "unknown";
  const ua = navigator.userAgent.toLowerCase();
  // Phones/tablets can't run the desktop app (Android's UA contains "linux").
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

export function DownloadButtons(_props: { releasesUrl?: string }) {
  // Start "unknown" so SSR and first client render match; fill in after mount.
  const [os, setOs] = useState<OS>("unknown");
  useEffect(() => {
    setOs(detectOS());
  }, []);

  // Download the detected OS's build if we have it; otherwise offer the build we
  // do have (macOS) so the primary button always downloads something real.
  const detected: Platform = os === "unknown" ? "mac" : os;
  const hasDetected = Boolean(DOWNLOADS[detected]);
  const primaryUrl = hasDetected ? DOWNLOADS[detected] : DOWNLOADS.mac;
  const primaryLabel = hasDetected
    ? `Download for ${PLATFORM_LABEL[detected]}`
    : "Download for macOS";

  const others = (Object.keys(PLATFORM_LABEL) as Platform[]).filter(
    (p) => p !== detected,
  );

  return (
    <>
      <div className="cta-row">
        <a className="btn btn-primary" href={primaryUrl} download>
          <DownloadIcon />
          {primaryLabel}
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

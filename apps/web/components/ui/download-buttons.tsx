"use client";

// OS-detecting download buttons for the desktop app.
//
// On mount we ask the GitHub API for the latest release and resolve the actual
// installer asset for each OS, so each button is a *direct download* of the
// right file (.dmg / .exe / .AppImage) rather than a link to a web page. The
// releases page is used only as a genuine last-resort fallback — while the API
// call is in flight, or if it fails, or if a given OS has no asset yet.
import { useEffect, useState } from "react";

type OS = "mac" | "windows" | "linux" | "unknown";
type Platform = Exclude<OS, "unknown">;

const PLATFORM_LABEL: Record<Platform, string> = {
  mac: "macOS",
  windows: "Windows",
  linux: "Linux",
};

const REPO = "prateekjain98/pyper";
const LATEST_API = `https://api.github.com/repos/${REPO}/releases/latest`;
const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`;

type Asset = { name: string; browser_download_url: string };
type Downloads = Record<Platform, string | null>;

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

// First asset whose name matches the highest-priority pattern for the OS.
function pickAsset(assets: Asset[], os: Platform): string | null {
  const patterns: Record<Platform, RegExp[]> = {
    mac: [/arm64.*\.dmg$/i, /universal.*\.dmg$/i, /\.dmg$/i, /mac.*\.zip$/i],
    windows: [/setup.*\.exe$/i, /\.exe$/i],
    linux: [/\.AppImage$/i, /\.deb$/i, /\.rpm$/i, /\.tar\.gz$/i],
  };
  for (const re of patterns[os]) {
    const hit = assets.find((a) => re.test(a.name));
    if (hit) return hit.browser_download_url;
  }
  return null;
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

export function DownloadButtons({ releasesUrl }: { releasesUrl?: string }) {
  // Start "unknown" so server-rendered and first client-rendered markup match;
  // the real OS + resolved asset URLs are filled in after mount.
  const [os, setOs] = useState<OS>("unknown");
  const [downloads, setDownloads] = useState<Downloads | null>(null);

  useEffect(() => {
    setOs(detectOS());
    let cancelled = false;
    fetch(LATEST_API, { headers: { Accept: "application/vnd.github+json" } })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((release: { assets?: Asset[] }) => {
        if (cancelled) return;
        const assets = release.assets ?? [];
        setDownloads({
          mac: pickAsset(assets, "mac"),
          windows: pickAsset(assets, "windows"),
          linux: pickAsset(assets, "linux"),
        });
      })
      .catch(() => {
        if (!cancelled) setDownloads(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const fallback = releasesUrl ?? RELEASES_PAGE;
  const urlFor = (p: Platform) => downloads?.[p] ?? fallback;
  const isDirect = (p: Platform) => Boolean(downloads?.[p]);

  const primaryLabel =
    os === "unknown" ? "Download" : `Download for ${PLATFORM_LABEL[os]}`;
  // For a detected OS, link its installer directly; for unknown (mobile/other),
  // there's no single right installer, so send them to the releases list.
  const primaryHref = os === "unknown" ? fallback : urlFor(os);
  const primaryDirect = os !== "unknown" && isDirect(os);

  const others = (Object.keys(PLATFORM_LABEL) as Platform[]).filter(
    (p) => p !== os,
  );

  return (
    <>
      <div className="cta-row">
        <a
          className="btn btn-primary"
          href={primaryHref}
          {...(primaryDirect ? { download: "" } : {})}
        >
          <DownloadIcon />
          {primaryLabel}
        </a>
      </div>
      <p className="platforms">
        {os === "unknown" ? "Available for " : "Also available for "}
        {others.map((p, i) => (
          <span key={p}>
            {i > 0 ? " · " : ""}
            <a
              className="platform-link"
              href={urlFor(p)}
              {...(isDirect(p) ? { download: "" } : {})}
            >
              {PLATFORM_LABEL[p]}
            </a>
          </span>
        ))}
      </p>
    </>
  );
}

"use client";

// Resolves a *direct* installer download for the visitor's OS by reading the
// latest GitHub release at runtime — so a CTA click starts the download instead
// of bouncing to the Releases page. Asset names embed the version, so they can't
// be hard-linked; fetching the release keeps the link correct across versions.
import { useEffect, useState } from "react";

export type DownloadOS = "mac" | "windows" | "linux" | "unknown";

const REPO = "prateekjain98/pyper";
const RELEASES_API = `https://api.github.com/repos/${REPO}/releases/latest`;
export const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`;

// The repo is currently PRIVATE, so the anonymous GitHub API can't resolve
// assets (it 404s). Pin the current release's direct installer per OS so a click
// still downloads in one step for anyone with repo access. Once the releases are
// made public, the runtime resolver below takes over and keeps these correct for
// every version automatically — until then, bump these on each release.
const FALLBACK_DIRECT: Partial<Record<DownloadOS, string>> = {
  mac: `https://github.com/${REPO}/releases/download/v1.8.3/Pyper-1.8.3-arm64.dmg`,
};

export const PLATFORM_LABEL: Record<Exclude<DownloadOS, "unknown">, string> = {
  mac: "macOS",
  windows: "Windows",
  linux: "Linux",
};

function detectOS(): DownloadOS {
  if (typeof navigator === "undefined") return "unknown";
  const ua = navigator.userAgent.toLowerCase();
  // Phones/tablets can't run the desktop app (Android's UA says "linux", so bail first).
  if (ua.includes("android") || /iphone|ipad|ipod/.test(ua)) return "unknown";
  const uaPlatform = (navigator as { userAgentData?: { platform?: string } }).userAgentData
    ?.platform;
  const platform = (uaPlatform || navigator.platform || "").toLowerCase();
  if (platform.includes("mac") || ua.includes("mac os x")) return "mac";
  if (platform.includes("win") || ua.includes("windows")) return "windows";
  if (platform.includes("linux") || ua.includes("linux")) return "linux";
  return "unknown";
}

type Asset = { name: string; browser_download_url: string };

function pickAsset(assets: Asset[], os: DownloadOS): Asset | undefined {
  const endsWith = (exts: string[]) =>
    assets.find((a) => exts.some((e) => a.name.toLowerCase().endsWith(e)));
  if (os === "mac") return endsWith([".dmg"]);
  if (os === "windows") return endsWith([".exe"]);
  if (os === "linux") return endsWith([".appimage", ".deb", ".rpm"]);
  return undefined;
}

export interface DownloadInfo {
  os: DownloadOS;
  /** Direct installer URL once resolved, otherwise the Releases page. */
  href: string;
  /** True when `href` points straight at an installer for this OS. */
  ready: boolean;
}

export function useDownload(): DownloadInfo {
  const [info, setInfo] = useState<DownloadInfo>({
    os: "unknown",
    href: RELEASES_PAGE,
    ready: false,
  });

  useEffect(() => {
    const os = detectOS();
    const fallback = FALLBACK_DIRECT[os];
    setInfo({ os, href: fallback ?? RELEASES_PAGE, ready: Boolean(fallback) });
    let cancelled = false;
    fetch(RELEASES_API, { headers: { Accept: "application/vnd.github+json" } })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { assets?: Asset[] } | null) => {
        if (cancelled || !data?.assets) return;
        const asset = pickAsset(data.assets, os);
        if (asset?.browser_download_url) {
          setInfo({ os, href: asset.browser_download_url, ready: true });
        }
      })
      .catch(() => {
        /* keep the Releases-page fallback */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return info;
}

"use client";

// Resolves a *direct* installer download for the visitor's OS, so a CTA click
// downloads the actual file instead of bouncing to a page. Installers are hosted
// on public cloud storage (GCS) — the GitHub repo is private, so its release
// assets 404 for anonymous visitors.
import { useEffect, useState } from "react";

export type DownloadOS = "mac" | "windows" | "linux" | "unknown";
export type Platform = Exclude<DownloadOS, "unknown">;

export const PLATFORM_LABEL: Record<Platform, string> = {
  mac: "macOS",
  windows: "Windows",
  linux: "Linux",
};

// Public, directly-downloadable installer URLs. Empty string = not built yet.
export const DOWNLOADS: Record<Platform, string> = {
  mac: "https://storage.googleapis.com/pyper-desktop-downloads/Pyper-1.8.3-arm64.dmg",
  windows: "",
  linux: "",
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

export interface DownloadInfo {
  os: DownloadOS;
  /** Direct installer URL for the detected OS (falls back to the macOS build). */
  href: string;
  /** e.g. "Download for macOS". */
  label: string;
}

export function useDownload(): DownloadInfo {
  // Start "unknown" so SSR and the first client render match; fill in after mount.
  const [os, setOs] = useState<DownloadOS>("unknown");
  useEffect(() => {
    setOs(detectOS());
  }, []);

  const hasDetected = os !== "unknown" && Boolean(DOWNLOADS[os as Platform]);
  // Always offer a real download; if the detected OS build isn't ready, give macOS.
  const href = hasDetected ? DOWNLOADS[os as Platform] : DOWNLOADS.mac;
  const label = hasDetected
    ? `Download for ${PLATFORM_LABEL[os as Platform]}`
    : "Download for macOS";

  return { os, href, label };
}

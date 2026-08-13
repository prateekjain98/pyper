"use client";

import type { ReactNode } from "react";
import { useDownload } from "@/lib/useDownload";

/**
 * A CTA link that points straight at the OS-appropriate installer, so clicking
 * starts the download immediately (GitHub serves release assets with an
 * attachment disposition). Falls back to the Releases page until resolved.
 */
export function DownloadCTA({
  className,
  children,
  onClick,
}: {
  className?: string;
  children: ReactNode;
  onClick?: () => void;
}) {
  const { href, ready } = useDownload();
  return (
    <a href={href} download={ready || undefined} className={className} onClick={onClick}>
      {children}
    </a>
  );
}

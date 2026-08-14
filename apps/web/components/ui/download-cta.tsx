"use client";

import type { ReactNode } from "react";
import Link from "next/link";

/**
 * Primary "Download" CTA. Routes to /install rather than straight at the file:
 * that page auto-starts the OS-appropriate installer download on mount AND shows
 * the first-launch instructions (Pyper is un-notarized, so macOS blocks the first
 * open). One click therefore both downloads the app and lands the user on help.
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
  return (
    <Link href="/install" className={className} onClick={onClick}>
      {children}
    </Link>
  );
}

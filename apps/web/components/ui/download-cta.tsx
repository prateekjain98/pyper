"use client";

import type { ReactNode } from "react";
import { useDownload } from "@/lib/useDownload";

/**
 * A CTA link that points straight at the OS-appropriate installer (public GCS),
 * so clicking downloads the file immediately — no page bounce.
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
  const { href } = useDownload();
  return (
    <a href={href} download className={className} onClick={onClick}>
      {children}
    </a>
  );
}

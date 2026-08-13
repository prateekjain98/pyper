import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pyper — Privacy-first voice-to-text dictation",
  description:
    "Press a hotkey, speak, and your words appear at your cursor. Private, offline-capable dictation with AI agents, meeting transcription, and notes. For macOS, Windows, and Linux.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

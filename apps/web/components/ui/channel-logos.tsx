import React from "react";

/* Brand marks for the destinations Pyper actually re-tones for
   (services/pyai-proxy/channelStyles.js). Inline SVG so they stay crisp and
   need no network request. */

export function SlackLogo({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 122 122" className={className} aria-hidden="true">
      <path
        fill="#E01E5A"
        d="M25.8 77.6a12.9 12.9 0 1 1-12.9-12.9h12.9v12.9Zm6.5 0a12.9 12.9 0 0 1 25.8 0v32.3a12.9 12.9 0 0 1-25.8 0V77.6Z"
      />
      <path
        fill="#36C5F0"
        d="M45.2 25.8a12.9 12.9 0 1 1 12.9-12.9v12.9H45.2Zm0 6.5a12.9 12.9 0 0 1 0 25.8H12.9a12.9 12.9 0 0 1 0-25.8h32.3Z"
      />
      <path
        fill="#2EB67D"
        d="M96.9 45.2a12.9 12.9 0 1 1 12.9 12.9H96.9V45.2Zm-6.5 0a12.9 12.9 0 0 1-25.8 0V12.9a12.9 12.9 0 0 1 25.8 0v32.3Z"
      />
      <path
        fill="#ECB22E"
        d="M77.6 96.9a12.9 12.9 0 1 1-12.9 12.9V96.9h12.9Zm0-6.5a12.9 12.9 0 0 1 0-25.8h32.3a12.9 12.9 0 0 1 0 25.8H77.6Z"
      />
    </svg>
  );
}

export function GmailLogo({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 36" className={className} aria-hidden="true">
      <path
        fill="#4285F4"
        d="M3.3 36h7.6V17.5L0 9.3v23.4C0 34.5 1.5 36 3.3 36Z"
      />
      <path
        fill="#34A853"
        d="M37.1 36h7.6c1.8 0 3.3-1.5 3.3-3.3V9.3l-10.9 8.2V36Z"
      />
      <path
        fill="#FBBC04"
        d="M37.1 3.3v14.2L48 9.3V5c0-4-4.6-6.3-7.8-3.9l-3.1 2.2Z"
      />
      <path
        fill="#EA4335"
        d="M10.9 17.5V3.3L24 13.1l13.1-9.8v14.2L24 27.3 10.9 17.5Z"
      />
      <path fill="#C5221F" d="M0 5v4.3l10.9 8.2V3.3L7.8 1.1C4.6-1.3 0 1 0 5Z" />
    </svg>
  );
}

export function NotesLogo({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
      <rect width="48" height="48" rx="11" fill="#FDCB4B" />
      <rect width="48" height="13" rx="11" fill="#FEF0B4" />
      <rect y="9" width="48" height="4" fill="#FEF0B4" />
      <g stroke="#B08A16" strokeWidth="2.4" strokeLinecap="round" opacity=".65">
        <path d="M11 22h26M11 29h26M11 36h16" />
      </g>
    </svg>
  );
}

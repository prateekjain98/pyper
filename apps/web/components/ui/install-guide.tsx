"use client";

// Post-download install helper. Reached by clicking any "Download" CTA, which
// routes here instead of straight at the file; on mount this page auto-starts
// the real installer download (OS-detected, macOS by default) so the file lands
// AND the user gets the first-launch instructions. Pyper is ad-hoc signed, not
// notarized, so macOS blocks the first open ("cannot be verified" / "was blocked
// to protect your Mac") — the steps below walk through opening it safely.
import { useEffect, useRef, useState } from "react";
import { ThinkingOrb } from "@/components/ui/thinking-orbs";
import { useDownload } from "@/lib/useDownload";

// Display name only (the actual download URL comes from useDownload()). Matches the
// stable "latest" alias the release pipeline publishes, so it stays correct per release.
const DMG_NAME = "Pyper-latest-arm64.dmg";
const XATTR_CMD = "xattr -dr com.apple.quarantine /Applications/Pyper.app";

export function InstallGuide() {
  // OS-detected direct installer URL (always at least the macOS build).
  const { href } = useDownload();
  const fired = useRef(false);
  const [copied, setCopied] = useState(false);

  // Auto-start the download once on mount. Guarded with a ref so neither React
  // StrictMode's dev double-invoke nor an href change after OS detection can
  // trigger a second download.
  useEffect(() => {
    if (fired.current || !href) return;
    fired.current = true;
    const a = document.createElement("a");
    a.href = href;
    a.download = "";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }, [href]);

  const copyCmd = async () => {
    try {
      await navigator.clipboard.writeText(XATTR_CMD);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked (e.g. insecure context) — the command stays selectable.
    }
  };

  return (
    <main className="container" style={{ paddingBottom: 72 }}>
      {/* -------------------------------------------------------------- */}
      {/* Hero — reassurance + the live download status                  */}
      {/* -------------------------------------------------------------- */}
      <section className="hero" style={{ paddingBottom: 28 }}>
        <span className="eyebrow">Almost there</span>
        <h1>
          Your download is <span className="grad">starting…</span>
        </h1>
        <p className="subtitle">
          Pyper is downloading now. Because it isn&rsquo;t notarized by Apple yet, macOS will
          ask you to confirm it the first time you open it. That&rsquo;s expected — the app is
          safe. Here&rsquo;s how to open it, in under a minute.
        </p>

        {/* Live download chip */}
        <div className="cta-row">
          <span className="inline-flex items-center gap-3 rounded-full border border-line bg-surface py-2 pl-2 pr-5 text-left shadow-[0_12px_30px_-16px_rgba(0,0,0,0.7)]">
            <span className="grid h-9 w-9 flex-none place-items-center [&_canvas]:!size-7">
              <ThinkingOrb state="working" size={64} theme="dark" />
            </span>
            <span className="min-w-0">
              <span className="block text-[14px] font-medium text-ink">
                Downloading {DMG_NAME}
              </span>
              <span className="block text-xs text-muted">macOS · Apple Silicon</span>
            </span>
          </span>
        </div>

        <p className="platforms" style={{ marginTop: 16 }}>
          Download didn&rsquo;t start?{" "}
          <a className="platform-link" href={href} download>
            Click here to download again
          </a>
          .
        </p>
      </section>

      {/* -------------------------------------------------------------- */}
      {/* macOS first-launch steps                                       */}
      {/* -------------------------------------------------------------- */}
      <section className="mx-auto max-w-2xl">
        <div className="text-center">
          <h2 className="text-[clamp(1.5rem,3.4vw,2rem)] font-bold tracking-[-0.02em] text-ink">
            Opening Pyper for the first time
          </h2>
          <p className="mt-3 text-[15px] leading-relaxed text-muted">
            The security prompt only appears because Pyper isn&rsquo;t notarized by Apple yet —
            not because anything is wrong. You only need these steps once; after that Pyper opens
            like any other app.
          </p>
        </div>

        <ol className="mt-9 grid gap-4">
          {/* Step 1 */}
          <li className="flex gap-4 rounded-2xl border border-line bg-surface p-5 sm:p-6">
            <span className="flex h-9 w-9 flex-none items-center justify-center rounded-xl bg-brand-050 text-sm font-bold text-brand">
              1
            </span>
            <div className="min-w-0">
              <h3 className="text-[17px] font-semibold text-ink">
                Open the installer, drag Pyper to Applications
              </h3>
              <p className="mt-1.5 text-[15px] leading-relaxed text-muted">
                Open the downloaded{" "}
                <code className="rounded bg-paper-2 px-1.5 py-0.5 font-mono text-[13px] text-ink-soft">
                  {DMG_NAME}
                </code>{" "}
                and drag <strong className="font-semibold text-ink">Pyper</strong> into your{" "}
                <strong className="font-semibold text-ink">Applications</strong> folder.
              </p>
            </div>
          </li>

          {/* Step 2 */}
          <li className="flex gap-4 rounded-2xl border border-line bg-surface p-5 sm:p-6">
            <span className="flex h-9 w-9 flex-none items-center justify-center rounded-xl bg-brand-050 text-sm font-bold text-brand">
              2
            </span>
            <div className="min-w-0">
              <h3 className="text-[17px] font-semibold text-ink">
                Expect macOS to block the first launch
              </h3>
              <p className="mt-1.5 text-[15px] leading-relaxed text-muted">
                The first time you open it, macOS may say{" "}
                <em className="text-ink-soft not-italic">
                  &ldquo;Pyper cannot be opened because Apple cannot check it for malicious
                  software&rdquo;
                </em>{" "}
                or{" "}
                <em className="text-ink-soft not-italic">
                  &ldquo;Pyper was blocked to protect your Mac.&rdquo;
                </em>{" "}
                This is normal for un-notarized apps — keep going.
              </p>
            </div>
          </li>

          {/* Step 3 */}
          <li className="flex gap-4 rounded-2xl border border-line bg-surface p-5 sm:p-6">
            <span className="flex h-9 w-9 flex-none items-center justify-center rounded-xl bg-brand-050 text-sm font-bold text-brand">
              3
            </span>
            <div className="min-w-0">
              <h3 className="text-[17px] font-semibold text-ink">
                Right-click Pyper and choose Open
              </h3>
              <p className="mt-1.5 text-[15px] leading-relaxed text-muted">
                In your Applications folder,{" "}
                <strong className="font-semibold text-ink">right-click (or Control-click)</strong>{" "}
                Pyper &rarr; <strong className="font-semibold text-ink">Open</strong>, then click{" "}
                <strong className="font-semibold text-ink">Open</strong> in the dialog. You only
                need to do this once — afterward it opens normally.
              </p>
            </div>
          </li>

          {/* Step 4 */}
          <li className="flex gap-4 rounded-2xl border border-line bg-surface p-5 sm:p-6">
            <span className="flex h-9 w-9 flex-none items-center justify-center rounded-xl bg-brand-050 text-sm font-bold text-brand">
              4
            </span>
            <div className="min-w-0">
              <h3 className="text-[17px] font-semibold text-ink">
                Or allow it from System Settings
              </h3>
              <p className="mt-1.5 text-[15px] leading-relaxed text-muted">
                Alternatively, open{" "}
                <strong className="font-semibold text-ink">
                  System Settings &rarr; Privacy &amp; Security
                </strong>
                , scroll to the &ldquo;Pyper was blocked&rdquo; message and click{" "}
                <strong className="font-semibold text-ink">Open Anyway</strong>, then launch Pyper
                again.
              </p>
            </div>
          </li>

          {/* Step 5 — damaged / quarantine */}
          <li className="flex gap-4 rounded-2xl border border-line bg-surface p-5 sm:p-6">
            <span className="flex h-9 w-9 flex-none items-center justify-center rounded-xl bg-brand-050 text-sm font-bold text-brand">
              5
            </span>
            <div className="min-w-0">
              <h3 className="text-[17px] font-semibold text-ink">
                If it says &ldquo;Pyper is damaged&rdquo;
              </h3>
              <p className="mt-1.5 text-[15px] leading-relaxed text-muted">
                Seeing{" "}
                <em className="text-ink-soft not-italic">
                  &ldquo;Pyper is damaged and can&rsquo;t be opened&rdquo;
                </em>
                ? macOS just quarantined the download. Open{" "}
                <strong className="font-semibold text-ink">Terminal</strong>, run the command
                below, then open Pyper normally:
              </p>
              <div className="mt-3 flex items-center gap-3 rounded-lg border border-line bg-paper-2 px-3 py-2.5">
                <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-[13px] text-ink-soft">
                  {XATTR_CMD}
                </code>
                <button
                  type="button"
                  onClick={copyCmd}
                  className="flex-none rounded-md border border-line px-2.5 py-1 text-xs font-semibold text-muted transition hover:border-white/25 hover:text-ink"
                >
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
            </div>
          </li>
        </ol>

        <p className="mt-8 text-center text-sm text-muted">
          On Windows or Linux? Native builds are coming soon — the download above is the macOS
          (Apple Silicon) app.
        </p>
      </section>
    </main>
  );
}

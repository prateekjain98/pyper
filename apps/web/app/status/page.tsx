import type { Metadata } from "next";
import { Header } from "@/components/ui/header";
import { StatusBoard } from "@/components/ui/status-board";

const BRAND = {
  name: "Pyper",
  domain: "pyper.work",
};

export const metadata: Metadata = {
  title: "Status — Pyper",
  description:
    "Live status of Pyper's backend dictation APIs — transcription, cleanup, and realtime — plus API-key credit health.",
};

// The board probes upstreams live on each request; never statically cache it.
export const dynamic = "force-dynamic";

export default function StatusPage() {
  return (
    <>
      <Header />

      <main className="container">
        <section className="hero">
          <span className="eyebrow">System status</span>
          <h1>
            Backend API <span className="grad">status.</span>
          </h1>
          <p className="subtitle">
            Real-time health of the cloud engines behind Pyper&apos;s dictation —
            transcription, transcript cleanup, and realtime — with a live check for
            any API key that has run out of credits.
          </p>
        </section>

        <StatusBoard />
      </main>

      <footer className="site-footer container">
        <span>
          © {new Date().getFullYear()} {BRAND.name} · Built by SaaS Labs
        </span>
        <span>{BRAND.domain} · System status</span>
      </footer>
    </>
  );
}

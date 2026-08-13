import type { Metadata } from "next";
import { Header } from "@/components/ui/header";
import { Pricing } from "@/components/ui/pricing";

const BRAND = {
  name: "Pyper",
  domain: "pyper.work",
  github: "https://github.com/prateekjain98/pyper",
};

export const metadata: Metadata = {
  title: "Pricing — Pyper",
  description:
    "Simple, privacy-first pricing for Pyper. Start free, upgrade to Pro for unlimited dictation and meetings, or contact us for Enterprise.",
};

export default function PricingPage() {
  return (
    <>
      <Header />

      <main className="container">
        <section className="hero">
          <span className="eyebrow">Pricing</span>
          <h1>
            Simple pricing that <span className="grad">scales with you.</span>
          </h1>
          <p className="subtitle">
            Start free and keep your audio on-device. Upgrade when you need unlimited
            dictation, meeting transcription, and team controls.
          </p>
        </section>

        <Pricing />
      </main>

      <footer className="site-footer container">
        <span>
          © {new Date().getFullYear()} {BRAND.name} · Built by SaaS Labs
        </span>
        <span>
          {BRAND.domain} · Derived from the open-source OpenWhispr project (MIT)
        </span>
      </footer>
    </>
  );
}

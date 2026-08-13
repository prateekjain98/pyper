import type { Metadata } from "next";
import { Header } from "@/components/ui/header";
import { InstallGuide } from "@/components/ui/install-guide";

const BRAND = {
  name: "Pyper",
  domain: "pyper.work",
};

export const metadata: Metadata = {
  title: "Install Pyper — Opening it the first time on macOS",
  description:
    "Your Pyper download is starting. Here's how to open the app the first time on macOS, when it isn't notarized by Apple yet.",
};

export default function InstallPage() {
  return (
    <>
      <Header />

      <InstallGuide />

      <footer className="site-footer container">
        <span>
          © {new Date().getFullYear()} {BRAND.name} · Built by SaaS Labs
        </span>
        <span>
          {BRAND.domain} · © 2026 SaaS Labs
        </span>
      </footer>
    </>
  );
}

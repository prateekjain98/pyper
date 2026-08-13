import { ParallaxComponent } from "@/components/ui/parallax-scrolling";
import { DownloadButtons } from "@/components/ui/download-buttons";

// Minimal Pyper marketing landing page.
// Brand values are kept in one place so the domain is easy to change.
const BRAND = {
  name: "Pyper",
  domain: "pyper.work",
  url: "https://pyper.work",
  docs: "https://docs.pyper.work",
  github: "https://github.com/prateekjain98/pyper",
  // Desktop app builds are published to GitHub Releases; "latest" redirects to
  // the newest published release once one exists.
  releases: "https://github.com/prateekjain98/pyper/releases/latest",
};

function MicMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="9" y="2" width="6" height="12" rx="3" fill="#fff" />
      <path
        d="M5 11a7 7 0 0 0 14 0M12 18v3"
        stroke="#fff"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

const features = [
  {
    icon: "⌨️",
    title: "Dictate anywhere",
    body: "Press a hotkey, speak, and your words appear at your cursor in any app.",
  },
  {
    icon: "🔒",
    title: "Private by default",
    body: "Fully offline transcription with local Whisper & NVIDIA Parakeet — your audio never leaves your device.",
  },
  {
    icon: "🤖",
    title: "AI agents",
    body: "Bring your own key for OpenAI, Anthropic, Gemini, Groq, and local models.",
  },
  {
    icon: "🎙️",
    title: "Meeting transcription",
    body: "Capture meetings with speaker diarization — no bot joins your call.",
  },
  {
    icon: "🗂️",
    title: "Notes & search",
    body: "Turn conversations into notes with fast semantic search across everything.",
  },
  {
    icon: "🖥️",
    title: "Cross-platform",
    body: "Native desktop apps for macOS, Windows, and Linux.",
  },
];

export default function Home() {
  return (
    <>
      <header className="site-header">
        <div className="brand">
          <span className="logo">
            <MicMark />
          </span>
          {BRAND.name}
        </div>
        <nav className="nav">
          <a href="#features">Features</a>
          <a href={BRAND.docs}>Docs</a>
          <a href={BRAND.github}>GitHub</a>
        </nav>
      </header>

      <ParallaxComponent title={BRAND.name} />
      <div className="osmo-credits">
        <p className="osmo-credits__p">
          Parallax resource by{" "}
          <a
            target="_blank"
            rel="noreferrer"
            href="https://www.osmo.supply/"
            className="osmo-credits__p-a"
          >
            Osmo
          </a>
        </p>
      </div>

      <main className="container">
        <section className="hero">
          <span className="eyebrow">Privacy-first voice-to-text</span>
          <h1>
            Speak. And your words <span className="grad">appear.</span>
          </h1>
          <p className="subtitle">
            {BRAND.name} turns your voice into text, notes, and actions from your desktop.
            Press a hotkey, speak, and your words land right at your cursor — online for
            speed, or fully offline for privacy.
          </p>
          <div className="cta-row">
            <a className="btn btn-primary" href="#download">
              Download for free
            </a>
            <a className="btn btn-ghost" href={BRAND.github}>
              View on GitHub
            </a>
          </div>
          <div className="platforms">Available for macOS · Windows · Linux</div>
        </section>

        <section id="features" className="features">
          {features.map((f) => (
            <div className="card" key={f.title}>
              <div className="ico">{f.icon}</div>
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </div>
          ))}
        </section>

        <section id="download" className="hero" style={{ paddingTop: 20 }}>
          <h1 style={{ fontSize: "clamp(28px, 4vw, 40px)" }}>
            Get started with {BRAND.name}
          </h1>
          <p className="subtitle">
            Free and open source — download the desktop app for your platform.
          </p>
          <DownloadButtons releasesUrl={BRAND.releases} />
        </section>
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

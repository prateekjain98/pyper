'use client';

import React from 'react';
import Link from 'next/link';
import { ThinkingOrb } from '@/components/ui/thinking-orbs';
import { DownloadCTA } from '@/components/ui/download-cta';

// Pyper nav — adapted from the shadcn "header-2" template (Features/Pricing/About
// + Sign In/Get Started) to the site's real destinations. Home anchors are
// root-relative so they also work from other routes (e.g. /pricing).
const NAV_LINKS = [
  { label: 'Status', href: '/status' },
  { label: 'GitHub', href: 'https://github.com/prateekjain98/pyper' },
];
const PRICING_HREF = '/pricing';

function BrandMark() {
  return (
    <Link className="brand" href="/" aria-label="Pyper home">
      <span className="logo logo--orb">
        <ThinkingOrb state="working" size={20} theme="dark" aria-label="Pyper" />
      </span>
      Pyper
    </Link>
  );
}

// Hamburger that morphs to an arrow/close mark. Reproduces the reference icon's
// stroke-dasharray morph + rotation, driven by CSS off the `menu-icon--open` class.
function MenuToggleIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={`menu-icon${open ? ' menu-icon--open' : ''}`}
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path
        className="menu-icon__morph"
        d="M27 10 13 10C10.8 10 9 8.2 9 6 9 3.5 10.8 2 13 2 15.2 2 17 3.8 17 6L17 26C17 28.2 18.8 30 21 30 23.2 30 25 28.2 25 26 25 23.8 23.2 22 21 22L7 22"
      />
      <path d="M7 16 27 16" />
    </svg>
  );
}

export function Header() {
  const [open, setOpen] = React.useState(false);
  const [scrolled, setScrolled] = React.useState(false);
  const sentinelRef = React.useRef<HTMLDivElement>(null);

  // Shrink/frost the pill once the page scrolls past the top. An
  // IntersectionObserver on a top sentinel is used instead of a window scroll
  // listener so it stays reliable under the page's Lenis smooth-scroll.
  React.useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    // The sentinel is a short strip at the very top; once it is fully scrolled
    // out of view the header switches to its scrolled (frosted) state.
    const io = new IntersectionObserver(
      ([entry]) => setScrolled(!entry.isIntersecting),
      { threshold: 0 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Lock body scroll while the mobile menu is open.
  React.useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  const headerClass = [
    'pill-header',
    scrolled && !open ? 'is-scrolled' : '',
    open ? 'is-open' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <>
      {/* Top sentinel: its visibility drives the scrolled/frosted state. */}
      <div ref={sentinelRef} className="pill-sentinel" aria-hidden="true" />
      <header className={headerClass}>
        <nav className="pill-nav">
        <BrandMark />

        <div className="pill-desktop">
          {NAV_LINKS.map((link) => (
            <a key={link.label} className="pill-link" href={link.href}>
              {link.label}
            </a>
          ))}
          <a className="pill-btn pill-btn--outline" href={PRICING_HREF}>
            Pricing
          </a>
          <DownloadCTA className="pill-btn pill-btn--primary">Download</DownloadCTA>
        </div>

        <button
          type="button"
          className="pill-toggle"
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <MenuToggleIcon open={open} />
        </button>
      </nav>

      <div className={`mobile-menu${open ? ' is-open' : ''}`}>
        <div className="mobile-menu__inner">
          <div className="mobile-menu__links">
            {NAV_LINKS.map((link) => (
              <a
                key={link.label}
                className="pill-link pill-link--block"
                href={link.href}
                onClick={() => setOpen(false)}
              >
                {link.label}
              </a>
            ))}
          </div>
          <div className="mobile-menu__actions">
            <a
              className="pill-btn pill-btn--outline pill-btn--block"
              href={PRICING_HREF}
              onClick={() => setOpen(false)}
            >
              Pricing
            </a>
            <DownloadCTA
              className="pill-btn pill-btn--primary pill-btn--block"
              onClick={() => setOpen(false)}
            >
              Download
            </DownloadCTA>
          </div>
        </div>
      </div>
      </header>
    </>
  );
}

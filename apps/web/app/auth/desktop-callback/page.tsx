import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Header } from '@/components/ui/header';
import { DesktopCallbackStatus } from './DesktopCallbackStatus';

const BRAND = {
  name: 'Pyper',
  domain: 'pyper.work',
};

export const metadata: Metadata = {
  title: 'Pyper — Connection complete',
  description: 'Finishing connecting your account to the Pyper desktop app.',
  robots: { index: false, follow: false },
};

export default function DesktopCallbackPage() {
  return (
    <>
      <Header />

      <main className="container" style={{ padding: '80px 0', minHeight: '50vh' }}>
        <Suspense
          fallback={
            <p style={{ textAlign: 'center', color: 'var(--muted)' }}>Finishing up…</p>
          }
        >
          <DesktopCallbackStatus />
        </Suspense>
      </main>

      <footer className="site-footer container">
        <span>
          © {new Date().getFullYear()} {BRAND.name} · Built by SaaS Labs
        </span>
        <span>{BRAND.domain} · © 2026 SaaS Labs</span>
      </footer>
    </>
  );
}

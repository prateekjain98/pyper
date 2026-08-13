'use client';

import React from 'react';

type Tier = {
  name: string;
  tagline: string;
  // null price = custom ("Contact us"); otherwise dollars/user/month.
  monthly: number | null;
  annual: number | null;
  cta: string;
  href: string;
  featured?: boolean;
  features: string[];
  // Leading feature line rendered muted (e.g. "Everything in Free, plus:").
  featuresLead?: string;
};

// Tiers modeled on wisprflow.ai/pricing, adapted to Pyper's feature set.
const TIERS: Tier[] = [
  {
    name: 'Free',
    tagline: 'For getting started',
    monthly: 0,
    annual: 0,
    cta: 'Download for free',
    href: '/#download',
    features: [
      'Dictate anywhere with a global hotkey',
      'Fully offline transcription (local Whisper & NVIDIA Parakeet)',
      '2,000 words / week',
      'Bring your own AI key — OpenAI, Anthropic, Gemini, Groq, local',
      'Notes & semantic search',
      'macOS, Windows & Linux',
      'Your audio never leaves your device',
    ],
  },
  {
    name: 'Pro',
    tagline: 'For power users',
    monthly: 15,
    annual: 12,
    cta: 'Get started',
    href: '/#download',
    featured: true,
    featuresLead: 'Everything in Free, plus:',
    features: [
      'Unlimited dictation',
      'Meeting transcription with speaker diarization',
      'Advanced AI thinking models & agents',
      'Longer note history & priority processing',
      'Early access to the latest models and features',
      'Priority support',
    ],
  },
  {
    name: 'Enterprise',
    tagline: 'For teams with advanced security & support needs',
    monthly: null,
    annual: null,
    cta: 'Contact sales',
    href: 'mailto:sales@pyper.work',
    featuresLead: 'Everything in Pro, plus:',
    features: [
      'SAML SSO & SCIM provisioning',
      'Centralized billing & user management',
      'Admin controls, audit logs, MDM',
      'SOC 2 Type II, ISO 27001, HIPAA-ready',
      'Advanced usage analytics',
      'Dedicated support & volume discounts',
    ],
  },
];

function CheckIcon() {
  return (
    <svg className="price-check" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M16.5 5.5 8.25 13.75 4 9.5"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PriceCard({ tier, annual }: { tier: Tier; annual: boolean }) {
  const isCustom = tier.monthly === null;
  const price = annual ? tier.annual : tier.monthly;
  const billNote = isCustom
    ? 'Volume pricing'
    : price === 0
      ? 'Free forever'
      : annual
        ? 'per user / month, billed annually'
        : 'per user / month, billed monthly';

  return (
    <div className={`price-card${tier.featured ? ' price-card--featured' : ''}`}>
      {tier.featured && <span className="price-card__badge">Most popular</span>}

      <div>
        <h3 className="price-card__name">{tier.name}</h3>
        <p className="price-card__tagline">{tier.tagline}</p>
      </div>

      <div>
        <div className="price-card__price">
          {isCustom ? (
            <span className="price-card__amount price-card__amount--sm">Custom</span>
          ) : (
            <>
              <span className="price-card__amount">${price}</span>
              <span className="price-card__period">/mo</span>
            </>
          )}
        </div>
        <div className="price-card__billnote">{billNote}</div>
      </div>

      <a
        className={`btn price-card__cta ${tier.featured ? 'btn-primary' : 'btn-ghost'}`}
        href={tier.href}
      >
        {tier.cta}
      </a>

      <ul className="price-card__features">
        {tier.featuresLead && (
          <li className="is-heading">{tier.featuresLead}</li>
        )}
        {tier.features.map((f) => (
          <li key={f}>
            <CheckIcon />
            <span>{f}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Pricing() {
  const [annual, setAnnual] = React.useState(true);

  return (
    <section className="pricing">
      <div className="pricing__billing">
        <div className="pricing__toggle" role="group" aria-label="Billing period">
          <button
            type="button"
            className={!annual ? 'is-active' : ''}
            aria-pressed={!annual}
            onClick={() => setAnnual(false)}
          >
            Monthly
          </button>
          <button
            type="button"
            className={annual ? 'is-active' : ''}
            aria-pressed={annual}
            onClick={() => setAnnual(true)}
          >
            Annual <span className="pricing__save">Save 20%</span>
          </button>
        </div>
      </div>

      <div className="pricing__grid">
        {TIERS.map((tier) => (
          <PriceCard key={tier.name} tier={tier} annual={annual} />
        ))}
      </div>

      <p className="pricing__foot">
        All plans include local, privacy-first transcription. Prices in USD.
      </p>
    </section>
  );
}

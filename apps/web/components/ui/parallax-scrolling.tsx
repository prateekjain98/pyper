'use client';

import React, { useEffect, useRef, type ReactNode } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import { AudioLines } from 'lucide-react';

/**
 * A scroll-driven parallax hero.
 *
 * The four stacked layers translate at different rates as the section scrolls
 * out of view (GSAP ScrollTrigger + Lenis smooth scroll), giving a sense of
 * depth. Layers 1, 2 and 4 are decorative images; layer 3 holds the title.
 *
 * Adapted for Pyper from an Osmo parallax resource: Osmo's cut-out artwork is
 * swapped for dark, blue-toned Unsplash photography that matches the marketing
 * site theme, the Osmo glyph is replaced with a lucide-react icon, and the
 * effect is disabled for visitors who prefer reduced motion.
 */

type ParallaxLayer = { layer: string; yPercent: number };

// How far each layer drifts (as a % of its own height) across the scroll.
// The wide spread between the distant sky (+) and the near figure (-) is what
// makes the parallax obvious: they slide in opposite directions as you scroll.
// The photo layers stay within the vertical bleed set in globals.css so their
// edges never show; the figure is a transparent SVG so it can move freely.
const LAYERS: ParallaxLayer[] = [
  { layer: '1', yPercent: 24 }, // sky — furthest, drifts down the most
  { layer: '2', yPercent: 14 }, // ridgeline
  { layer: '3', yPercent: 8 }, // title
  { layer: '4', yPercent: 3 }, // mist
  { layer: '5', yPercent: -9 }, // figure — nearest, rises against the vista
];

const IMAGES = {
  // Deep-blue night sky over a mountain — matches the site's #0b0d12 / blue palette.
  sky: 'https://images.unsplash.com/photo-1519681393784-d120267933ba?auto=format&fit=crop&w=1600&q=80',
  // Mountain range / lake for the middle ridgeline.
  ridge: 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?auto=format&fit=crop&w=1600&q=80',
  // Foggy dark forest for the nearest foreground layer.
  foreground: 'https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?auto=format&fit=crop&w=1600&q=80',
};

export type ParallaxHeroProps = {
  /** Small label above the title. */
  eyebrow?: string;
  /** The large parallax headline (the brand name by default). */
  title?: string;
  /** Short headline shown in the content panel below the visual. */
  tagline?: ReactNode;
  /** Supporting copy shown under the tagline. */
  subtitle?: ReactNode;
  /** Small print shown beneath the call-to-action row. */
  footnote?: ReactNode;
  /** Call-to-action buttons rendered in the content panel. */
  children?: ReactNode;
};

export function ParallaxHero({
  eyebrow = 'Privacy-first voice-to-text',
  title = 'Pyper',
  tagline,
  subtitle,
  footnote,
  children,
}: ParallaxHeroProps) {
  const parallaxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = parallaxRef.current;
    if (!root) return;

    // Respect users who ask for less motion: skip the parallax + smooth scroll
    // entirely and leave a static, fully legible layered hero.
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced) return;

    gsap.registerPlugin(ScrollTrigger);

    const triggerElement = root.querySelector('[data-parallax-layers]');
    let tl: gsap.core.Timeline | undefined;

    if (triggerElement) {
      tl = gsap.timeline({
        scrollTrigger: {
          trigger: triggerElement,
          start: '0% 0%',
          end: '100% 0%',
          scrub: 0,
        },
      });

      LAYERS.forEach((layerObj, idx) => {
        tl!.to(
          triggerElement.querySelectorAll(`[data-parallax-layer="${layerObj.layer}"]`),
          { yPercent: layerObj.yPercent, ease: 'none' },
          idx === 0 ? undefined : '<',
        );
      });
    }

    // Lenis drives smooth scrolling; feed it from GSAP's ticker and keep
    // ScrollTrigger in sync.
    const lenis = new Lenis();
    lenis.on('scroll', ScrollTrigger.update);
    const update = (time: number) => lenis.raf(time * 1000);
    gsap.ticker.add(update);
    gsap.ticker.lagSmoothing(0);

    return () => {
      // Scoped teardown so we never leak the timeline, the ScrollTrigger,
      // the ticker callback, or the Lenis instance across re-mounts.
      tl?.scrollTrigger?.kill();
      tl?.kill();
      gsap.ticker.remove(update);
      lenis.destroy();
    };
  }, []);

  return (
    <div className="parallax" ref={parallaxRef}>
      <section className="parallax__header">
        <div className="parallax__visuals">
          <div className="parallax__black-line-overflow" />
          <div data-parallax-layers className="parallax__layers">
            <img
              src={IMAGES.sky}
              loading="eager"
              width={1600}
              data-parallax-layer="1"
              alt=""
              className="parallax__layer-img parallax__layer-img--sky"
            />
            <img
              src={IMAGES.ridge}
              loading="eager"
              width={1600}
              data-parallax-layer="2"
              alt=""
              className="parallax__layer-img parallax__layer-img--ridge"
            />
            <div data-parallax-layer="3" className="parallax__layer-title">
              <span className="parallax__eyebrow">{eyebrow}</span>
              <h1 className="parallax__title">{title}</h1>
            </div>
            <img
              src={IMAGES.foreground}
              loading="eager"
              width={1600}
              data-parallax-layer="4"
              alt=""
              className="parallax__layer-img parallax__layer-img--foreground"
            />
            {/* Nearest layer: a lone figure looking out over the vista. A
                transparent SVG silhouette so it composites cleanly over the
                photos and can carry the strongest parallax. */}
            <div data-parallax-layer="5" className="parallax__layer-person" aria-hidden="true">
              <svg viewBox="0 0 240 500" xmlns="http://www.w3.org/2000/svg" className="parallax__person-svg">
                <g
                  fill="currentColor"
                  stroke="currentColor"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                >
                  {/* head */}
                  <circle cx="120" cy="50" r="29" />
                  {/* torso: broad shoulders tapering to the waist */}
                  <path d="M90 102 Q120 88 150 102 L143 236 Q143 250 129 250 L111 250 Q97 250 97 236 Z" strokeWidth="13" />
                  {/* arms resting at the sides */}
                  <rect x="73" y="112" width="16" height="138" rx="8" />
                  <rect x="151" y="112" width="16" height="138" rx="8" />
                  {/* legs, slightly apart in a standing stance */}
                  <rect x="100" y="244" width="18" height="228" rx="9" transform="rotate(3 109 358)" />
                  <rect x="122" y="244" width="18" height="228" rx="9" transform="rotate(-3 131 358)" />
                </g>
              </svg>
            </div>
          </div>
          <div className="parallax__fade" />
        </div>
      </section>

      <section className="parallax__content">
        <span className="parallax__content-icon" aria-hidden="true">
          <AudioLines strokeWidth={1.5} />
        </span>
        {tagline ? <h2 className="parallax__content-title">{tagline}</h2> : null}
        {subtitle ? <p className="parallax__content-text">{subtitle}</p> : null}
        {children ? <div className="cta-row">{children}</div> : null}
        {footnote ? <div className="platforms">{footnote}</div> : null}
      </section>
    </div>
  );
}

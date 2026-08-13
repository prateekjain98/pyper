---
id: 20260813-100100-dictation-overlay-parity
title: Dictation overlay / recording pill — match Wispr Flow
status: todo
priority: P1
owner:
branch:
created: 2026-08-13T10:01:00Z
---

## Prompt

Make Pyper's dictation overlay — the always-on-top recording indicator in `apps/desktop/src/App.jsx`
and its overlay window — visually and behaviorally indistinguishable from Wispr Flow's dictation pill.

Steps:
1. Paste Wispr Flow's dictation-pill states into
   `tasks/assets/20260813-100100-dictation-overlay-parity/` — idle, listening (with the audio-level
   animation), processing, and result/paste states.
2. Diff against `App.jsx`'s recording states: size, shape, position, colors, the mic/waveform
   animation, timing/easing, and the transitions between states.
3. Implement parity. Preserve existing behavior (draggable, always-on-top).

Verify: `/verify`, then `npm run desktop` and trigger dictation to compare each state side-by-side with
the reference.

## Reference screenshots

<!-- ![listening](assets/20260813-100100-dictation-overlay-parity/wispr-listening.png) -->

## Acceptance / verification

Each dictation state (idle / listening / processing / result) matches the Wispr Flow reference — shape,
motion, and timing included. `/verify` green.

## Context / out of scope

In scope: `App.jsx` + the dictation overlay window styling/animation. Out of scope: the transcription
engine, settings, onboarding.

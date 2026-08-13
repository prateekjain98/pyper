---
id: 20260813-000000-onboarding-parity-audit
title: Audit onboarding vs Wispr Flow, step by step
status: todo
priority: P1
owner:
branch:
created: 2026-08-13T00:00:00Z
---

## Prompt

Open Pyper's onboarding — `apps/desktop/src/components/OnboardingFlow.tsx` (an 8-step first-time
setup wizard) and the `PermissionsSection` it uses — and compare it **step by step** against Wispr
Flow's onboarding. For EACH step record: does Pyper have the same step, in the same order, with the
same copy, controls, permission prompts, and visual layout? Produce a checklist of every gap (missing
step, wrong order, different copy/animation/permission dialog). For each Wispr Flow step, drop a
reference screenshot in `tasks/assets/20260813-000000-onboarding-parity-audit/` and embed it below.

Do **not** change product code in this task — this is the audit that spawns one focused fix task per
gap (add each with `/task`, carrying its own before/after screenshots).

## Reference screenshots

<!-- Paste/capture each Wispr Flow onboarding step and embed it, e.g.:
![Wispr Flow — welcome](assets/20260813-000000-onboarding-parity-audit/wispr-01-welcome.png) -->

## Acceptance / verification

A gap checklist covering every Wispr Flow onboarding step, each with (a) a Wispr Flow reference
screenshot and (b) a one-line "Pyper diff". Each gap becomes a follow-up `todo` task on the board.

## Context / out of scope

In scope: `OnboardingFlow.tsx`, `PermissionsSection`, related onboarding components/copy.
Out of scope: implementing the fixes (each is its own task).

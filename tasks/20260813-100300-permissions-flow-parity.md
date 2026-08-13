---
id: 20260813-100300-permissions-flow-parity
title: Permissions flow — match Wispr Flow
status: todo
priority: P2
owner:
branch:
created: 2026-08-13T10:03:00Z
---

## Prompt

Match Wispr Flow's permission-request UX (microphone, accessibility, screen recording). Components:
`apps/desktop/src/components/ui/PermissionsSection.tsx` and `ui/MicPermissionWarning.tsx` (the latter
is also used in onboarding).

Steps:
1. Paste Wispr Flow's permission screens/prompts into
   `tasks/assets/20260813-100300-permissions-flow-parity/` — each permission, granted vs not-granted.
2. Diff copy, button labels/placement, the "open system settings" affordance, and the granted/denied
   states.
3. Implement parity across the macOS / Windows / Linux variants the components already branch on.

Verify: `/verify`, then `npm run desktop` and walk the permissions UI in each state.

## Reference screenshots

<!-- ![mic-permission](assets/20260813-100300-permissions-flow-parity/wispr-mic-perm.png) -->

## Acceptance / verification

Permission cards/warnings match the Wispr Flow reference in copy, states, and controls. `/verify` green.

## Context / out of scope

In scope: `PermissionsSection.tsx`, `MicPermissionWarning.tsx` visuals / copy / states. Out of scope:
the underlying OS permission APIs and IPC.

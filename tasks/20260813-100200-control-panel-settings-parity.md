---
id: 20260813-100200-control-panel-settings-parity
title: Control panel + settings — match Wispr Flow
status: todo
priority: P2
owner:
branch:
created: 2026-08-13T10:02:00Z
---

## Prompt

Bring Pyper's control panel and settings UX to parity with Wispr Flow's dashboard/settings.
Components: `apps/desktop/src/components/ControlPanel.tsx`, `ControlPanelSidebar.tsx`,
`SettingsPage.tsx`.

Steps:
1. Paste Wispr Flow's settings/dashboard screenshots (each section + the nav) into
   `tasks/assets/20260813-100200-control-panel-settings-parity/`.
2. Diff nav structure, section order, labels/copy, control types, spacing, and typography.
3. Implement parity section by section, reusing the existing shadcn/ui primitives.

Verify: `/verify`, then `npm run desktop` → open the control panel and compare each section side-by-side.

## Reference screenshots

<!-- ![settings-nav](assets/20260813-100200-control-panel-settings-parity/wispr-settings.png) -->

## Acceptance / verification

The control panel's navigation and each settings section match the Wispr Flow reference. `/verify` green.

## Context / out of scope

In scope: control-panel + settings layout / nav / copy. Out of scope: onboarding, the dictation overlay,
and settings-persistence logic (this is visual/UX parity only).

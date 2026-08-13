---
id: 20260813-000000-onboarding-parity-audit
title: Audit onboarding vs Wispr Flow, step by step
status: doing
priority: P1
owner: prateek (agent)
branch: claude/hackathon-multi-agent-config-dd1f74
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

## Audit — Pyper's current onboarding (Phase 1: our state)

Source: `apps/desktop/src/components/OnboardingFlow.tsx` (+ `onboarding/*`, `ui/PermissionsSection.tsx`).
The flow is **dynamic** — steps appear/disappear by account state. The `meeting` step is currently
disabled (`showMeetingStep = false`). Two live variants today:

- **Signed-in (cloud):** welcome → usecase → setup (+ permissions folded in) → activation → voiceAgent → finish
- **Continue without account:** welcome → usecase → setup (transcription) → permissions → activation → finish

| # | Step (id) | Shown when | What it does today | Advance gate |
|---|-----------|-----------|--------------------|--------------|
| 0 | welcome | always | `AuthenticationStep` — sign in / create account / "continue without account"; `EmailVerificationStep` after signup | signed in **or** chose to skip |
| 1 | usecase | always | `UseCaseStep` — pick use-cases + optional note (skippable) | none (optional) |
| 2 | setup | always | Signed-in: language + `PermissionsSection`. Not signed-in: `TranscriptionModelPicker` (local/cloud mode + model) + language | signed-in: mic granted · else: local model downloaded **or** provider API key set |
| 3 | permissions | only if NOT signed-in | `PermissionsSection` (mic + accessibility / system-audio) | mic granted |
| 4 | activation | always | Dictation hotkey (`HotkeyInput`) + tap/hold `ActivationModeSelector` + test textarea; auto-registers the default hotkey; reveals the dictation panel | hotkey set |
| 5 | voiceAgent | signed-in + agent allowed | Voice-agent hotkey + example chips + test (skippable, optional) | none |
| 6 | meeting | disabled today | `MeetingSetupStep` — meeting hotkey | none |
| 7 | finish | always | `FinishStep` — its own finish actions; runs a cloud health check → connectivity-fallback dialog | n/a |

Chrome: `TitleBar` + `StepProgress` (centered in the title bar on macOS; a separate progress bar
elsewhere); footer with Back / Skip (for `usecase`, `voiceAgent`, `meeting`) / Next; a blurred `Card`
(max-w-sm on welcome, max-w-3xl after); loads the "Noto Sans" web font.

## On-screen verification (rendered from the renderer at `localhost:5199/?panel=true`)

Header step labels the user sees: **About you · Setup · Permissions · Dictation · Finish**
(internal ids: `usecase · setup · permissions · activation · finish`). Actual on-screen content:

- **Welcome (auth):** "Welcome to Pyper — Dictate anywhere using your voice". Continue with Apple /
  Google / Microsoft; email + "Continue with email"; "Sign in with SSO"; "Continue without account";
  Terms / Privacy footer.
- **About you (usecase):** "Why are you here?" checklist — Writing faster · Meeting notes & summaries ·
  Medical, clinical & therapy transcription · Translating languages · Talking to my AI · Uploading
  audio files. Optional "Anything else…" note. Back / Skip / Next.
- **Setup (transcription):** "Transcription Setup — Choose your mode and provider". Cloud/Local toggle;
  provider chips OpenAI/Groq/xAI/Mistral/Corti/Tinfoil/Custom; API Key ("Get key"); model list
  (GPT-4o Mini Transcribe [Active] · GPT-4o Transcribe · Whisper); Preferred Language (Auto-detect).
- **Permissions:** "Microphone access required" — Microphone card ("Turns your speech into text.
  Nothing is recorded until you press your hotkey.") + Grant Access.
- **Dictation (activation):** "Dictation Setup — Configure how you trigger dictation". HOTKEY
  (Globe/Fn, "Click to change"); MODE Tap / Hold ("Press to start/stop"); TEST textarea.
- **Finish:** "You're all set" — Open Settings / Skip for now.

These are the **"before"** (Pyper) states. The Wispr Flow **"after"** references still need pasting.

## Phase 2 — Wispr Flow diff (needs reference screenshots)

For each step above, drop the matching Wispr Flow screen into
`tasks/assets/20260813-000000-onboarding-parity-audit/` and fill a one-line "Pyper diff" (missing
step / different order / different copy / different control / different animation). Each diff then
becomes a focused fix task. **Blocked on the Wispr Flow onboarding screenshots** — once they're in, I
finish the diff and spawn the per-step fix tasks.

## Progress

- ✅ Phase 1 — our current onboarding enumerated (above).
- ⏳ Phase 2 — Wispr Flow diff + per-step fix tasks: waiting on reference screenshots.

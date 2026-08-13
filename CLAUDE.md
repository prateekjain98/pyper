# Pyper — Multi-Agent Hackathon Playbook

<!--
  Maintainers: this ROOT playbook covers the parallel-agent workflow + project orientation only.
  Keep it tight (best practice: aim under ~200 lines). Architecture / how-it-works detail lives in
  apps/desktop/CLAUDE.md; deep research in docs/. Review edits to this file like code.
-->

**Read this first.** You are one of several Claude agents building this repo *in parallel*
during a hackathon. Iterate fast — but a broken `main` blocks every other agent, so the
rules below exist to keep parallel work quick *and* collision-free.

## What we're building

**Pyper is an open-source alternative to Wispr Flow** (the commercial AI voice-dictation app):
privacy-first, voice-to-text that types into *any* app via a global hotkey, with local
(whisper.cpp / NVIDIA Parakeet) or cloud (OpenAI / Anthropic / Gemini …) processing. It's a
monorepo (npm workspaces + turbo): `apps/desktop` (the Electron app — the product) and
`apps/web` (marketing site).

**Current mission — Wispr Flow parity.** Right now the goal is to match Wispr Flow's UX *exactly*,
especially **every step of onboarding**. Build UI from a Wispr Flow reference screenshot and treat
"indistinguishable from Wispr Flow" as the acceptance bar. Capture parity gaps as tasks on the board (§7).

We build on two open-source (MIT) projects — know which is which:

- **OpenWhispr** — <https://github.com/OpenWhispr/openwhispr> — the codebase **Pyper is forked
  from** (dictation-first; Electron + React). This is our lineage: when unsure why something
  exists, it probably came from here.
- **anarlog** (fastrepl, formerly Hyprnote) — <https://github.com/fastrepl/anarlog> — a
  local-first **meeting-notetaker** (Granola-style; Tauri/Rust). **A feature reference, NOT our
  code** — we port its notes-as-workspace ideas (structured templates, task extraction, outbound
  integrations, import). Deep dive: [docs/anarlog-vs-openwhispr.md](docs/anarlog-vs-openwhispr.md).

> **How the code actually works** (architecture, helpers, IPC, build internals) →
> [apps/desktop/CLAUDE.md](apps/desktop/CLAUDE.md). The rest of *this* file is **how we work
> together** as parallel agents.

---

## Commands

Run from the repo root on **Node 24** (pinned in `.nvmrc`); `.npmrc` handles peer-deps, so installs need no flags.

```bash
nvm exec 24 npm install                    # install / refresh deps — read §5 before touching the lockfile
npm run desktop                            # run the desktop app (Electron) — exercise dictation/UI changes here
npm run web                                # run the marketing site (Next.js)

# --- the fast push gate (run the /verify skill, which picks the right subset) ---
npm run typecheck                          # tsc: apps/desktop (src) + apps/web
npm run lint                               # eslint (desktop) + next lint (web)
npm test -w @pyper/desktop                  # desktop unit tests (node --test) — for apps/desktop changes
npm run build:renderer -w @pyper/desktop    # fast Vite renderer build — for desktop UI changes
npm run build -w @pyper/web                 # next build — for apps/web changes

npm run build                              # ⚠ FULL packaging (electron-builder + model downloads) — slow; NOT a per-change gate
```

The **`/verify`** skill runs the right subset for you. Heads-up: the first `npm run desktop` (or
`npm run build`) also downloads local models (whisper / parakeet / qdrant) and can be slow — details
in [apps/desktop/CLAUDE.md](apps/desktop/CLAUDE.md).

## 1. `main` is the source of truth — stay glued to it

`main` always holds the latest integrated code. Work on your own branch and pull `main` *constantly*.

- **Before you start:** `git fetch origin && git merge origin/main`
- **While you work:** re-sync every ~20–30 min, and *always* right before editing a shared/hot file (see §4).
- **Before you integrate:** merge the latest `main`, resolve conflicts, and confirm it builds (§3).

Frequent small syncs turn giant end-of-task merge conflicts into three-line ones.

## 2. Branch to build, push to `main` to deliver

- **Develop** on your own `claude/<task-slug>` branch — don't build directly on `main`.
- Small, frequent commits beat one giant diff. Keep the change scoped to *your* task only.
- **Deliver by pushing to `main`, early and often** — but *only* work that is verified and working (§3).
  As soon as a slice passes the push gate, get it onto `main` so other agents build on it. Don't hoard
  work on a long-lived branch; it drifts and conflicts.

  ```bash
  # ONLY once your work is verified and actually working (§3):
  git fetch origin && git merge origin/main   # 1. pull latest main into your branch; resolve conflicts
  npm run build && npm run typecheck && npm run lint   # 2. re-run the §3 gate AFTER the merge
  git push origin HEAD:main                    # 3. fast-forward main to your verified work
  ```
  If step 3 is **rejected** (another agent pushed first), start over at step 1 — re-sync, re-verify,
  push again. **Never** `git push --force` to `main` and never rewrite its history.

## 3. The push gate — verified & working, or it does not touch `main`

**Hard rule: never push to `main` unless you have verified your change and confirmed it works.**
CI in `.github/workflows/` only **builds native helpers** (on narrow source-path changes) and
**cuts releases** (on `v*` tags) — nothing runs `build` / `typecheck` / `lint` / tests on a normal
push to `main`. So for everyday changes **you are the only check** between a bad push and a broken
`main` that stalls every other agent.

Before every push to `main`, *all* of this must hold:

- The **`/verify`** skill passes — `npm run typecheck` + `npm run lint`, plus `npm test -w @pyper/desktop`
  and `npm run build:renderer -w @pyper/desktop` for desktop changes (see [Commands](#commands)).
  **Do not** gate on root `npm run build` — it runs electron-builder packaging and is far too heavy.
- You **actually exercised what you changed** — ran the app (`npm run desktop`) or the feature, not
  just the compiler.

Can't verify it? It stays on your branch. If something half-done must land, keep it inert (behind a
flag or unwired) so it can't break anyone.

## 4. Avoid collisions with other agents

- **Localize edits.** Prefer new files / new functions over rewriting files many agents touch.
- **Hot files** — sync `main` *immediately* before touching, then push fast to shrink the conflict window:
  `package.json`, `package-lock.json`, `apps/desktop/src/main.js`, `ipcHandlers.js`, `preload.js`,
  shared UI, and any i18n `translation.json`.
- If you discover another agent already owns an area, rebase onto their merged work instead of duplicating it.

## 5. Dependencies & the lockfile (the #1 cross-agent conflict)

- **Node 24 for every install** (see [Commands](#commands)) — a different major version rewrites
  `package-lock.json` incompatibly and breaks everyone's `npm ci`.
- `.npmrc` already sets `legacy-peer-deps=true` — a plain `npm install` resolves correctly; **don't** add the flag by hand or override it.
- **Don't regenerate `package-lock.json` unless your task actually changes dependencies.** If it does:
  sync `main` → install on Node 24 → commit lockfile + `package.json` together → push promptly.

## 6. Resolving conflicts

- Keep **only** your task's intended change; take `main`'s version for anything outside your scope.
- If a conflicting hunk looks like another agent's in-flight work, **keep both and reconcile** — don't silently drop it. When unsure, ask.

## 7. Shared task board (cross-team hand-offs)

Coordinate work on the board in [`tasks/`](tasks/README.md) — one short file per task carrying a
ready-to-run **prompt** and any **reference screenshots** (`tasks/assets/`). Any teammate's agent can
add a task or take one. Run **`/task`** to view / add / claim / finish; status lives in each task's
frontmatter (`todo` → `doing` → `done`). **Looking for work? Run `/task` and claim a `todo`.**

---

**TL;DR:** branch → `merge origin/main` often → keep edits small and local → **verify it actually works** → push to `main` → repeat. A push to `main` that isn't verified-and-working is the one forbidden move.

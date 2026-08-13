# Pyper — Multi-Agent Hackathon Playbook

**Read this first.** You are one of several Claude agents working this repo *in parallel*
during a hackathon. Iterate fast — but a broken `main` blocks every other agent, so the
few rules below exist to keep parallel work quick *and* collision-free.

> Architecture / how the code works → [apps/desktop/CLAUDE.md](apps/desktop/CLAUDE.md).
> This file is only about **how we work together**.

Monorepo (npm workspaces + turbo): `apps/desktop` (Electron app) and `apps/web` (marketing site).

---

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
  npm run build && npm run typecheck          # 2. re-verify AFTER the merge
  git push origin HEAD:main                    # 3. fast-forward main to your verified work
  ```
  If step 3 is **rejected** (another agent pushed first), start over at step 1 — re-sync, re-verify,
  push again. **Never** `git push --force` to `main` and never rewrite its history.

## 3. The push gate — verified & working, or it does not touch `main`

**Hard rule: never push to `main` unless you have verified your change and confirmed it works.**
There is **no CI** here (no `.github/workflows`) — nothing catches a bad push but you, and a broken
`main` stalls every other agent. Pushing unverified work is the one thing that breaks the whole fleet.

"Verified" means all of these pass, every time, before you push:

```bash
npm run build       # turbo run build across both workspaces — must pass
npm run typecheck    # turbo run typecheck — must pass
npm run lint         # run it too
```

…**and** you actually exercised what you changed — ran the app or the feature, not just the compiler.
Can't verify it? It stays on your branch. If something half-done must land, keep it inert (behind a
flag or unwired) so it can't break anyone.

## 4. Avoid collisions with other agents

- **Localize edits.** Prefer new files / new functions over rewriting files many agents touch.
- **Hot files** — sync `main` *immediately* before touching, then push fast to shrink the conflict window:
  `package.json`, `package-lock.json`, `apps/desktop/src/main.js`, `ipcHandlers.js`, `preload.js`,
  shared UI, and any i18n `translation.json`.
- If you discover another agent already owns an area, rebase onto their merged work instead of duplicating it.

## 5. Dependencies & the lockfile (the #1 cross-agent conflict)

- Use **Node 24** for any install: `nvm exec 24 npm install`. A different major version rewrites
  `package-lock.json` incompatibly and breaks everyone's `npm ci`.
- `.npmrc` already sets `legacy-peer-deps=true` — a plain `npm install` resolves correctly; **don't** add the flag by hand or override it.
- **Don't regenerate `package-lock.json` unless your task actually changes dependencies.** If it does:
  sync `main` → install on Node 24 → commit lockfile + `package.json` together → push promptly.

## 6. Resolving conflicts

- Keep **only** your task's intended change; take `main`'s version for anything outside your scope.
- If a conflicting hunk looks like another agent's in-flight work, **keep both and reconcile** — don't silently drop it. When unsure, ask.

---

**TL;DR:** branch → `merge origin/main` often → keep edits small and local → **verify it actually works** → push to `main` → repeat. A push to `main` that isn't verified-and-working is the one forbidden move.

---
name: sync-main
description: Sync with the latest main and deliver verified work back to main. Use to "pull main", "sync", "integrate", or "push my work". Encodes Pyper's parallel-agent git flow.
---

# Sync & deliver to `main`

`main` is the source of truth. Pull it constantly; push only verified work.

## Pull latest `main` into your branch (do this often)

```bash
git fetch origin
git merge origin/main    # keep only YOUR task's changes; take main's version for anything out of scope
```

Re-sync before editing a hot file (`package.json`, `package-lock.json`, `apps/desktop/src/main.js`,
`ipcHandlers.js`, `preload.js`, shared UI, i18n `translation.json`) and every ~20–30 min on long tasks.

## Deliver: push verified work to `main`

Only after the `verify` gate passes **and** you've exercised the change:

```bash
git add -A && git commit -m "<scoped message>"
git fetch origin && git merge origin/main   # re-sync latest main
# re-run the `verify` gate here — a merge can break a green tree
git push origin HEAD:main                    # fast-forward main to your verified work
```

If the push is **rejected** (another agent pushed first): re-run from `git fetch` above, re-verify,
push again. **Never** `git push --force` to `main` and never rewrite its history.

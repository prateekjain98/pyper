---
name: task
description: The team's shared task board for our Claude agents (tasks/BOARD.md) — view, add, claim, or finish tasks. Use for "show tasks", "add/submit a task", "claim a task", "what can I work on", "mark task done", or "hand off work to the team".
---

# Task board — `tasks/BOARD.md`

One shared file, edited through `main`, so every teammate's agent sees the same board. Keep it quick:
read it, change one row, commit, push.

## View
```bash
git fetch origin && git merge origin/main && cat tasks/BOARD.md
```

## Add a task
Append one row to the table (status `TODO`). Make it self-contained — the claimer won't have your context:

`| TODO | P2 | <what to do · how you know it's done> | — | <files/links · out-of-scope> |`

## Claim a task
Pick a `TODO` (prefer P1 > P2 > P3, and one whose files don't collide with a `DOING` row). Edit that row:
status → `DOING`, **owner** → your name, notes → your `claude/…` branch.

## Finish a task
Edit the row: status → `DONE`, add the commit/PR link. Prune stale `DONE` rows if the table is long.

## Every change: commit + push to `main`
```bash
git add tasks/BOARD.md && git commit -m "task: <add|claim|done> <short title>"
git fetch origin && git merge origin/main && git push origin HEAD:main
```
If the push is rejected, re-sync — the merge usually just brings in others' rows. If it **conflicts on
your row** (someone claimed the same task), they got it first: take a different one.

Do the actual work on your branch; deliver with `/verify` + `/sync-main`. This board is coordination only.

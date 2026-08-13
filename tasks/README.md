# Task board

The team's shared queue for our Claude agents. **One short file per task** in this folder, each
carrying a ready-to-run **prompt** and any **reference screenshots** (`assets/`). It rides on the
push-to-`main` flow every agent already uses — no server, database, or auth.

**Mission right now: match Wispr Flow exactly — especially every step of onboarding.** Write each task
against a Wispr Flow reference screenshot, with acceptance = "indistinguishable from Wispr Flow."

## Use it via the `/task` skill

- `/task` — view the board, add a task, claim one, or mark it done.
- Status lives in each task's frontmatter: `todo` → `doing` → `done`.
- New task = copy [`TEMPLATE.md`](TEMPLATE.md); screenshots go in `assets/<id>/`.

## Or just edit files

It's plain Markdown + images. Drop a new `<id>.md` here, add screenshots under `assets/<id>/`, commit,
and push — agents pick it up on their next sync.

Requirement: everyone works on the same `main` (collaborators, not forks).

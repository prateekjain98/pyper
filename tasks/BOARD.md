# 🗂️ Task board

The team's shared to-do for our Claude agents. **It's one file — edit it, commit, push to `main`,** and
every teammate's agent sees it on their next sync. Run **`/task`** for the guided flow.

- **Add** work → append a row with status `TODO` (write it self-contained — the claimer lacks your context).
- **Claim** → set the row's status to `DOING`, put your name + `claude/…` branch.
- **Finish** → set status `DONE`, add the commit/PR. Prune old `DONE` rows when the table gets long.

Priorities: **P1** (do next) · **P2** (normal) · **P3** (whenever). Do the actual work on your branch and
deliver with `/verify` + `/sync-main` — this board is coordination only.

| status | pri | task — what · done-when | owner | branch / notes |
|--------|-----|-------------------------|-------|----------------|
| TODO | P2 | _Example: exclude soft-deleted rows from the notes list · list no longer shows deleted notes_ | — | _apps/desktop/convex/notes.ts · replace this row_ |

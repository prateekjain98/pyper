---
name: task-submit
description: Submit a task to the shared cross-team task board so any teammate's Claude agent can pick it up. Use for "add a task", "submit a task", "put this on the board", "hand off work to the team".
---

# Submit a task to the shared board

The board lives under `tasks/` (see [tasks/README.md](../../../tasks/README.md)) and is delivered
through `main`, so every agent that pulls `main` sees it. Status = folder: `open/` → `claimed/` → `done/`.

## Steps

1. Sync first: `git fetch origin && git merge origin/main`.
2. Make a short slug and a unique id:
   ```bash
   slug="fix-notes-sync"                        # 2–4 words, kebab-case
   id="$(date +%Y%m%d-%H%M%S)-$RANDOM-$slug"
   ```
3. Create `tasks/open/$id.md` from the template (fill EVERY section — the claimer has none of your context):
   ```markdown
   ---
   id: <id>
   title: <one-line title>
   status: open
   priority: med            # low | med | high
   submitted_by: <your name/agent>
   created: <run: date -u +%Y-%m-%dT%H:%M:%SZ>
   claimed_by:
   claimed_at:
   branch:
   ---

   ## What
   <clear, self-contained description>

   ## Acceptance / verification
   <how to know it's done: the check to run (/verify), expected behavior>

   ## Context
   <files/interfaces involved, links, constraints, what is OUT of scope>
   ```
4. Commit just that file and push to `main` (a new file never conflicts):
   ```bash
   git add "tasks/open/$id.md"
   git commit -m "task: submit $id"
   git fetch origin && git merge origin/main
   git push origin HEAD:main
   ```

Good tasks are delegation briefs: self-contained, name the files, state what's out of scope, end
with a verification step. That is what lets another agent pick it up cleanly.

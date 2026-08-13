---
name: task-claim
description: Claim an open task from the shared cross-team board and mark it in-progress. Use for "claim a task", "pick up work", "take a task", "what can I work on next".
---

# Claim a task from the shared board

## Steps

1. Sync: `git fetch origin && git merge origin/main`.
2. See what's open and read the candidates:
   ```bash
   ls tasks/open/
   cat tasks/open/<id>.md
   ```
   Prefer higher `priority` and older `created`. Avoid tasks whose files/scope collide with work
   already in `tasks/claimed/` (check it first) — parallel agents should touch disjoint surfaces.
3. Claim it — move `open/` → `claimed/` and stamp your ownership:
   ```bash
   id="<the-task-id>"
   git mv "tasks/open/$id.md" "tasks/claimed/$id.md"
   # edit tasks/claimed/$id.md frontmatter:
   #   status: claimed
   #   claimed_by: <you>
   #   claimed_at: <date -u +%Y-%m-%dT%H:%M:%SZ>
   #   branch: <your claude/... branch>
   git add "tasks/claimed/$id.md"
   git commit -m "task: claim $id"
   git fetch origin && git merge origin/main
   git push origin HEAD:main
   ```
4. **Lost the race?** If the push is rejected and the merge conflicts on this task file, someone
   claimed it first. If your branch has no other unpushed work, discard the lost claim with
   `git merge --abort` then `git reset --hard origin/main`, re-read `tasks/open/`, and claim a
   *different* task. Never fight over an already-claimed task.

Then do the work on your own branch. Deliver with `/verify` + `/sync-main`, and run `/task-done`
when finished.

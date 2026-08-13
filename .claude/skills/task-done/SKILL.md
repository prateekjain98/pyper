---
name: task-done
description: Mark a claimed task complete on the shared cross-team board. Use for "finish a task", "mark done", "close out my task".
---

# Complete a task

1. Make sure the work is actually delivered — merged to `main` via `/sync-main`, with `/verify` green.
2. Move the task `claimed/` → `done/` and record the outcome:
   ```bash
   id="<the-task-id>"
   git fetch origin && git merge origin/main
   git mv "tasks/claimed/$id.md" "tasks/done/$id.md"
   # append to the file:
   #   ## Outcome
   #   what shipped + commit/PR link + how it was verified
   git add "tasks/done/$id.md"
   git commit -m "task: done $id"
   git fetch origin && git merge origin/main
   git push origin HEAD:main
   ```

If you can't finish it, don't leave it stranded in `claimed/`: either hand it back (move it to
`tasks/open/`, clear `claimed_by`/`branch`, note progress) or update the task with where you got to.

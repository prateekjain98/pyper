---
name: task-board
description: Show the shared cross-team task board — what's open, claimed, and done. Use for "show the board", "what tasks are there", "task status", or when looking for work to pick up.
---

# Show the task board

```bash
git fetch origin && git merge origin/main    # always show the latest

for dir in open claimed done; do
  echo "== ${dir} =="
  find "tasks/$dir" -maxdepth 1 -name '*.md' 2>/dev/null | sort | while read -r f; do
    grep -HE '^(title|priority|submitted_by|claimed_by|branch):' "$f"
    echo "  ($f)"
  done
done
```

`find` (not a shell glob) keeps this working under both bash and zsh, and prints nothing for an empty
section. Summarize for the user: open tasks (title + priority), who's working on what (claimed +
branch), and how many are done. To start something use `/task-claim`; to hand off work, `/task-submit`.

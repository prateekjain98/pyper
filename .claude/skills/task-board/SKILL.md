---
name: task-board
description: Show the shared cross-team task board — what's open, claimed, and done. Use for "show the board", "what tasks are there", "task status", or when looking for work to pick up.
---

# Show the task board

```bash
git fetch origin && git merge origin/main    # always show the latest

echo "== OPEN (up for grabs) =="
for f in tasks/open/*.md; do [ -e "$f" ] && grep -HE '^(title|priority|submitted_by):' "$f" && echo "  ($f)"; done

echo "== CLAIMED (in progress) =="
for f in tasks/claimed/*.md; do [ -e "$f" ] && grep -HE '^(title|claimed_by|branch):' "$f" && echo "  ($f)"; done

echo "== DONE =="
ls tasks/done/*.md 2>/dev/null | wc -l
```

Summarize for the user: open tasks (title + priority), who's working on what (claimed + branch), and
how many are done. If they want to start something, use `/task-claim`; to hand off work, `/task-submit`.

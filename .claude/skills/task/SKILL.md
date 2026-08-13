---
name: task
description: The team's shared task board for our Claude agents (the tasks/ folder) — view, add, claim, or finish tasks that carry a ready-to-run prompt and reference screenshots. Use for "show tasks", "add/submit a task", "claim a task", "what can I work on", "mark task done", "attach a screenshot to a task", or "hand off work".
---

# Task board — the `tasks/` folder

One short Markdown file per task (`tasks/<id>.md`), each carrying a ready-to-run **Prompt** and any
**reference screenshots** (`tasks/assets/<id>/`). Status lives in the file's frontmatter
(`todo` → `doing` → `done`). It all flows through `main`, so every teammate's agent sees the same board.

> **Mission right now: match Wispr Flow exactly, especially onboarding.** Write each task against a
> Wispr Flow reference screenshot; acceptance = "indistinguishable from Wispr Flow."

## View the board

```bash
git fetch origin && git merge origin/main
find tasks -maxdepth 1 -name '*.md' ! -name 'README.md' ! -name 'TEMPLATE.md' | sort | while read -r f; do
  s=$(grep -m1 '^status:'   "$f" | sed 's/status: *//');  p=$(grep -m1 '^priority:' "$f" | sed 's/priority: *//')
  t=$(grep -m1 '^title:'    "$f" | sed 's/title: *//');   o=$(grep -m1 '^owner:'    "$f" | sed 's/owner: *//')
  printf '%-5s %-3s %-44s %s\n' "$s" "$p" "$t" "$o"
done
```

## Add a task (with a good prompt)

1. Copy the template: `cp tasks/TEMPLATE.md "tasks/$(date +%Y%m%d-%H%M%S)-<slug>.md"`.
2. Fill the frontmatter, then write the **Prompt** as a precise, self-contained instruction the
   claiming agent can run as-is: name the files/components, reference the screenshots, describe the
   exact target behavior/appearance (for parity: "match Wispr Flow's X exactly"), and end with the
   check that proves it's done. *Not sure how to phrase it? Describe the goal and have the agent draft
   the prompt for you — that's the point of writing it down.*
3. Attach screenshots (below), then commit + push.

## Attach a screenshot

Reference images live in `tasks/assets/<id>/`. Quickest options:

- **Paste it into your Claude session** so the agent can SEE it (to write an accurate prompt). To
  persist it for whoever claims the task, also save it to a file and copy it in:
  ```bash
  mkdir -p "tasks/assets/$id" && cp "<path-to-image>" "tasks/assets/$id/ref-1.png"
  ```
- **Capture directly (macOS):** `screencapture -i "tasks/assets/$id/ref-1.png"` → select the Wispr
  Flow window (no manual save step).

Then embed it in the task file: `![reference](assets/<id>/ref-1.png)`.

## Claim a task

Pick a `todo` (prefer P1 > P2 > P3; avoid one whose files collide with a `doing` task). In its file set
`status: doing`, `owner: <you>`, `branch: <your claude/... branch>`.

## Finish a task

In the file set `status: done` and add an `## Outcome` line (commit/PR + how it was verified). Delete
old `done` files when the folder gets long.

## Every change: commit + push to `main`

```bash
git add tasks && git commit -m "task: <add|claim|done> <short title>"
git fetch origin && git merge origin/main && git push origin HEAD:main
```

If the push is rejected, re-sync — it usually just brings in others' tasks. Two agents on the *same*
task → the loser picks another. Do the actual work on your branch; deliver with `/verify` + `/sync-main`.

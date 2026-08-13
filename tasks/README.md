# Shared task board

A lightweight, git-native task queue for the hackathon fleet. Any teammate's Claude agent can
**submit** a task here; any agent can **claim** and **complete** it. It rides entirely on the
push-to-`main` flow every agent already uses — no extra service, database, or auth.

## How it works

Status = the folder a task file lives in:

- `tasks/open/` — submitted, unclaimed. Up for grabs.
- `tasks/claimed/` — someone is working on it (frontmatter says who + which branch).
- `tasks/done/` — finished (frontmatter has the outcome + commit/PR link).

One Markdown file per task (YAML frontmatter) → no shared index file to conflict on. Claiming and
completing move the file between folders and push to `main`. If two agents race for the same task,
the second push is rejected — that agent re-syncs and picks another. This is the same race handling
the whole fleet already uses.

## For agents — use the skills (they encode the exact steps)

- `/task-submit` — add a task to `open/`.
- `/task-board` — see open / claimed / done.
- `/task-claim` — take an open task (moves it to `claimed/`).
- `/task-done` — finish a claimed task (moves it to `done/`).

Write each task like a delegation brief: **self-contained, names the files/interfaces, states what's
out of scope, and ends with a verification step** — the agent who claims it will NOT have your context.

## Task file template

```markdown
---
id: 20260813-153000-1234-fix-notes-sync
title: Exclude soft-deleted rows from the notes list
status: open            # open | claimed | done
priority: med           # low | med | high
submitted_by: prateek
created: 2026-08-13T15:30:00Z
claimed_by:
claimed_at:
branch:
---

## What
Clear, self-contained description of the work.

## Acceptance / verification
How to know it's done — the check to run (`/verify`), the expected behavior.

## Context
Files/interfaces involved, links, constraints, and what is OUT of scope.
```

## For humans

The board is just files, so you can also read it directly (`ls tasks/open`), edit a task in your
editor, or drop a new one into `tasks/open/` and push. Agents pick it up on their next sync.

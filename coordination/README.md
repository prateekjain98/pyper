# Coordination — live worklog

A live status feed so parallel agents share context **constantly**. Each agent keeps **one file** at
`coordination/agents/<id>.md` (id = your branch slug) and pushes it to `main` after every meaningful
step. Per-agent files never collide, so pushing status is fast and conflict-free.

Use the **`/worklog`** skill to update your status and to see what the fleet is doing. This is separate
from the task board (`/task`, discrete work items) — the worklog is your live **progress + blockers +
fixes**.

## Why

- Others see who's working on what → no duplicated effort.
- Blockers are visible → someone can help or reprioritize.
- **Fixes & gotchas** you discover are broadcast → other agents apply them and get unblocked fast.

## Your status file — `coordination/agents/<id>.md`

```markdown
---
agent: <your name or branch>
branch: <claude/... branch>
status: working        # working | blocked | idle | done
updated: <YYYY-MM-DDTHH:MM:SSZ>
---

## Now
<the task + files you're touching right now>

## Progress
- <time> — <what you just did / where you are>   (newest first)

## Blockers
<what's blocking you, or "none">

## Fixes & gotchas (others should apply)
- <file — the problem — the fix/workaround other agents need>
```

Update it **constantly** and push immediately. When you start work or hit a blocker, run `/worklog`
first to read the fleet's status + fixes.

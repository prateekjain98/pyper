---
name: worklog
description: Broadcast what you're working on, your progress, blockers, and fixes other agents should apply — to the shared coordination feed, pushed to main constantly. Use to "log my work", "update my status", "check in", "broadcast progress", "share a fix", or (when starting or blocked) to see what other agents are doing.
---

# Worklog — live cross-agent coordination

Every agent keeps a running status file at `coordination/agents/<id>.md` and pushes it to `main`
**constantly**, so the whole fleet has live context: who's on what, what's blocked, and any
fixes/gotchas to apply. Separate from `/task` (discrete work items) — worklog is your live feed.

> **This is now automatic.** Hooks (`.claude/settings.json` → `coordination/worklog-hook.sh`) do it for
> you: a `Stop` hook rewrites your status file (branch, last commit, uncommitted files) and pushes it to
> `main` each turn; a `SessionStart` hook loads the fleet's status + fixes into your context. You mainly
> just curate the **`## Fixes & gotchas`** section — the Stop hook preserves it. Use the steps below only
> for a manual/richer update or an on-demand fleet view.

Your id is your branch slug:

```bash
id="$(git rev-parse --abbrev-ref HEAD | sed 's#.*/##')"
```

## Update your status — do this CONSTANTLY (after every meaningful step, not just at the end)

1. Create/refresh `coordination/agents/$id.md` (shape in `coordination/README.md`): set `status`,
   `updated` (`date -u +%Y-%m-%dT%H:%M:%SZ`), **Now**, append a **Progress** line, note **Blockers**,
   and add any **Fixes & gotchas** other agents should apply.
2. Push immediately — per-agent files never collide, so this is clean and fast:
   ```bash
   git add "coordination/agents/$id.md"
   git commit -m "worklog: <short note>"
   git fetch origin && git merge origin/main && git push origin HEAD:main
   ```
   Do it every few minutes / at each milestone. **Don't batch it to the end** — stale status helps no one.

## See what the fleet is doing — before starting, when blocked, and periodically

```bash
git fetch origin && git merge origin/main
echo "== WHO'S ON WHAT =="
find coordination/agents -maxdepth 1 -name '*.md' 2>/dev/null | sort | while read -r f; do
  a=$(grep -m1 '^agent:'   "$f" | sed 's/agent: *//')
  s=$(grep -m1 '^status:'  "$f" | sed 's/status: *//')
  u=$(grep -m1 '^updated:' "$f" | sed 's/updated: *//')
  printf '%-22s [%-8s] %s\n' "$a" "$s" "$u"
done
echo
echo "== FIXES & GOTCHAS TO APPLY =="
find coordination/agents -maxdepth 1 -name '*.md' 2>/dev/null | sort | while read -r f; do
  awk '/^## Fixes & gotchas/{p=1;next} p&&/^## /{p=0} p&&/^- /{print "  - "substr($0,3)}' "$f"
done
```

## When blocked

Run the fleet view above and read **Fixes & gotchas**. If another agent already solved your blocker,
apply their fix, note it in your Progress, and push — don't sit blocked on something already fixed.

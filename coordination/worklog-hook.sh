#!/usr/bin/env bash
# coordination/worklog-hook.sh — AUTOMATIC cross-agent worklog (see coordination/README.md).
#
#   $1 = session-start : inject the fleet's status + fixes + open tasks into the agent's context
#   $1 = stop          : refresh THIS agent's worklog file and best-effort push it to main
#
# Wired from .claude/settings.json (SessionStart + Stop). Safe by design:
#   - always exits 0 (a Stop hook must never block the turn)
#   - every git op is best-effort (|| true) and never leaves a conflicted tree
#   - only ever commits/pushes the agent's OWN worklog file — never work-in-progress
#   - set WORKLOG_HOOK_DRYRUN=1 to update the file without committing/pushing (for testing)
set -uo pipefail

mode="${1:-}"
root="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
cd "$root" 2>/dev/null || exit 0
branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null)" || exit 0
id="$(printf '%s' "$branch" | sed 's#.*/##')"
[ -n "$id" ] || exit 0
dir="coordination/agents"

# ---- session-start: load fleet context ----------------------------------------
if [ "$mode" = "session-start" ]; then
  git fetch origin -q 2>/dev/null || true
  ref="origin/main"; git rev-parse --verify -q "$ref" >/dev/null 2>&1 || ref="HEAD"
  text="$(
    echo "## Fleet worklog (auto-loaded) — who is working on what"
    git ls-tree -r --name-only "$ref" -- "$dir" 2>/dev/null | grep '\.md$' | while read -r wf; do
      c="$(git show "$ref:$wf" 2>/dev/null)" || continue
      a=$(printf '%s\n' "$c" | grep -m1 '^agent:'  | sed 's/agent: *//')
      s=$(printf '%s\n' "$c" | grep -m1 '^status:' | sed 's/status: *//')
      n=$(printf '%s\n' "$c" | awk '/^## Now/{getline; while($0 ~ /^[[:space:]]*$/) getline; print; exit}')
      echo "- ${a:-?} [${s:-?}] — ${n}"
    done
    echo
    echo "## Fixes & gotchas from the fleet — apply these to get unblocked"
    git ls-tree -r --name-only "$ref" -- "$dir" 2>/dev/null | grep '\.md$' | while read -r wf; do
      git show "$ref:$wf" 2>/dev/null | awk '/^## Fixes & gotchas/{p=1;next} p&&/^## /{p=0} p&&/^- /{print "- "substr($0,3)}'
    done
    echo
    echo "(Open tasks: run /task. Your own worklog auto-updates and pushes on each turn.)"
  )"
  if command -v jq >/dev/null 2>&1; then
    printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":%s}}\n' \
      "$(printf '%s' "$text" | jq -Rs .)"
  fi
  exit 0
fi

# ---- stop: refresh + best-effort push this agent's worklog --------------------
if [ "$mode" = "stop" ]; then
  mkdir -p "$dir" 2>/dev/null || exit 0
  f="$dir/$id.md"
  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null)"
  last="$(git log -1 --pretty=%s 2>/dev/null | tr -d '\r')"
  changed="$(git status --porcelain 2>/dev/null | awk '{print "- "$0}' | head -15)"

  # Preserve the human-curated "Fixes & gotchas" section (to end of file) if present.
  fixes=""
  [ -f "$f" ] && fixes="$(awk '/^## Fixes & gotchas/{p=1} p{print}' "$f")"
  [ -n "$fixes" ] || fixes=$'## Fixes & gotchas (others should apply)\n- (add fixes/gotchas here so other agents can apply them)'

  {
    echo "---"
    echo "agent: $id"
    echo "branch: $branch"
    echo "status: working"
    echo "updated: ${ts:-unknown}"
    echo "auto: true"
    echo "---"
    echo
    echo "## Now"
    echo "Last commit: ${last:-<none yet>}"
    echo
    echo "## Uncommitted changes"
    if [ -n "$changed" ]; then echo "$changed"; else echo "- (clean)"; fi
    echo
    echo "$fixes"
  } > "$f" 2>/dev/null || exit 0

  [ -n "${WORKLOG_HOOK_DRYRUN:-}" ] && exit 0

  git add "$f" 2>/dev/null || exit 0
  git diff --cached --quiet -- "$f" 2>/dev/null && exit 0   # nothing to commit
  git fetch origin -q 2>/dev/null || true
  ahead="$(git rev-list --count origin/main..HEAD 2>/dev/null || echo 1)"
  if [ "$ahead" = "0" ]; then
    # No local work commits — advance to latest main and push just the worklog.
    git merge -q --ff-only origin/main 2>/dev/null || true
    git commit -q --only "$f" -m "worklog: auto ($id)" 2>/dev/null || true
    git push -q origin HEAD:main 2>/dev/null || true
  else
    # Agent has unpushed work — commit the worklog so it rides the next verified push; don't push now.
    git commit -q --only "$f" -m "worklog: auto ($id)" 2>/dev/null || true
  fi
  exit 0
fi

exit 0

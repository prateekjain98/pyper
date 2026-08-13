#!/usr/bin/env bash
# PreToolUse(Bash) hook — verify before a push to `main`.
#
# Blocks a push to `main` ONLY if TypeScript typecheck fails. Safe by design:
# if deps aren't installed we can't verify, so we warn and ALLOW (exit 0) — this
# hook must never brick the fleet's delivery. Full tests + lint remain the agent's
# job via the /verify skill. To disable: remove the "hooks" block in
# .claude/settings.json, or delete this file.
set -uo pipefail

input="$(cat 2>/dev/null || true)"

# Only act on git pushes that mention main; otherwise allow immediately.
printf '%s' "$input" | grep -Eq 'git[^"]*push'  || exit 0
printf '%s' "$input" | grep -Eq 'main'          || exit 0

root="$(git rev-parse --show-toplevel 2>/dev/null || echo .)"

if [ ! -d "$root/node_modules" ]; then
  echo "verify-before-push: node_modules missing — cannot typecheck. Run /verify manually. Allowing push." >&2
  exit 0
fi

echo "verify-before-push: running 'npm run typecheck' before pushing to main…" >&2
if (cd "$root" && npm run typecheck >/tmp/pyper-verify-typecheck.log 2>&1); then
  echo "verify-before-push: ✓ typecheck clean — allowing push." >&2
  exit 0
fi

echo "verify-before-push: ✗ typecheck FAILED — fix type errors before pushing to main:" >&2
tail -n 25 /tmp/pyper-verify-typecheck.log >&2
exit 2

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

# Hooks can run with a minimal PATH (no login profile sourced), so Node installed
# via Homebrew / nvm / fnm / volta is often invisible here. Add the usual install
# locations, then fail OPEN if npm still can't be found — an unverifiable
# environment must never block delivery (same contract as the node_modules check
# above). Without this, `npm: command not found` was falling through to the
# typecheck-failed branch and wrongly blocking every push on such machines.
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.volta/bin:$HOME/.local/bin:$PATH"
for d in "$HOME/.nvm/versions/node"/*/bin "$HOME/.local/state/fnm_multishells"/*/bin "$HOME/Library/Caches/fnm_multishells"/*/bin; do
  [ -d "$d" ] && PATH="$d:$PATH"
done
if ! command -v npm >/dev/null 2>&1; then
  echo "verify-before-push: npm not on PATH — cannot typecheck. Run /verify manually. Allowing push." >&2
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

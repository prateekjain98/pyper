#!/usr/bin/env bash

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "This script will stop Pyper, remove the installed app, and delete caches, databases, and preferences."
read -r -p "Continue with the full uninstall? [y/N]: " confirm
if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
  echo "Aborted."
  exit 0
fi

remove_target() {
  local target="$1"
  if [[ -e "$target" ]]; then
    echo "Removing $target"
    rm -rf "$target" 2>/dev/null || sudo rm -rf "$target"
  fi
}

echo "Stopping running Pyper/Electron processes..."
pkill -f "Pyper" 2>/dev/null || true
pkill -f "pyper" 2>/dev/null || true
pkill -f "Electron Helper.*Pyper" 2>/dev/null || true

echo "Removing /Applications/Pyper.app (requires admin)..."
remove_target "/Applications/Pyper.app"

echo "Purging Application Support data..."
remove_target "$HOME/Library/Application Support/Pyper"
remove_target "$HOME/Library/Application Support/pyper"
remove_target "$HOME/Library/Application Support/Pyper-dev"
remove_target "$HOME/Library/Application Support/com.saaslabs.pyper"
remove_target "$HOME/Library/Application Support/com.saaslabs.pyper.Pyper"

echo "Removing caches, logs, and saved state..."
remove_target "$HOME/Library/Caches/pyper"
remove_target "$HOME/Library/Caches/com.saaslabs.pyper.Pyper"
remove_target "$HOME/Library/Preferences/com.saaslabs.pyper.Pyper.plist"
remove_target "$HOME/Library/Preferences/com.saaslabs.pyper.helper.plist"
remove_target "$HOME/Library/Logs/Pyper"
remove_target "$HOME/Library/Saved Application State/com.saaslabs.pyper.Pyper.savedState"

echo "Cleaning temporary files..."
shopt -s nullglob
for tmp in /tmp/pyper*; do
  remove_target "$tmp"
done
for crash in "$HOME/Library/Application Support/CrashReporter"/Pyper_*; do
  remove_target "$crash"
done
shopt -u nullglob

read -r -p "Remove downloaded Whisper models and caches (~/.cache/whisper, ~/Library/Application Support/whisper)? [y/N]: " wipe_models
if [[ "$wipe_models" =~ ^[Yy]$ ]]; then
  remove_target "$HOME/.cache/whisper"
  remove_target "$HOME/Library/Application Support/whisper"
  remove_target "$HOME/Library/Application Support/Pyper/models"
fi

ENV_FILE="$PROJECT_ROOT/.env"
if [[ -f "$ENV_FILE" ]]; then
  read -r -p "Remove the local environment file at $ENV_FILE? [y/N]: " wipe_env
  if [[ "$wipe_env" =~ ^[Yy]$ ]]; then
    echo "Removing $ENV_FILE"
    rm -f "$ENV_FILE"
  fi
fi

cat <<'EOF'
macOS keeps microphone, screen recording, and accessibility approvals even after files are removed.
Reset them if you want a truly fresh start:
  tccutil reset Microphone com.saaslabs.pyper.app
  tccutil reset Accessibility com.saaslabs.pyper.app
  tccutil reset ScreenCapture com.saaslabs.pyper.app

Full uninstall complete. Reboot if you removed permissions, then reinstall or run npm scripts on a clean tree.
EOF

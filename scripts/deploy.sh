#!/usr/bin/env bash
set -euo pipefail

if [[ $# -eq 0 ]]; then
  echo "Usage: $(basename "$0") <user@host>"
  echo "  e.g. $(basename "$0") dave@farthings.me"
  exit 1
fi

REMOTE="$1"
DEST="/apps/racemaster"

EXCLUDES=(
  --exclude='.git' --exclude='.idea' --exclude='scripts' --exclude='data' --exclude='results'
  --exclude='users.txt' --exclude='admins.txt' --exclude='sessions.txt'
)
SRC="$(dirname "$0")/../"

echo "Ensuring ${REMOTE}:${DEST} exists..."
ssh "$REMOTE" "sudo mkdir -p ${DEST}"

echo "Checking for stale files on ${REMOTE}:${DEST}..."
STALE=$(rsync -av --dry-run --delete --rsync-path="sudo rsync" "${EXCLUDES[@]}" "$SRC" "${REMOTE}:${DEST}/" \
  | { grep '^deleting ' || true; })
if [[ -n "$STALE" ]]; then
  echo "Files on destination not in source:"
  echo "$STALE"
  echo ""
else
  echo "No stale files found."
fi

echo "Deploying to ${REMOTE}:${DEST}..."

CHANGED=$(rsync -av --rsync-path="sudo rsync" "${EXCLUDES[@]}" "$SRC" "${REMOTE}:${DEST}/" \
  | { grep -v '^\(sending\|sent\|total\|\./\|.*/$\)' | { grep -v '^$' || true; } || true; })
if [[ -n "$CHANGED" ]]; then
  echo "Files deployed:"
  echo "$CHANGED"
else
  echo "No new files deployed."
fi

echo "Done. To restart the app on the server run:"
echo "  ssh ${REMOTE} 'cd ${DEST} && docker compose up -d --build'"

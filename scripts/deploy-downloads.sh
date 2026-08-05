#!/usr/bin/env bash
set -euo pipefail

if [[ $# -eq 0 ]]; then
  echo "Usage: $(basename "$0") <user@host>"
  echo "  e.g. $(basename "$0") dave@farthings.me"
  exit 1
fi

REMOTE="$1"
DEST="/apps/racemaster"
SRC="$(dirname "$0")/../downloads/"

echo "Ensuring ${REMOTE}:${DEST}/downloads exists..."
ssh "$REMOTE" "sudo mkdir -p ${DEST}/downloads"

echo "Deploying downloads to ${REMOTE}:${DEST}/downloads..."
rsync -av --rsync-path="sudo rsync" "$SRC" "${REMOTE}:${DEST}/downloads/"

echo "Done."
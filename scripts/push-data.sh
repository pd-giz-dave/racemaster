#!/usr/bin/env bash
set -euo pipefail

if [[ $# -eq 0 ]]; then
  echo "Usage: $(basename "$0") <user@host>"
  echo "  e.g. $(basename "$0") dave@farthings.me"
  exit 1
fi

REMOTE="$1"
DEST="/apps/racemaster"
LOCAL="$(dirname "$0")/.."

echo "Pushing data to ${REMOTE}:${DEST}..."

ssh "$REMOTE" "sudo mkdir -p ${DEST}/data ${DEST}/results"

rsync -av --rsync-path="sudo rsync" "${LOCAL}/data/"        "${REMOTE}:${DEST}/data/"
rsync -av --rsync-path="sudo rsync" "${LOCAL}/results/"     "${REMOTE}:${DEST}/results/"
rsync -av --rsync-path="sudo rsync" "${LOCAL}/users.txt"    "${REMOTE}:${DEST}/users.txt"
rsync -av --rsync-path="sudo rsync" "${LOCAL}/admins.txt"   "${REMOTE}:${DEST}/admins.txt"
rsync -av --rsync-path="sudo rsync" "${LOCAL}/sessions.txt" "${REMOTE}:${DEST}/sessions.txt"

echo "Done."
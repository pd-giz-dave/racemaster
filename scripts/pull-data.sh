#!/usr/bin/env bash
set -euo pipefail

if [[ $# -eq 0 ]]; then
  echo "Usage: $(basename "$0") <user@host>"
  echo "  e.g. $(basename "$0") dave@farthings.me"
  exit 1
fi

REMOTE="$1"
SRC="/apps/racemaster"
LOCAL="$(dirname "$0")/.."

echo "Pulling data from ${REMOTE}:${SRC}..."

rsync -av --rsync-path="sudo rsync" "${REMOTE}:${SRC}/data/"        "${LOCAL}/data/"
rsync -av --rsync-path="sudo rsync" "${REMOTE}:${SRC}/results/"     "${LOCAL}/results/"
rsync -av --rsync-path="sudo rsync" "${REMOTE}:${SRC}/users.txt"    "${LOCAL}/users.txt"
rsync -av --rsync-path="sudo rsync" "${REMOTE}:${SRC}/admins.txt"   "${LOCAL}/admins.txt"
rsync -av --rsync-path="sudo rsync" "${REMOTE}:${SRC}/sessions.txt" "${LOCAL}/sessions.txt"

echo "Done."
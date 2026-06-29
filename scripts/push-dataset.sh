#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "Usage: $(basename "$0") <user@host> <user/dataset.json>"
  echo "  e.g. $(basename "$0") dave@farthings.me giz/trigs-2026-private.json"
  exit 1
fi

REMOTE="$1"
DATASET="$2"
DEST="/apps/racemaster"
LOCAL="$(dirname "$0")/.."
USER_DIR="$(dirname "$DATASET")"

echo "Pushing data/${DATASET} to ${REMOTE}:${DEST}..."

ssh "$REMOTE" "sudo mkdir -p ${DEST}/data/${USER_DIR}"
rsync -av --rsync-path="sudo rsync" "${LOCAL}/data/${DATASET}" "${REMOTE}:${DEST}/data/${DATASET}"

echo "Done."
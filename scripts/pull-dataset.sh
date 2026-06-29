#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "Usage: $(basename "$0") <user@host> <user/dataset.json>"
  echo "  e.g. $(basename "$0") dave@farthings.me giz/trigs-2026-private.json"
  exit 1
fi

REMOTE="$1"
DATASET="$2"
SRC="/apps/racemaster"
LOCAL="$(dirname "$0")/.."
USER_DIR="$(dirname "$DATASET")"

echo "Pulling data/${DATASET} from ${REMOTE}:${SRC}..."

mkdir -p "${LOCAL}/data/${USER_DIR}"
rsync -av --rsync-path="sudo rsync" "${REMOTE}:${SRC}/data/${DATASET}" "${LOCAL}/data/${DATASET}"

echo "Done."
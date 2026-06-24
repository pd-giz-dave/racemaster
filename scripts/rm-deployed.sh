#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "Usage: $(basename "$0") <user@host> <path> [<path> ...]"
  echo "  Paths are relative to the app root, e.g. js/auth.js"
  echo "  e.g. $(basename "$0") dave@farthings.me js/auth.js"
  exit 1
fi

REMOTE="$1"
DEST="/apps/racemaster"
shift

TARGETS=()
for f in "$@"; do
  TARGETS+=("${DEST}/${f}")
done

echo "Deleting from ${REMOTE}:"
printf '  %s\n' "${TARGETS[@]}"
echo ""

ssh "$REMOTE" sudo rm -v "${TARGETS[@]}"

#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $(basename "$0") <port>"
  echo "  e.g. $(basename "$0") 3000"
  exit 1
fi

PORT="$1"

pids=$(lsof -ti "tcp:${PORT}" -sTCP:LISTEN 2>/dev/null || true)
if [[ -z "$pids" ]]; then
  echo "No server listening on port ${PORT}."
  exit 0
fi

echo "Listening on port ${PORT}:"
lsof -i "tcp:${PORT}" -sTCP:LISTEN

echo "Stopping (pid $(echo "$pids" | tr '\n' ' '))..."
kill $pids

# Give it a moment to shut down gracefully before force-killing what's left.
for _ in $(seq 1 10); do
  pids=$(lsof -ti "tcp:${PORT}" -sTCP:LISTEN 2>/dev/null || true)
  [[ -z "$pids" ]] && break
  sleep 0.5
done

if [[ -n "$pids" ]]; then
  echo "Still running — force killing (pid $(echo "$pids" | tr '\n' ' '))..."
  kill -9 $pids
fi

echo "Stopped."

#!/usr/bin/env bash
set -euo pipefail

LOCAL="$(dirname "$0")/.."
cd "${LOCAL}"

mkdir -p coverage
node --test --experimental-test-coverage \
  --test-reporter=spec --test-reporter-destination=stdout \
  --test-reporter=lcov --test-reporter-destination=coverage/lcov.info \
  "test/**/*.test.js"

echo
echo "LCOV report written to coverage/lcov.info"
echo "In WebStorm: Run > Show Coverage Data... and browse to that file."

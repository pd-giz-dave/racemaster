#!/usr/bin/env bash
set -euo pipefail

LOCAL="$(dirname "$0")/.."
cd "${LOCAL}"

node --test "test/**/*.test.js"
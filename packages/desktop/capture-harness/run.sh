#!/bin/sh
set -eu

if [ "$(uname -s)" != "Linux" ]; then
  echo "Paseo desktop capture is only supported on Linux." >&2
  exit 1
fi

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/../../.." && pwd)
ELECTRON="$REPO_ROOT/node_modules/.bin/electron"

if [ "${PASEO_CAPTURE_HARNESS_GROUP:-}" = "browser-profile" ] && [ -z "${PASEO_CAPTURE_HARNESS_PHASE:-}" ]; then
  PASEO_CAPTURE_HARNESS_PHASE=write "$ELECTRON" "$SCRIPT_DIR/main.js"
  # Give Chromium's profile helpers time to release the persistent session before reopening it.
  sleep 1
  PASEO_CAPTURE_HARNESS_PHASE=read "$ELECTRON" "$SCRIPT_DIR/main.js"
  exit
fi

exec "$ELECTRON" "$SCRIPT_DIR/main.js"

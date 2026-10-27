#!/usr/bin/env bash
# Build the Music Scribe PyInstaller sidecar for the current OS (macOS / Linux).
# Output: desktop/sidecar/music-scribe-helper/ (onedir) — copied for electron-builder.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ ! -d .venv ]]; then
  echo "Create .venv first (./setup.sh), then re-run." >&2
  exit 1
fi
# shellcheck disable=SC1091
source .venv/bin/activate
python -m pip install -U pip pyinstaller

OUT_DIR="$ROOT/desktop/sidecar"
rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"

export PYTHONPATH="$ROOT/backend${PYTHONPATH:+:$PYTHONPATH}"
pyinstaller \
  --noconfirm \
  --clean \
  --distpath "$ROOT/sidecar/dist" \
  --workpath "$ROOT/sidecar/build" \
  "$ROOT/sidecar/music_scribe_helper.spec"

# Flatten onedir next to electron-builder extraResources expectation:
# desktop/sidecar/music-scribe-helper (+ _internal) OR a single binary name.
HELPER_DIR="$ROOT/sidecar/dist/music-scribe-helper"
if [[ -d "$HELPER_DIR" ]]; then
  cp -R "$HELPER_DIR"/. "$OUT_DIR"/
else
  echo "Expected onedir at $HELPER_DIR" >&2
  exit 1
fi

# Ensure frontend is also visible beside the helper for BANDSCRIBE_ROOT resolution.
if [[ ! -d "$OUT_DIR/frontend" ]]; then
  cp -R "$ROOT/frontend" "$OUT_DIR/frontend"
fi

echo "Sidecar ready at $OUT_DIR"
ls -la "$OUT_DIR" | head

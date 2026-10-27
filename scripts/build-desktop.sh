#!/usr/bin/env bash
# Package the Electron app for the current host OS.
# On Linux CI/dev VMs this can produce an AppImage smoke build; macOS .dmg and
# Windows NSIS must be built on macos-latest / windows-latest (see GitHub Actions).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/desktop"

if [[ ! -d node_modules ]]; then
  npm install
fi

# Sidecar must already exist under desktop/sidecar/ (from build-sidecar.sh/.ps1).
if [[ ! -e sidecar/music-scribe-helper && ! -e sidecar/music-scribe-helper.exe ]]; then
  echo "Missing desktop/sidecar helper binary. Run scripts/build-sidecar.sh first." >&2
  exit 1
fi

case "$(uname -s)" in
  Darwin) npm run dist:mac ;;
  Linux)  npx electron-builder --linux ;;
  MINGL*|MSYS*|CYGWIN*|Windows_NT) npm run dist:win ;;
  *) echo "Unsupported OS: $(uname -s)" >&2; exit 1 ;;
esac

echo "Artifacts under desktop/dist/"
ls -la dist || true

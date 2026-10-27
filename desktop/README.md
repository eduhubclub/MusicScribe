# Music Scribe desktop (Electron)

Electron shell around the existing `frontend/` + localhost Python helper.

## Dev (macOS / Windows)

1. From the repo root, create the Python venv (`./setup.sh` or `.\setup.ps1`).
2. Install Electron deps:

```bash
cd desktop && npm install
```

3. Start the desktop shell (spawns `.venv` helper on `127.0.0.1`, splash while it boots):

```bash
npm run dev
```

On Windows PowerShell:

```powershell
cd desktop
npm install
npm run dev
```

The helper never binds `0.0.0.0`. Jobs stay ephemeral by default.

## Production layout

- `electron-builder` packs this app and copies `frontend/` + `desktop/sidecar/` into `resources/`.
- Production spawn uses the OS-native PyInstaller binary (`music-scribe-helper` / `.exe`).
- First-run model download UI writes weights under:
  - macOS: `~/Library/Application Support/MusicScribe/models`
  - Windows: `%LOCALAPPDATA%\MusicScribe\models`

## Build installers

Build the sidecar on the **same OS** as the target, then package:

```bash
# macOS
./scripts/build-sidecar.sh
./scripts/build-desktop.sh   # → .dmg

# Windows (PowerShell)
.\scripts\build-sidecar.ps1
.\scripts\build-desktop.ps1  # → NSIS .exe (+ portable)
```

GitHub Actions (`.github/workflows/desktop-release.yml`) builds **macos-latest** and
**windows-latest** on version tags (`v*`) and attaches artifacts to the release.

This Linux/cloud VM cannot produce signed macOS `.dmg` or Windows NSIS installers;
use the workflow for those artifacts.

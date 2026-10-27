# Desktop app packaging

Music Scribe ships as a **downloadable desktop app** (macOS + Windows) that embeds the
existing UI and a localhost-only Python helper. Songs never leave the machine.

## Architecture

- **Electron** loads a splash, starts the helper on `127.0.0.1` (auto-picks a free port if
  `8765` is busy), then opens the existing `frontend/` served by that helper.
- **PyInstaller sidecar** (`music-scribe-helper`) packages `bandscribe.server` for production.
- **Dev mode** spawns `.venv/bin/python` (macOS/Linux) or `.venv\Scripts\python.exe` (Windows)
  with `python -m bandscribe`.
- **Models** are downloaded on first run into the OS user-data folder (installer stays lean).

## Privacy invariants

- Helper bind address is forced to localhost (`127.0.0.1` / `localhost` / `::1` only).
- No cloud song storage; ephemeral jobs remain the default (`BANDSCRIBE_KEEP_JOBS` opt-in).
- Clear local data still wipes ephemeral jobs.

## Build & release

See [`desktop/README.md`](../desktop/README.md) and
[`.github/workflows/desktop-release.yml`](../.github/workflows/desktop-release.yml).

Tag a release (`v0.1.0`) to build `.dmg` and NSIS `.exe` on GitHub-hosted runners.

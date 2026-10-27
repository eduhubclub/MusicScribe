# Music Scribe

Turn a song into playable parts — chord sheet with lyrics, guitar and bass tabs, piano,
drums, and melody. Everything runs on **your computer**. No accounts. No cloud uploads.

## Download the app (macOS & Windows)

**This is the primary way to use Music Scribe.**

| Platform | Installer |
|---|---|
| **macOS** (Apple Silicon + Intel) | [GitHub Releases](https://github.com/thomaseccles67/MusicScribe/releases) → `.dmg` |
| **Windows** 10/11 (x64) | [GitHub Releases](https://github.com/thomaseccles67/MusicScribe/releases) → NSIS `.exe` |

1. Download the installer for your OS from the latest
   [Release](https://github.com/thomaseccles67/MusicScribe/releases).
2. Open Music Scribe (double-click). A short splash appears while the local engine starts.
3. On first launch, the app downloads AI models into a folder on your machine (not into the
   installer), then you’re ready to drop in a song.

| OS | Model cache |
|---|---|
| macOS | `~/Library/Application Support/MusicScribe/` |
| Windows | `%LOCALAPPDATA%\MusicScribe\` |

Your songs never leave this computer. The helper listens on `127.0.0.1` only. Job files are
**ephemeral** by default (cleared when the engine starts and via **Clear local data**).

Desktop packaging details: [`docs/desktop.md`](docs/desktop.md) · [`desktop/README.md`](desktop/README.md).

> Automatic transcription is a solid first draft, not a perfect score. Edit chords and lyrics
> in place; check tabs by ear.

### What you get

- **Chord sheet** with lyrics and section headings (paste Suno lyrics to time them).
- **Guitar / bass tab** in any tuning or capo; Drop-D style suggestions when they fit.
- **Piano** roll + live keyboard for the current chord.
- **Drums** on a 16th-note grid; **melody** with lyrics underneath.
- Chord diagrams, transpose, **MIDI** and **PDF** export, play-along highlighting.

## Privacy

**Songs never go to a Music Scribe cloud.** There are no accounts and no remote job store.
The page talks only to a **localhost** helper (`127.0.0.1`). See
[`docs/browser-local-architecture.md`](docs/browser-local-architecture.md).

Honest limit: Demucs / Whisper / Basic Pitch still need that local Python helper (bundled in
the desktop app). They do not all run inside a plain browser tab yet.

---

## Developers: run from source

Use this path if you are hacking on Music Scribe. Day-to-day users should
[download the app](#download-the-app-macos--windows) instead.

### Desktop shell (Electron, recommended for UI work)

```bash
./setup.sh                  # or .\setup.ps1 on Windows
cd desktop && npm install && npm run dev
```

Spawns the venv helper on `127.0.0.1`, shows a splash while it boots, then loads `frontend/`.

### CLI helper only (browser)

#### Windows 10 / 11

```powershell
winget install --id Git.Git -e --accept-source-agreements --accept-package-agreements
winget install --id Python.Python.3.12 -e --accept-source-agreements --accept-package-agreements
winget install --id Gyan.FFmpeg -e --accept-source-agreements --accept-package-agreements
```

Close and reopen PowerShell, then:

```powershell
cd $HOME
git clone https://github.com/thomaseccles67/MusicScribe.git
cd MusicScribe
powershell -ExecutionPolicy Bypass -File .\setup.ps1
powershell -ExecutionPolicy Bypass -File .\run.ps1
```

Browser opens http://localhost:8765. Leave PowerShell open; **Ctrl+C** stops the helper.

#### macOS

```bash
brew install git python@3.12 ffmpeg
cd ~ && git clone https://github.com/thomaseccles67/MusicScribe.git && cd MusicScribe
./setup.sh && ./run.sh
```

#### Linux (Ubuntu 24.04)

```bash
sudo apt update && sudo apt install -y git python3 python3-venv ffmpeg
cd ~ && git clone https://github.com/thomaseccles67/MusicScribe.git && cd MusicScribe
./setup.sh && ./run.sh
```

### Updating (developers)

```powershell
cd $HOME\MusicScribe; git pull; powershell -ExecutionPolicy Bypass -File .\setup.ps1
```
```bash
cd ~/MusicScribe && git pull && ./setup.sh
```

Ephemeral jobs are wiped on helper restart. Set `BANDSCRIBE_KEEP_JOBS=1` only if you want
durable **local** disk jobs (still never uploaded).

### Tests

```bash
PYTHONPATH=backend python -m unittest backend.tests.test_chords_accuracy -v
PYTHONPATH=backend python -m unittest backend.tests.test_paths backend.tests.test_models_status -v
```

### Hardware

Everything works on the CPU. A GPU speeds up stem separation (and lyrics on NVIDIA).

| Hardware | Stem separation | Lyrics |
|---|---|---|
| NVIDIA RTX 20-series and newer | GPU (CUDA 12.8) | GPU |
| AMD Radeon RX 7000/9000, Ryzen AI Max 300, selected Ryzen AI 300/400 | GPU (ROCm) | CPU |
| Intel Arc, including Core Ultra iGPU | GPU (XPU) | CPU |
| Apple silicon | GPU (MPS) | CPU |
| Anything else | CPU | CPU |

### Settings

| Variable | Effect |
|---|---|
| `BANDSCRIBE_DATA` | Where songs and results are stored (opts out of ephemeral default) |
| `BANDSCRIBE_KEEP_JOBS` | `1` to keep durable local jobs |
| `BANDSCRIBE_DEVICE` | Force separation device: `cuda`, `xpu`, `mps`, `cpu` |
| `BANDSCRIBE_WHISPER_DEVICE` | Force lyrics device: `cuda` or `cpu` |
| `MUSICSCRIBE_USER_DATA` | Override Application Support / LocalAppData root |
| `MUSICSCRIBE_MODEL_CACHE` | Override model weight cache directory |

The server listens on `127.0.0.1` only and has no login.

### How it works

1. **Demucs** (`htdemucs_6s`) splits the song into stems.
2. **librosa** tracks the beat; bars follow chord changes.
3. **Chords** via chroma templates + HMM; **lyrics** via faster-whisper (or pasted text).
4. **Notes** via Basic Pitch; **tabs** via Viterbi; **drums** via onset bands.

## Credits

Built on [Demucs](https://github.com/facebookresearch/demucs),
[faster-whisper](https://github.com/SYSTRAN/faster-whisper),
[Basic Pitch](https://github.com/spotify/basic-pitch),
[librosa](https://github.com/librosa/librosa), [pretty_midi](https://github.com/craffel/pretty-midi),
[FastAPI](https://github.com/fastapi/fastapi), and [Electron](https://www.electronjs.org/).

Forked from upstream [Bandscribe](https://github.com/skipzx-lab/bandscribe).

Only transcribe music you have the right to use.

## License

MIT

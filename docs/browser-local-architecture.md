# Browser-local architecture (honest)

Music Scribe’s product requirement: **run in the browser; do not store anyone’s songs on a server.**

## Threat model — what never leaves the machine

| Asset | Leave machine? |
|---|---|
| Source audio | **No** — chosen in-page; POSTed only to `127.0.0.1` helper |
| Stems / `result.json` / notes | **No** — ephemeral local disk (temp) or future IndexedDB |
| Accounts / cloud sync | **None** |
| Telemetry of song content | **None** (not implemented; must stay that way) |

The helper **must** bind `127.0.0.1` only (`run.sh` / `run.ps1` already do). Binding `0.0.0.0` would expose a local LAN endpoint — treat that as a privacy bug.

## Current stack (truth)

Today’s pipeline is FastAPI + Demucs + Whisper + Basic Pitch (Python). **That cannot all magically run as-is in a tab.** Claiming “fully in-browser ML” would be false.

### First slice (shipped)

1. SPA frontend holds UX; file picker in-page.
2. Localhost-only helper for ML.
3. **Ephemeral jobs** under OS temp (`bandscribe-ephemeral`) — wiped on helper start/shutdown and via **Clear local data** (`POST /api/privacy/clear`).
4. No durable `data/jobs` library unless the user opts in with `BANDSCRIBE_KEEP_JOBS=1` / `BANDSCRIBE_DATA` (still local-only).
5. Privacy banner + README promise.
6. `frontend/inference-stub.js` documents what is/isn’t in-browser yet.

### Next slices

| Stage | Move in-browser | Keep localhost helper |
|---|---|---|
| A | Chord HMM / chroma (WASM or ORT Web) | Separation |
| B | Basic Pitch ONNX via ONNX Runtime Web | Demucs |
| C | Drum band heuristics | — |
| D | Optional whisper.cpp WASM | Full-quality Whisper |
| E | WebGPU Demucs-class port **or** smaller separator | Until then: helper required |

When stages A–C land, results can live entirely in **memory / IndexedDB** with the helper used only for separation.

## Phased migration

1. **Ephemeral localhost (now)** — no cloud, no durable library, clear-all.
2. **Client result cache** — IndexedDB for `result` + blob URLs for stems after helper finishes; helper may delete disk copy immediately.
3. **Partial in-tab inference** — chords/AMT/drums without re-upload to helper when stems exist as local blobs.
4. **Separation strategy** — WebGPU port, or keep helper as an explicit “local engine” install; never a multi-tenant server.

## Non-goals

- Cloud accounts, shared libraries, or “sync my songs.”
- Pretending Demucs already runs in Chromium.
- Marketing gloss that hides helper requirements.

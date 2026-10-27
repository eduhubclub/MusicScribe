#!/usr/bin/env python3
"""Lightweight localhost UI server for fixture formatting work (no Demucs/Whisper).

Serves frontend/ + a pre-baked done job. Bind is forced to 127.0.0.1.
"""
from __future__ import annotations

import json
import os
import sys
import time
import uuid
from pathlib import Path

from fastapi import Body, FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend"
JOBS = Path(os.environ.get("BANDSCRIBE_DATA", str(ROOT / "data" / "fixture-ui" / "jobs")))
HOST = "127.0.0.1"
PORT = int(os.environ.get("PORT", "8765"))

sys.path.insert(0, str(ROOT / "backend"))
from bandscribe.manual_sheet import build_manual_result  # noqa: E402

app = FastAPI(title="Music Scribe fixture UI")


def _job_dir(job_id: str) -> Path:
    path = (JOBS / job_id).resolve()
    if path.parent != JOBS.resolve() or not path.is_dir():
        raise HTTPException(404, "job not found")
    return path


def _meta(job_id: str) -> dict:
    path = _job_dir(job_id) / "meta.json"
    if not path.exists():
        raise HTTPException(404, "job not found")
    return json.loads(path.read_text(encoding="utf-8"))


def _result(job_id: str) -> dict | None:
    path = _job_dir(job_id) / "result.json"
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


@app.get("/api/health")
def health():
    return {"ok": True, "host": HOST, "mode": "fixture-ui"}


@app.get("/api/privacy")
def privacy():
    return {
        "mode": "fixture",
        "jobs_root": str(JOBS),
        "localhost_only": True,
        "cloud_upload": False,
        "accounts": False,
        "promise": (
            "Fixture UI mode: sample song data is local only. Helper binds 127.0.0.1. "
            "No American Standards WAVs or user audio are loaded."
        ),
    }


@app.post("/api/privacy/clear")
def clear_local():
    return {"ok": True, "privacy": privacy()}


@app.get("/api/jobs")
def list_jobs():
    out = []
    if not JOBS.is_dir():
        return out
    for p in JOBS.glob("*/meta.json"):
        try:
            out.append(json.loads(p.read_text(encoding="utf-8")))
        except (OSError, json.JSONDecodeError):
            continue
    return sorted(out, key=lambda m: -m.get("created", 0))


@app.post("/api/jobs/manual")
def create_manual_job(payload: dict = Body(...)):
    """Create a local no-audio job from pasted lyrics (Tab your own)."""
    lyrics = str(payload.get("lyrics") or "").strip()
    if not lyrics:
        raise HTTPException(400, "lyrics required")
    title = str(payload.get("title") or "").strip()
    if not title:
        first = next((ln.strip() for ln in lyrics.splitlines() if ln.strip()), "Untitled")
        if _is_section_line(first):
            first = next((ln.strip() for ln in lyrics.splitlines() if ln.strip() and not _is_section_line(ln)), "Untitled")
        title = first[:80]
    job_id = uuid.uuid4().hex[:12]
    job_dir = JOBS / job_id
    job_dir.mkdir(parents=True, exist_ok=False)
    result = build_manual_result(lyrics)
    meta = {
        "id": job_id,
        "title": title[:200],
        "filename": "manual.txt",
        "options": {"manual": True},
        "status": "done",
        "stage": "done",
        "stage_label": "Done",
        "progress": 1.0,
        "error": None,
        "created": time.time(),
        "device": "manual",
        "manual": True,
    }
    (job_dir / "meta.json").write_text(json.dumps(meta), encoding="utf-8")
    (job_dir / "result.json").write_text(json.dumps(result), encoding="utf-8")
    return {**meta, "result": result}


def _is_section_line(line: str) -> bool:
    from bandscribe.manual_sheet import _is_section
    return _is_section(line)


@app.delete("/api/jobs/{job_id}")
def delete_job(job_id: str):
    import shutil
    path = _job_dir(job_id)
    shutil.rmtree(path, ignore_errors=True)
    return {"ok": True}


@app.get("/api/jobs/{job_id}")
def get_job(job_id: str):
    meta = _meta(job_id)
    return {**meta, "result": _result(job_id) if meta.get("status") == "done" else None}


@app.patch("/api/jobs/{job_id}")
def rename_job(job_id: str, payload: dict = Body(...)):
    meta = _meta(job_id)
    title = str(payload.get("title", "")).strip()
    if not title:
        raise HTTPException(400, "title required")
    meta["title"] = title[:200]
    (_job_dir(job_id) / "meta.json").write_text(json.dumps(meta), encoding="utf-8")
    return meta


@app.put("/api/jobs/{job_id}/result")
def save_result(job_id: str, result: dict = Body(...)):
    _meta(job_id)
    (_job_dir(job_id) / "result.json").write_text(json.dumps(result), encoding="utf-8")
    return {"ok": True}


@app.get("/api/jobs/{job_id}/notes/{part}")
def get_notes(job_id: str, part: str):
    result = _result(job_id) or {}
    notes_path = _job_dir(job_id) / "notes" / f"{part}.json"
    if notes_path.exists():
        return json.loads(notes_path.read_text(encoding="utf-8"))
    # Fall back to empty editable set so fret UI can open without crashing.
    return {"notes": []}


@app.put("/api/jobs/{job_id}/notes/{part}")
def put_notes(job_id: str, part: str, payload: dict = Body(...)):
    notes_dir = _job_dir(job_id) / "notes"
    notes_dir.mkdir(exist_ok=True)
    notes = payload.get("notes") or []
    (notes_dir / f"{part}.json").write_text(json.dumps({"notes": notes}), encoding="utf-8")
    result = _result(job_id) or {}
    return {"parts": result.get("parts", {}), "notes": notes}


@app.put("/api/jobs/{job_id}/drums/hits")
def put_drums(job_id: str, payload: dict = Body(...)):
    result = _result(job_id) or {}
    hits = payload.get("hits") or []
    if "drums" in result.get("parts", {}):
        result["parts"]["drums"]["hits"] = hits
        result["parts"]["drums"]["note_count"] = len(hits)
        (_job_dir(job_id) / "result.json").write_text(json.dumps(result), encoding="utf-8")
    return {"parts": {"drums": result["parts"]["drums"]}}


@app.post("/api/jobs/{job_id}/tuning")
def tuning_stub(job_id: str, payload: dict = Body(...)):
    """Fixture mode: acknowledge tuning change without re-fretting."""
    result = _result(job_id) or {}
    name = str(payload.get("name") or "Custom")[:40]
    strings = payload.get("strings") or result.get("tuning", {}).get("strings")
    capo = int(payload.get("capo", 0))
    result["tuning"] = {"name": name, "strings": strings, "capo": capo}
    (_job_dir(job_id) / "result.json").write_text(json.dumps(result), encoding="utf-8")
    return {"parts": result.get("parts", {}), "tuning": result["tuning"]}


@app.post("/api/jobs/{job_id}/lyrics")
def lyrics_stub(job_id: str, payload: dict = Body(...)):
    result = _result(job_id) or {}
    return result.get("lyrics") or {"lines": []}


@app.get("/api/jobs/{job_id}/audio/{stem}")
def audio(job_id: str, stem: str):
    if not stem.isalpha():
        raise HTTPException(400, "bad stem")
    path = _job_dir(job_id) / "audio" / f"{stem}.mp3"
    if not path.exists():
        # Fall back to mix so the player always has something.
        path = _job_dir(job_id) / "audio" / "mix.mp3"
    if not path.exists():
        raise HTTPException(404, "audio not found")
    return FileResponse(path, media_type="audio/mpeg")


@app.get("/api/jobs/{job_id}/midi/{part}")
def midi_stub(job_id: str, part: str):
    # Tiny empty-ish MIDI header so the download link does not 404 during UI play.
    data = bytes([
        0x4D, 0x54, 0x68, 0x64, 0x00, 0x00, 0x00, 0x06, 0x00, 0x00, 0x00, 0x01, 0x00, 0x60,
        0x4D, 0x54, 0x72, 0x6B, 0x00, 0x00, 0x00, 0x04, 0x00, 0xFF, 0x2F, 0x00,
    ])
    from fastapi.responses import Response
    return Response(data, media_type="audio/midi",
                    headers={"Content-Disposition": f'attachment; filename="fixture-{part}.mid"'})


@app.get("/api/jobs/{job_id}/pdf")
def pdf_stub(job_id: str):
    raise HTTPException(501, "PDF export needs the full helper; use chord sheet / Print for formatting")


@app.middleware("http")
async def no_cache_frontend(request, call_next):
    response = await call_next(request)
    if not request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-cache"
    return response


app.mount("/", StaticFiles(directory=str(FRONTEND), html=True), name="frontend")


def main() -> None:
    if HOST != "127.0.0.1":
        raise SystemExit("fixture UI server must bind 127.0.0.1 only")
    JOBS.mkdir(parents=True, exist_ok=True)
    import uvicorn

    print(f"Music Scribe fixture UI → http://{HOST}:{PORT}/  (jobs={JOBS})", flush=True)
    uvicorn.run(app, host=HOST, port=PORT, log_level="info")


if __name__ == "__main__":
    main()

"""Privacy helpers: ephemeral job roots, localhost-only posture, clear-all."""
from __future__ import annotations

import os
import shutil
import tempfile
from pathlib import Path

SESSION_ENV = "BANDSCRIBE_DATA"
KEEP_ENV = "BANDSCRIBE_KEEP_JOBS"  # set to 1 to opt into durable disk jobs (not the default)


def ephemeral_root(repo_root: Path) -> Path:
    """Default job storage: OS temp session folder — not a durable `data/jobs` library.

    Opt out (developers only): BANDSCRIBE_KEEP_JOBS=1 and/or BANDSCRIBE_DATA=/path.
    """
    if os.environ.get(SESSION_ENV):
        return Path(os.environ[SESSION_ENV])
    base = Path(tempfile.gettempdir()) / "bandscribe-ephemeral"
    base.mkdir(parents=True, exist_ok=True)
    return base / "jobs"


def keep_jobs() -> bool:
    return os.environ.get(KEEP_ENV, "").strip() in ("1", "true", "yes")


def wipe_jobs(root: Path) -> int:
    """Delete every job directory under root. Returns how many were removed."""
    if not root.exists():
        return 0
    n = 0
    for child in list(root.iterdir()):
        if child.is_dir():
            shutil.rmtree(child, ignore_errors=True)
            n += 1
        elif child.is_file():
            child.unlink(missing_ok=True)
    return n


def privacy_info(root: Path) -> dict:
    return {
        "mode": "durable" if keep_jobs() or os.environ.get(SESSION_ENV) else "ephemeral",
        "jobs_root": str(root),
        "localhost_only": True,
        "cloud_upload": False,
        "accounts": False,
        "promise": (
            "Audio and results stay on this machine. The helper binds 127.0.0.1 only. "
            "Default storage is ephemeral (cleared on helper start and via Clear local data). "
            "Heavy ML (Demucs/Whisper/Basic Pitch) still runs in a local Python helper — "
            "not fully in-browser yet."
        ),
    }

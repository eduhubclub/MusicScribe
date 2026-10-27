"""Resolve repo / packaged resource roots and OS-specific Music Scribe user data."""
from __future__ import annotations

import os
import sys
from pathlib import Path


APP_NAME = "MusicScribe"


def frozen() -> bool:
    return bool(getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"))


def resource_root() -> Path:
    """Directory that contains `frontend/` and (in packs) the sidecar binary.

    Dev: repository root. Packaged: Electron `resources/` (or PyInstaller layout).
    Override with BANDSCRIBE_ROOT.
    """
    if os.environ.get("BANDSCRIBE_ROOT"):
        return Path(os.environ["BANDSCRIBE_ROOT"]).expanduser().resolve()
    if frozen():
        exe_dir = Path(sys.executable).resolve().parent
        for candidate in (exe_dir, exe_dir.parent, Path(sys._MEIPASS)):  # type: ignore[attr-defined]
            if (candidate / "frontend").is_dir():
                return candidate
        return exe_dir
    return Path(__file__).resolve().parents[2]


def frontend_dir() -> Path:
    if os.environ.get("BANDSCRIBE_FRONTEND"):
        return Path(os.environ["BANDSCRIBE_FRONTEND"]).expanduser().resolve()
    return resource_root() / "frontend"


def user_data_dir() -> Path:
    """macOS Application Support / Windows LocalAppData / Linux XDG config.

    Override with MUSICSCRIBE_USER_DATA.
    """
    if os.environ.get("MUSICSCRIBE_USER_DATA"):
        path = Path(os.environ["MUSICSCRIBE_USER_DATA"]).expanduser().resolve()
    elif sys.platform == "darwin":
        path = Path.home() / "Library" / "Application Support" / APP_NAME
    elif sys.platform == "win32":
        base = os.environ.get("LOCALAPPDATA") or str(Path.home() / "AppData" / "Local")
        path = Path(base) / APP_NAME
    else:
        base = os.environ.get("XDG_DATA_HOME") or str(Path.home() / ".local" / "share")
        path = Path(base) / APP_NAME
    path.mkdir(parents=True, exist_ok=True)
    return path


def model_cache_dir() -> Path:
    """Local model weights cache (Demucs / Whisper). Not shipped in the installer."""
    if os.environ.get("MUSICSCRIBE_MODEL_CACHE"):
        path = Path(os.environ["MUSICSCRIBE_MODEL_CACHE"]).expanduser().resolve()
    else:
        path = user_data_dir() / "models"
    path.mkdir(parents=True, exist_ok=True)
    return path


def apply_cache_env() -> Path:
    """Point torch hub / Hugging Face / Whisper caches at the Music Scribe user folder."""
    cache = model_cache_dir()
    torch_home = cache / "torch"
    hf_home = cache / "huggingface"
    whisper_home = cache / "whisper"
    for d in (torch_home, hf_home, whisper_home):
        d.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("TORCH_HOME", str(torch_home))
    os.environ.setdefault("HF_HOME", str(hf_home))
    os.environ.setdefault("HUGGINGFACE_HUB_CACHE", str(hf_home / "hub"))
    os.environ.setdefault("XDG_CACHE_HOME", str(cache / "xdg"))
    # faster-whisper download root
    os.environ.setdefault("MUSICSCRIBE_WHISPER_CACHE", str(whisper_home))
    return cache

"""First-run model download / status for the desktop app (lean installer)."""
from __future__ import annotations

import logging
import threading
from pathlib import Path
from typing import Any

from . import paths

log = logging.getLogger(__name__)

# Default Whisper size for first-run (matches frontend default).
DEFAULT_WHISPER = "small"
DEMUCS_NAME = "htdemucs_6s"

_state_lock = threading.Lock()
_download_state: dict[str, Any] = {
    "status": "idle",  # idle | running | done | error
    "step": "",
    "message": "",
    "progress": 0.0,
    "error": None,
}


def _set_state(**kwargs: Any) -> None:
    with _state_lock:
        _download_state.update(kwargs)


def download_status() -> dict[str, Any]:
    with _state_lock:
        snap = dict(_download_state)
    snap["models"] = status()
    return snap


def _demucs_cached() -> bool:
    """Heuristic: torch hub / demucs store already has htdemucs_6s weights."""
    import os

    cache = paths.model_cache_dir()
    torch_home = Path(os.environ.get("TORCH_HOME", str(cache / "torch")))
    patterns = [
        f"**/*{DEMUCS_NAME}*",
        "**/checkpoints/**",
        "hub/**/htdemucs*",
    ]
    roots = [
        torch_home,
        cache / "torch",
        Path.home() / ".cache" / "torch",
    ]
    for root in roots:
        if not root.exists():
            continue
        for pat in patterns:
            for p in root.glob(pat):
                if p.is_file() and p.stat().st_size > 1_000_000:
                    return True
                if p.is_dir():
                    for f in p.rglob("*"):
                        if f.is_file() and f.stat().st_size > 1_000_000:
                            return True
    return False


def _whisper_cached(size: str = DEFAULT_WHISPER) -> bool:
    import os

    cache = paths.model_cache_dir()
    candidates = [
        Path(os.environ.get("MUSICSCRIBE_WHISPER_CACHE", str(cache / "whisper"))),
        Path(os.environ.get("HF_HOME", str(cache / "huggingface"))) / "hub",
        Path.home() / ".cache" / "huggingface" / "hub",
        Path.home() / ".cache" / "whisper",
    ]
    needles = [size.replace(".", "-"), f"whisper-{size}", size]
    for root in candidates:
        if not root.exists():
            continue
        for needle in needles:
            for p in root.rglob("*"):
                name = p.name.lower()
                if needle.lower() in name and p.is_file() and p.stat().st_size > 1_000_000:
                    return True
                if p.is_dir() and needle.lower() in p.name.lower():
                    for f in p.rglob("*"):
                        if f.is_file() and f.stat().st_size > 1_000_000:
                            return True
    return False


def _basic_pitch_ok() -> bool:
    try:
        import basic_pitch

        model = Path(basic_pitch.__file__).parent / "saved_models" / "icassp_2022" / "nmp.onnx"
        return model.is_file() and model.stat().st_size > 100_000
    except Exception:
        return False


def status() -> dict[str, Any]:
    paths.apply_cache_env()
    demucs = _demucs_cached()
    whisper = _whisper_cached(DEFAULT_WHISPER)
    basic = _basic_pitch_ok()
    return {
        "cache_dir": str(paths.model_cache_dir()),
        "user_data_dir": str(paths.user_data_dir()),
        "demucs": {"name": DEMUCS_NAME, "ready": demucs},
        "whisper": {"name": DEFAULT_WHISPER, "ready": whisper},
        "basic_pitch": {"ready": basic, "bundled": True},
        "ready": demucs and whisper and basic,
    }


def _download_demucs() -> None:
    _set_state(step="demucs", message=f"Downloading {DEMUCS_NAME}…", progress=0.15)
    from demucs.pretrained import get_model

    model = get_model(DEMUCS_NAME)
    # Touch eval so weights are fully loaded into the cache.
    model.eval()
    _set_state(progress=0.55, message=f"{DEMUCS_NAME} ready")


def _download_whisper(size: str = DEFAULT_WHISPER) -> None:
    import os

    _set_state(step="whisper", message=f"Downloading Whisper ({size})…", progress=0.6)
    from faster_whisper import WhisperModel

    download_root = os.environ.get("MUSICSCRIBE_WHISPER_CACHE")
    kwargs: dict[str, Any] = {
        "device": "cpu",
        "compute_type": "int8",
        "cpu_threads": max(1, (os.cpu_count() or 4) // 2),
    }
    if download_root:
        kwargs["download_root"] = download_root
    # Constructing WhisperModel downloads weights if missing.
    WhisperModel(size, **kwargs)
    _set_state(progress=0.95, message=f"Whisper ({size}) ready")


def ensure_models(background: bool = True) -> dict[str, Any]:
    """Download missing models. If background, start a daemon thread and return immediately."""
    paths.apply_cache_env()
    current = status()
    if current["ready"]:
        _set_state(status="done", step="done", message="Models ready", progress=1.0, error=None)
        return download_status()

    with _state_lock:
        if _download_state["status"] == "running":
            return download_status()

    def run() -> None:
        _set_state(status="running", step="start", message="Preparing model cache…", progress=0.05, error=None)
        try:
            if not status()["demucs"]["ready"]:
                _download_demucs()
            else:
                _set_state(progress=0.55, message="Demucs already cached")
            if not status()["whisper"]["ready"]:
                _download_whisper(DEFAULT_WHISPER)
            else:
                _set_state(progress=0.95, message="Whisper already cached")
            if not _basic_pitch_ok():
                raise RuntimeError(
                    "Basic Pitch ONNX model missing from the install; reinstall Music Scribe."
                )
            _set_state(status="done", step="done", message="Models ready", progress=1.0, error=None)
        except Exception as exc:
            log.exception("model download failed")
            _set_state(status="error", message=str(exc), error=str(exc))

    if background:
        threading.Thread(target=run, daemon=True, name="musicscribe-models").start()
    else:
        run()
    return download_status()

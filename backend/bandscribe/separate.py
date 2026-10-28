"""Source separation with Demucs (htdemucs_6s: drums, bass, other, vocals, guitar, piano)."""
import logging
import shutil
from pathlib import Path

import numpy as np
import soundfile as sf

from .device import torch_device

log = logging.getLogger(__name__)
MODEL_NAME = "htdemucs_6s"
STEM_NAMES = ("drums", "bass", "other", "vocals", "guitar", "piano")
# User upload track_type → which Demucs-shaped stem receives the mix when skipping separation.
TRACK_TYPE_STEM = {
    "guitar": "guitar",
    "bass": "bass",
    "drums": "drums",
    "other": "other",
}
_model = None


def _get_model():
    global _model
    if _model is None:
        from demucs.pretrained import get_model

        _model = get_model(MODEL_NAME)
        _model.eval()
    return _model


def separate(wav_path: Path, out_dir: Path) -> tuple[dict[str, Path], str]:
    """Split a 44.1 kHz stereo wav into stems. Returns ({stem: path}, device_used)."""
    import torch
    from demucs.apply import apply_model

    model = _get_model()
    y, sr = sf.read(str(wav_path), dtype="float32", always_2d=True)
    if sr != model.samplerate:
        raise ValueError(f"expected {model.samplerate} Hz audio, got {sr}")
    wav = torch.from_numpy(np.ascontiguousarray(y.T))
    ref = wav.mean(0)
    mean, std = ref.mean(), ref.std() + 1e-8
    mix = ((wav - mean) / std)[None]

    device = torch_device()
    try:
        with torch.no_grad():
            sources = apply_model(model, mix, device=device, split=True, overlap=0.25)
    except Exception:
        if device == "cpu":
            raise
        log.exception("Demucs failed on %s, retrying on CPU", device)
        device = "cpu"
        with torch.no_grad():
            sources = apply_model(model, mix, device=device, split=True, overlap=0.25)

    sources = sources[0].cpu() * std + mean
    out_dir.mkdir(parents=True, exist_ok=True)
    paths = {}
    for name, src in zip(model.sources, sources):
        path = out_dir / f"{name}.wav"
        sf.write(str(path), src.numpy().T, sr, subtype="PCM_16")
        paths[name] = path
    return paths, device


def passthrough_stems(wav_path: Path, out_dir: Path, track_type: str) -> tuple[dict[str, Path], str]:
    """Skip Demucs: copy the mix into the stem matching track_type; write silent stubs for the rest.

    Downstream code keeps the same stem dict keys as htdemucs_6s.
    """
    role = TRACK_TYPE_STEM.get(track_type)
    if not role:
        raise ValueError(f"passthrough requires a stem track_type, got {track_type!r}")

    y, sr = sf.read(str(wav_path), dtype="float32", always_2d=True)
    out_dir.mkdir(parents=True, exist_ok=True)
    paths: dict[str, Path] = {}
    silent = np.zeros_like(y)
    for name in STEM_NAMES:
        path = out_dir / f"{name}.wav"
        if name == role:
            shutil.copy2(wav_path, path)
        else:
            sf.write(str(path), silent, sr, subtype="PCM_16")
        paths[name] = path
    return paths, "passthrough"

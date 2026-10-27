# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec for the Music Scribe localhost helper (run on macOS or Windows)."""
from __future__ import annotations

import sys
from pathlib import Path

from PyInstaller.utils.hooks import collect_all, collect_data_files, collect_submodules

SPECDIR = Path(SPECPATH)  # noqa: F821 — provided by PyInstaller
REPO = SPECDIR.parent
BACKEND = REPO / "backend"
FRONTEND = REPO / "frontend"

datas = [(str(FRONTEND), "frontend")]
binaries = []
hiddenimports = [
    "bandscribe",
    "bandscribe.server",
    "bandscribe.__main__",
    "uvicorn.logging",
    "uvicorn.loops",
    "uvicorn.loops.auto",
    "uvicorn.protocols",
    "uvicorn.protocols.http",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.websockets",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.lifespan",
    "uvicorn.lifespan.on",
]

# Optional heavy stacks — collect when present so the sidecar is self-contained.
for pkg in (
    "fastapi",
    "starlette",
    "uvicorn",
    "demucs",
    "torch",
    "torchaudio",
    "librosa",
    "sklearn",
    "faster_whisper",
    "ctranslate2",
    "onnxruntime",
    "basic_pitch",
    "av",
    "soundfile",
):
    try:
        d, b, h = collect_all(pkg)
        datas += d
        binaries += b
        hiddenimports += h
    except Exception:
        hiddenimports += collect_submodules(pkg)
        try:
            datas += collect_data_files(pkg)
        except Exception:
            pass

block_cipher = None

a = Analysis(  # noqa: F821
    [str(SPECDIR / "music_scribe_helper.py")],
    pathex=[str(BACKEND)],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)  # noqa: F821

exe = EXE(  # noqa: F821
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="music-scribe-helper",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(  # noqa: F821
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="music-scribe-helper",
)

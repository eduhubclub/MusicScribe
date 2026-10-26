"""Drum transcription from the Demucs drum stem: onsets in frequency bands -> kick / snare / hi-hat / crash."""
from pathlib import Path

import librosa
import numpy as np

from .tabs import SLOTS_PER_BEAT, slot_of

SR = 22050
HOP = 256
N_FFT = 1024
# (name, low Hz, high Hz, peak-pick threshold) — snare/hat deltas are strict to cut bleed FPs
BANDS = [
    ("kick", 30, 120, 0.10),
    ("snare", 1500, 5000, 0.16),  # the snare's noisy crack; higher delta vs kick bleed
    ("hihat", 7000, 11000, 0.10),
]
# Crash: energy must still be high ~CRASH_DELAY after the hit (closed hats are gone by then).
# Keep the delay under typical 8th-note spacing (~0.2s at 150 BPM) so the next hat is not counted.
CRASH_DELAY = 0.12
CRASH_RATIO = 0.35   # delayed energy vs peak at onset
CRASH_ABS = 0.10     # delayed energy vs band loud level — sustained *high* energy
MIN_LEVEL = 0.05     # ignore onsets quieter than this share of the band's loud level
# Same-onset window: drop snare that is only kick-band bleed (keep real kick+snare backbeats)
ONSET_MERGE_S = 0.05
# snare_band / kick_band at the frame — kick body alone is ~1e-4; real snare+kick is ~0.2+
SNARE_KICK_RATIO = 0.05
# Absolute floor vs the track's kick loudness — kills hat/kick bleed when no real snare exists
# (relative-to-snare-loud fails when the snare band's p99 is only bleed).
SNARE_VS_KICK_LOUD = 0.02
KICK_REL_MIN = 0.08  # kick band energy / loud; below this, no kick rival
LINES = [("CR", "crash", "x"), ("HH", "hihat", "x"), ("SD", "snare", "o"), ("BD", "kick", "o")]
COUNT = "1e+a2e+a3e+a4e+a"


def transcribe(path: Path) -> list[tuple[float, str]]:
    y, _ = librosa.load(str(path), sr=SR, mono=True)
    return transcribe_signal(y)


def transcribe_signal(y: np.ndarray, sr: int = SR) -> list[tuple[float, str]]:
    """Detect kick / snare / hi-hat / crash onsets from a mono drum signal."""
    if sr != SR:
        y = librosa.resample(y, orig_sr=sr, target_sr=SR)
    S = np.abs(librosa.stft(y, n_fft=N_FFT, hop_length=HOP)) ** 2
    freqs = librosa.fft_frequencies(sr=SR, n_fft=N_FFT)
    wait = int(0.06 * SR / HOP)
    delay = int(CRASH_DELAY * SR / HOP)
    band_energy: dict[str, np.ndarray] = {}
    band_loud: dict[str, float] = {}
    raw: list[tuple[float, str, float]] = []  # t, kind, relative band energy
    for name, lo, hi, delta in BANDS:
        energy = S[(freqs >= lo) & (freqs < hi)].sum(axis=0)
        band_energy[name] = energy
        env = np.log1p(energy / (np.percentile(energy, 99) + 1e-12) * 100)
        flux = np.maximum(0, np.diff(env, prepend=env[0]))
        flux /= flux.max() + 1e-9
        loud = float(np.percentile(energy, 99) + 1e-12)
        band_loud[name] = loud
        peaks = librosa.util.peak_pick(
            flux, pre_max=3, post_max=3, pre_avg=10, post_avg=10, delta=delta, wait=wait
        )
        for f in peaks:
            if energy[f] < MIN_LEVEL * loud:
                continue
            kind = name
            if name == "hihat":
                # Crash only when the high band is still loud after the closed-hat decay window.
                di = min(f + delay, len(energy) - 1)
                delayed = float(energy[di])
                if delayed > CRASH_RATIO * energy[f] and delayed > CRASH_ABS * loud:
                    kind = "crash"
            t = round(float(librosa.frames_to_time(f, sr=SR, hop_length=HOP)), 3)
            raw.append((t, kind, float(energy[f] / loud)))
    return _resolve_conflicts(raw, band_energy, band_loud)


def _resolve_conflicts(
    raw: list[tuple[float, str, float]],
    band_energy: dict[str, np.ndarray],
    band_loud: dict[str, float],
) -> list[tuple[float, str]]:
    """Suppress snare onsets that are only kick bleed; keep real kick+snare backbeats."""
    if not raw:
        return []
    raw = sorted(raw, key=lambda x: x[0])
    kicks = band_energy.get("kick")
    snares = band_energy.get("snare")
    kick_loud = band_loud.get("kick", 1.0)

    kept: list[tuple[float, str, float]] = []
    for hit in raw:
        t, kind, rel = hit
        if kind != "snare":
            kept.append(hit)
            continue
        if kicks is None or snares is None:
            kept.append(hit)
            continue
        frame = int(round(t * SR / HOP))
        frame = max(0, min(frame, len(kicks) - 1))
        kick_e = float(kicks[frame])
        snare_e = float(snares[frame])
        # Drop bleed that only looks loud relative to an empty snare band.
        if snare_e < SNARE_VS_KICK_LOUD * kick_loud:
            continue
        kick_rel = kick_e / kick_loud
        near_kick = kick_rel >= KICK_REL_MIN or any(
            kk == "kick" and abs(kt - t) <= ONSET_MERGE_S for kt, kk, _ in kept
        )
        if near_kick and snare_e < SNARE_KICK_RATIO * kick_e:
            continue  # mutual exclusion: kick onset without a real snare crack
        kept.append(hit)
    return sorted((t, k) for t, k, _ in kept)


def build_tab(hits: list[tuple[float, str]], beats: np.ndarray, measures: list[dict]) -> dict:
    """Drum tab on the 16th-note grid, one line per drum, with the count above each bar."""
    period = float(np.median(np.diff(beats))) if len(beats) > 1 else 0.5
    grid: dict[int, set[str]] = {}
    for t, kind in hits:
        grid.setdefault(slot_of(t, beats, period), set()).add(kind)

    out = []
    for m in measures:
        first = m["beat"] * SLOTS_PER_BEAT
        n = m["beats"] * SLOTS_PER_BEAT
        rows = ["".join(mark if kind in grid.get(first + j, ()) else "-" for j in range(n))
                for _, kind, mark in LINES]
        out.append({"beat": m["beat"], "chords": COUNT[:n].ljust(n + 1), "strings": [r + "|" for r in rows]})
    return {
        "string_names": [label for label, _, _ in LINES],
        "note_count": len(hits),
        "measures": out,
        "hits": [[t, k] for t, k in hits],
    }

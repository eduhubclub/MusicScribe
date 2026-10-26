"""Synthetic drum onset accuracy checks (librosa only — no Demucs).

Mirrors the appraisal false-snare/crash probe: 4-on-the-floor + closed hats,
optional backbeat snares, optional crash. Expects far fewer invented snares/crashes.
"""
from __future__ import annotations

import unittest
from collections import Counter

import numpy as np

from bandscribe import drums

SR = drums.SR


def _place(total: np.ndarray, t: float, clip: np.ndarray) -> None:
    i = int(t * SR)
    end = min(len(total), i + len(clip))
    total[i:end] += clip[: end - i]


def _band_noise(n: int, lo_hz: float, hi_hz: float, rng: np.random.Generator) -> np.ndarray:
    noise = rng.standard_normal(n)
    spec = np.fft.rfft(noise)
    freqs = np.fft.rfftfreq(n, 1 / SR)
    mask = (freqs >= lo_hz) & (freqs <= hi_hz)
    spec[~mask] *= 0.05
    return np.fft.irfft(spec, n)


def _kick(rng: np.random.Generator, amp: float = 0.9) -> np.ndarray:
    del rng  # deterministic body
    n = int(0.25 * SR)
    t = np.arange(n) / SR
    return (
        amp * np.sin(2 * np.pi * 60 * t) * np.exp(-t / 0.05)
        + 0.4 * amp * np.sin(2 * np.pi * 90 * t) * np.exp(-t / 0.03)
    )


def _snare(rng: np.random.Generator, amp: float = 0.7) -> np.ndarray:
    n = int(0.2 * SR)
    t = np.arange(n) / SR
    crack = _band_noise(n, 1500, 5000, rng)
    return (
        amp * 0.3 * np.sin(2 * np.pi * 180 * t) * np.exp(-t / 0.05)
        + amp * 0.9 * crack * np.exp(-t / 0.06)
    )


def _hat(rng: np.random.Generator, amp: float = 0.35, decay: float = 0.015) -> np.ndarray:
    n = int(0.1 * SR)
    t = np.arange(n) / SR
    return amp * _band_noise(n, 7000, 11000, rng) * np.exp(-t / decay)


def _crash(rng: np.random.Generator, amp: float = 0.6, decay: float = 0.5) -> np.ndarray:
    n = int(1.2 * SR)
    t = np.arange(n) / SR
    return amp * _band_noise(n, 6000, 11000, rng) * np.exp(-t / decay)


def _mix(
    *,
    bars: int = 2,
    bpm: float = 120.0,
    with_snare: bool = True,
    crash_at: float | None = None,
    seed: int = 0,
) -> tuple[np.ndarray, float, float]:
    """4-on-the-floor kicks, 8th-note closed hats, optional backbeat snares / crash.

    Returns (mono, onset_offset_s, beat_period_s).
    """
    rng = np.random.default_rng(seed)
    beat = 60.0 / bpm
    offset = 0.15
    dur = bars * 4 * beat + 0.8
    y = np.zeros(int(dur * SR))
    for b in range(bars * 4):
        t = offset + b * beat
        _place(y, t, _kick(rng))
        if with_snare and b % 2 == 1:
            _place(y, t, _snare(rng))
        _place(y, t, _hat(rng))
        _place(y, t + beat / 2, _hat(rng, amp=0.25))
    if crash_at is not None:
        _place(y, offset + crash_at, _crash(rng))
    y = y / (np.max(np.abs(y)) + 1e-9) * 0.9
    return y, offset, beat


def _counts(hits: list[tuple[float, str]]) -> Counter:
    return Counter(k for _, k in hits)


class DrumAccuracyTests(unittest.TestCase):
    def test_four_on_floor_no_false_snare_or_crash(self):
        # Appraisal probe: kicks + hats only → many false snares/crashes before the fix.
        y, _, _ = _mix(with_snare=False)
        hits = drums.transcribe_signal(y)
        c = _counts(hits)
        self.assertGreaterEqual(c["kick"], 6)
        self.assertGreaterEqual(c["hihat"], 12)
        self.assertEqual(c["snare"], 0, c)
        self.assertEqual(c["crash"], 0, c)

    def test_backbeat_keeps_real_snares_without_crash(self):
        y, offset, beat = _mix(with_snare=True)
        hits = drums.transcribe_signal(y)
        c = _counts(hits)
        self.assertGreaterEqual(c["kick"], 6)
        self.assertEqual(c["snare"], 4, c)
        self.assertEqual(c["crash"], 0, c)
        # Snares land near backbeats (odd beat indices), not on 1/3.
        snare_times = [t for t, k in hits if k == "snare"]
        for t in snare_times:
            idx = int(round((t - offset) / beat))
            self.assertEqual(idx % 2, 1, (t, idx, snare_times))

    def test_kick_snare_mutual_exclusion_on_kick_only_beats(self):
        y, offset, beat = _mix(with_snare=True)
        hits = drums.transcribe_signal(y)
        # No snare within the merge window of a kick-only beat (even index).
        for t, kind in hits:
            if kind != "kick":
                continue
            idx = int(round((t - offset) / beat))
            if idx % 2 != 0:
                continue
            near_snare = any(
                k == "snare" and abs(ts - t) <= drums.ONSET_MERGE_S for ts, k in hits
            )
            self.assertFalse(near_snare, (t, idx, hits))

    def test_crash_only_on_sustained_high_energy(self):
        y, offset, _ = _mix(with_snare=True, crash_at=0.0)
        hits = drums.transcribe_signal(y)
        c = _counts(hits)
        self.assertEqual(c["crash"], 1, c)
        self.assertEqual(c["snare"], 4, c)
        crash_t = next(t for t, k in hits if k == "crash")
        self.assertLess(abs(crash_t - offset), 0.08)

    def test_closed_hats_not_promoted_to_crash(self):
        y, _, _ = _mix(with_snare=True, crash_at=None)
        hits = drums.transcribe_signal(y)
        self.assertEqual(_counts(hits)["crash"], 0)


if __name__ == "__main__":
    unittest.main()

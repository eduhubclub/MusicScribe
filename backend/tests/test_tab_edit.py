"""Note/hit edit helpers rewrite notes and rebuild tabs without ML."""
import json
import sys
import tempfile
import types
import unittest
from pathlib import Path

# pipeline imports separate → torch; stub for unit tests without CUDA wheels.
if "torch" not in sys.modules:
    sys.modules["torch"] = types.ModuleType("torch")

from bandscribe import pipeline


class TabEditTests(unittest.TestCase):
    def _result(self):
        beats = [0.0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0]
        measures = [{"beat": i * 4, "beats": 4} for i in range(2)]
        return {
            "version": 2,
            "duration": 4.0,
            "key": {"tonic": "C", "mode": "major", "name": "C major"},
            "tempo": 120.0,
            "beats": beats,
            "measures": measures,
            "chords": [{"start": 0.0, "end": 4.0, "chord": "C"}],
            "lyrics": {"language": None, "lines": []},
            "tuning": {"name": "Standard", "strings": [40, 45, 50, 55, 59, 64], "capo": 0},
            "stems": ["guitar", "drums"],
            "parts": {
                "guitar": {"source": "guitar"},
                "drums": {"source": "drums"},
            },
        }

    def test_save_notes_retabs_guitar(self):
        with tempfile.TemporaryDirectory() as tmp:
            job = Path(tmp)
            result = self._result()
            notes = [
                {"start": 0.0, "end": 0.4, "pitch": 60, "amp": 0.9, "attack": 0.8},
                {"start": 0.5, "end": 0.9, "pitch": 64, "amp": 0.85, "attack": 0.7},
            ]
            out = pipeline.save_notes(job, result, "guitar", notes)
            saved = json.loads((job / "notes_guitar.json").read_text())
            self.assertEqual(len(saved), 2)
            self.assertEqual(out["parts"]["guitar"]["note_count"], 2)
            self.assertTrue(out["parts"]["guitar"]["measures"])

    def test_save_drum_hits_rebuilds_tab(self):
        with tempfile.TemporaryDirectory() as tmp:
            job = Path(tmp)
            result = self._result()
            hits = [[0.0, "kick"], [0.5, "snare"], [1.0, "kick"], [1.5, "snare"]]
            out = pipeline.save_drum_hits(job, result, hits)
            self.assertEqual(out["parts"]["drums"]["note_count"], 4)
            self.assertEqual(out["parts"]["drums"]["hits"], hits)
            # Toggle off snares
            kicks = [[t, k] for t, k in hits if k == "kick"]
            out2 = pipeline.save_drum_hits(job, result, kicks)
            self.assertEqual(out2["parts"]["drums"]["note_count"], 2)


if __name__ == "__main__":
    unittest.main()

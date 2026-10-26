"""Ghost-note filter unit tests (no Basic Pitch / Demucs)."""
import unittest

from bandscribe.tabs import is_ghost


class GhostFilterTests(unittest.TestCase):
    def test_hard_quiet_always_ghost(self):
        self.assertTrue(is_ghost({"start": 0, "end": 0.2, "pitch": 60, "amp": 0.2, "attack": 0.9}))

    def test_weak_attack_and_amp(self):
        self.assertTrue(is_ghost({"start": 0, "end": 0.2, "pitch": 60, "amp": 0.5, "attack": 0.2}))

    def test_short_quiet_ghost(self):
        self.assertTrue(is_ghost({"start": 0, "end": 0.05, "pitch": 60, "amp": 0.4, "attack": 0.8}))

    def test_strong_pluck_kept(self):
        self.assertFalse(is_ghost({"start": 0, "end": 0.25, "pitch": 60, "amp": 0.85, "attack": 0.7}))

    def test_missing_attack_defaults_to_pluck(self):
        # No attack field → assume articulated; only hard amp floor applies.
        self.assertFalse(is_ghost({"start": 0, "end": 0.2, "pitch": 60, "amp": 0.7}))


if __name__ == "__main__":
    unittest.main()

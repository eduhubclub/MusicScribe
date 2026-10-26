"""Confidence scoring uses real signals and never claims 100%."""
import unittest

from bandscribe import confidence


class ConfidenceTests(unittest.TestCase):
    def test_overall_below_one_and_has_sections(self):
        result = {
            "duration": 16.0,
            "beats": [0, 1, 2, 3, 4, 5, 6, 7, 8],
            "measures": [{"beat": 0, "beats": 4}, {"beat": 4, "beats": 4}],
            "chords": [
                {"start": 0, "end": 8, "chord": "C", "confidence": 0.8},
                {"start": 8, "end": 16, "chord": "G", "confidence": 0.4},
            ],
            "lyrics": {
                "lines": [
                    {"start": 0, "end": 4, "section": "Verse", "words": [
                        {"text": "a", "start": 0.0, "end": 0.5},
                        {"text": "b", "start": 0.5, "end": 1.0},
                    ]},
                    {"start": 8, "end": 12, "section": "Chorus", "stanza": True, "words": [
                        {"text": "c", "start": 8.0, "end": 8.5},
                    ]},
                ],
            },
            "parts": {
                "guitar": {"source": "piano", "source_fallback": True, "source_reason": "fallback",
                           "note_count": 10, "ghost_filtered": 20},
                "drums": {"hits": [[0, "kick"], [0.5, "snare"], [1, "kick"], [1.5, "snare"]],
                          "note_count": 4},
            },
        }
        conf = confidence.compute(result)
        self.assertLess(conf["overall"], 1.0)
        self.assertGreaterEqual(conf["overall"], 0.05)
        self.assertIn("chords", conf["by_part"])
        self.assertIn("guitar", conf["by_part"])
        self.assertLess(conf["by_part"]["guitar"], conf["by_part"]["chords"])
        self.assertGreaterEqual(len(conf["by_section"]), 2)
        self.assertTrue(any(s["score"] < 0.75 for s in conf["by_section"]))
        self.assertIn("disclaimer", conf)

    def test_empty_song_stays_low(self):
        conf = confidence.compute({"duration": 1.0, "chords": [], "lyrics": {"lines": []}, "parts": {}})
        self.assertLess(conf["overall"], 0.4)


if __name__ == "__main__":
    unittest.main()

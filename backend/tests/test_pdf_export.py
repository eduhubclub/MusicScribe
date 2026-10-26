"""PDF export builds a non-empty PDF from a minimal result blob."""
import unittest

from bandscribe import pdf_export


MINI = {
    "key": {"tonic": "C", "mode": "major", "name": "C major"},
    "tempo": 120.0,
    "duration": 8.0,
    "tuning": {"name": "Standard", "strings": [40, 45, 50, 55, 59, 64], "capo": 0},
    "chords": [
        {"start": 0.0, "end": 4.0, "chord": "C"},
        {"start": 4.0, "end": 8.0, "chord": "G"},
    ],
    "lyrics": {
        "language": "en",
        "lines": [
            {
                "start": 0.0,
                "end": 4.0,
                "section": "Verse",
                "words": [
                    {"text": "hello", "start": 0.0, "end": 1.0},
                    {"text": "world", "start": 1.0, "end": 2.0},
                ],
            }
        ],
    },
    "parts": {
        "guitar": {
            "source": "guitar",
            "tuning": "E A D G B E",
            "string_names": ["e ", "B ", "G ", "D ", "A ", "E "],
            "capo": 0,
            "note_count": 2,
            "measures": [
                {
                    "beat": 0,
                    "chords": "C               ",
                    "strings": [
                        "----------------|",
                        "----------------|",
                        "0---------------|",
                        "----------------|",
                        "----------------|",
                        "----------------|",
                    ],
                }
            ],
        }
    },
}


class PdfExportTests(unittest.TestCase):
    def test_pdf_has_header_and_size(self):
        data = pdf_export.build_pdf("Test Song", MINI, ["chords", "guitar"])
        self.assertTrue(data.startswith(b"%PDF"))
        self.assertGreater(len(data), 500)

    def test_parts_filter_skips_missing(self):
        data = pdf_export.build_pdf("Test Song", MINI, ["chords", "drums"])
        self.assertTrue(data.startswith(b"%PDF"))


if __name__ == "__main__":
    unittest.main()

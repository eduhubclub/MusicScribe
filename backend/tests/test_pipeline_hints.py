"""Upload pipeline hints: skip flags, passthrough stems, honest N/A confidence."""
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import numpy as np
import soundfile as sf

from bandscribe import confidence, lyrics, pipeline, separate


class PassthroughStemsTests(unittest.TestCase):
    def test_guitar_stem_copies_mix_and_silences_rest(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            mix = root / "mix.wav"
            # 0.2 s of tone at Demucs sample rate
            sr = 44100
            t = np.linspace(0, 0.2, int(sr * 0.2), endpoint=False)
            y = (0.2 * np.sin(2 * np.pi * 220 * t)).astype(np.float32)
            sf.write(str(mix), np.column_stack([y, y]), sr, subtype="PCM_16")
            stems, device = separate.passthrough_stems(mix, root / "stems", "guitar")
            self.assertEqual(device, "passthrough")
            self.assertEqual(set(stems), set(separate.STEM_NAMES))
            g, _ = sf.read(str(stems["guitar"]), dtype="float32")
            d, _ = sf.read(str(stems["drums"]), dtype="float32")
            self.assertGreater(float(np.sqrt(np.mean(g ** 2))), 0.01)
            self.assertLess(float(np.sqrt(np.mean(d ** 2))), 1e-4)


class LyricsPastedTests(unittest.TestCase):
    def test_lines_from_pasted_spreads_words(self):
        lines = lyrics.lines_from_pasted("Hello world\nSecond line here", duration=4.0)
        self.assertEqual(len(lines), 2)
        words = [w for ln in lines for w in ln["words"]]
        self.assertEqual([w["text"] for w in words], ["Hello", "world", "Second", "line", "here"])
        self.assertLess(words[0]["start"], words[-1]["start"])
        self.assertLessEqual(words[-1]["end"], 4.0 + 1e-6)


class ConfidenceSkipTests(unittest.TestCase):
    def test_instrumental_lyrics_are_na_not_fake_low(self):
        result = {
            "duration": 8.0,
            "beats": [0, 1, 2, 3, 4],
            "measures": [{"beat": 0, "beats": 4}],
            "chords": [{"start": 0, "end": 8, "chord": "C", "confidence": 0.7}],
            "lyrics": {"language": None, "lines": [], "asr_skipped": True, "skip_reason": "instrumental"},
            "pipeline_hints": {"asr_skipped": True, "skip_reason": "instrumental"},
            "parts": {"guitar": {"source": "guitar", "note_count": 8, "ghost_filtered": 1}},
        }
        conf = confidence.compute(result, {"guitar": [
            {"start": 0, "end": 0.5, "pitch": 60, "amp": 0.8},
        ]})
        self.assertIsNone(conf["by_part"]["lyrics"])
        self.assertTrue(any("skipped" in r for r in conf["part_reasons"]["lyrics"]))
        # Overall must not be pulled down by a fake 0.15 lyrics score
        self.assertGreater(conf["overall"], 0.3)
        self.assertNotIn(None, [v for k, v in conf["by_part"].items() if k != "lyrics"])

    def test_pasted_lyrics_also_na(self):
        result = {
            "duration": 4.0,
            "chords": [{"start": 0, "end": 4, "chord": "G", "confidence": 0.6}],
            "lyrics": {
                "asr_skipped": True,
                "skip_reason": "pasted_lyrics",
                "text": "hi there",
                "lines": [{"start": 0, "end": 1, "words": [
                    {"text": "hi", "start": 0.0, "end": 0.4},
                    {"text": "there", "start": 0.4, "end": 0.9},
                ]}],
            },
            "parts": {},
        }
        conf = confidence.compute(result)
        self.assertIsNone(conf["by_part"]["lyrics"])


class PipelineHintHelpersTests(unittest.TestCase):
    def test_track_type_defaults_and_validates(self):
        self.assertEqual(pipeline._track_type({}), "full")
        self.assertEqual(pipeline._track_type({"track_type": "GUITAR"}), "guitar")
        self.assertEqual(pipeline._track_type({"track_type": "nope"}), "full")

    def test_vocals_hint_parsing(self):
        self.assertIsNone(pipeline._truthy_vocals({}))
        self.assertTrue(pipeline._truthy_vocals({"has_vocals": True}))
        self.assertFalse(pipeline._truthy_vocals({"has_vocals": "false"}))
        self.assertFalse(pipeline._truthy_vocals({"has_vocals": "0"}))


class PipelineRunSkipTests(unittest.TestCase):
    def test_instrumental_and_stem_skip_whisper_and_demucs(self):
        with tempfile.TemporaryDirectory() as tmp:
            job = Path(tmp)
            src = job / "src.wav"
            sr = 44100
            t = np.linspace(0, 0.5, int(sr * 0.5), endpoint=False)
            y = (0.15 * np.sin(2 * np.pi * 110 * t)).astype(np.float32)
            sf.write(str(src), np.column_stack([y, y]), sr, subtype="PCM_16")

            fake_stems = {}
            for name in separate.STEM_NAMES:
                p = job / f"{name}.wav"
                if name == "guitar":
                    sf.write(str(p), np.column_stack([y, y]), sr, subtype="PCM_16")
                else:
                    sf.write(str(p), np.zeros((len(y), 2), dtype=np.float32), sr, subtype="PCM_16")
                fake_stems[name] = p

            with mock.patch.object(separate, "passthrough_stems", return_value=(fake_stems, "passthrough")) as passthrough, \
                 mock.patch.object(separate, "separate") as demucs, \
                 mock.patch.object(lyrics, "transcribe") as whisper, \
                 mock.patch.object(pipeline, "build_parts") as build:
                def _attach(job_dir, result, *a, **k):
                    result["parts"] = {"guitar": {"source": "guitar", "note_count": 1, "ghost_filtered": 0}}
                    result["confidence"] = confidence.compute(result)

                build.side_effect = _attach
                # Avoid heavy rhythm/chord work: stub after stems
                with mock.patch.object(pipeline, "_load", return_value=y), \
                     mock.patch("bandscribe.rhythm.track_beats", return_value=(120.0, np.array([0.0, 0.5]), 0.5)), \
                     mock.patch("bandscribe.chords.recognize", return_value={
                         "key": {"tonic": "A", "mode": "minor", "name": "A minor"},
                         "segments": [],
                         "beat_labels": ["A"] * 2,
                         "beat_confidence": [0.5, 0.5],
                     }), \
                     mock.patch("bandscribe.rhythm.downbeat_phase", return_value=0), \
                     mock.patch("bandscribe.rhythm.measures", return_value=[{"beat": 0, "beats": 2}]), \
                     mock.patch("bandscribe.audio.to_wav"), \
                     mock.patch("bandscribe.audio.to_mp3"):
                    result = pipeline.run(
                        job, src,
                        {"has_vocals": False, "track_type": "guitar", "whisper_model": "small", "language": ""},
                        lambda *a: None,
                    )

            demucs.assert_not_called()
            whisper.assert_not_called()
            passthrough.assert_called_once()
            self.assertTrue(result["lyrics"]["asr_skipped"])
            self.assertEqual(result["lyrics"]["skip_reason"], "instrumental")
            self.assertTrue(result["pipeline_hints"]["demucs_skipped"])
            self.assertIsNone(result["confidence"]["by_part"]["lyrics"])


if __name__ == "__main__":
    unittest.main()

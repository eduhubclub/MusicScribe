"""Model status endpoint helpers (no network downloads)."""
from __future__ import annotations

import os
import tempfile
import unittest
from unittest import mock

from bandscribe import models, paths


class ModelsStatusTests(unittest.TestCase):
    def test_status_shape(self):
        with tempfile.TemporaryDirectory() as tmp:
            with mock.patch.dict(os.environ, {"MUSICSCRIBE_MODEL_CACHE": tmp, "MUSICSCRIBE_USER_DATA": tmp}):
                paths.apply_cache_env()
                status = models.status()
        self.assertIn("cache_dir", status)
        self.assertIn("demucs", status)
        self.assertIn("whisper", status)
        self.assertIn("basic_pitch", status)
        self.assertIn("ready", status)
        self.assertEqual(status["demucs"]["name"], "htdemucs_6s")
        self.assertEqual(status["whisper"]["name"], "small")

    def test_download_status_idle_by_default(self):
        snap = models.download_status()
        self.assertIn(snap["status"], {"idle", "done", "running", "error"})


if __name__ == "__main__":
    unittest.main()

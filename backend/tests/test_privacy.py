"""Ephemeral job root and wipe helpers."""
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from bandscribe import privacy


class PrivacyTests(unittest.TestCase):
    def test_ephemeral_root_under_temp(self):
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("BANDSCRIBE_DATA", None)
            root = privacy.ephemeral_root(Path("/tmp/repo"))
        self.assertIn("bandscribe-ephemeral", str(root))

    def test_wipe_jobs(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "jobs"
            (root / "abc").mkdir(parents=True)
            (root / "abc" / "meta.json").write_text("{}")
            (root / "def").mkdir()
            self.assertEqual(privacy.wipe_jobs(root), 2)
            self.assertEqual(list(root.iterdir()), [])

    def test_privacy_info_flags(self):
        info = privacy.privacy_info(Path("/tmp/x"))
        self.assertFalse(info["cloud_upload"])
        self.assertFalse(info["accounts"])
        self.assertTrue(info["localhost_only"])


if __name__ == "__main__":
    unittest.main()

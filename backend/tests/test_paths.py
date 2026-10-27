"""OS user-data paths and localhost-only CLI guard."""
from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from bandscribe import paths
from bandscribe.__main__ import LOCAL_HOSTS, main


class PathsTests(unittest.TestCase):
    def test_model_cache_respects_override(self):
        with tempfile.TemporaryDirectory() as tmp:
            with mock.patch.dict(os.environ, {"MUSICSCRIBE_MODEL_CACHE": tmp}, clear=False):
                cache = paths.model_cache_dir()
            self.assertEqual(cache, Path(tmp).resolve())
            self.assertTrue(cache.is_dir())

    def test_user_data_override(self):
        with tempfile.TemporaryDirectory() as tmp:
            with mock.patch.dict(os.environ, {"MUSICSCRIBE_USER_DATA": tmp}, clear=False):
                root = paths.user_data_dir()
            self.assertEqual(root, Path(tmp).resolve())

    def test_apply_cache_env_sets_torch_and_hf(self):
        with tempfile.TemporaryDirectory() as tmp:
            with mock.patch.dict(
                os.environ,
                {"MUSICSCRIBE_MODEL_CACHE": tmp},
                clear=False,
            ):
                for key in ("TORCH_HOME", "HF_HOME", "MUSICSCRIBE_WHISPER_CACHE"):
                    os.environ.pop(key, None)
                cache = paths.apply_cache_env()
                self.assertEqual(cache, Path(tmp).resolve())
                self.assertTrue(os.environ["TORCH_HOME"].startswith(str(cache)))
                self.assertTrue(os.environ["HF_HOME"].startswith(str(cache)))
                self.assertTrue(os.environ["MUSICSCRIBE_WHISPER_CACHE"].startswith(str(cache)))


class MainHostGuardTests(unittest.TestCase):
    def test_localhost_hosts_allowed(self):
        self.assertIn("127.0.0.1", LOCAL_HOSTS)

    def test_refuses_non_localhost(self):
        with self.assertRaises(SystemExit) as ctx:
            main(["--host", "0.0.0.0", "--port", "8765"])
        self.assertEqual(ctx.exception.code, 2)


if __name__ == "__main__":
    unittest.main()

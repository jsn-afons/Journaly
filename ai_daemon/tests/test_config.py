import os
import unittest
from pathlib import Path
from unittest import mock

from ai_daemon.core.config import DaemonConfig


class ConfigTests(unittest.TestCase):
    def test_journal_directory_follows_rust_supplied_env(self):
        with mock.patch.dict(os.environ, {"JOURNALY_JOURNAL_DIR": "/somewhere/Journal"}):
            self.assertEqual(DaemonConfig().journal_directory, Path("/somewhere/Journal"))

    def test_journal_directory_defaults_to_cwd_journal(self):
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("JOURNALY_JOURNAL_DIR", None)
            self.assertEqual(DaemonConfig().journal_directory, Path.cwd() / "Journal")

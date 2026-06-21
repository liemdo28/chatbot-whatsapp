"""Tests for first_run_wizard config logic (no Tk window)."""
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "desktop-app"))


class TestFirstRunWizardHelpers(unittest.TestCase):
    def test_needs_wizard_when_no_config(self):
        with patch("ui.first_run_wizard._load_config", return_value={}):
            from ui.first_run_wizard import needs_first_run_wizard
            self.assertTrue(needs_first_run_wizard())

    def test_needs_wizard_when_mi_core_disabled(self):
        with patch("ui.first_run_wizard._load_config", return_value={"mi_core": {"enabled": False}}):
            from ui.first_run_wizard import needs_first_run_wizard
            self.assertTrue(needs_first_run_wizard())

    def test_needs_wizard_when_localhost_url(self):
        with patch("ui.first_run_wizard._load_config", return_value={
            "mi_core": {"enabled": True, "base_url": "http://localhost:3456"},
            "machine": {"machine_id": "m1"},
        }):
            from ui.first_run_wizard import needs_first_run_wizard
            self.assertTrue(needs_first_run_wizard())

    def test_no_wizard_when_fully_configured(self):
        with patch("ui.first_run_wizard._load_config", return_value={
            "mi_core": {"enabled": True, "base_url": "http://100.1.2.3:3456"},
            "machine": {"machine_id": "qb-laptop-01"},
        }):
            from ui.first_run_wizard import needs_first_run_wizard
            self.assertFalse(needs_first_run_wizard())

    def test_write_env_key_creates_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            env_path = Path(tmp) / ".env"
            from ui.first_run_wizard import _write_env_key
            _write_env_key(env_path, "MI_CORE_API_KEY", "secret123")
            content = env_path.read_text()
            self.assertIn("MI_CORE_API_KEY=secret123", content)

    def test_write_env_key_updates_existing(self):
        with tempfile.TemporaryDirectory() as tmp:
            env_path = Path(tmp) / ".env"
            env_path.write_text("MI_CORE_API_KEY=old\nOTHER=val\n")
            from ui.first_run_wizard import _write_env_key
            _write_env_key(env_path, "MI_CORE_API_KEY", "new-key")
            content = env_path.read_text()
            self.assertIn("MI_CORE_API_KEY=new-key", content)
            self.assertNotIn("old", content)
            self.assertIn("OTHER=val", content)


if __name__ == "__main__":
    unittest.main()

"""
test_one_click_installer.py
============================
Verifies installer artifacts and feature flag defaults for a clean install.
"""
import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "desktop-app"))


class TestInstallerArtifacts(unittest.TestCase):
    def test_iss_script_exists(self):
        self.assertTrue((REPO_ROOT / "installer" / "ToastPOSManager.iss").exists())

    def test_build_script_exists(self):
        self.assertTrue((REPO_ROOT / "installer" / "build_installer.ps1").exists())

    def test_iss_launches_first_run_wizard(self):
        iss = (REPO_ROOT / "installer" / "ToastPOSManager.iss").read_text()
        self.assertIn("--first-run", iss)

    def test_iss_creates_scheduled_task_at_logon(self):
        iss = (REPO_ROOT / "installer" / "ToastPOSManager.iss").read_text()
        self.assertIn("ONLOGON", iss)
        self.assertIn("ToastPOSManager-Background", iss)

    def test_iss_has_uninstall_cleanup(self):
        iss = (REPO_ROOT / "installer" / "ToastPOSManager.iss").read_text()
        self.assertIn("[UninstallRun]", iss)
        self.assertIn("/Delete", iss)

    def test_build_script_checks_for_iscc(self):
        ps1 = (REPO_ROOT / "installer" / "build_installer.ps1").read_text()
        self.assertIn("ISCC", ps1)

    def test_agent_installer_registers_hidden_task(self):
        ps1 = (REPO_ROOT / "installer" / "install-agent.ps1").read_text()
        self.assertIn("<Hidden>true</Hidden>", ps1)
        self.assertIn("pythonw.exe", ps1)

    def test_laptop2_template_uses_c_qb_path(self):
        template = REPO_ROOT / "desktop-app" / "config-templates" / "laptop-02-local-config.json"
        raw = template.read_text(encoding="utf-8")
        cfg = json.loads(raw)

        self.assertNotIn("REPLACE_WITH_ACTUAL_PATH", raw)
        self.assertEqual(cfg["quickbooks"]["company_file"], "C:\\QB\\StoneOak.qbw")
        self.assertEqual(cfg["qbw_paths"]["Stone Oak"], "C:\\QB\\StoneOak.qbw")
        self.assertIn("C:\\QB", cfg["quickbooks_files"]["scan_roots"])
        self.assertFalse(cfg["features"]["qb_write_sync_enabled"])
        self.assertFalse(cfg["auto_sync"]["enabled"])
        self.assertEqual(cfg["auto_sync"]["stores"], ["Stone Oak"])


class TestFirstRunConfig(unittest.TestCase):
    def test_first_run_wizard_module_exists(self):
        self.assertTrue((REPO_ROOT / "desktop-app" / "ui" / "first_run_wizard.py").exists())

    def test_default_config_write_sync_off(self):
        """After first run, QB write sync must be OFF."""
        with patch("services.feature_flags._load_flags", return_value={}):
            from services.feature_flags import qb_write_sync_enabled
            self.assertFalse(qb_write_sync_enabled())

    def test_default_config_read_log_on(self):
        """After first run, QB read-only log must be ON."""
        with patch("services.feature_flags._load_flags", return_value={}):
            from services.feature_flags import qb_read_only_activity_log_enabled
            self.assertTrue(qb_read_only_activity_log_enabled())

    def test_startup_task_command_in_installer(self):
        """Installer must reference background EXE for startup task."""
        iss = (REPO_ROOT / "installer" / "ToastPOSManager.iss").read_text()
        self.assertIn("Background", iss)


if __name__ == "__main__":
    unittest.main()

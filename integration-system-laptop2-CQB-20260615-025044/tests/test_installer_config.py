"""Tests that verify installer artifacts exist and are correctly structured."""
import sys
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent


class TestInstallerArtifacts(unittest.TestCase):
    def test_iss_file_exists(self):
        iss = REPO_ROOT / "installer" / "ToastPOSManager.iss"
        self.assertTrue(iss.exists(), f"ISS file not found: {iss}")

    def test_build_installer_script_exists(self):
        ps1 = REPO_ROOT / "installer" / "build_installer.ps1"
        self.assertTrue(ps1.exists(), f"build_installer.ps1 not found: {ps1}")

    def test_iss_has_app_name(self):
        iss = REPO_ROOT / "installer" / "ToastPOSManager.iss"
        content = iss.read_text()
        self.assertIn("ToastPOSManager", content)

    def test_iss_has_scheduled_task_creation(self):
        iss = REPO_ROOT / "installer" / "ToastPOSManager.iss"
        content = iss.read_text()
        self.assertIn("schtasks", content)
        self.assertIn("ToastPOSManager-Background", content)

    def test_iss_has_uninstall_cleanup(self):
        iss = REPO_ROOT / "installer" / "ToastPOSManager.iss"
        content = iss.read_text()
        self.assertIn("[UninstallRun]", content)

    def test_iss_has_first_run_launch(self):
        iss = REPO_ROOT / "installer" / "ToastPOSManager.iss"
        content = iss.read_text()
        self.assertIn("--first-run", content)

    def test_build_script_references_iscc(self):
        ps1 = REPO_ROOT / "installer" / "build_installer.ps1"
        content = ps1.read_text()
        self.assertIn("ISCC", content)
        self.assertIn("Inno Setup", content)


if __name__ == "__main__":
    unittest.main()

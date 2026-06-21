"""
test_project_scope_separation.py
==================================
Verifies that QB write sync and QB read-only logging are correctly separated
via feature flags. Default install must be read-only.
"""
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "desktop-app"))


class TestFeatureDefaults(unittest.TestCase):
    def test_write_sync_off_by_default(self):
        with patch("services.feature_flags._load_flags", return_value={}):
            from services.feature_flags import qb_write_sync_enabled
            self.assertFalse(qb_write_sync_enabled())

    def test_read_only_log_on_by_default(self):
        with patch("services.feature_flags._load_flags", return_value={}):
            from services.feature_flags import qb_read_only_activity_log_enabled
            self.assertTrue(qb_read_only_activity_log_enabled())

    def test_mi_core_reporting_on_by_default(self):
        with patch("services.feature_flags._load_flags", return_value={}):
            from services.feature_flags import mi_core_reporting_enabled
            self.assertTrue(mi_core_reporting_enabled())

    def test_12h_sync_on_by_default(self):
        with patch("services.feature_flags._load_flags", return_value={}):
            from services.feature_flags import multi_file_12h_sync_enabled
            self.assertTrue(multi_file_12h_sync_enabled())

    def test_write_sync_can_be_enabled_explicitly(self):
        with patch("services.feature_flags._load_flags", return_value={"qb_write_sync_enabled": True}):
            from services.feature_flags import qb_write_sync_enabled
            self.assertTrue(qb_write_sync_enabled())

    def test_read_only_can_be_disabled(self):
        with patch("services.feature_flags._load_flags", return_value={"qb_read_only_activity_log_enabled": False}):
            from services.feature_flags import qb_read_only_activity_log_enabled
            self.assertFalse(qb_read_only_activity_log_enabled())


class TestScopeFiles(unittest.TestCase):
    """Verify scope file separation exists."""

    REPO_ROOT = Path(__file__).resolve().parent.parent

    def test_qb_write_files_exist(self):
        """QB write/import files must exist (qb_sync.py, qb_client.py)."""
        self.assertTrue((self.REPO_ROOT / "desktop-app" / "qb_sync.py").exists())
        self.assertTrue((self.REPO_ROOT / "desktop-app" / "qb_client.py").exists())

    def test_qb_read_only_service_exists(self):
        svc = self.REPO_ROOT / "desktop-app" / "services" / "qb_activity_log_service.py"
        self.assertTrue(svc.exists())

    def test_qb_activity_queries_exists(self):
        q = self.REPO_ROOT / "desktop-app" / "services" / "qb_activity_queries.py"
        self.assertTrue(q.exists())

    def test_feature_flags_service_exists(self):
        ff = self.REPO_ROOT / "desktop-app" / "services" / "feature_flags.py"
        self.assertTrue(ff.exists())

    def test_local_config_example_has_features_section(self):
        cfg_path = self.REPO_ROOT / "desktop-app" / "local-config.example.json"
        with open(cfg_path) as f:
            cfg = json.load(f)
        self.assertIn("features", cfg)
        self.assertFalse(cfg["features"]["qb_write_sync_enabled"])
        self.assertTrue(cfg["features"]["qb_read_only_activity_log_enabled"])


if __name__ == "__main__":
    unittest.main()

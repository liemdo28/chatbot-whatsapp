"""Tests for backward compatibility: old agent_coding config still works."""
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "desktop-app"))


class TestBackwardCompatibility(unittest.TestCase):
    def test_machine_identity_reads_mi_core_url(self):
        config = {"mi_core": {"enabled": True, "base_url": "http://micore:3456"},
                  "machine": {"machine_id": "m1", "machine_name": "Test", "store_code": "s1"}}
        with patch("services.machine_identity_service._load_local_config", return_value=config):
            import services.machine_identity_service as svc
            url = svc.get_base_url()
        self.assertEqual(url, "http://micore:3456")

    def test_machine_identity_reads_agent_coding_url(self):
        config = {"agent_coding": {"enabled": True, "base_url": "http://legacy:3456"},
                  "machine": {"machine_id": "m1", "machine_name": "Test", "store_code": "s1"}}
        with patch("services.machine_identity_service._load_local_config", return_value=config):
            import services.machine_identity_service as svc
            url = svc.get_base_url()
        self.assertEqual(url, "http://legacy:3456")

    def test_mi_core_overrides_agent_coding(self):
        config = {
            "mi_core": {"enabled": True, "base_url": "http://new:3456"},
            "agent_coding": {"enabled": True, "base_url": "http://old:3456"},
            "machine": {"machine_id": "m1"},
        }
        with patch("services.machine_identity_service._load_local_config", return_value=config):
            import services.machine_identity_service as svc
            url = svc.get_base_url()
        self.assertEqual(url, "http://new:3456")

    def test_is_enabled_with_agent_coding(self):
        config = {"agent_coding": {"enabled": True, "base_url": "http://legacy:3456"}}
        clean_env = {k: v for k, v in os.environ.items() if k not in ("MI_CORE_API_KEY", "AGENT_CODING_API_KEY")}
        clean_env["AGENT_CODING_API_KEY"] = "key123"
        with patch("services.machine_identity_service._load_local_config", return_value=config):
            with patch.dict(os.environ, clean_env, clear=True):
                import services.machine_identity_service as svc
                self.assertTrue(svc.is_agent_coding_enabled())

    def test_get_api_key_accepts_both_env_vars(self):
        import services.machine_identity_service as svc
        clean = {k: v for k, v in os.environ.items() if k not in ("MI_CORE_API_KEY", "AGENT_CODING_API_KEY")}
        clean["MI_CORE_API_KEY"] = "mi-key"
        with patch.dict(os.environ, clean, clear=True):
            self.assertEqual(svc.get_api_key(), "mi-key")

        clean2 = {k: v for k, v in os.environ.items() if k not in ("MI_CORE_API_KEY", "AGENT_CODING_API_KEY")}
        clean2["AGENT_CODING_API_KEY"] = "ac-key"
        with patch.dict(os.environ, clean2, clear=True):
            self.assertEqual(svc.get_api_key(), "ac-key")


if __name__ == "__main__":
    unittest.main()

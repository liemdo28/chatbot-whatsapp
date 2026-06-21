"""
feature_flags.py
=================
Central feature flag service for integration-system.

Controls which operational mode the app runs in:

  QB_WRITE_SYNC (default OFF)
    - Import Sales Receipts into QB
    - Import credit card expenses into QB
    - Toast report sync into QB
    - Any QBXML AddRq / ModRq / DelRq

  QB_READ_ONLY_ACTIVITY_LOG (default ON)
    - Read latest Sales Receipt date
    - Read latest bank transaction date
    - Read latest reconcile date
    - Read invoice/payment/deposit/journal/bill activity
    - Generate log/timeline per store/date
    - ZERO writes to QB

  MI_CORE_REPORTING (default ON)
    - Heartbeat to Mi-core
    - Push activity log result to Mi-core
    - Push timeline result to Mi-core
    - Remote commands from Mi-core

  MULTI_FILE_12H_SYNC (default ON)
    - Schedule 12-hour multi-file QB sync

CEO requirement:
  Default installed app must run read-only logging/reporting.
  Write/import mode is OFF unless explicitly enabled by CEO.
"""
from __future__ import annotations

import json
import logging
from pathlib import Path
from json_file_utils import load_json_file

logger = logging.getLogger("feature_flags")

try:
    from app_paths import RUNTIME_DIR
except ImportError:
    RUNTIME_DIR = Path(__file__).resolve().parent.parent

LOCAL_CONFIG_PATH = RUNTIME_DIR / "local-config.json"

# ── Defaults ─────────────────────────────────────────────────────────────────
DEFAULTS = {
    "qb_write_sync_enabled": False,          # OFF by default — CEO must enable
    "qb_read_only_activity_log_enabled": True,  # ON by default
    "mi_core_reporting_enabled": True,          # ON by default
    "multi_file_12h_sync_enabled": True,        # ON by default
}


def _load_flags() -> dict:
    try:
        if LOCAL_CONFIG_PATH.exists():
            cfg = load_json_file(LOCAL_CONFIG_PATH)
            return cfg.get("features", {})
    except Exception:
        pass
    return {}


def get_flags() -> dict:
    """Return merged feature flags (defaults + config overrides)."""
    flags = DEFAULTS.copy()
    flags.update(_load_flags())
    return flags


def is_enabled(flag: str) -> bool:
    """Check if a specific feature flag is enabled."""
    return get_flags().get(flag, DEFAULTS.get(flag, False))


def qb_write_sync_enabled() -> bool:
    """QB write/import mode — OFF by default."""
    return is_enabled("qb_write_sync_enabled")


def qb_read_only_activity_log_enabled() -> bool:
    """QB read-only activity log mode — ON by default."""
    return is_enabled("qb_read_only_activity_log_enabled")


def mi_core_reporting_enabled() -> bool:
    """Mi-core reporting mode — ON by default."""
    return is_enabled("mi_core_reporting_enabled")


def multi_file_12h_sync_enabled() -> bool:
    """Multi-file 12h sync scheduler — ON by default."""
    return is_enabled("multi_file_12h_sync_enabled")


def log_active_features() -> None:
    flags = get_flags()
    logger.info("=== Feature Flags ===")
    for key, val in flags.items():
        status = "ON" if val else "OFF"
        logger.info("  %s: %s", key, status)
    if flags.get("qb_write_sync_enabled"):
        logger.warning("QB WRITE SYNC is ENABLED — QB data will be modified!")
    logger.info("=====================")

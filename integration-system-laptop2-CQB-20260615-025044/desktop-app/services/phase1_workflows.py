"""Phase 1 workflow entrypoints for remote Mi-Core commands."""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger("phase1_workflows")


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def runAllPhase1Workflows(*, mi_core_client=None, auto_sync_scheduler=None) -> dict[str, Any]:
    """
    Run the canonical Phase 1 QB sync workflow.

    The historical remote command contract names this camelCase function. In
    this Python agent the concrete sync entrypoint is the multi-file QB cycle.
    """
    started_at = _utc_now()
    try:
        try:
            from services.qb_multi_file_sync_scheduler import run_cycle_now
        except Exception:
            from qb_multi_file_sync_scheduler import run_cycle_now

        cycle_result = run_cycle_now(mi_core_client=mi_core_client)
        return {
            "ok": True,
            "workflow": "qb_multi_file_sync",
            "started_at": started_at,
            "finished_at": _utc_now(),
            "result": cycle_result,
        }
    except Exception as exc:
        logger.warning("Multi-file Phase 1 sync failed: %s", exc)

    if auto_sync_scheduler is None:
        raise RuntimeError("No Phase 1 sync workflow is available")

    status = auto_sync_scheduler.trigger_now()
    return {
        "ok": True,
        "workflow": "auto_report_sync",
        "started_at": started_at,
        "finished_at": _utc_now(),
        "status": getattr(status, "status", ""),
        "message": getattr(status, "message", ""),
    }


def run_all_phase1_workflows(*, mi_core_client=None, auto_sync_scheduler=None) -> dict[str, Any]:
    """Snake-case alias for Python callers."""
    return runAllPhase1Workflows(
        mi_core_client=mi_core_client,
        auto_sync_scheduler=auto_sync_scheduler,
    )

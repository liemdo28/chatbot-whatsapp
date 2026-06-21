"""
tests/test_update_scheduler.py
Tests for update_scheduler.py — 12h check interval, manual check, callbacks.
"""
import sys
import tempfile
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).parent.parent / "desktop-app"))

from services.update_scheduler import UpdateScheduler
from services.update_client import UpdateCheckResult


def _make_check_result(update_available=False, version="1.2.0", latest="1.2.0"):
    return UpdateCheckResult(
        update_available=update_available,
        current_version=version,
        latest_version=latest,
        manifest=None,
        checked_at="2026-06-09T09:00:00Z",
    )


def test_check_now_no_update():
    mock_client = MagicMock()
    scheduler = UpdateScheduler(mi_core_client=mock_client)

    with tempfile.TemporaryDirectory() as tmp:
        scheduler._state.__class__  # access state
        with patch("services.update_scheduler.STATE_FILE", Path(tmp) / "state.json"), \
             patch("services.update_client.check_for_updates",
                   return_value=_make_check_result(False, "1.2.0", "1.2.0")), \
             patch.object(scheduler, "_report_event"):
            result = scheduler.check_now()

    assert result["update_available"] is False
    assert scheduler._state.update_available is False


def test_check_now_fires_callback_when_update_available():
    mock_client = MagicMock()
    callback_called = []

    def on_update(result):
        callback_called.append(result)

    scheduler = UpdateScheduler(
        mi_core_client=mock_client,
        on_update_available=on_update,
    )

    with tempfile.TemporaryDirectory() as tmp:
        with patch("services.update_scheduler.STATE_FILE", Path(tmp) / "state.json"), \
             patch("services.update_client.check_for_updates",
                   return_value=_make_check_result(True, "1.2.0", "1.3.0")), \
             patch.object(scheduler, "_report_event"):
            scheduler.check_now()

    assert len(callback_called) == 1
    assert callback_called[0].update_available is True


def test_12h_scheduler_interval_set():
    scheduler = UpdateScheduler()
    assert scheduler._interval == 12 * 3600


def test_manual_update_command_works():
    """check_now() can be called without scheduler running."""
    mock_client = MagicMock()
    scheduler = UpdateScheduler(mi_core_client=mock_client)

    with tempfile.TemporaryDirectory() as tmp:
        with patch("services.update_scheduler.STATE_FILE", Path(tmp) / "state.json"), \
             patch("services.update_client.check_for_updates",
                   return_value=_make_check_result(True, "1.2.0", "1.3.0")), \
             patch.object(scheduler, "_report_event") as mock_report:
            result = scheduler.check_now()

    assert result["update_available"] is True
    # Should report UPDATE_CHECKED and UPDATE_AVAILABLE
    report_calls = [c[0][0] for c in mock_report.call_args_list]
    assert "UPDATE_CHECKED" in report_calls
    assert "UPDATE_AVAILABLE" in report_calls


def test_update_event_sent_to_mi_core():
    mock_client = MagicMock()
    scheduler = UpdateScheduler(mi_core_client=mock_client)

    with tempfile.TemporaryDirectory() as tmp:
        with patch("services.update_scheduler.STATE_FILE", Path(tmp) / "state.json"), \
             patch("services.update_client.check_for_updates",
                   return_value=_make_check_result(False)), \
             patch("services.machine_identity_service.get_machine_identity",
                   return_value="qb-laptop-01"):
            scheduler.check_now()

    mock_client.post.assert_called()

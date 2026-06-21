from __future__ import annotations

import pytest

from services.toast_browser_agent import ToastBrowserTask, assert_task_is_safe, build_browser_use_task


def test_browser_use_task_contains_safety_constraints(tmp_path):
    task = ToastBrowserTask(
        store="Bandera",
        business_date="2026-06-10",
        report_type="orders",
        download_dir=tmp_path,
    )

    text = build_browser_use_task(task)

    assert "Do not change settings" in text
    assert "Do not store passwords" in text
    assert "HUMAN_REQUIRED" in text
    assert_task_is_safe(text)


def test_forbidden_action_guard_exists():
    with pytest.raises(ValueError):
        assert_task_is_safe("Navigate to Toast and delete reports")

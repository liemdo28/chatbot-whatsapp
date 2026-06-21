from __future__ import annotations

from datetime import date

from app import _get_nav_order
from services.ui_state_service import get_nav_theme
from ui.toast_download_panel import _previous_business_day


def test_toast_download_nav_visible_for_standard_and_admin():
    assert "toast_download" in _get_nav_order("standard")
    assert "toast_download" in _get_nav_order("admin")
    assert "toast_download" in get_nav_theme()


def test_previous_business_day_skips_weekend():
    assert _previous_business_day(date(2026, 6, 8)) == "2026-06-05"
    assert _previous_business_day(date(2026, 6, 10)) == "2026-06-09"

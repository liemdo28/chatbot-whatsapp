from __future__ import annotations

from services.toast_browser_agent import STATUS_HUMAN_REQUIRED
from services import toast_human_handoff


def test_human_handoff_persists_and_can_mark_login_completed(monkeypatch, tmp_path):
    handoff_file = tmp_path / "toast-human-handoff.json"
    monkeypatch.setattr(toast_human_handoff, "HANDOFF_FILE", handoff_file)

    payload = toast_human_handoff.create_handoff(
        reason="MFA required",
        store="Bandera",
        business_date="2026-06-10",
        report_type="orders",
    )
    assert payload["status"] == STATUS_HUMAN_REQUIRED
    assert handoff_file.exists()

    completed = toast_human_handoff.mark_login_completed()
    assert completed["status"] == "LOGIN_COMPLETED"
    assert completed["operator_confirmed_at"]

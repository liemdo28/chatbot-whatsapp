"""
ToastPOSManager — Home Dashboard Tab

The default first tab. Replaces or complements the old QB tab.

Sections
-------
  1. Hero Welcome        — greeting + app version + safe-mode indicator
  2. Today's Readiness  — 2×2 grid of StatusBadges for the 4 core features
  3. Quick Actions      — ActionCard row (Download / QB Sync / Recovery)
  4. Recommended Next Step — RecommendedNextStep widget
  5. Safe Mode Banner   — amber bar when safe mode is active

Navigation via status_var
-------------------------
Caller sets status_var to trigger tab switches:
  "navigate:download"  → Download Reports tab
  "navigate:qb"        → QB Sync tab
  "navigate:settings"  → Settings / Recovery tab

Usage:
    from ui.home_dashboard import HomeDashboard

    dashboard = HomeDashboard(tab_parent, status_var=nav_var)
    dashboard.pack(fill="both", expand=True)
"""

from __future__ import annotations

import json
import logging
import sys
from datetime import datetime
from pathlib import Path
from typing import Optional

# ---------------------------------------------------------------------------
# CTK import with graceful fallback
# ---------------------------------------------------------------------------
try:
    import customtkinter as ctk
    CTK = True
except ImportError:
    CTK = False
    object = object  # cosmetic shim so class bases don't need extra guards

# ---------------------------------------------------------------------------
# Internal imports
# ---------------------------------------------------------------------------
from ui.widgets.status_badge import StatusBadge, Status as BadgeStatus
from ui.widgets.action_card import ActionCard, ActionCardRow
from ui.widgets.recommended_next_step import RecommendedNextStep

from models.feature_readiness import (
    FeatureKey,
    FeatureReadiness,
    ReadinessStatus,
)
from services.feature_readiness_service import check_all_features, get_most_urgent, get_smart_recommendation

from safe_mode import is_safe_mode, get_safe_mode_config

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
_log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Path helpers (same pattern as app_paths / safe_mode)
# ---------------------------------------------------------------------------

def _resolve_bundle_dir() -> Path:
    if getattr(sys, "frozen", False):
        return Path(getattr(sys, "_MEIPASS", Path(sys.executable).resolve().parent))
    return Path(__file__).resolve().parent


BUNDLE_DIR = _resolve_bundle_dir()
RUNTIME_DIR = (
    Path(sys.executable).resolve().parent
    if getattr(sys, "frozen", False)
    else BUNDLE_DIR
)


def _runtime_path(*parts: str) -> Path:
    return RUNTIME_DIR.joinpath(*parts)


# ---------------------------------------------------------------------------
# Version loader
# ---------------------------------------------------------------------------

def _load_version() -> str:
    """
    Read app version from version.json if present,
    falling back to "v2.2" when unavailable or on first-run.
    """
    try:
        vpath = _runtime_path("version.json")
        if vpath.exists():
            data = json.loads(vpath.read_text(encoding="utf-8-sig", errors="replace"))
            return f"v{data.get('app_version', '2.2')}"
    except Exception:
        pass
    return "v2.2"


# ---------------------------------------------------------------------------
# Greeting helper
# ---------------------------------------------------------------------------

def _greeting() -> str:
    """Return a time-appropriate greeting."""
    hour = datetime.now().hour
    if hour < 12:
        return "Good morning"
    if hour < 17:
        return "Good afternoon"
    return "Good evening"


def _operator_name() -> str:
    """Return the configured operator name, or 'Operator'."""
    try:
        cfg_path = _runtime_path("local-config.json")
        if cfg_path.exists():
            data = json.loads(cfg_path.read_text(encoding="utf-8-sig", errors="replace"))
            name = data.get("operator_name", "").strip()
            if name:
                return name
    except Exception:
        pass
    return "Operator"


# ---------------------------------------------------------------------------
# ReadinessStatus → BadgeStatus helper
# ---------------------------------------------------------------------------

_STATUS_TO_BADGE: dict[ReadinessStatus, BadgeStatus] = {
    ReadinessStatus.READY:   BadgeStatus.READY,
    ReadinessStatus.PARTIAL:  BadgeStatus.PARTIAL,
    ReadinessStatus.WARNING:  BadgeStatus.WARNING,
    ReadinessStatus.BLOCKED: BadgeStatus.BLOCKED,
    ReadinessStatus.UNKNOWN: BadgeStatus.UNKNOWN,
}


def _status_to_badge(status: ReadinessStatus) -> BadgeStatus:
    return _STATUS_TO_BADGE.get(status, BadgeStatus.UNKNOWN)


# ---------------------------------------------------------------------------
# Make section card helper (mirrors app.py make_section_card)
# ---------------------------------------------------------------------------

_UI_CARD_FG     = "#111827"
_UI_CARD_BORDER  = "#1e293b"
_UI_MUTED_TEXT   = "#94a3b8"


def _make_section_card(parent, title, subtitle: Optional[str] = None):
    """Create a standard dark section card frame with header and body."""
    card = ctk.CTkFrame(
        parent,
        fg_color=_UI_CARD_FG,
        corner_radius=18,
        border_width=1,
        border_color=_UI_CARD_BORDER,
    )
    card.pack(fill="x", padx=15, pady=7)

    header = ctk.CTkFrame(card, fg_color="transparent")
    header.pack(fill="x", padx=16, pady=(14, 6))

    ctk.CTkLabel(
        header,
        text=title,
        font=ctk.CTkFont(size=16, weight="bold"),
        text_color="#f8fafc",
    ).pack(anchor="w")

    if subtitle:
        ctk.CTkLabel(
            header,
            text=subtitle,
            font=ctk.CTkFont(size=11),
            text_color=_UI_MUTED_TEXT,
            justify="left",
            wraplength=900,
        ).pack(anchor="w", pady=(3, 0))

    body = ctk.CTkFrame(card, fg_color="transparent")
    body.pack(fill="x", padx=16, pady=(0, 16))
    return card, body


# ---------------------------------------------------------------------------
# Main widget
# ---------------------------------------------------------------------------

class HomeDashboard(ctk.CTkFrame if CTK else object):
    """
    Drop-in tab content for the Home Dashboard.

    Parameters
    ----------
    master : CTkFrame or tkinter.Widget
        Parent container.
    status_var : tk.StringVar, optional
        When set, the dashboard writes navigation tokens to it so the
        parent tab controller can switch tabs.  Values:
          - "navigate:download"
          - "navigate:qb"
          - "navigate:settings"
    **kwargs
        Passed through to ctk.CTkFrame.
    """

    # Features shown in the Today's Readiness grid
    _READINESS_GRID_KEYS = [
        FeatureKey.REPORT_DOWNLOAD,
        FeatureKey.QB_SYNC,
        FeatureKey.REMOVE_TX,
        FeatureKey.GOOGLE_DRIVE,
    ]

    # Feature key → human-readable label
    _FEATURE_LABELS: dict[FeatureKey, str] = {
        FeatureKey.REPORT_DOWNLOAD: "Download Reports",
        FeatureKey.QB_SYNC:         "QB Sync",
        FeatureKey.REMOVE_TX:        "Remove Transactions",
        FeatureKey.GOOGLE_DRIVE:    "Drive Upload",
    }

    def __init__(
        self,
        master,
        *,
        status_var=None,
        **kwargs,
    ):
        if not CTK:
            kwargs = {}

        super().__init__(master, fg_color="transparent", **kwargs)

        self._status_var = status_var
        self._version = _load_version()
        self._operator = _operator_name()

        # Writable copy of readiness so we can refresh without re-calling
        self._readiness_cache: dict[FeatureKey, FeatureReadiness] = {}

        self._build_ui()

    # ------------------------------------------------------------------
    # Public
    # ------------------------------------------------------------------

    def refresh(self) -> None:
        """Re-read feature readiness and update all dynamic widgets."""
        self._readiness_cache = check_all_features()
        self._update_readiness_grid()
        self._update_recommended_step()
        if hasattr(self, "_recent_activity"):
            self._recent_activity.refresh()

    # ------------------------------------------------------------------
    # UI construction
    # ------------------------------------------------------------------

    def _build_ui(self) -> None:
        """Assemble all sections of the dashboard."""
        # ── Scroll container ─────────────────────────────────────────────
        scroll = ctk.CTkScrollableFrame(
            self,
            fg_color="transparent",
        )
        scroll.pack(fill="both", expand=True)
        self._configure_scrollbar(scroll)

        parent = scroll  # all sections are children of the scroll frame

        # ── 1. Hero welcome ───────────────────────────────────────────────
        self._hero(parent)

        # ── 2. QB Auto-Start Status Panel ────────────────────────────────
        self._qb_status_section(parent)

        # ── 3. QB Activity Log Panel ─────────────────────────────────────
        self._qb_activity_log_section(parent)

        # ── 4. Today's Readiness ─────────────────────────────────────────
        self._readiness_section(parent)

        # ── 4. Quick Actions ─────────────────────────────────────────────
        self._quick_actions_section(parent)

        # ── 5. Recommended Next Step ────────────────────────────────────
        self._recommended_section(parent)

        # ── 6. Recent Activity ──────────────────────────────────────────
        self._recent_activity_section(parent)

        # ── 7. Safe Mode Banner ──────────────────────────────────────────
        if is_safe_mode():
            self._safe_mode_banner(parent)

    def _configure_scrollbar(self, scroll) -> None:
        """Style the scroll frame's scrollbar to match the dark theme."""
        try:
            scroll._scrollbar.configure(
                button_color="#334155",
                button_hover_color="#475569",
            )
        except Exception:
            pass

    # ------------------------------------------------------------------
    # Section builders
    # ------------------------------------------------------------------

    def _hero(self, parent) -> None:
        """Build the hero welcome card."""
        hero = ctk.CTkFrame(
            parent,
            fg_color="#1e293b",
            corner_radius=12,
        )
        hero.pack(fill="x", padx=15, pady=(12, 4))

        # Left: greeting + subtitle
        left = ctk.CTkFrame(hero, fg_color="transparent")
        left.pack(side="left", fill="both", expand=True, padx=20, pady=18)

        greeting_text = f"{_greeting()}, {self._operator}"
        ctk.CTkLabel(
            left,
            text=greeting_text,
            font=ctk.CTkFont(size=22, weight="bold"),
            text_color="#f8fafc",
            anchor="w",
        ).pack(anchor="w")

        ctk.CTkLabel(
            left,
            text="ToastPOSManager is running.",
            font=ctk.CTkFont(size=12),
            text_color="#94a3b8",
            anchor="w",
        ).pack(anchor="w", pady=(4, 0))

        # Right: version + safe-mode badge
        right = ctk.CTkFrame(hero, fg_color="transparent")
        right.pack(side="right", padx=20, pady=18, anchor="e")

        ctk.CTkLabel(
            right,
            text=self._version,
            font=ctk.CTkFont(size=12, weight="bold"),
            text_color="#64748b",
            anchor="e",
        ).pack(anchor="e")

        if is_safe_mode():
            cfg = get_safe_mode_config()
            ctk.CTkLabel(
                right,
                text=f"Safe Mode: {cfg.reason or 'Active'}",
                font=ctk.CTkFont(size=11),
                text_color="#f59e0b",
                anchor="e",
            ).pack(anchor="e", pady=(4, 0))

    # ------------------------------------------------------------------
    # QB / Auto-Sync Status Panel
    # ------------------------------------------------------------------

    # Status → (bg_color, accent_color, icon)
    _QB_STATUS_COLORS: dict = {
        "QB_CLOSED":     ("#1c1c2e", "#6366f1", "○"),
        "QB_OPENING":    ("#1a2a1a", "#86efac", "⟳"),
        "QB_CONNECTING": ("#1a2a1a", "#4ade80", "⟳"),
        "QB_READY":      ("#052e16", "#22c55e", "✓"),
        "QB_WRONG_CO":   ("#2d1b00", "#f59e0b", "⚠"),
        "QB_BLOCKED":    ("#1f0a0a", "#ef4444", "✕"),
        "QB_DISABLED":   ("#111827", "#475569", "—"),
    }
    _SCHED_STATUS_COLORS: dict = {
        "Off":                   ("#111827", "#475569", "—"),
        "Waiting for report time":("#1c1c2e", "#818cf8", "⏱"),
        "Reports missing":       ("#2d1b00", "#f59e0b", "⚠"),
        "QB not ready":          ("#2d1b00", "#f59e0b", "⏳"),
        "Ready":                 ("#052e16", "#22c55e", "✓"),
        "Syncing":               ("#1a2a1a", "#4ade80", "⟳"),
        "Completed":             ("#052e16", "#22c55e", "✓"),
        "Failed":                ("#1f0a0a", "#ef4444", "✕"),
        "Another sync running":  ("#1c1c2e", "#a78bfa", "⏳"),
    }

    def _qb_status_section(self, parent) -> None:
        """Build the QB Auto-Start Status section with action buttons."""
        card, body = _make_section_card(
            parent,
            "QuickBooks & Auto-Sync Status",
            "Real-time QB connection and scheduled sync state",
        )

        # ── Row 1: QB status + Scheduler status ──────────────────────────
        row1 = ctk.CTkFrame(body, fg_color="transparent")
        row1.pack(fill="x", pady=(0, 8))
        row1.columnconfigure(0, weight=1, uniform="half")
        row1.columnconfigure(1, weight=1, uniform="half")

        # QB status card
        self._qb_status_card = self._build_status_chip(
            row1, "QuickBooks", "QB_DISABLED", "QB auto-open is not configured.", row=0, col=0
        )

        # Scheduler status card
        self._sched_status_card = self._build_status_chip(
            row1, "Auto Sync", "Off", "Auto sync is disabled.", row=0, col=1
        )

        # ── Row 2: detail labels ──────────────────────────────────────────
        details_row = ctk.CTkFrame(body, fg_color="transparent")
        details_row.pack(fill="x", pady=(0, 8))

        self._qb_last_sync_label = ctk.CTkLabel(
            details_row,
            text="Last sync: —",
            font=ctk.CTkFont(size=11),
            text_color="#64748b",
            anchor="w",
        )
        self._qb_last_sync_label.pack(side="left", padx=(2, 16))

        self._qb_next_sync_label = ctk.CTkLabel(
            details_row,
            text="Next sync: —",
            font=ctk.CTkFont(size=11),
            text_color="#64748b",
            anchor="w",
        )
        self._qb_next_sync_label.pack(side="left", padx=(0, 16))

        self._qb_error_label = ctk.CTkLabel(
            details_row,
            text="",
            font=ctk.CTkFont(size=11),
            text_color="#ef4444",
            anchor="w",
            wraplength=600,
        )
        self._qb_error_label.pack(side="left", fill="x", expand=True)

        # ── Row 3: Action buttons ─────────────────────────────────────────
        btn_row = ctk.CTkFrame(body, fg_color="transparent")
        btn_row.pack(fill="x")

        _BTN_STYLE = dict(
            height=32,
            corner_radius=8,
            font=ctk.CTkFont(size=12, weight="bold"),
        )

        ctk.CTkButton(
            btn_row,
            text="Open QB Now",
            fg_color="#1d4ed8", hover_color="#1e40af",
            command=self._on_open_qb_now,
            **_BTN_STYLE,
        ).pack(side="left", padx=(0, 8))

        ctk.CTkButton(
            btn_row,
            text="Test QB Connection",
            fg_color="#0f766e", hover_color="#115e59",
            command=self._on_test_qb_connection,
            **_BTN_STYLE,
        ).pack(side="left", padx=(0, 8))

        ctk.CTkButton(
            btn_row,
            text="Run Scheduled Sync Now",
            fg_color="#7c3aed", hover_color="#6d28d9",
            command=self._on_run_sync_now,
            **_BTN_STYLE,
        ).pack(side="left", padx=(0, 8))

        ctk.CTkButton(
            btn_row,
            text="View Sync Ledger",
            fg_color="#334155", hover_color="#475569",
            command=self._on_view_ledger,
            **_BTN_STYLE,
        ).pack(side="left")

    def _build_status_chip(
        self, parent, title: str, status_key: str, message: str, *, row: int, col: int
    ) -> ctk.CTkFrame:
        """Build a single status chip in the grid."""
        color_map = self._QB_STATUS_COLORS if title == "QuickBooks" else self._SCHED_STATUS_COLORS
        bg, accent, icon = color_map.get(status_key, ("#111827", "#64748b", "—"))

        chip = ctk.CTkFrame(parent, fg_color=bg, corner_radius=12, border_width=1, border_color=accent)
        chip.grid(row=row, column=col, padx=5, pady=4, sticky="ew")

        inner = ctk.CTkFrame(chip, fg_color="transparent")
        inner.pack(fill="both", padx=12, pady=8)

        hdr = ctk.CTkFrame(inner, fg_color="transparent")
        hdr.pack(fill="x")
        ctk.CTkLabel(hdr, text=icon, font=ctk.CTkFont(size=13, weight="bold"), text_color=accent, width=18).pack(side="left")
        ctk.CTkLabel(hdr, text=title, font=ctk.CTkFont(size=13, weight="bold"), text_color="#f8fafc", anchor="w").pack(side="left", padx=(4, 0), fill="x", expand=True)
        pill = ctk.CTkFrame(hdr, fg_color=accent, corner_radius=8)
        pill.pack(side="right")
        pill_label = ctk.CTkLabel(pill, text=status_key, font=ctk.CTkFont(size=10, weight="bold"), text_color="#000")
        pill_label.pack(padx=6, pady=2)

        msg_label = ctk.CTkLabel(inner, text=message[:100], font=ctk.CTkFont(size=11), text_color="#94a3b8", anchor="w", wraplength=260, justify="left")
        msg_label.pack(anchor="w", pady=(3, 0))

        # Store refs for update
        attr = "qb" if title == "QuickBooks" else "sched"
        setattr(self, f"_{attr}_chip", chip)
        setattr(self, f"_{attr}_chip_pill", pill)
        setattr(self, f"_{attr}_chip_pill_label", pill_label)
        setattr(self, f"_{attr}_chip_msg_label", msg_label)
        setattr(self, f"_{attr}_chip_icon_label", hdr.winfo_children()[0])
        return chip

    def update_qb_status(self, status: str, message: str, *, error: str = "", last_sync: str = "", next_sync: str = "") -> None:
        """Call from main thread to update QB status chip. Thread-safe via .after()."""
        def _update():
            color_map = self._QB_STATUS_COLORS
            bg, accent, icon = color_map.get(status, ("#111827", "#64748b", "—"))
            chip = getattr(self, "_qb_chip", None)
            if chip:
                chip.configure(fg_color=bg, border_color=accent)
            for attr, value in [
                ("_qb_chip_pill", None),
                ("_qb_chip_pill_label", status),
                ("_qb_chip_msg_label", message[:100]),
                ("_qb_chip_icon_label", icon),
            ]:
                w = getattr(self, attr, None)
                if w and value is not None:
                    w.configure(text=value)
            pill = getattr(self, "_qb_chip_pill", None)
            if pill:
                pill.configure(fg_color=accent)
            # Update detail labels
            if last_sync and hasattr(self, "_qb_last_sync_label"):
                self._qb_last_sync_label.configure(text=f"Last sync: {last_sync}")
            if next_sync and hasattr(self, "_qb_next_sync_label"):
                self._qb_next_sync_label.configure(text=f"Next sync: {next_sync}")
            if hasattr(self, "_qb_error_label"):
                self._qb_error_label.configure(text=error[:120] if error else "")
        try:
            self.after(0, _update)
        except Exception:
            pass

    def update_scheduler_status(self, status: str, message: str, *, last_sync: str = "", next_sync: str = "", error: str = "") -> None:
        """Call from main thread (via .after()) to update Auto Sync chip."""
        def _update():
            color_map = self._SCHED_STATUS_COLORS
            bg, accent, icon = color_map.get(status, ("#111827", "#64748b", "—"))
            chip = getattr(self, "_sched_chip", None)
            if chip:
                chip.configure(fg_color=bg, border_color=accent)
            for attr, value in [
                ("_sched_chip_pill_label", status),
                ("_sched_chip_msg_label", message[:100]),
                ("_sched_chip_icon_label", icon),
            ]:
                w = getattr(self, attr, None)
                if w and value is not None:
                    w.configure(text=value)
            pill = getattr(self, "_sched_chip_pill", None)
            if pill:
                pill.configure(fg_color=accent)
            if last_sync and hasattr(self, "_qb_last_sync_label"):
                self._qb_last_sync_label.configure(text=f"Last sync: {last_sync}")
            if next_sync and hasattr(self, "_qb_next_sync_label"):
                self._qb_next_sync_label.configure(text=f"Next sync: {next_sync}")
            if error and hasattr(self, "_qb_error_label"):
                self._qb_error_label.configure(text=error[:120])
        try:
            self.after(0, _update)
        except Exception:
            pass

    # ── Button handlers ────────────────────────────────────────────────────

    def _on_open_qb_now(self) -> None:
        """Trigger QB startup service manually."""
        try:
            from services.qb_startup_service import start_qb_startup_service
            def _on_status(s):
                self.update_qb_status(s.status, s.message, error=s.error)
            start_qb_startup_service(on_status=_on_status)
            self.update_qb_status("QB_OPENING", "Opening QuickBooks...")
        except Exception as exc:
            self.update_qb_status("QB_BLOCKED", "Failed to start QB.", error=str(exc))

    def _on_test_qb_connection(self) -> None:
        """Test QB COM connection without syncing."""
        import threading
        def _test():
            try:
                from qb_client import QBClient
                import json
                from app_paths import runtime_path
                cfg = {}
                p = runtime_path("local-config.json")
                if p.exists():
                    cfg = json.loads(p.read_text(encoding="utf-8-sig"))
                qbw_paths = cfg.get("qbw_paths", {})
                qbw = next(iter(qbw_paths.values()), "")
                client = QBClient()
                client.connect(qbw)
                accounts = client.query_all_accounts()
                client.disconnect()
                msg = f"QB connection OK. Found {len(accounts)} accounts."
                self.after(0, lambda: self.update_qb_status("QB_READY", msg))
            except Exception as exc:
                self.after(0, lambda: self.update_qb_status("QB_BLOCKED", "QB connection test failed.", error=str(exc)))
        threading.Thread(target=_test, daemon=True).start()
        self.update_qb_status("QB_CONNECTING", "Testing QB connection...")

    def _on_run_sync_now(self) -> None:
        """Manually trigger the auto sync scheduler."""
        try:
            from services.auto_report_sync_scheduler import get_scheduler, start_scheduler
            sched = get_scheduler()
            if sched is None:
                sched = start_scheduler()
            def _run():
                result = sched.trigger_now()
                self.after(0, lambda r=result: self.update_scheduler_status(
                    r.status, r.message, last_sync=r.last_sync_at, error=r.last_error
                ))
            import threading
            threading.Thread(target=_run, daemon=True).start()
            self.update_scheduler_status("Syncing", "Manual sync triggered...")
        except Exception as exc:
            self.update_scheduler_status("Failed", "Manual sync trigger failed.", error=str(exc))

    def _on_view_ledger(self) -> None:
        """Navigate to Audit Center tab to view sync ledger."""
        if self._status_var:
            self._status_var.set("navigate:audit")

    # ------------------------------------------------------------------
    # QB Activity Log Panel
    # ------------------------------------------------------------------

    _ALOG_STATUS_COLORS: dict = {
        "Off":           ("#111827", "#475569", "—"),
        "Waiting":       ("#1c1c2e", "#818cf8", "⏱"),
        "QB not ready":  ("#2d1b00", "#f59e0b", "⏳"),
        "Running":       ("#1a2a1a", "#4ade80", "⟳"),
        "Done":          ("#052e16", "#22c55e", "✓"),
        "Failed":        ("#1f0a0a", "#ef4444", "✕"),
    }

    def _qb_activity_log_section(self, parent) -> None:
        """Build the QB Activity Log status panel with action buttons."""
        card, body = _make_section_card(
            parent,
            "QB Activity Log",
            "Tracks last Sales Receipt, Bank Feed, Reconcile, and QB actions per store",
        )

        # ── Status chip row ───────────────────────────────────────────
        chip_row = ctk.CTkFrame(body, fg_color="transparent")
        chip_row.pack(fill="x", pady=(0, 6))
        chip_row.columnconfigure(0, weight=1)

        bg, accent, icon = self._ALOG_STATUS_COLORS.get("Off", ("#111827", "#475569", "—"))
        self._alog_chip = ctk.CTkFrame(
            chip_row, fg_color=bg, corner_radius=12,
            border_width=1, border_color=accent,
        )
        self._alog_chip.grid(row=0, column=0, padx=5, pady=4, sticky="ew")

        inner = ctk.CTkFrame(self._alog_chip, fg_color="transparent")
        inner.pack(fill="both", padx=12, pady=8)

        hdr = ctk.CTkFrame(inner, fg_color="transparent")
        hdr.pack(fill="x")
        self._alog_icon  = ctk.CTkLabel(hdr, text=icon, font=ctk.CTkFont(size=13, weight="bold"), text_color=accent, width=18)
        self._alog_icon.pack(side="left")
        ctk.CTkLabel(hdr, text="Activity Log", font=ctk.CTkFont(size=13, weight="bold"), text_color="#f8fafc", anchor="w").pack(side="left", padx=(4, 0), fill="x", expand=True)
        self._alog_pill = ctk.CTkFrame(hdr, fg_color=accent, corner_radius=8)
        self._alog_pill.pack(side="right")
        self._alog_pill_label = ctk.CTkLabel(self._alog_pill, text="Off", font=ctk.CTkFont(size=10, weight="bold"), text_color="#000")
        self._alog_pill_label.pack(padx=6, pady=2)
        self._alog_msg_label = ctk.CTkLabel(inner, text="QB activity log is disabled.", font=ctk.CTkFont(size=11), text_color="#94a3b8", anchor="w", wraplength=700, justify="left")
        self._alog_msg_label.pack(anchor="w", pady=(3, 0))

        # ── Summary detail row ────────────────────────────────────────
        detail_row = ctk.CTkFrame(body, fg_color="transparent")
        detail_row.pack(fill="x", pady=(0, 6))

        self._alog_last_receipt_label = ctk.CTkLabel(detail_row, text="Last receipt: —", font=ctk.CTkFont(size=11), text_color="#64748b", anchor="w")
        self._alog_last_receipt_label.pack(side="left", padx=(2, 14))

        self._alog_last_bank_label = ctk.CTkLabel(detail_row, text="Last bank txn: —", font=ctk.CTkFont(size=11), text_color="#64748b", anchor="w")
        self._alog_last_bank_label.pack(side="left", padx=(0, 14))

        self._alog_last_reconcile_label = ctk.CTkLabel(detail_row, text="Last reconcile: —", font=ctk.CTkFont(size=11), text_color="#64748b", anchor="w")
        self._alog_last_reconcile_label.pack(side="left", padx=(0, 14))

        self._alog_generated_label = ctk.CTkLabel(detail_row, text="Generated: —", font=ctk.CTkFont(size=11), text_color="#64748b", anchor="w")
        self._alog_generated_label.pack(side="left")

        # ── Metrics row ───────────────────────────────────────────────
        metrics_row = ctk.CTkFrame(body, fg_color="transparent")
        metrics_row.pack(fill="x", pady=(0, 4))

        self._alog_duration_label = ctk.CTkLabel(metrics_row, text="Duration: —", font=ctk.CTkFont(size=10), text_color="#475569", anchor="w")
        self._alog_duration_label.pack(side="left", padx=(2, 14))

        self._alog_warn_label = ctk.CTkLabel(metrics_row, text="Warnings: —", font=ctk.CTkFont(size=10), text_color="#475569", anchor="w")
        self._alog_warn_label.pack(side="left", padx=(0, 14))

        self._alog_err_label = ctk.CTkLabel(metrics_row, text="Errors: —", font=ctk.CTkFont(size=10), text_color="#475569", anchor="w")
        self._alog_err_label.pack(side="left")

        # ── Action buttons ────────────────────────────────────────────
        btn_row = ctk.CTkFrame(body, fg_color="transparent")
        btn_row.pack(fill="x")

        _BTN = dict(height=32, corner_radius=8, font=ctk.CTkFont(size=12, weight="bold"))

        ctk.CTkButton(
            btn_row, text="Generate Log Now",
            fg_color="#7c3aed", hover_color="#6d28d9",
            command=self._on_generate_activity_log,
            **_BTN,
        ).pack(side="left", padx=(0, 8))

        ctk.CTkButton(
            btn_row, text="Open Log Folder",
            fg_color="#334155", hover_color="#475569",
            command=self._on_open_log_folder,
            **_BTN,
        ).pack(side="left")

    def update_activity_log_status(
        self,
        status: str,
        message: str,
        *,
        last_receipt: str = "",
        last_bank: str = "",
        last_reconcile: str = "",
        generated_at: str = "",
        total_ms: int = 0,
        warn_count: int = 0,
        error_count: int = 0,
    ) -> None:
        """Update the QB Activity Log chip — call via .after() from any thread."""
        def _update():
            bg, accent, icon = self._ALOG_STATUS_COLORS.get(status, ("#111827", "#64748b", "—"))
            chip = getattr(self, "_alog_chip", None)
            if chip:
                chip.configure(fg_color=bg, border_color=accent)
            w = getattr(self, "_alog_icon", None)
            if w:
                w.configure(text=icon, text_color=accent)
            w = getattr(self, "_alog_pill", None)
            if w:
                w.configure(fg_color=accent)
            w = getattr(self, "_alog_pill_label", None)
            if w:
                w.configure(text=status)
            w = getattr(self, "_alog_msg_label", None)
            if w:
                w.configure(text=message[:120])
            if last_receipt:
                w = getattr(self, "_alog_last_receipt_label", None)
                if w:
                    w.configure(text=f"Last receipt: {last_receipt}")
            if last_bank:
                w = getattr(self, "_alog_last_bank_label", None)
                if w:
                    w.configure(text=f"Last bank txn: {last_bank}")
            if last_reconcile:
                w = getattr(self, "_alog_last_reconcile_label", None)
                if w:
                    w.configure(text=f"Last reconcile: {last_reconcile}")
            if generated_at:
                w = getattr(self, "_alog_generated_label", None)
                if w:
                    w.configure(text=f"Generated: {generated_at}")
            # Metrics row
            if total_ms > 0:
                w = getattr(self, "_alog_duration_label", None)
                if w:
                    w.configure(text=f"Duration: {total_ms} ms")
            w = getattr(self, "_alog_warn_label", None)
            if w:
                w.configure(text=f"Warnings: {warn_count}")
            w = getattr(self, "_alog_err_label", None)
            if w:
                w.configure(text=f"Errors: {error_count}", text_color="#ef4444" if error_count > 0 else "#475569")
        try:
            self.after(0, _update)
        except Exception:
            pass

    def _on_generate_activity_log(self) -> None:
        """Manually trigger QB activity log generation."""
        import threading
        def _run():
            try:
                from services.qb_activity_log_scheduler import get_activity_log_scheduler, start_activity_log_scheduler
                sched = get_activity_log_scheduler()
                if sched is None:
                    sched = start_activity_log_scheduler()
                self.after(0, lambda: self.update_activity_log_status("Running", "Generating QB activity logs..."))
                result = sched.trigger_now(force=True)
                status = "Done" if result.get("ok") else "Failed"
                msg = "Activity logs generated." if result.get("ok") else str(result.get("error", ""))
                self.after(0, lambda s=status, m=msg: self.update_activity_log_status(s, m))
            except Exception as exc:
                self.after(0, lambda e=exc: self.update_activity_log_status("Failed", f"Error: {e}"))
        threading.Thread(target=_run, daemon=True).start()

    def _on_open_log_folder(self) -> None:
        """Open the QB activity log output folder in Explorer."""
        import subprocess, os, json
        try:
            from app_paths import runtime_path
            cfg_path = runtime_path("local-config.json")
            output_dir = "logs/qb-activity"
            if cfg_path.exists():
                cfg = json.loads(cfg_path.read_text(encoding="utf-8-sig"))
                output_dir = cfg.get("qb_activity_log", {}).get("output_dir", output_dir) or output_dir
            log_path = runtime_path(output_dir)
            log_path.mkdir(parents=True, exist_ok=True)
            if os.name == "nt":
                subprocess.Popen(["explorer", str(log_path)])
            else:
                subprocess.Popen(["open" if os.uname().sysname == "Darwin" else "xdg-open", str(log_path)])
        except Exception as exc:
            _log.warning("Could not open log folder: %s", exc)

    # ── QB Activity Timeline section ─────────────────────────────────────────

    _ATL_STATUS_COLORS: dict = {
        "Off":          ("#111827", "#475569", "—"),
        "Waiting":      ("#1c1c2e", "#818cf8", "⏱"),
        "QB not ready": ("#2d1b00", "#f59e0b", "⏳"),
        "Running":      ("#1a2a1a", "#4ade80", "⟳"),
        "Done":         ("#052e16", "#22c55e", "✓"),
        "Failed":       ("#1f0a0a", "#ef4444", "✕"),
    }

    def _qb_activity_timeline_section(self, parent) -> None:
        """Build the QB Activity Timeline panel with action buttons."""
        card, body = _make_section_card(
            parent,
            "QB Activity Timeline",
            "Full chronological event log of all QB transactions per store per day",
        )

        # Status chip row
        chip_row = ctk.CTkFrame(body, fg_color="transparent")
        chip_row.pack(fill="x", pady=(0, 6))
        chip_row.columnconfigure(0, weight=1)

        bg, accent, icon = self._ATL_STATUS_COLORS.get("Off", ("#111827", "#475569", "—"))
        self._atl_chip = ctk.CTkFrame(
            chip_row, fg_color=bg, corner_radius=12,
            border_width=1, border_color=accent,
        )
        self._atl_chip.grid(row=0, column=0, padx=5, pady=4, sticky="ew")

        inner = ctk.CTkFrame(self._atl_chip, fg_color="transparent")
        inner.pack(fill="both", padx=12, pady=8)

        hdr = ctk.CTkFrame(inner, fg_color="transparent")
        hdr.pack(fill="x")
        self._atl_icon = ctk.CTkLabel(hdr, text=icon, font=ctk.CTkFont(size=13, weight="bold"), text_color=accent, width=18)
        self._atl_icon.pack(side="left")
        ctk.CTkLabel(hdr, text="Timeline", font=ctk.CTkFont(size=13, weight="bold"), text_color="#f8fafc", anchor="w").pack(side="left", padx=(4, 0), fill="x", expand=True)
        self._atl_pill = ctk.CTkFrame(hdr, fg_color=accent, corner_radius=8)
        self._atl_pill.pack(side="right")
        self._atl_pill_label = ctk.CTkLabel(self._atl_pill, text="Off", font=ctk.CTkFont(size=10, weight="bold"), text_color="#000")
        self._atl_pill_label.pack(padx=6, pady=2)
        self._atl_msg_label = ctk.CTkLabel(inner, text="QB timeline is disabled.", font=ctk.CTkFont(size=11), text_color="#94a3b8", anchor="w", wraplength=700, justify="left")
        self._atl_msg_label.pack(anchor="w", pady=(3, 0))

        # Detail row
        detail_row = ctk.CTkFrame(body, fg_color="transparent")
        detail_row.pack(fill="x", pady=(0, 6))

        self._atl_event_count_label = ctk.CTkLabel(detail_row, text="Events today: —", font=ctk.CTkFont(size=11), text_color="#64748b", anchor="w")
        self._atl_event_count_label.pack(side="left", padx=(2, 14))

        self._atl_last_type_label = ctk.CTkLabel(detail_row, text="Last type: —", font=ctk.CTkFont(size=11), text_color="#64748b", anchor="w")
        self._atl_last_type_label.pack(side="left", padx=(0, 14))

        self._atl_last_time_label = ctk.CTkLabel(detail_row, text="Last time: —", font=ctk.CTkFont(size=11), text_color="#64748b", anchor="w")
        self._atl_last_time_label.pack(side="left", padx=(0, 14))

        self._atl_generated_label = ctk.CTkLabel(detail_row, text="Generated: —", font=ctk.CTkFont(size=11), text_color="#64748b", anchor="w")
        self._atl_generated_label.pack(side="left")

        # Action buttons
        btn_row = ctk.CTkFrame(body, fg_color="transparent")
        btn_row.pack(fill="x")

        _BTN = dict(height=32, corner_radius=8, font=ctk.CTkFont(size=12, weight="bold"))

        ctk.CTkButton(
            btn_row, text="Generate Timeline Now",
            fg_color="#0891b2", hover_color="#0e7490",
            command=self._on_generate_timeline,
            **_BTN,
        ).pack(side="left", padx=(0, 8))

        ctk.CTkButton(
            btn_row, text="Open Timeline Folder",
            fg_color="#334155", hover_color="#475569",
            command=self._on_open_timeline_folder,
            **_BTN,
        ).pack(side="left")

    def update_timeline_status(
        self,
        status: str,
        message: str,
        *,
        event_count: int = 0,
        last_type: str = "",
        last_time: str = "",
        generated_at: str = "",
    ) -> None:
        """Update the QB Activity Timeline chip — call via .after() from any thread."""
        def _update():
            bg, accent, icon = self._ATL_STATUS_COLORS.get(status, ("#111827", "#64748b", "—"))
            chip = getattr(self, "_atl_chip", None)
            if chip:
                chip.configure(fg_color=bg, border_color=accent)
            w = getattr(self, "_atl_icon", None)
            if w:
                w.configure(text=icon, text_color=accent)
            w = getattr(self, "_atl_pill", None)
            if w:
                w.configure(fg_color=accent)
            w = getattr(self, "_atl_pill_label", None)
            if w:
                w.configure(text=status)
            w = getattr(self, "_atl_msg_label", None)
            if w:
                w.configure(text=message[:120])
            if event_count > 0:
                w = getattr(self, "_atl_event_count_label", None)
                if w:
                    w.configure(text=f"Events today: {event_count}")
            if last_type:
                w = getattr(self, "_atl_last_type_label", None)
                if w:
                    w.configure(text=f"Last type: {last_type}")
            if last_time:
                w = getattr(self, "_atl_last_time_label", None)
                if w:
                    w.configure(text=f"Last time: {last_time}")
            if generated_at:
                w = getattr(self, "_atl_generated_label", None)
                if w:
                    w.configure(text=f"Generated: {generated_at}")
        try:
            self.after(0, _update)
        except Exception:
            pass

    def _on_generate_timeline(self) -> None:
        """Manually trigger QB activity timeline generation."""
        import threading
        def _run():
            try:
                from services.qb_activity_timeline_scheduler import get_timeline_scheduler, start_timeline_scheduler
                sched = get_timeline_scheduler()
                if sched is None:
                    sched = start_timeline_scheduler()
                self.after(0, lambda: self.update_timeline_status("Running", "Generating QB activity timelines..."))
                result = sched.trigger_now(force=True)
                status = "Done" if result.get("ok") else "Failed"
                total_events = sum(r.get("event_count", 0) for r in result.get("results", []))
                msg = f"Timelines generated. Total events: {total_events}" if result.get("ok") else str(result.get("error", ""))
                self.after(0, lambda s=status, m=msg, ec=total_events: self.update_timeline_status(s, m, event_count=ec))
            except Exception as exc:
                self.after(0, lambda e=exc: self.update_timeline_status("Failed", f"Error: {e}"))
        threading.Thread(target=_run, daemon=True).start()

    def _on_open_timeline_folder(self) -> None:
        """Open the timeline output folder in Explorer."""
        import subprocess, os, json
        try:
            from app_paths import runtime_path
            cfg_path = runtime_path("local-config.json")
            output_dir = "logs/qb-activity"
            if cfg_path.exists():
                cfg = json.loads(cfg_path.read_text(encoding="utf-8-sig"))
                output_dir = cfg.get("qb_activity_log", {}).get("output_dir", output_dir) or output_dir
            log_path = runtime_path(output_dir)
            log_path.mkdir(parents=True, exist_ok=True)
            if os.name == "nt":
                subprocess.Popen(["explorer", str(log_path)])
            else:
                subprocess.Popen(["open" if os.uname().sysname == "Darwin" else "xdg-open", str(log_path)])
        except Exception as exc:
            _log.warning("Could not open timeline folder: %s", exc)

    def _readiness_section(self, parent) -> None:
        """Build Today's Readiness: a 2×2 grid of rich readiness cards."""
        card, body = _make_section_card(parent, "Today's Readiness")

        # Refresh readiness on first build
        self._readiness_cache = check_all_features()

        # Grid: 2 columns × 2 rows
        grid = ctk.CTkFrame(body, fg_color="transparent")
        grid.pack(fill="x", pady=(0, 4))
        grid.columnconfigure(0, weight=1, uniform="half")
        grid.columnconfigure(1, weight=1, uniform="half")

        keys = self._READINESS_GRID_KEYS
        for idx, key in enumerate(keys):
            row = idx // 2
            col = idx % 2
            fr = self._readiness_cache.get(key)
            self._place_readiness_card(grid, key, fr, row, col)

    def _place_badge(
        self,
        grid,
        key: FeatureKey,
        fr: Optional[FeatureReadiness],
        row: int,
        col: int,
    ) -> None:
        """Place a single readiness badge in the grid (kept for backward compatibility)."""
        status = fr.status if fr else ReadinessStatus.UNKNOWN
        badge_status = _status_to_badge(status)
        label_text = fr.reason if fr else "Status unknown."

        badge = StatusBadge(
            grid,
            status=badge_status,
            text=self._FEATURE_LABELS.get(key, key.value),
        )

        # Store ref for later refresh
        attr_name = f"_badge_{key.value}"
        setattr(self, attr_name, badge)

        badge.grid(row=row, column=col, padx=6, pady=5, sticky="ew")

    def _place_readiness_card(
        self,
        parent,
        key: FeatureKey,
        fr: Optional[FeatureReadiness],
        row: int,
        col: int,
    ):
        """Place a rich readiness card showing status + reason + next step."""
        STATUS_COLORS = {
            ReadinessStatus.READY:   ("#052e16", "#22c55e"),   # bg, accent
            ReadinessStatus.WARNING: ("#2d1b00", "#f59e0b"),
            ReadinessStatus.PARTIAL: ("#2d1b00", "#f59e0b"),
            ReadinessStatus.BLOCKED: ("#1f0a0a", "#ef4444"),
            ReadinessStatus.UNKNOWN: ("#111827", "#64748b"),
        }

        status = fr.status if fr else ReadinessStatus.UNKNOWN
        bg, accent = STATUS_COLORS.get(status, ("#111827", "#64748b"))

        STATUS_ICONS = {
            ReadinessStatus.READY: "✓",
            ReadinessStatus.WARNING: "⚠",
            ReadinessStatus.PARTIAL: "⚠",
            ReadinessStatus.BLOCKED: "✕",
            ReadinessStatus.UNKNOWN: "○",
        }
        icon = STATUS_ICONS.get(status, "○")

        card = ctk.CTkFrame(parent, fg_color=bg, corner_radius=12, border_width=1, border_color=accent)
        card.grid(row=row, column=col, padx=6, pady=6, sticky="nsew")

        inner = ctk.CTkFrame(card, fg_color="transparent")
        inner.pack(fill="both", expand=True, padx=12, pady=10)

        # Header row: icon + feature name + status
        hdr = ctk.CTkFrame(inner, fg_color="transparent")
        hdr.pack(fill="x")
        ctk.CTkLabel(hdr, text=icon, font=ctk.CTkFont(size=14, weight="bold"), text_color=accent, width=20).pack(side="left")
        label_text = self._FEATURE_LABELS.get(key, key.value.replace("_", " ").title())
        ctk.CTkLabel(hdr, text=label_text, font=ctk.CTkFont(size=13, weight="bold"), text_color="#f8fafc", anchor="w").pack(side="left", padx=(4, 0), fill="x", expand=True)

        # Status pill
        status_label = status.value.title() if hasattr(status, "value") else str(status)
        pill = ctk.CTkFrame(hdr, fg_color=accent, corner_radius=8)
        pill.pack(side="right")
        ctk.CTkLabel(pill, text=status_label, font=ctk.CTkFont(size=10, weight="bold"), text_color="#000000" if status == ReadinessStatus.READY else "#ffffff").pack(padx=6, pady=2)

        # Reason line
        reason = (fr.reason if fr else "Status unknown")[:90]
        ctk.CTkLabel(inner, text=reason, font=ctk.CTkFont(size=11), text_color="#94a3b8", anchor="w", wraplength=220, justify="left").pack(anchor="w", pady=(4, 0))

        # Next step line
        if fr and fr.next_step:
            ns = fr.next_step[:80]
            ctk.CTkLabel(inner, text=f"→ {ns}", font=ctk.CTkFont(size=11), text_color=accent, anchor="w", wraplength=220, justify="left").pack(anchor="w", pady=(2, 0))

        # Store ref for update
        setattr(self, f"_readiness_card_{key.value}", card)
        setattr(self, f"_readiness_card_bg_{key.value}", bg)
        return card

    def _update_readiness_grid(self) -> None:
        """Refresh each badge in the readiness grid."""
        for key in self._READINESS_GRID_KEYS:
            fr = self._readiness_cache.get(key)
            badge: StatusBadge = getattr(self, f"_badge_{key.value}", None)
            if badge is None:
                continue
            status = fr.status if fr else ReadinessStatus.UNKNOWN
            badge_status = _status_to_badge(status)
            reason_text = fr.reason if fr else "Status unknown."
            badge.set(badge_status, self._FEATURE_LABELS.get(key, key.value))

    def _quick_actions_section(self, parent) -> None:
        """Build the Quick Actions section with three ActionCards."""
        card, body = _make_section_card(parent, "Quick Actions")

        def _nav(target: str):
            if self._status_var is not None:
                self._status_var.set(target)

        cards = [
            ActionCard(
                body,
                title="Download Reports",
                description="Download missing Toast reports for selected stores",
                accent="#22c55e",
                icon="▼",
                command=lambda: _nav("navigate:wizard_download"),
            ),
            ActionCard(
                body,
                title="Run QB Sync",
                description="Sync sales receipts to QuickBooks Desktop for selected stores",
                accent="#0f766e",
                icon="⬆",
                command=lambda: _nav("navigate:wizard_qb"),
            ),
            ActionCard(
                body,
                title="Recovery Center",
                description="Troubleshoot issues, export support bundles, repair settings",
                accent="#475569",
                icon="⚙",
                command=lambda: _nav("navigate:settings"),
            ),
        ]

        ActionCardRow(body, cards)

    def _recommended_section(self, parent) -> None:
        """Build the Recommended Next Step section."""
        card, body = _make_section_card(parent, "Recommended Next Step", "What to do right now")

        # The RecommendedNextStep widget
        self._recommended_widget = RecommendedNextStep(body, feature_readiness=None)
        self._recommended_widget.pack(fill="x", pady=(0, 8))

        # Large CTA button row
        self._cta_frame = ctk.CTkFrame(body, fg_color="transparent")
        self._cta_frame.pack(fill="x")
        self._cta_button = ctk.CTkButton(
            self._cta_frame,
            text="Get Started →",
            font=ctk.CTkFont(size=13, weight="bold"),
            height=40,
            corner_radius=10,
            fg_color="#2563eb",
            hover_color="#1d4ed8",
            command=self._on_cta_click,
        )
        self._cta_button.pack(side="left", padx=(0, 8))
        self._cta_target = "navigate:wizard_download"  # default

        self._update_recommended_step()

    def _recent_activity_section(self, parent) -> None:
        """Build the Recent Activity section."""
        from ui.widgets.recent_activity_list import RecentActivityList
        card, body = _make_section_card(parent, "Recent Activity", "Last 5 actions in this workspace")
        self._recent_activity = RecentActivityList(body, count=5)
        self._recent_activity.pack(fill="x", pady=(0, 4))

    def _on_cta_click(self) -> None:
        """Handle CTA button click — navigate based on current recommendation."""
        target = getattr(self, "_cta_target", "navigate:home")
        if self._status_var:
            self._status_var.set(target)

    def _update_recommended_step(self) -> None:
        """Refresh the RecommendedNextStep widget and CTA button."""
        fr = get_smart_recommendation()
        if hasattr(self, "_recommended_widget"):
            self._recommended_widget.update(fr)
        # Keep backward-compat ref
        if hasattr(self, "_recommended_step"):
            self._recommended_step.update(fr)

        # Update CTA based on fr
        if fr:
            key = fr.feature_key
            # Map feature to navigation target
            NAV_MAP = {
                FeatureKey.REPORT_DOWNLOAD: "navigate:wizard_download",
                FeatureKey.QB_SYNC:         "navigate:wizard_qb",
                FeatureKey.GOOGLE_DRIVE:    "navigate:settings",
                FeatureKey.REMOVE_TX:       "navigate:remove",
                FeatureKey.RECOVERY_CENTER: "navigate:recovery",
            }
            self._cta_target = NAV_MAP.get(key, "navigate:home")
            # Set button text/color based on action needed
            if fr.status.value in ("BLOCKED", "WARNING"):
                btn_text = "→ Fix This Now"
                btn_color = "#dc2626" if fr.status.value == "BLOCKED" else "#d97706"
            else:
                btn_text = "→ Get Started"
                btn_color = "#2563eb"
            if hasattr(self, "_cta_button"):
                self._cta_button.configure(text=btn_text, fg_color=btn_color, hover_color=btn_color)
        else:
            self._cta_target = "navigate:wizard_download"
            if hasattr(self, "_cta_button"):
                self._cta_button.configure(text="→ All Clear — Start Downloading", fg_color="#059669", hover_color="#047857")

    def _safe_mode_banner(self, parent) -> None:
        """Draw the amber safe-mode banner across the bottom."""
        banner = ctk.CTkFrame(
            parent,
            fg_color="#451a03",
            corner_radius=0,
            border_width=1,
            border_color="#b45309",
        )
        banner.pack(fill="x", padx=0, pady=(0, 0))

        label = ctk.CTkLabel(
            banner,
            text="⚠  Safe Mode Active — Background workers are disabled.",
            font=ctk.CTkFont(size=12, weight="bold"),
            text_color="#f59e0b",
        )
        label.pack(padx=16, pady=10)


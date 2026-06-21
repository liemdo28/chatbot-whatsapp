"""
Smart confirmation reply builder.

Replaces Phase 11 (Smart Confirmation) of the old pipeline. Generates the
WhatsApp message that gets posted back to the kitchen group.

Design principles:
  1. Confirm what was successfully read — give the employee confidence the bot got it.
  2. Surface only what needs attention (FAILs + REVIEWs + MISSINGs).
  3. Offer clear action buttons (CONFIRM / EDIT / MANUAL / MANAGER / CANCEL).
  4. Never spam — one message per form, even if 10 fields fail.
  5. Tag manager only on critical issues (Unsafe, not REVIEW).
"""

from __future__ import annotations
from typing import Optional

from .decision_engine import FormDecision, Disposition

# Per-store manager handles (Telegram or WhatsApp @mention)
# Keys must match StoreSchema.store_name exactly (see schemas/stores.py)
MANAGERS = {
    "Bandera Road": "Miles",
    "Stone Oak":    "Edga",
    "The Rim":      "David",
}


def build_confirmation_reply(decision: FormDecision) -> str:
    """
    Build the WhatsApp message text. Returns plain text — WhatsApp markdown
    is *italic*, *bold*, ~strikethrough~.

    Reply structure:

      [HEADER: store + date + shift + employee]
      Confirmed: X/Y readings
      Review needed: list of (id = raw -> proposed value) with confidence
      Fails: list of (id = value vs target) [if any] -> manager tag
      Missing: list of (id) [if any]
      Actions: CONFIRM | EDIT <id> <value> | MANUAL | MANAGER | CANCEL
    """
    lines = []
    total = len(decision.decisions)
    n_pass = sum(1 for d in decision.decisions if d.disposition == Disposition.PASS)

    # Header
    store = decision.store or "(store ?)"
    date = decision.date or "(date ?)"
    shift = decision.shift or ""
    employee = decision.employee_name or ""

    header_bits = [f"*{store}*", date]
    if shift:    header_bits.append(shift)
    if employee: header_bits.append(f"by {employee}")
    lines.append(" · ".join(header_bits))

    lines.append("")
    lines.append(f"✓ Confirmed *{n_pass}/{total}* readings")

    # Reviews — needs human eyes (medium urgency)
    reviews = decision.reviews
    if reviews:
        lines.append("")
        lines.append("⚠ *Need to confirm* (low confidence or implausible):")
        for d in reviews:
            v = "—" if d.value is None else f"{d.value:g}°F"
            conf = int(d.confidence * 100)
            raw = d.raw_text or "?"
            lines.append(f"  • {d.field_id} — read '{raw}' → {v} ({conf}%) {d.notes}".rstrip())

    # Fails — corrective action needed (high urgency)
    fails = decision.fails
    if fails:
        lines.append("")
        lines.append("🚨 *Out of range — needs corrective action:*")
        for d in fails:
            v = f"{d.value:g}°F"
            target = f"{d.target_op} {d.target:g}°F"
            lines.append(f"  • {d.display}: {v} (target {target})")
        if decision.store and decision.store in MANAGERS:
            lines.append(f"\nManager: @{MANAGERS[decision.store]}")

    # Missing
    if decision.missing:
        lines.append("")
        lines.append("◌ *Missing / illegible:*")
        for d in decision.missing:
            lines.append(f"  • {d.display} ({d.field_id})")

    # Action menu
    lines.append("")
    lines.append("Reply with:")
    if not decision.needs_human_review:
        lines.append("  *CONFIRM* — save all readings as shown")
    else:
        lines.append("  *CONFIRM* — accept all proposed values")
        lines.append("  *EDIT <field_id> <value>* — fix one reading (e.g., EDIT FRYER_1 358)")
        lines.append("  *MANUAL* — start over by typing all values")
    lines.append("  *MANAGER* — escalate this form to the manager")
    lines.append("  *CANCEL* — discard this submission")

    return "\n".join(lines)


def build_alert_message(decision: FormDecision) -> Optional[str]:
    """
    Build a separate alert to the Management Group when there are food-safety
    violations. Returns None if no alert needed.

    Per old Phase 13: one alert per form, not one per field.
    """
    fails = decision.fails
    if not fails:
        return None

    store = decision.store or "(store?)"
    manager = MANAGERS.get(store, "(no manager assigned)")
    lines = [
        f"🚨 *Food safety alert* — {store}",
        f"Form: {decision.date or '?'} {decision.shift or ''}".rstrip(),
        f"Logged by: {decision.employee_name or '?'}",
        "",
        f"*{len(fails)} reading(s) out of range:*",
    ]
    for d in fails:
        v = f"{d.value:g}°F"
        target = f"{d.target_op} {d.target:g}°F"
        lines.append(f"  • {d.display}: {v} (target {target})")
        if d.corrective_action:
            lines.append(f"    → {d.corrective_action}")

    lines.append(f"\n@{manager} please confirm corrective action was taken.")
    return "\n".join(lines)

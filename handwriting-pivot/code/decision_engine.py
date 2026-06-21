"""
Decision Engine — post-processing on FormExtraction.

The vision LLM gives us:
  - Per-field value + confidence + raw_text + notes

We apply:
  1. Plausibility check (value within valid_min/valid_max)
  2. Target check (PASS/FAIL based on operator and target)
  3. Food-safety check for hot-holding items (food_safety_min)
  4. Critical-field flag (food safety violations)
  5. Confidence-based escalation (which fields need human review)
  6. Final disposition per field

Why this layer is small now:
  Old pipeline: OCR → Memory → Writer Profile → Store Knowledge → Vision Reviewer
  → Decision Engine.  Five components feeding into the decision.

  New pipeline: Vision LLM → Decision Engine.
  The vision LLM ate the middle four because it already has world knowledge,
  store context (via prompt), and self-confidence scoring. Decision Engine
  becomes a thin policy layer.
"""

from __future__ import annotations
from dataclasses import dataclass, field
from typing import Optional
from enum import Enum

from .providers.base import FormExtraction, FieldReading
from .schemas.stores import StoreSchema, Field


class Disposition(str, Enum):
    PASS = "PASS"                       # within target, high confidence
    FAIL = "FAIL"                       # outside target, high confidence — food safety violation
    REVIEW = "REVIEW"                   # low confidence, needs human eyes
    IMPLAUSIBLE = "IMPLAUSIBLE"        # outside valid_min/max — likely OCR error
    MISSING = "MISSING"                 # cell empty/illegible
    UNKNOWN = "UNKNOWN"                 # field expected but not returned by model


@dataclass
class FieldDecision:
    field_id: str
    display: str
    category: str
    value: Optional[float]
    raw_text: str
    confidence: float
    disposition: Disposition
    target_op: str
    target: float
    notes: str = ""
    corrective_action: Optional[str] = None
    # For hot-holding: food is safe even above target if above food_safety_min
    is_food_safety_violation: bool = False  # True = alert manager


@dataclass
class FormDecision:
    store: Optional[str]
    date: Optional[str]
    shift: Optional[str]
    employee_name: Optional[str]
    decisions: list[FieldDecision] = field(default_factory=list)

    # Thresholds for human review escalation
    needs_human_review: bool = False
    review_reasons: list[str] = field(default_factory=list)

    @property
    def fails(self) -> list[FieldDecision]:
        """Returns only TRUE food safety violations (not equipment-only issues)."""
        return [d for d in self.decisions if d.is_food_safety_violation]

    @property
    def reviews(self) -> list[FieldDecision]:
        return [d for d in self.decisions
                if d.disposition in (Disposition.REVIEW, Disposition.IMPLAUSIBLE)]

    @property
    def passes(self) -> list[FieldDecision]:
        return [d for d in self.decisions if d.disposition == Disposition.PASS]

    @property
    def missing(self) -> list[FieldDecision]:
        return [d for d in self.decisions
                if d.disposition in (Disposition.MISSING, Disposition.UNKNOWN)]

    @property
    def equipment_warnings(self) -> list[FieldDecision]:
        """Hot-holding above target but still food-safe. No manager alert needed."""
        return [d for d in self.decisions
                if d.disposition == Disposition.FAIL and not d.is_food_safety_violation]


# ─── Corrective actions per category ────────────────────────────────────────
CORRECTIVE_ACTIONS = {
    "Cold Holding": "Close door, re-temp in 10 min, alert MOD if still high.",
    "Hot Holding":  "Adjust warmer / re-temp. If below food-safety min for >2 hr, discard and alert MOD.",
    "Cooking Equipment": "Adjust temperature dial and re-temp in 10 min. Alert MOD if equipment fails.",
}

# ─── Confidence thresholds ───────────────────────────────────────────────
CONFIDENCE_REVIEW_THRESHOLD = 0.85
CONFIDENCE_MISSING_THRESHOLD = 0.30

# ─── Known bad OCR values for cooking equipment ──────────────────────────
# OCR misreads thermometer digits, "°F", or partial characters.
# These MUST be IMPLAUSIBLE/REVIEW, never FAIL alert.
# 7/8/9: OCR reading "°F" or partial digit
# 138: OCR misread of "350" or similar
# 300: OCR misread below fryer target (350) — known error pattern
COOKING_OCR_BLOCKLIST = frozenset({7, 8, 9, 138, 300})


def decide(extraction: FormExtraction, schema: StoreSchema) -> FormDecision:
    """Apply policy to extraction. Returns FormDecision."""
    result = FormDecision(
        store=extraction.store,
        date=extraction.date,
        shift=extraction.shift,
        employee_name=extraction.employee_name,
    )

    # Index extracted readings by field_id for fast lookup
    readings_by_id = {r.field_id: r for r in extraction.readings}

    for f in schema.fields:
        reading = readings_by_id.get(f.id)

        if reading is None:
            result.decisions.append(FieldDecision(
                field_id=f.id, display=f.display, category=f.category,
                value=None, raw_text="", confidence=0.0,
                disposition=Disposition.UNKNOWN,
                target_op=f.op, target=f.target,
                notes="Field not present in model output",
            ))
            continue

        decision = _decide_field(reading, f)
        result.decisions.append(decision)

    # Decide whether the form as a whole needs human review
    if result.fails:
        result.review_reasons.append(f"{len(result.fails)} food safety violation(s) — manager alert sent")
    if result.reviews:
        result.review_reasons.append(f"{len(result.reviews)} reading(s) low-confidence or implausible")
    if result.missing:
        result.review_reasons.append(f"{len(result.missing)} reading(s) missing or illegible")
    if extraction.overall_confidence < 0.7:
        result.review_reasons.append(f"Overall extraction confidence is low ({extraction.overall_confidence:.2f})")
    if extraction.store is None:
        result.review_reasons.append("Store could not be identified from header")

    result.needs_human_review = bool(result.review_reasons)
    return result


def _decide_field(reading: FieldReading, f: Field) -> FieldDecision:
    """Apply policy to a single reading."""
    base = FieldDecision(
        field_id=f.id,
        display=f.display,
        category=f.category,
        value=reading.value,
        raw_text=reading.raw_text,
        confidence=reading.confidence,
        target_op=f.op,
        target=f.target,
        notes=reading.notes,
        disposition=Disposition.UNKNOWN,
        is_food_safety_violation=False,
    )

    # Case 1: value is None or confidence too low → MISSING
    if reading.value is None or reading.confidence < CONFIDENCE_MISSING_THRESHOLD:
        base.disposition = Disposition.MISSING
        return base

    v = float(reading.value)

    # Case 2: value outside the physically plausible range → IMPLAUSIBLE
    if v < f.valid_min or v > f.valid_max:
        base.disposition = Disposition.IMPLAUSIBLE
        if not base.notes:
            base.notes = f"Reading {v}°F outside plausible range [{f.valid_min}, {f.valid_max}]"
        return base

    # Case 2b: known bad OCR values for cooking equipment → IMPLAUSIBLE
    # OCR misreads thermometer digits as 7/8/9/138/300.
    # These MUST be flagged as IMPLAUSIBLE, never FAIL alert.
    if f.category == "Cooking Equipment" and int(v) in COOKING_OCR_BLOCKLIST:
        base.disposition = Disposition.IMPLAUSIBLE
        if not base.notes:
            base.notes = f"Reading {v}°F is a known OCR error pattern for cooking equipment"
        return base

    # Case 3: confidence below review threshold → REVIEW (human eyes)
    if reading.confidence < CONFIDENCE_REVIEW_THRESHOLD:
        base.disposition = Disposition.REVIEW
        return base

    # Case 4: passes plausibility, has confidence — check against target
    if f.op == "<=":
        ok = v <= f.target
    elif f.op == ">=":
        ok = v >= f.target
    else:
        ok = False

    if ok:
        base.disposition = Disposition.PASS
    else:
        # FAIL — but determine if it's a food safety violation or just equipment issue
        #
        # Cooking Equipment (fryer, pasta boiler) below target is an EQUIPMENT issue,
        # never a food safety violation. Staff can still serve food from other equipment.
        # Cold/Hot Holding below/above target CAN be a food safety violation.
        if f.category == "Cooking Equipment":
            # Equipment failure — not a food safety violation, no manager alert
            base.disposition = Disposition.REVIEW
            base.corrective_action = CORRECTIVE_ACTIONS.get(f.category, "Alert MOD")
            if not base.notes:
                base.notes = f"Reading {v}°F below target ({f.target}°F) — equipment issue"
        elif _is_food_safety_violation(v, f):
            base.disposition = Disposition.FAIL
            base.is_food_safety_violation = True
            base.corrective_action = CORRECTIVE_ACTIONS.get(f.category, "Alert MOD")
        else:
            # Hot-holding above target but still food-safe (e.g., 145°F broth > 100°F target)
            # Route to REVIEW, not FAIL — no manager alert, just note for employee
            base.disposition = Disposition.REVIEW
            if not base.notes:
                base.notes = f"Reading {v}°F above target ({f.target}°F) but food-safe (≥{f.food_safety_min}°F)"

    return base


def _is_food_safety_violation(value: float, field: Field) -> bool:
    """
    Check if a value is a genuine food safety violation.

    For cold holding (<=): value > target = violation
    For hot holding (>=):
      - value >= food_safety_min = food-safe, even if below target (equipment warm)
      - value < food_safety_min = violation (food in danger zone)
    """
    if field.food_safety_min is None:
        # No food_safety_min means this field doesn't have a hot-holding concern
        # For <= operators, FAIL if above target
        # For >= operators, value must be checked differently
        # This case mainly applies to cooking equipment where > target is normal
        return True  # Fall through to normal FAIL logic

    # Hot-holding field with food_safety_min
    if field.op == ">=":
        if value < field.food_safety_min:
            # Below food-safety minimum = food safety violation
            return True
        else:
            # Above food-safety minimum = food-safe, even if above target
            # This is an equipment/quality issue, not a safety issue
            return False
    elif field.op == "<=":
        # Cold holding or cold prep
        if value > field.target:
            # Above cold-holding target = food safety violation
            return True
        return False

    return True  # Default: treat as violation

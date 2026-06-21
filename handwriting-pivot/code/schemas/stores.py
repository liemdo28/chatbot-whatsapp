"""
Per-store form schemas.

Each store has a different paper form layout, so the vision LLM gets a
store-specific prompt + JSON schema describing what fields to extract
and what valid ranges look like.

Field IDs match the Node.js formTemplates.json exactly:
  RIM-01..19, SO-01..19, BAN-01..19

The threshold ranges are embedded in the prompt — this gives the vision LLM
the context to flag "138" when target is 350-360 (Phase 8 Store Knowledge
in the old pipeline, now folded into the single LLM call).
"""

from __future__ import annotations
from dataclasses import dataclass
from typing import Literal, Optional


@dataclass(frozen=True)
class Field:
    """One temperature reading on the form."""
    id: str                    # canonical ID, e.g. "RIM-01"
    display: str               # human label, e.g. "Walk-In Cooler (Produce)"
    category: str              # "Cold Holding" | "Hot Holding" | "Cooking Equipment"
    op: Literal["<=", ">="]
    target: float               # threshold temperature in °F
    valid_min: float           # impossible-below for plausibility
    valid_max: float           # impossible-above for plausibility
    photo_required: bool = False
    food_safety_min: Optional[float] = None


@dataclass(frozen=True)
class StoreSchema:
    store_name: str
    store_code: str
    whatsapp_group: str
    template_version: str
    fields: tuple[Field, ...]


# ─── RIM (B1 The Rim) — 19 fields matching formTemplates.json ────────────
RIM = StoreSchema(
    store_name="The Rim",
    store_code="RIM",
    whatsapp_group="B1 Kitchen Log",
    template_version="v3",
    fields=(
        Field("RIM-01",  "Walk-In Cooler (Produce)",   "Cold Holding", "<=",  40, -20,  80, photo_required=True),
        Field("RIM-02",  "Walk-In Freezer",             "Cold Holding", "<=",   0, -40,  50, photo_required=True),
        Field("RIM-03",  "Prep Area Cooler",            "Cold Holding", "<=",  40, -20,  80),
        Field("RIM-04",  "Bowl Warmer",                 "Hot Holding",  ">=", 100,  50, 200, food_safety_min=135),
        Field("RIM-05",  "Ramen Reach-In Top",          "Cold Holding", "<=",  40, -20,  80),
        Field("RIM-06",  "Ramen Reach-In Below",        "Cold Holding", "<=",  40, -20,  80),
        Field("RIM-07",  "Line Freezer",                "Cold Holding", "<=",   0, -40,  50, photo_required=True),
        Field("RIM-08",  "Seasoned Eggs",               "Hot Holding",  ">=", 100,  50, 200, photo_required=True, food_safety_min=135),
        Field("RIM-09",  "Sliced Pork Hot",             "Hot Holding",  ">=", 100,  50, 200, food_safety_min=135),
        Field("RIM-10",  "Diced Pork Hot",              "Hot Holding",  ">=", 100,  50, 200, food_safety_min=135),
        Field("RIM-11",  "Tapas Reach-In Top",          "Cold Holding", "<=",  40, -20,  80),
        Field("RIM-12",  "Chicken Cold",                "Cold Holding", "<=",  40, -20,  80),
        Field("RIM-13",  "Pork Cold",                   "Cold Holding", "<=",  40, -20,  80),
        Field("RIM-14",  "Tapas Reach-In Below",        "Cold Holding", "<=",  40, -20,  80),
        Field("RIM-15",  "Walk-In Produce Recheck",     "Cold Holding", "<=",  40, -20,  80),
        Field("RIM-16",  "Fryer Left",                  "Cooking Equipment", ">=", 350, 100, 450, photo_required=True),
        Field("RIM-17",  "Fryer Right",                 "Cooking Equipment", ">=", 350, 100, 450, photo_required=True),
        Field("RIM-18",  "Pasta Boiler Left",           "Cooking Equipment", ">=", 200, 100, 250),
        Field("RIM-19",  "Pasta Boiler Right",          "Cooking Equipment", ">=", 200, 100, 250),
    ),
)

# ─── SO (B2 Stone Oak) — 19 fields matching formTemplates.json ───────────
STONE_OAK = StoreSchema(
    store_name="Stone Oak",
    store_code="STONE_OAK",
    whatsapp_group="B2 Kitchen Log",
    template_version="v3",
    fields=(
        Field("SO-01",  "Walk-In Cooler (Produce)",     "Cold Holding", "<=",  40, -20,  80, photo_required=True),
        Field("SO-02",  "Walk-In Freezer",              "Cold Holding", "<=",   0, -40,  50, photo_required=True),
        Field("SO-03",  "Prep Area Cooler",             "Cold Holding", "<=",  40, -20,  80),
        Field("SO-04",  "Bowl Warmer",                  "Hot Holding",  ">=", 100,  50, 200, food_safety_min=135),
        Field("SO-05",  "Ramen Reach-In Top",           "Cold Holding", "<=",  40, -20,  80),
        Field("SO-06",  "Ramen Reach-In Below",         "Cold Holding", "<=",  40, -20,  80),
        Field("SO-07",  "Line Freezer",                 "Cold Holding", "<=",   0, -40,  50, photo_required=True),
        Field("SO-08",  "Seasoned Eggs",                "Hot Holding",  ">=", 100,  50, 200, photo_required=True, food_safety_min=135),
        Field("SO-09",  "Sliced Pork Hot",              "Hot Holding",  ">=", 100,  50, 200, food_safety_min=135),
        Field("SO-10",  "Diced Pork Hot",               "Hot Holding",  ">=", 100,  50, 200, food_safety_min=135),
        Field("SO-11",  "Tapas Reach-In Top",           "Cold Holding", "<=",  40, -20,  80),
        Field("SO-12",  "Chicken Cold",                 "Cold Holding", "<=",  40, -20,  80),
        Field("SO-13",  "Pork Cold",                    "Cold Holding", "<=",  40, -20,  80),
        Field("SO-14",  "Tapas Reach-In Below",         "Cold Holding", "<=",  40, -20,  80),
        Field("SO-15",  "Walk-In Produce Recheck",      "Cold Holding", "<=",  40, -20,  80),
        Field("SO-16",  "Fryer Left",                   "Cooking Equipment", ">=", 350, 100, 450, photo_required=True),
        Field("SO-17",  "Fryer Right",                  "Cooking Equipment", ">=", 350, 100, 450, photo_required=True),
        Field("SO-18",  "Pasta Boiler Left",            "Cooking Equipment", ">=", 200, 100, 250),
        Field("SO-19",  "Pasta Boiler Right",           "Cooking Equipment", ">=", 200, 100, 250),
    ),
)

# ─── BAN (B3 Bandera) — 19 fields matching formTemplates.json ────────────
BANDERA = StoreSchema(
    store_name="Bandera Road",
    store_code="BANDERA",
    whatsapp_group="B3 Kitchen Log",
    template_version="v3",
    fields=(
        Field("BAN-01",  "Walk-In Cooler (Produce)",    "Cold Holding", "<=",  40, -20,  80, photo_required=True),
        Field("BAN-02",  "Walk-In Freezer",             "Cold Holding", "<=",   0, -40,  50, photo_required=True),
        Field("BAN-03",  "Prep Area Cooler",            "Cold Holding", "<=",  40, -20,  80),
        Field("BAN-04",  "Bowl Warmer",                 "Hot Holding",  ">=", 100,  50, 200, food_safety_min=135),
        Field("BAN-05",  "Ramen Reach-In Top",          "Cold Holding", "<=",  40, -20,  80),
        Field("BAN-06",  "Ramen Reach-In Below",        "Cold Holding", "<=",  40, -20,  80),
        Field("BAN-07",  "Line Freezer",                "Cold Holding", "<=",   0, -40,  50, photo_required=True),
        Field("BAN-08",  "Seasoned Eggs",               "Hot Holding",  ">=", 100,  50, 200, photo_required=True, food_safety_min=135),
        Field("BAN-09",  "Sliced Pork Hot",             "Hot Holding",  ">=", 100,  50, 200, food_safety_min=135),
        Field("BAN-10",  "Diced Pork Hot",              "Hot Holding",  ">=", 100,  50, 200, food_safety_min=135),
        Field("BAN-11",  "Tapas Reach-In Top",          "Cold Holding", "<=",  40, -20,  80),
        Field("BAN-12",  "Chicken Cold",                "Cold Holding", "<=",  40, -20,  80),
        Field("BAN-13",  "Pork Cold",                   "Cold Holding", "<=",  40, -20,  80),
        Field("BAN-14",  "Tapas Reach-In Below",        "Cold Holding", "<=",  40, -20,  80),
        Field("BAN-15",  "Walk-In Produce Recheck",     "Cold Holding", "<=",  40, -20,  80),
        Field("BAN-16",  "Fryer Left",                  "Cooking Equipment", ">=", 350, 100, 450, photo_required=True),
        Field("BAN-17",  "Fryer Right",                 "Cooking Equipment", ">=", 350, 100, 450, photo_required=True),
        Field("BAN-18",  "Pasta Boiler Left",           "Cooking Equipment", ">=", 200, 100, 250),
        Field("BAN-19",  "Pasta Boiler Right",          "Cooking Equipment", ">=", 200, 100, 250),
    ),
)

ALL_SCHEMAS = {
    "BANDERA": BANDERA,
    "STONE_OAK": STONE_OAK,
    "RIM": RIM,
}

GROUP_TO_SCHEMA = {s.whatsapp_group: s for s in ALL_SCHEMAS.values()}


def resolve_store(*, group_name: str = None, header_text: str = None) -> StoreSchema | None:
    """
    Resolve a store using the required resolution order:

    1. Group Mapping (authoritative) — exact WhatsApp group name match
    2. Header Detection — read store name from form header via vision LLM
    3. Template Signature Detection — match field IDs (RIM-XX, SO-XX, BAN-XX)
    4. Manual Confirmation — return None; caller must ask user

    Header text takes precedence over group when both present (header is
    what the vision LLM actually saw on the paper).
    """
    # Step 1: Group Mapping (authoritative)
    if group_name:
        group_result = GROUP_TO_SCHEMA.get(group_name)
        if group_result is not None:
            return group_result

    # Step 2: Header Detection
    if header_text:
        upper = header_text.upper()
        if "BANDERA" in upper:    return BANDERA
        if "STONE OAK" in upper:  return STONE_OAK
        if "THE RIM" in upper or "RIM" in upper.split(): return RIM

    # Steps 3-4 are handled by the caller (template signature from extraction
    # field IDs, or manual confirmation prompt). Return None to signal unresolved.
    return None


def resolve_store_from_field_ids(field_ids: list[str]) -> StoreSchema | None:
    """
    Step 3: Template Signature Detection.
    If field IDs start with RIM-xx, SO-xx, or BAN-xx, resolve from that.
    This is a last resort before asking for manual confirmation.
    """
    if not field_ids:
        return None
    sample_ids = [fid.upper() for fid in field_ids[:5]]
    rim_count = sum(1 for fid in sample_ids if fid.startswith("RIM-"))
    so_count = sum(1 for fid in sample_ids if fid.startswith("SO-"))
    ban_count = sum(1 for fid in sample_ids if fid.startswith("BAN-"))
    # Need at least 2 matching field IDs for confidence
    if rim_count >= 2:
        return RIM
    if so_count >= 2:
        return STONE_OAK
    if ban_count >= 2:
        return BANDERA
    return None

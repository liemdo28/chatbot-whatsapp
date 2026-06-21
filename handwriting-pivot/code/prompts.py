"""
Prompt builder for vision LLM form extraction.

Generates a store-specific prompt that:
  1. Tells the model what kind of form this is
  2. Lists the exact fields to extract (per-store)
  3. Embeds threshold + plausibility ranges (so model knows "138" for
     fryer is impossible — built-in store knowledge)
  4. Demands a strict JSON output format
  5. Requests per-field confidence scoring
  6. Extracts BOTH shift columns (10AM + 4PM) in one call
"""

from __future__ import annotations
import json
from .schemas.stores import StoreSchema


SYSTEM_INSTRUCTION = (
    "You are a food-safety auditor reading handwritten kitchen temperature log forms.\n"
    "Your job is to extract temperature readings written by line cooks at the start\n"
    "of shift. The handwriting is often rushed and may include cross-outs, smudges,\n"
    "or values that look implausible.\n\n"
    "CRITICAL ROW ALIGNMENT RULES:\n"
    "- Forms are TABLES with labeled rows and time columns (Open/Mid/Late).\n"
    "- READ EACH ROW CAREFULLY: follow the horizontal line from the row label\n"
    "  to the correct cell. Do NOT mix up values between adjacent rows.\n"
    "- Walk-in freezers are ALWAYS near 0°F (-10 to 10°F range). If you see\n"
    "  a value > 20°F in a freezer row, you are reading the WRONG ROW.\n"
    "- Fryers typically read 300-380°F. Cold holding units (coolers, fridges)\n"
    "  read 33-45°F. Never confuse a cooler reading with a fryer or vice versa.\n"
    "- Hot holding (broth, eggs, warmers) reads 100-250°F.\n\n"
    "Rules:\n"
    "1. Read each numeric cell carefully. Distinguish 0/6, 1/7, 3/8, 5/6.\n"
    "   - A '0' written for freezer is valid. Do not confuse with '10' or '100'.\n"
    "   - Two-digit vs three-digit: '38' in a cold unit is correct; '380' in a\n"
    "     cold unit means you read from the wrong row.\n"
    "2. If a cell is empty, illegible, or crossed out, report value=null.\n"
    "3. For each reading, give a confidence score 0.0-1.0:\n"
    "   - 1.0 = unambiguous, clearly written, single digit set\n"
    "   - 0.8 = clear but minor smudge or one ambiguous digit\n"
    "   - 0.5 = strong guess, multiple possible readings\n"
    "   - 0.2 = barely legible\n"
    "   - 0.0 = couldn't read at all (then value=null too)\n"
    "4. Apply common sense: if a written value is far outside the target range,\n"
    "   re-examine the cell and the row label. You may be reading the wrong row.\n"
    "   KEEP the literal reading but lower confidence and add a note if unsure.\n"
    "   Do NOT silently correct values.\n"
    "5. The 'raw_text' field is what you literally see written, exactly as scribbled.\n"
    "6. Output ONLY the JSON object. No commentary, no markdown fences.\n"
    "7. DOUBLE-CHECK each value: for every field, verify the row label matches\n"
    "   the expected category. Cold items ≤ 45°F, hot items ≥ 100°F, fryers ≥ 300°F."
)


def build_prompt(schema: StoreSchema) -> str:
    """Build the user prompt for a given store schema."""
    field_lines = []
    for f in schema.fields:
        target_str = f"{f.op} {f.target}°F"
        plausible_str = f"plausible range: {f.valid_min} to {f.valid_max}°F"
        food_safe = f", food-safe if ≥{f.food_safety_min}°F" if f.food_safety_min else ""
        field_lines.append(
            f"- {f.id} ({f.display}, {f.category}): target {target_str}, {plausible_str}{food_safe}"
        )

    fields_section = "\n".join(field_lines)

    prompt = f"""\
{SYSTEM_INSTRUCTION}

This is a food-safety line check form from {schema.store_name} (store code {schema.store_code}).
Template version: {schema.template_version}.

Extract the following fields for BOTH time columns (10AM/OPEN and 4PM/MID).
Some forms have only one column. Extract whichever columns are visible.

FIELDS TO EXTRACT (in order):
{fields_section}

ALSO EXTRACT:
- store: which store the form is from (read the header). One of: "Bandera Road", "Stone Oak", "Rim", or null if unclear.
- date: date written on the form (ISO 8601 YYYY-MM-DD if possible, else the raw text as written).
- employee_name_10am: the name written on the form for the 10AM/OPEN shift (string or null).
- employee_name_4pm: the name written on the form for the 4PM/MID shift (string or null).

IMPORTANT: For each field, return BOTH 10AM AND 4PM values. Use null if that column is empty or the form only has one column.

OUTPUT FORMAT: a single JSON object. No prose, no fences. Structure:
{{
  "store": "...",
  "date": "...",
  "readings": [
    {{
      "field_id": "BAN-01",   // use the exact ID from FIELDS TO EXTRACT above
      "v_10am": 42,       // value for 10AM/OPEN column, or null
      "v_4pm": 40,        // value for 4PM/MID column, or null
      "confidence_10am": 0.98,  // 0.0-1.0
      "confidence_4pm": 0.97,
      "raw_text_10am": "42",
      "raw_text_4pm": "40",
      "notes": ""
    }},
    ...
  ]
}}
"""
    return prompt


def build_json_schema(schema: StoreSchema) -> dict:
    """Build a JSON schema (Gemini-style responseSchema) for two-shift extraction."""
    field_ids = [f.id for f in schema.fields]

    return {
        "type": "object",
        "properties": {
            "store": {"type": "string", "nullable": True},
            "date": {"type": "string", "nullable": True},
            "readings": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "field_id": {"type": "string", "enum": field_ids},
                        "v_10am": {"type": "number", "nullable": True},
                        "v_4pm": {"type": "number", "nullable": True},
                        "confidence_10am": {"type": "number"},
                        "confidence_4pm": {"type": "number"},
                        "raw_text_10am": {"type": "string"},
                        "raw_text_4pm": {"type": "string"},
                        "notes": {"type": "string"},
                    },
                    "required": ["field_id", "v_10am", "v_4pm", "confidence_10am", "confidence_4pm", "raw_text_10am", "raw_text_4pm"],
                },
            },
        },
        "required": ["store", "readings"],
    }

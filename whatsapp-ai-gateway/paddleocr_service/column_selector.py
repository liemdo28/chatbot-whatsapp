"""
column_selector.py
==================
Automatic column selection logic for food safety forms.
Implements the new rule:
  - If only 10am has values → select 10am
  - If only 4pm has values → select 4pm
  - If both have values → select 4pm (later/current record)
  - Only ask user if confidence is too low or ambiguous
"""

from typing import List, Dict, Any, Optional, Tuple


# Minimum confidence to auto-accept a cell as "filled"
MIN_CONFIDENCE = 0.30

# If filled ratio difference < this, column is ambiguous (both could be valid)
AMBIGUITY_THRESHOLD = 0.1

# If neither column has any filled cells above confidence, ask user
MIN_FILLED_FOR_AUTO = 1


def count_filled_cells(column_data: List[Dict[str, Any]]) -> int:
    """Count cells that have a non-null value above confidence threshold."""
    return sum(
        1 for cell in column_data
        if cell.get("value") is not None and cell.get("confidence", 0) >= MIN_CONFIDENCE
    )


def avg_confidence(column_data: List[Dict[str, Any]]) -> float:
    """Average confidence across all cells in a column."""
    confs = [c.get("confidence", 0) for c in column_data if c.get("value") is not None]
    return sum(confs) / len(confs) if confs else 0.0


def select_column_auto(
    ten_am: List[Dict[str, Any]],
    four_pm: List[Dict[str, Any]],
) -> Tuple[str, str]:
    """
    Automatically select the column based on filled cell counts.

    Returns:
        (selected_column, selection_reason)

    selected_column: "10am" | "4pm" | "ASK_USER"
    selection_reason: human-readable explanation
    """
    ten_filled = count_filled_cells(ten_am)
    four_filled = count_filled_cells(four_pm)

    ten_ratio = ten_filled / len(ten_am) if ten_am else 0
    four_ratio = four_filled / len(four_pm) if four_pm else 0
    ratio_diff = abs(four_ratio - ten_ratio)

    # Neither column has values
    if ten_filled < MIN_FILLED_FOR_AUTO and four_filled < MIN_FILLED_FOR_AUTO:
        return "ASK_USER", "neither_column_has_values"

    # Only 10am has values
    if four_filled < MIN_FILLED_FOR_AUTO and ten_filled >= MIN_FILLED_FOR_AUTO:
        return "10am", "only_10am_column_has_values"

    # Only 4pm has values
    if ten_filled < MIN_FILLED_FOR_AUTO and four_filled >= MIN_FILLED_FOR_AUTO:
        return "4pm", "only_4pm_column_has_values"

    # Both have values
    if four_filled > 0 and ten_filled > 0:
        # Rule: prefer 4pm when both have values
        if ratio_diff <= AMBIGUITY_THRESHOLD:
            # Ambiguous: both roughly equal - prefer 4pm as later record
            return "4pm", "both_columns_filled_prefer_4pm_later_record"
        else:
            # Clear winner - still prefer 4pm as current record
            return "4pm", "both_columns_filled_prefer_4pm_current_record"

    # Fallback
    return "4pm", "fallback_default_4pm"


def should_ask_user(
    ten_am: List[Dict[str, Any]],
    four_pm: List[Dict[str, Any]],
    selected_column: str,
) -> Tuple[bool, Optional[str]]:
    """
    Determine if we should ask the user to confirm column selection.

    Returns:
        (should_ask, reason)
    """
    ten_filled = count_filled_cells(ten_am)
    four_filled = count_filled_cells(four_pm)

    ten_conf = avg_confidence(ten_am)
    four_conf = avg_confidence(four_pm)

    # Ask if confidence is very low for the selected column
    selected_conf = ten_conf if selected_column == "10am" else four_conf
    if selected_conf < MIN_CONFIDENCE and (ten_filled + four_filled) > 0:
        return True, f"low_confidence_selected_column_{selected_column}_conf_{selected_conf:.2f}"

    # Ask if both columns have significant values but our auto-select is uncertain
    if ten_filled > 0 and four_filled > 0:
        ratio_diff = abs(four_filled / len(four_pm) - ten_filled / len(ten_am))
        if ratio_diff < AMBIGUITY_THRESHOLD:
            return True, f"ambiguous_column_both_filled_ten={ten_filled}_four={four_filled}"

    return False, None


def format_column_prompt(
    ten_am: List[Dict[str, Any]],
    four_pm: List[Dict[str, Any]],
    lang: str = "ES",
) -> str:
    """Format a user prompt to select the column."""
    ten_filled = count_filled_cells(ten_am)
    four_filled = count_filled_cells(four_pm)
    ten_conf = avg_confidence(ten_am)
    four_conf = avg_confidence(four_pm)

    ten_pct = int(ten_conf * 100)
    four_pct = int(four_conf * 100)
    if lang == "EN":
        lines = [
            "Detected temperatures in both columns.",
            "10:00 AM: " + str(ten_filled) + " fields filled (confidence: " + str(ten_pct) + "%)",
            "4:00 PM:  " + str(four_filled) + " fields filled (confidence: " + str(four_pct) + "%)",
            "",
            "Which shift are you submitting?",
            "1 = 10:00 AM",
            "2 = 4:00 PM",
        ]
    else:
        lines = [
            "Se detectaron temperaturas en ambas columnas.",
            "10:00 AM: " + str(ten_filled) + " campos completados (confianza: " + str(ten_pct) + "%)",
            "4:00 PM:  " + str(four_filled) + " campos completados (confianza: " + str(four_pct) + "%)",
            "",
            "Cual turno esta enviando?",
            "1 = 10:00 AM",
            "2 = 4:00 PM",
        ]
    return "\n".join(lines)

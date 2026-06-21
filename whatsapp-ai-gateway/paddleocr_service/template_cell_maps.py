"""
Template Cell Coordinate Maps for PaddleOCR Cell Extraction
=============================================================
Coordinates are normalized 0-1 range (relative to image dimensions).
Calibrate by: open form image, run calibration_tool.py to auto-detect coordinates.

Format per field:
  field_id: { x1, y1, x2, y2 }  -- normalized rectangle for the temperature cell
"""

TEMPLATE_CELL_MAPS = {
    "FoodSafety-StoneOak-v3": {
        "store_id": "stone_oak",
        "store_name": "Stone Oak",
        "store_code": "B2",
        "template_id": "FoodSafety-StoneOak-v3",
        "field_prefix": "SO",
        "form_type": "19_item",
        "columns": {
            "10am": {
                "label_col_x": 0.44, "label_col_w": 0.18,
            },
            "4pm": {
                "label_col_x": 0.62, "label_col_w": 0.18,
            },
        },
        "fields": {
            "SO-01": {"y1": 0.20,  "y2": 0.235, "range_min": 30,  "range_max": 45,  "unit": "F"},
            "SO-02": {"y1": 0.235, "y2": 0.27,  "range_min": -20, "range_max": 5,   "unit": "F"},
            "SO-03": {"y1": 0.27,  "y2": 0.305, "range_min": 30,  "range_max": 45,  "unit": "F"},
            "SO-04": {"y1": 0.305, "y2": 0.34,  "range_min": 100, "range_max": 125, "unit": "F"},
            "SO-05": {"y1": 0.34,  "y2": 0.375, "range_min": 30,  "range_max": 45,  "unit": "F"},
            "SO-06": {"y1": 0.375, "y2": 0.41,  "range_min": 30,  "range_max": 45,  "unit": "F"},
            "SO-07": {"y1": 0.41,  "y2": 0.445, "range_min": -20, "range_max": 0,   "unit": "F"},
            "SO-08": {"y1": 0.445, "y2": 0.48,  "range_min": 95,  "range_max": 105, "unit": "F"},
            "SO-09": {"y1": 0.48,  "y2": 0.515, "range_min": 95,  "range_max": 105, "unit": "F"},
            "SO-10": {"y1": 0.515, "y2": 0.55,  "range_min": 95,  "range_max": 105, "unit": "F"},
            "SO-11": {"y1": 0.55,  "y2": 0.585, "range_min": 30,  "range_max": 45,  "unit": "F"},
            "SO-12": {"y1": 0.585, "y2": 0.62,  "range_min": 30,  "range_max": 40,  "unit": "F"},
            "SO-13": {"y1": 0.62,  "y2": 0.655, "range_min": 30,  "range_max": 40,  "unit": "F"},
            "SO-14": {"y1": 0.655, "y2": 0.69,  "range_min": 30,  "range_max": 45,  "unit": "F"},
            "SO-15": {"y1": 0.69,  "y2": 0.725, "range_min": 30,  "range_max": 45,  "unit": "F"},
            "SO-16": {"y1": 0.725, "y2": 0.76,  "range_min": 350, "range_max": 360, "unit": "F"},
            "SO-17": {"y1": 0.76,  "y2": 0.795, "range_min": 350, "range_max": 360, "unit": "F"},
            "SO-18": {"y1": 0.795, "y2": 0.83,  "range_min": 200, "range_max": 220, "unit": "F"},
            "SO-19": {"y1": 0.83,  "y2": 0.865, "range_min": 200, "range_max": 220, "unit": "F"},
        },
        "item_labels": {
            "SO-01": "Walk-In Cooler (Produce)",
            "SO-02": "Walk-In Freezer",
            "SO-03": "Prep Area Cooler",
            "SO-04": "Bowl Warmer",
            "SO-05": "Ramen Reach-In Top",
            "SO-06": "Ramen Reach-In Below",
            "SO-07": "Line Freezer",
            "SO-08": "Seasoned Eggs",
            "SO-09": "Sliced Pork Hot",
            "SO-10": "Diced Pork Hot",
            "SO-11": "Tapas Reach-In Top",
            "SO-12": "Chicken Cold",
            "SO-13": "Pork Cold",
            "SO-14": "Tapas Reach-In Below",
            "SO-15": "Walk-In Produce Recheck",
            "SO-16": "Fryer Left",
            "SO-17": "Fryer Right",
            "SO-18": "Pasta Boiler Left",
            "SO-19": "Pasta Boiler Right",
        },
    },

    "FoodSafety-Rim-v3": {
        "store_id": "rim",
        "store_name": "The Rim",
        "store_code": "B1",
        "template_id": "FoodSafety-Rim-v3",
        "field_prefix": "RIM",
        "form_type": "19_item",
        "columns": {
            "10am": {"label_col_x": 0.40, "label_col_w": 0.18},
            "4pm":  {"label_col_x": 0.58, "label_col_w": 0.18},
        },
        "fields": {
            "RIM-01": {"y1": 0.20,  "y2": 0.235, "range_min": 30,  "range_max": 45,  "unit": "F"},
            "RIM-02": {"y1": 0.235, "y2": 0.27,  "range_min": -20, "range_max": 5,   "unit": "F"},
            "RIM-03": {"y1": 0.27,  "y2": 0.305, "range_min": 30,  "range_max": 45,  "unit": "F"},
            "RIM-04": {"y1": 0.305, "y2": 0.34,  "range_min": 100, "range_max": 125, "unit": "F"},
            "RIM-05": {"y1": 0.34,  "y2": 0.375, "range_min": 30,  "range_max": 45,  "unit": "F"},
            "RIM-06": {"y1": 0.375, "y2": 0.41,  "range_min": 30,  "range_max": 45,  "unit": "F"},
            "RIM-07": {"y1": 0.41,  "y2": 0.445, "range_min": -20, "range_max": 0,   "unit": "F"},
            "RIM-08": {"y1": 0.445, "y2": 0.48,  "range_min": 95,  "range_max": 105, "unit": "F"},
            "RIM-09": {"y1": 0.48,  "y2": 0.515, "range_min": 95,  "range_max": 105, "unit": "F"},
            "RIM-10": {"y1": 0.515, "y2": 0.55,  "range_min": 95,  "range_max": 105, "unit": "F"},
            "RIM-11": {"y1": 0.55,  "y2": 0.585, "range_min": 30,  "range_max": 45,  "unit": "F"},
            "RIM-12": {"y1": 0.585, "y2": 0.62,  "range_min": 30,  "range_max": 40,  "unit": "F"},
            "RIM-13": {"y1": 0.62,  "y2": 0.655, "range_min": 30,  "range_max": 40,  "unit": "F"},
            "RIM-14": {"y1": 0.655, "y2": 0.69,  "range_min": 30,  "range_max": 45,  "unit": "F"},
            "RIM-15": {"y1": 0.69,  "y2": 0.725, "range_min": 30,  "range_max": 45,  "unit": "F"},
            "RIM-16": {"y1": 0.725, "y2": 0.76,  "range_min": 350, "range_max": 360, "unit": "F"},
            "RIM-17": {"y1": 0.76,  "y2": 0.795, "range_min": 350, "range_max": 360, "unit": "F"},
            "RIM-18": {"y1": 0.795, "y2": 0.83,  "range_min": 200, "range_max": 220, "unit": "F"},
            "RIM-19": {"y1": 0.83,  "y2": 0.865, "range_min": 200, "range_max": 220, "unit": "F"},
        },
        "item_labels": {
            "RIM-01": "Walk-In Cooler (Produce)",
            "RIM-02": "Walk-In Freezer",
            "RIM-03": "Prep Area Cooler",
            "RIM-04": "Bowl Warmer",
            "RIM-05": "Ramen Reach-In Top",
            "RIM-06": "Ramen Reach-In Below",
            "RIM-07": "Line Freezer",
            "RIM-08": "Seasoned Eggs",
            "RIM-09": "Sliced Pork Hot",
            "RIM-10": "Diced Pork Hot",
            "RIM-11": "Tapas Reach-In Top",
            "RIM-12": "Chicken Cold",
            "RIM-13": "Pork Cold",
            "RIM-14": "Tapas Reach-In Below",
            "RIM-15": "Walk-In Produce Recheck",
            "RIM-16": "Fryer Left",
            "RIM-17": "Fryer Right",
            "RIM-18": "Pasta Boiler Left",
            "RIM-19": "Pasta Boiler Right",
        },
    },

    "FoodSafety-Bandera-v3": {
        "store_id": "bandera",
        "store_name": "Bandera",
        "store_code": "B3",
        "template_id": "FoodSafety-Bandera-v3",
        "field_prefix": "BAN",
        "form_type": "19_item",
        "columns": {
            "10am": {"label_col_x": 0.40, "label_col_w": 0.18},
            "4pm":  {"label_col_x": 0.58, "label_col_w": 0.18},
        },
        "fields": {
            "BAN-01": {"y1": 0.20,  "y2": 0.235, "range_min": 30,  "range_max": 45,  "unit": "F"},
            "BAN-02": {"y1": 0.235, "y2": 0.27,  "range_min": -20, "range_max": 5,   "unit": "F"},
            "BAN-03": {"y1": 0.27,  "y2": 0.305, "range_min": 30,  "range_max": 45,  "unit": "F"},
            "BAN-04": {"y1": 0.305, "y2": 0.34,  "range_min": 100, "range_max": 125, "unit": "F"},
            "BAN-05": {"y1": 0.34,  "y2": 0.375, "range_min": 30,  "range_max": 45,  "unit": "F"},
            "BAN-06": {"y1": 0.375, "y2": 0.41,  "range_min": 30,  "range_max": 45,  "unit": "F"},
            "BAN-07": {"y1": 0.41,  "y2": 0.445, "range_min": -20, "range_max": 0,   "unit": "F"},
            "BAN-08": {"y1": 0.445, "y2": 0.48,  "range_min": 95,  "range_max": 105, "unit": "F"},
            "BAN-09": {"y1": 0.48,  "y2": 0.515, "range_min": 95,  "range_max": 105, "unit": "F"},
            "BAN-10": {"y1": 0.515, "y2": 0.55,  "range_min": 95,  "range_max": 105, "unit": "F"},
            "BAN-11": {"y1": 0.55,  "y2": 0.585, "range_min": 30,  "range_max": 45,  "unit": "F"},
            "BAN-12": {"y1": 0.585, "y2": 0.62,  "range_min": 30,  "range_max": 40,  "unit": "F"},
            "BAN-13": {"y1": 0.62,  "y2": 0.655, "range_min": 30,  "range_max": 40,  "unit": "F"},
            "BAN-14": {"y1": 0.655, "y2": 0.69,  "range_min": 30,  "range_max": 45,  "unit": "F"},
            "BAN-15": {"y1": 0.69,  "y2": 0.725, "range_min": 30,  "range_max": 45,  "unit": "F"},
            "BAN-16": {"y1": 0.725, "y2": 0.76,  "range_min": 350, "range_max": 360, "unit": "F"},
            "BAN-17": {"y1": 0.76,  "y2": 0.795, "range_min": 350, "range_max": 360, "unit": "F"},
            "BAN-18": {"y1": 0.795, "y2": 0.83,  "range_min": 200, "range_max": 220, "unit": "F"},
            "BAN-19": {"y1": 0.83,  "y2": 0.865, "range_min": 200, "range_max": 220, "unit": "F"},
        },
        "item_labels": {
            "BAN-01": "Walk-In Cooler (Produce)",
            "BAN-02": "Walk-In Freezer",
            "BAN-03": "Prep Area Cooler",
            "BAN-04": "Bowl Warmer",
            "BAN-05": "Ramen Reach-In Top",
            "BAN-06": "Ramen Reach-In Below",
            "BAN-07": "Line Freezer",
            "BAN-08": "Seasoned Eggs",
            "BAN-09": "Sliced Pork Hot",
            "BAN-10": "Diced Pork Hot",
            "BAN-11": "Tapas Reach-In Top",
            "BAN-12": "Chicken Cold",
            "BAN-13": "Pork Cold",
            "BAN-14": "Tapas Reach-In Below",
            "BAN-15": "Walk-In Produce Recheck",
            "BAN-16": "Fryer Left",
            "BAN-17": "Fryer Right",
            "BAN-18": "Pasta Boiler Left",
            "BAN-19": "Pasta Boiler Right",
        },
    },
}


def get_template(template_id):
    return TEMPLATE_CELL_MAPS.get(template_id)


def get_all_templates():
    return TEMPLATE_CELL_MAPS


def get_field_ids(template_id):
    template = TEMPLATE_CELL_MAPS.get(template_id)
    if not template:
        return []
    return list(template.get("fields", {}).keys())


def get_column_x_range(template_id, column_key):
    """Returns (x1, x2) pixel range for a given column key in normalized coords."""
    template = TEMPLATE_CELL_MAPS.get(template_id)
    if not template:
        return None, None
    col = template.get("columns", {}).get(column_key)
    if not col:
        return None, None
    return col["label_col_x"], col["label_col_x"] + col["label_col_w"]


def get_cell_coords(template_id, field_id, column_key):
    """Returns pixel coordinates (x1, y1, x2, y2) for a specific cell.

    Args:
        template_id: e.g. "FoodSafety-StoneOak-v3"
        field_id: e.g. "SO-01"
        column_key: "10am" or "4pm"

    Returns:
        tuple (x1, y1, x2, y2) in absolute pixels (call with img_h, img_w)
    """
    template = TEMPLATE_CELL_MAPS.get(template_id)
    if not template:
        return None
    field = template.get("fields", {}).get(field_id)
    if not field:
        return None
    col_info = template.get("columns", {}).get(column_key)
    if not col_info:
        return None
    return {
        "x1": col_info["label_col_x"],
        "y1": field["y1"],
        "x2": col_info["label_col_x"] + col_info["label_col_w"],
        "y2": field["y2"],
    }


def get_all_cell_coords(template_id, column_key, img_width=1200, img_height=1600):
    """Returns all field IDs and their absolute pixel coords for a given column.

    Args:
        template_id: template name
        column_key: "10am" or "4pm"
        img_width: actual image width in pixels
        img_height: actual image height in pixels

    Returns:
        dict: { field_id: {x1, y1, x2, y2} } with absolute pixel values
    """
    template = TEMPLATE_CELL_MAPS.get(template_id)
    if not template:
        return {}
    col_info = template.get("columns", {}).get(column_key)
    if not col_info:
        return {}
    result = {}
    for field_id, field in template.get("fields", {}).items():
        result[field_id] = {
            "x1": int(col_info["label_col_x"] * img_width),
            "y1": int(field["y1"] * img_height),
            "x2": int((col_info["label_col_x"] + col_info["label_col_w"]) * img_width),
            "y2": int(field["y2"] * img_height),
        }
    return result


def get_expected_values(template_id):
    """Returns a list of (field_id, range_min, range_max) for a template."""
    template = TEMPLATE_CELL_MAPS.get(template_id)
    if not template:
        return []
    return [
        (fid, f["range_min"], f["range_max"])
        for fid, f in template.get("fields", {}).items()
    ]

"""
cell_extractor.py
==================
PaddleOCR-based cell extraction engine.
Processes each temperature cell individually using template coordinates.

DEV1 FIX: Added cell crop upscaling pipeline, blank cell detection,
          and debug crop saving for accuracy proof.
"""

import re
import io
import os
import cv2
import numpy as np
from typing import Optional, List, Dict, Any, Tuple

# PaddleOCR imports
from paddleocr import PaddleOCR

# Local modules
from template_cell_maps import TEMPLATE_CELL_MAPS, get_template, get_all_cell_coords
from form_preprocessor import crop_to_region, preprocess_cell, enlarge_cell


# --- DEV1 FIX: Cell Crop Preprocessing Constants ---
MIN_CELL_WIDTH = 180
MIN_CELL_HEIGHT = 96
UPSCALE_FACTOR = 3
PADDING_PX = 8


# --- DEV1 FIX: Blank Cell Detection ---

def is_cell_blank(cell_img, white_threshold=0.92):
    if cell_img is None or cell_img.size == 0:
        return True
    gray = cell_img
    if len(cell_img.shape) == 3:
        gray = cv2.cvtColor(cell_img, cv2.COLOR_BGR2GRAY)
    _, binary = cv2.threshold(gray, 200, 255, cv2.THRESH_BINARY)
    white_fraction = np.sum(binary == 255) / binary.size
    variance = np.var(gray.astype(np.float64))
    return white_fraction > white_threshold and variance < 500


def is_cell_dash_or_line(cell_img):
    if cell_img is None or cell_img.size == 0:
        return False
    gray = cell_img
    if len(cell_img.shape) == 3:
        gray = cv2.cvtColor(cell_img, cv2.COLOR_BGR2GRAY)
    _, binary = cv2.threshold(gray, 180, 255, cv2.THRESH_BINARY_INV)
    row_sums = np.sum(binary, axis=1) / 255
    col_sums = np.sum(binary, axis=0) / 255
    max_row_density = np.max(row_sums) if row_sums.size > 0 else 0
    max_col_density = np.max(col_sums) if col_sums.size > 0 else 0
    total_dark = np.sum(binary > 0)
    h, w = gray.shape[:2]
    total_pixels = h * w
    has_horizontal_line = max_row_density > w * 0.3
    is_thin = total_dark < total_pixels * 0.05
    no_vertical = max_col_density < h * 0.15
    return has_horizontal_line and is_thin and no_vertical


# --- DEV1 FIX: Cell Crop Upscaling Pipeline ---

def upscale_cell_for_ocr(cell_img, target_width=MIN_CELL_WIDTH,
                         target_height=MIN_CELL_HEIGHT,
                         upscale_factor=UPSCALE_FACTOR,
                         save_path=None):
    if cell_img is None or cell_img.size == 0:
        return cell_img

    h, w = cell_img.shape[:2]

    # Step 1: Add white padding
    padded = cv2.copyMakeBorder(
        cell_img, PADDING_PX, PADDING_PX, PADDING_PX, PADDING_PX,
        cv2.BORDER_CONSTANT, value=(255, 255, 255)
    )
    ph, pw = padded.shape[:2]

    # Step 2: Upscale to meet minimum dimensions
    scale_w = max(1, target_width / pw)
    scale_h = max(1, target_height / ph)
    scale = max(scale_w, scale_h, upscale_factor)
    new_w = int(pw * scale)
    new_h = int(ph * scale)
    upscaled = cv2.resize(padded, (new_w, new_h), interpolation=cv2.INTER_CUBIC)

    # Step 3: Grayscale
    gray = upscaled
    if len(upscaled.shape) == 3:
        gray = cv2.cvtColor(upscaled, cv2.COLOR_BGR2GRAY)

    # Step 4: CLAHE contrast normalization
    clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(4, 4))
    enhanced = clahe.apply(gray)

    # Step 5: Adaptive threshold
    binary = cv2.adaptiveThreshold(
        enhanced, 255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY_INV,
        blockSize=11, C=5
    )

    # Step 6: Remove grid lines
    bh, bw = binary.shape[:2]
    horizontal_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (max(bw // 15, 15), 1))
    detected_h_lines = cv2.morphologyEx(binary, cv2.MORPH_OPEN, horizontal_kernel, iterations=1)
    binary = cv2.subtract(binary, detected_h_lines)
    vertical_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (1, max(bh // 15, 15)))
    detected_v_lines = cv2.morphologyEx(binary, cv2.MORPH_OPEN, vertical_kernel, iterations=1)
    binary = cv2.subtract(binary, detected_v_lines)

    # Invert so text is white on black (PaddleOCR prefers this)
    result = cv2.bitwise_not(binary)

    # Save debug crops if path provided
    if save_path:
        try:
            os.makedirs(os.path.dirname(save_path), exist_ok=True)
            raw_path = save_path.replace("processed_crop.png", "raw_crop.png")
            cv2.imwrite(raw_path, cell_img)
            cv2.imwrite(save_path, result)
        except Exception:
            pass

    return result


# --- OCR Digit Normalizer ---

def normalize_ocr_digit(text):
    if not text or not isinstance(text, str):
        return None
    normalized = text.strip()
    normalized = re.sub(r"[\u2013\u2014\u2212]", "-", normalized)
    normalized = re.sub(r"[\u00b0\u00ba\u2122\u2019]", "", normalized)
    normalized = re.sub(r"[Oo]", "0", normalized)
    normalized = re.sub(r"[Ll]", "1", normalized)
    normalized = re.sub(r"[Ss]", "5", normalized)
    normalized = re.sub(r"[Bb]", "8", normalized)
    normalized = re.sub(r"[^0-9.\-]", "", normalized)
    normalized = re.sub(r"^-0+", "-", normalized)
    normalized = re.sub(r"^(?!-)(0+)", lambda m: m.group(1).lstrip("0") or "0", normalized)
    if normalized.count(".") > 1:
        return None
    if re.search(r"[^-]\-", normalized):
        return None
    if not normalized or normalized == "." or normalized == "-":
        return None
    try:
        value = float(normalized)
    except ValueError:
        return None
    if value < -50 or value > 500:
        return None
    return value


def is_likely_temperature(text):
    if not text:
        return False
    cleaned = re.sub(r"[\u2013\u2014\u00b0\u00ba]", "-", text)
    cleaned = re.sub(r"[LlOo]", "1", cleaned)
    cleaned = re.sub(r"[^0-9.\-]", "", cleaned)
    return bool(re.match(r"^-?\d+\.?\d*$", cleaned.strip()))


# --- PaddleOCR Cell Reader ---

class CellOCRReader:
    def __init__(self, use_angle_cls=True, lang="en", show_log=False, use_gpu=False):
        try:
            self.ocr = PaddleOCR(lang=lang)
        except TypeError:
            self.ocr = PaddleOCR(use_angle_cls=use_angle_cls, lang=lang,
                                  show_log=show_log, use_gpu=use_gpu)

    def read_cell_text(self, cell_img, debug=False):
        is_color = len(cell_img.shape) == 3
        if is_color:
            rgb = cv2.cvtColor(cell_img, cv2.COLOR_BGR2RGB)
        else:
            rgb = cv2.cvtColor(cell_img, cv2.COLOR_GRAY2RGB)
        ok, buf = cv2.imencode(".png", rgb)
        if not ok:
            return "", 0.0
        try:
            result = self.ocr.predict(rgb)
        except (TypeError, AttributeError):
            try:
                result = self.ocr.ocr(buf.tobytes(), cls=True)
            except Exception:
                return "", 0.0
        if not result:
            return "", 0.0
        texts = []
        confidences = []
        first = result[0] if result else None
        if first is not None:
            rec_texts = []
            rec_scores = []
            if isinstance(first, dict):
                rec_texts = first.get("rec_texts", []) or []
                rec_scores = first.get("rec_scores", []) or []
            elif hasattr(first, "rec_texts"):
                rec_texts = getattr(first, "rec_texts", []) or []
                rec_scores = getattr(first, "rec_scores", []) or []
            if rec_texts:
                for text, score in zip(rec_texts, rec_scores):
                    texts.append(str(text).strip())
                    confidences.append(float(score) if score is not None else 0.5)
        elif isinstance(first, list):
            lines = first
            if lines:
                for line in lines:
                    if isinstance(line, list) and len(line) >= 2:
                        text_info = line[1]
                        if isinstance(text_info, tuple) and len(text_info) >= 2:
                            text, conf = text_info
                            texts.append(str(text).strip())
                            confidences.append(conf)
                        elif isinstance(text_info, str):
                            texts.append(str(text_info).strip())
                            confidences.append(0.5)
                    elif isinstance(line, dict):
                        text = line.get("text", "")
                        conf = line.get("confidence", 0.5)
                        texts.append(str(text).strip())
                        confidences.append(conf)
        combined_text = " ".join(texts).strip()
        avg_conf = sum(confidences) / len(confidences) if confidences else 0.0
        if debug:
            print(f"  [CellOCR] text='{combined_text}' conf={avg_conf:.3f}")
        return combined_text, avg_conf

    def read_digit_only(self, cell_img):
        text, conf = self.read_cell_text(cell_img)
        value = normalize_ocr_digit(text)
        if value is None and text.strip():
            conf = conf * 0.3
        return value, conf


# --- Template-Based Cell Extraction ---

class TemplateCellExtractor:
    def __init__(self, use_gpu=False, debug=False, debug_crop_dir=None):
        self.reader = CellOCRReader(use_gpu=use_gpu, show_log=debug)
        self.debug = debug
        self.debug_crop_dir = debug_crop_dir

    def extract_cell_value(self, form_img, template_id, field_id, column_key):
        template = get_template(template_id)
        if not template:
            return {"field_id": field_id, "error": "unknown_template"}
        field_info = template["fields"].get(field_id)
        if not field_info:
            return {"field_id": field_id, "error": "unknown_field"}
        img_h, img_w = form_img.shape[:2]
        col_info = template["columns"].get(column_key)
        if not col_info:
            return {"field_id": field_id, "error": f"unknown_column:{column_key}"}
        x1 = int(col_info["label_col_x"] * img_w)
        x2 = int((col_info["label_col_x"] + col_info["label_col_w"]) * img_w)
        y1 = int(field_info["y1"] * img_h)
        y2 = int(field_info["y2"] * img_h)
        cell_raw = crop_to_region(form_img, x1, y1, x2, y2)
        if cell_raw.size == 0:
            return {
                "field_id": field_id, "column": column_key,
                "raw_text": "", "value": None, "confidence": 0.0,
                "status": "EMPTY_CROP",
                "range_min": field_info["range_min"],
                "range_max": field_info["range_max"],
                "range": f"{field_info['range_min']}-{field_info['range_max']}",
            }

        # DEV1 FIX: Blank cell detection BEFORE OCR
        if is_cell_blank(cell_raw):
            if self.debug:
                print(f"  [BLANK] {field_id}: cell is blank")
            return {
                "field_id": field_id, "column": column_key,
                "raw_text": "", "value": None, "confidence": 1.0,
                "status": "MISSING",
                "range_min": field_info["range_min"],
                "range_max": field_info["range_max"],
                "range": f"{field_info['range_min']}-{field_info['range_max']}",
                "item": template["item_labels"].get(field_id, field_id),
                "unit": field_info.get("unit", "F"),
                "blank_detected": True,
            }

        # DEV1 FIX: Dash detection BEFORE OCR
        if is_cell_dash_or_line(cell_raw):
            if self.debug:
                print(f"  [DASH] {field_id}: cell contains only a dash/line")
            return {
                "field_id": field_id, "column": column_key,
                "raw_text": "-", "value": None, "confidence": 1.0,
                "status": "MISSING",
                "range_min": field_info["range_min"],
                "range_max": field_info["range_max"],
                "range": f"{field_info['range_min']}-{field_info['range_max']}",
                "item": template["item_labels"].get(field_id, field_id),
                "unit": field_info.get("unit", "F"),
                "blank_detected": True,
            }

        # DEV1 FIX: Cell crop upscaling pipeline
        # Build debug crop save path
        save_path = None
        if self.debug_crop_dir:
            save_path = os.path.join(
                self.debug_crop_dir,
                f"{field_id}_{column_key}_processed_crop.png"
            )

        cell_processed = upscale_cell_for_ocr(cell_raw, save_path=save_path)

        # Also save the cell raw crop dimensions for proof
        raw_h, raw_w = cell_raw.shape[:2]

        # OCR on upscaled cell
        raw_text, ocr_conf = self.reader.read_cell_text(cell_processed, debug=self.debug)
        value, norm_conf = self.reader.read_digit_only(cell_processed)

        confidence = ocr_conf * 0.6 + (1.0 if value is not None else 0.0) * 0.4
        confidence = round(confidence, 4)

        if value is None:
            status = "MISSING"
        else:
            rm, rx = field_info["range_min"], field_info["range_max"]
            status = "SAFE" if rm <= value <= rx else "WARNING"

        result = {
            "field_id": field_id,
            "column": column_key,
            "raw_text": raw_text,
            "value": value,
            "confidence": confidence,
            "status": status,
            "range_min": field_info["range_min"],
            "range_max": field_info["range_max"],
            "range": f"{field_info['range_min']}-{field_info['range_max']}",
            "item": template["item_labels"].get(field_id, field_id),
            "unit": field_info.get("unit", "F"),
            "raw_crop_size": f"{raw_w}x{raw_h}",
        }

        if self.debug:
            print(f"  [OCR] {field_id}: raw_text='{raw_text}' value={value} "
                  f"conf={confidence:.3f} status={status} crop={raw_w}x{raw_h}")

        return result

    def extract_column(self, form_img, template_id, column_key):
        template = get_template(template_id)
        if not template:
            return []
        results = []
        for field_id in template["fields"]:
            result = self.extract_cell_value(form_img, template_id, field_id, column_key)
            results.append(result)
        return results

    def extract_all(self, form_img, template_id):
        return {
            "10am": self.extract_column(form_img, template_id, "10am"),
            "4pm":  self.extract_column(form_img, template_id, "4pm"),
        }


def extract_full_form(form_img, template_id, selected_column,
                      use_gpu=False, debug=False, debug_crop_dir=None):
    extractor = TemplateCellExtractor(use_gpu=use_gpu, debug=debug, debug_crop_dir=debug_crop_dir)
    template = get_template(template_id)
    if not template:
        return {"error": "unknown_template", "template_id": template_id}

    all_columns = extractor.extract_all(form_img, template_id)
    ten_am = all_columns.get("10am", [])
    four_pm = all_columns.get("4pm", [])

    def count_filled(column_data):
        return sum(1 for cell in column_data if cell.get("value") is not None)

    ten_filled = count_filled(ten_am)
    four_filled = count_filled(four_pm)

    if selected_column is None:
        if four_filled > 0 and ten_filled > 0:
            selected = "4pm"
        elif four_filled > 0:
            selected = "4pm"
        elif ten_filled > 0:
            selected = "10am"
        else:
            selected = "ASK_USER"
    else:
        selected = "10am" if "10" in str(selected_column) else "4pm"

    selected_data = all_columns.get(selected, []) if selected != "ASK_USER" else []
    unselected_data = all_columns.get("10am" if selected == "4pm" else "4pm", [])

    items = []
    for cell in selected_data:
        items.append({
            "id": cell.get("field_id"),
            "value": cell.get("value"),
            "range": cell.get("range"),
            "status": "SAFE" if cell.get("status") == "SAFE" else
                      ("WARNING" if cell.get("status") == "WARNING" else "UNCLEAR"),
            "raw_text": cell.get("raw_text"),
            "confidence": cell.get("confidence"),
            "column_10am_value": None,
            "column_4pm_value": None,
            "raw_crop_size": cell.get("raw_crop_size"),
            "blank_detected": cell.get("blank_detected", False),
        })

    for i, cell in enumerate(selected_data):
        items[i]["column_10am_value"] = ten_am[i].get("value") if i < len(ten_am) else None
        items[i]["column_4pm_value"] = four_pm[i].get("value") if i < len(four_pm) else None

    return {
        "store_code": template.get("store_code", "B2"),
        "store_name": template.get("store_name", "Unknown"),
        "template_id": template_id,
        "selected_column": None if selected == "ASK_USER" else ("10:00 AM" if selected == "10am" else "4:00 PM"),
        "needs_review": selected == "ASK_USER",
        "selection_reason": "neither_column_has_values" if selected == "ASK_USER" else "auto_selected",
        "column_10am_filled": ten_filled,
        "column_4pm_filled": four_filled,
        "items": items,
    }

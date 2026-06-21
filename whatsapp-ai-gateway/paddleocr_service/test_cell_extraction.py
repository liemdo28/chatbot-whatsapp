"""
test_cell_extraction.py
=======================
Test script for PaddleOCR cell extraction pipeline.
Run after installing dependencies: python test_cell_extraction.py

Usage:
  python test_cell_extraction.py [image_path] [template_id]

Example:
  python test_cell_extraction.py test_images/stone_oak_clear.jpg FoodSafety-StoneOak-v3
"""

import sys
import os
import json
import time

# Add service directory to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from form_preprocessor import preprocess_form, load_image_from_bytes
from cell_extractor import extract_full_form
from column_selector import select_column_auto, format_column_prompt
from template_cell_maps import get_template, get_all_templates


# Expected values for Stone Oak form (ground truth)
STONE_OAK_EXPECTED = {
    "SO-01": 30, "SO-02": 0,  "SO-03": 35, "SO-04": 100, "SO-05": 40,
    "SO-06": 40, "SO-07": 0,  "SO-08": 100, "SO-09": 101, "SO-10": 102,
}

RIM_EXPECTED = {
    "RIM-01": 30,  "RIM-02": -20, "RIM-03": 35, "RIM-04": 100, "RIM-05": 40,
    "RIM-06": 40, "RIM-07": -15, "RIM-08": 100, "RIM-09": 101, "RIM-10": 102,
    "RIM-11": 39, "RIM-12": 41, "RIM-13": 39, "RIM-14": 38, "RIM-15": 40,
    "RIM-16": 351, "RIM-17": 352, "RIM-18": 210, "RIM-19": 210,
}


def compute_accuracy(results, expected):
    """Compute field-level accuracy."""
    correct = 0
    total = 0
    errors = []
    for item in results:
        fid = item.get("id") or item.get("field_id")
        if fid not in expected:
            continue
        val = item.get("value")
        exp = expected[fid]
        total += 1
        if val == exp:
            correct += 1
        else:
            errors.append({
                "field_id": fid,
                "expected": exp,
                "detected": val,
                "raw_text": item.get("raw_text"),
                "confidence": item.get("confidence"),
            })
    accuracy = correct / total if total > 0 else 0.0
    return accuracy, errors


def run_test(image_path, template_id="FoodSafety-StoneOak-v3"):
    """Run a single extraction test."""
    print(f"\n{'='*70}")
    print(f"TEST: {os.path.basename(image_path)}")
    print(f"Template: {template_id}")
    print(f"{'='*70}")

    if not os.path.exists(image_path):
        print(f"[ERROR] Image not found: {image_path}")
        return None

    # Step 1: Load & preprocess
    t0 = time.time()
    processed, meta = preprocess_form(
        image_path=image_path,
        apply_perspective=True,
        enhance=True,
    )
    preprocess_time = time.time() - t0
    print(f"\n[1] Preprocessing: {preprocess_time:.2f}s")
    print(f"    Steps: {meta.get('steps', [])}")
    if meta.get("perspective"):
        print(f"    Perspective: corrected={meta['perspective'].get('corrected')}")

    # Step 2: Extract
    t1 = time.time()
    result = extract_full_form(
        form_img=processed,
        template_id=template_id,
        selected_column=None,  # auto-select
        use_gpu=False,
        debug=False,
    )
    extract_time = time.time() - t1
    print(f"\n[2] Extraction: {extract_time:.2f}s")
    print(f"    Selected column: {result.get('selected_column')}")
    print(f"    10am filled: {result.get('column_10am_filled', 'N/A')}")
    print(f"    4pm filled: {result.get('column_4pm_filled', 'N/A')}")

    items = result.get("items", [])
    print(f"\n[3] Results ({len(items)} items):")
    hdr = "{:<8} {:<10} {:<15} {:<10}".format("ID", "Value", "Range", "Status")
    print(f"    {hdr}")
    for item in items:
        fid = item.get("id") or item.get("field_id", "?")
        val = item.get("value")
        val_str = str(val) if val is not None else "MISSING"
        rng = item.get("range", "")
        sts = item.get("status", "UNK")
        print(f"    {fid:<8} {val_str:<10} {rng:<15} {sts:<10}")

    # Compute accuracy
    if template_id == "FoodSafety-StoneOak-v3":
        expected = STONE_OAK_EXPECTED
    elif template_id == "FoodSafety-Rim-v3":
        expected = RIM_EXPECTED
    else:
        expected = {}

    if expected:
        acc, errors = compute_accuracy(items, expected)
        print(f"\n[4] Accuracy: {acc:.1%} ({len(errors)} errors)")
        for err in errors:
            print(f"    ERROR: {err['field_id']} expected={err['expected']} got={err['detected']} raw='{err['raw_text']}'")

    return result


def run_negative_temperature_tests():
    """P0: Verify negative temperature OCR preserves minus sign."""
    print("\n[P0 UNIT TESTS] Negative Temperature Recognition")
    print("=" * 60)
    from cell_extractor import normalize_ocr_digit

    # All minus styles that must be recognized
    minus_styles = ["-", "–", "—", "−"]
    test_values = [-20, -15, -10, -5, 0, 5]

    all_passed = True
    for val in test_values:
        for style in minus_styles:
            if val < 0:
                raw = style + str(abs(val))
            else:
                raw = str(val)
            result = normalize_ocr_digit(raw)
            ok = result == float(val)
            status = "PASS" if ok else "FAIL"
            print(f"  [{status}] normalize_ocr_digit('{raw}') = {result}  (expected {val})")
            if not ok:
                all_passed = False

    # Explicit must-not-drop tests
    must_preserve = [
        ("-20", -20.0), ("-15", -15.0), ("-10", -10.0),
        ("-5", -5.0), ("-030", -30.0), ("—15", -15.0),
        ("–10", -10.0), ("−5", -5.0),
        # Positive with degree symbol
        ("5°", 5.0), ("0°", 0.0),
    ]
    print("\n[P0] Must-Preserve Minus Sign Tests:")
    for raw, expected in must_preserve:
        result = normalize_ocr_digit(raw)
        ok = result == expected
        status = "PASS" if ok else "FAIL"
        print(f"  [{status}] normalize_ocr_digit('{raw}') = {result}  (expected {expected})")
        if not ok:
            all_passed = False

    # Must-NEVER convert negative to positive
    must_not_become_positive = [("-20", 20.0), ("-15", 15.0), ("-10", 10.0), ("-5", 5.0)]
    print("\n[P0] Must-NEVER Drop Minus (these are FAIL if value becomes positive):")
    for raw, wrong_positive in must_not_become_positive:
        result = normalize_ocr_digit(raw)
        if result is not None and result > 0:
            print(f"  [FAIL] normalize_ocr_digit('{raw}') = {result}  ← MINUS WAS DROPPED! (expected negative)")
            all_passed = False
        elif result is None:
            print(f"  [FAIL] normalize_ocr_digit('{raw}') = None  ← REJECTED! (expected {wrong_positive * -1})")
            all_passed = False
        else:
            print(f"  [PASS] normalize_ocr_digit('{raw}') = {result}  (correctly negative)")

    # Freezer range validation
    print("\n[P0] Freezer Range Validation:")
    freezer_tests = [
        ("SO-02", -10.0, -10, 0, True),   # In range
        ("RIM-02", -20.0, -20, 5, True),  # In range
        ("RIM-07", -15.0, -20, 0, True),  # In range
        ("SO-02", 0.0, -10, 0, True),     # Boundary: 0 is valid for Walk-In Freezer
        ("RIM-07", 5.0, -20, 0, False),   # Out of range: 5 > 0
        ("RIM-02", 10.0, -20, 5, False),  # Out of range
    ]
    for field_id, value, rmin, rmax, expect_safe in freezer_tests:
        in_range = rmin <= value <= rmax
        ok = (in_range == expect_safe)
        status = "PASS" if ok else "FAIL"
        print(f"  [{status}] {field_id} value={value} range=[{rmin},{rmax}] → {'SAFE' if in_range else 'WARNING'} (expected {'SAFE' if expect_safe else 'WARNING'})")

    print("\n" + "=" * 60)
    overall = "ALL PASS" if all_passed else "SOME FAILURES"
    print(f"Negative Temperature OCR: {overall}")
    return all_passed


def main():
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        print("\nNo image provided. Running all unit tests...\n")
        print("=" * 60)
        print("[UNIT TESTS] Digit Normalizer (Standard):")
        from cell_extractor import normalize_ocr_digit
        test_cases = [
            ("30", 30), ("0", 0), ("35", 35), ("100", 100),
            ("101", 101), ("102", 102), ("39", 39), ("41", 41),
            ("351", 351), ("352", 352), ("210", 210),
            ("3O", 30), ("l00", 100), ("—15", -15), ("5°", 5),
            ("-030", -30), ("030", 30), ("–10", -10), ("−5", -5),
        ]
        passed = 0
        for text, expected in test_cases:
            result = normalize_ocr_digit(text)
            ok = result == expected
            status = "PASS" if ok else "FAIL"
            print(f"  [{status}] normalize_ocr_digit('{text}') = {result} (expected {expected})")
            if ok:
                passed += 1
        print(f"\nDigit normalizer: {passed}/{len(test_cases)} passed")

        print("\n")
        run_negative_temperature_tests()
        return

    image_path = args[0]
    template_id = args[1] if len(args) > 1 else "FoodSafety-StoneOak-v3"

    result = run_test(image_path, template_id)
    if result:
        print(f"\n[COMPLETE] JSON output:")
        print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()

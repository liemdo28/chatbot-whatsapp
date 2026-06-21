"""
D2 Locked Ground Truth Evaluation
===================================
Runs Vision LLM pipeline on form images and compares against CEO-locked GT.

RULE: GT is read from locked_ground_truth.json. This file MUST NOT be modified
during eval. Any change requires RFC + CEO approval.

Usage:
    cd handwriting-pivot

    # Default — Gemini Flash (free tier, fast)
    set GEMINI_API_KEY=your-key
    python eval/run_locked_eval.py

    # Claude Vision via configured proxy
    set CLAUDE_API_KEY=your-key
    python eval/run_locked_eval.py --provider claude

    # Compare both (run sequentially, output goes to suffixed files)
    python eval/run_locked_eval.py --provider both

Output:
    - Per-cell match table (stdout)
    - eval/locked_eval_results_{provider}.json
    - Confidence calibration analysis
    - Latency breakdown
"""
import argparse
import json
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from code.pipeline import FormPipeline
from code.providers.gemini_flash import GeminiFlashProvider
from code.providers.claude_vision import ClaudeVisionProvider

# Path to CEO-locked ground truth
LOCKED_GT_PATH = Path(__file__).parent / "locked_ground_truth.json"
FIXTURES_DIR = Path(__file__).parent / "fixtures"
EVAL_DIR = Path(__file__).parent  # eval dir has form_bandera.png, form_stone_oak.png

# Map model field_id → CEO cell_id.
# NEW format: model outputs BAN-01, SO-01, RIM-01 directly (same as GT cell_id) → identity map.
# OLD format (legacy): model outputs generic names like WALK_IN_COOLER → needs explicit mapping.

def _build_identity_map(prefix, count):
    """Build {"BAN-01": "BAN-01", ...} identity mapping for new-format forms."""
    return {f"{prefix}-{i:02d}": f"{prefix}-{i:02d}" for i in range(1, count + 1)}

BAN_FIELD_TO_CELL = _build_identity_map("BAN", 19)
SO_FIELD_TO_CELL = _build_identity_map("SO", 19)
RIM_FIELD_TO_CELL = _build_identity_map("RIM", 19)

# Legacy old format — model outputs generic names like WALK_IN_COOLER
SO_OLD_FIELD_TO_ROW = {
    "WALK_IN_COOLER": "row_01",
    "WALK_IN_FREEZER": "row_02",
    "PREP_AREA_COOLER": "row_03",
    "RAMEN_REACH_BELOW": "row_04",
    "RAMEN_REACH_TOP": "row_05",
    "LINE_FREEZER": "row_06",
    "TAPAS_REACH_BELOW": "row_07",
    "TAPAS_REACH_TOP": "row_08",
    "PORK_CHASHU_COLD": "row_09",
    "CHICKEN_CHASHU_COLD": "row_10",
    "FRYER_1": "row_11",
    "FRYER_2": "row_12",
    "PASTA_BOILER_1": "row_13",
    "PASTA_BOILER_2": "row_14",
    "SEASONED_EGGS": "row_15",
    "PORK_BROTH": "row_16",
    "CHICKEN_BROTH": "row_17",
    "VEGGIE_BROTH": "row_18",
}


def load_locked_gt():
    with open(LOCKED_GT_PATH) as f:
        return json.load(f)


def evaluate_form(pipeline, image_path, form_key, form_gt, field_map, shift=None):
    """Run pipeline on one form image and evaluate against locked GT."""
    if not image_path.exists():
        print(f"  SKIP: Image not found at {image_path}")
        return None

    with open(image_path, "rb") as f:
        img_bytes = f.read()

    group_map = {
        "Bandera Road": "B3 Kitchen Log",
        "Stone Oak": "B2 Kitchen Log",
        "Rim": "B1 Kitchen Log",
    }
    group_name = group_map.get(form_gt.get("store", ""), "B3 Kitchen Log")

    print(f"\n{'='*70}")
    print(f"FORM: {form_key}")
    print(f"Image: {image_path.name} ({len(img_bytes)/1024:.0f} KB)")
    print(f"Store: {form_gt.get('store')}, Date: {form_gt.get('date')}")
    print(f"{'='*70}")

    t0 = time.time()
    result = pipeline.process(image_bytes=img_bytes, group_name=group_name)
    latency = time.time() - t0

    print(f"Provider: {result.extraction.provider} / {result.extraction.model}")
    print(f"Store detected: {result.extraction.store}")
    print(f"Provider latency: {result.extraction.latency_ms}ms")
    print(f"Total latency: {latency:.2f}s")
    print(f"Overall confidence: {result.extraction.overall_confidence:.2f}")
    print(f"Readings returned: {len(result.extraction.readings)}")
    if result.extraction.error:
        print(f"ERROR: {result.extraction.error}")
        return None

    # Build extracted dict by field_id
    extracted = {}
    for rd in result.extraction.readings:
        extracted[rd.field_id.upper()] = rd

    # Compare cell by cell
    cells = form_gt.get("cells", {})
    rows = []

    for cell_id, cell_gt in sorted(cells.items()):
        # Determine which shift value to compare
        if shift == "4PM":
            expected = cell_gt.get("v_4pm")
        elif shift == "10AM":
            expected = cell_gt.get("v_10am")
        elif shift == "11AM":
            expected = cell_gt.get("value")
        else:
            # For dual-shift Bandera, test 4PM first (more common)
            expected = cell_gt.get("v_4pm", cell_gt.get("value"))

        field_id = cell_gt.get("label", "")
        # Find model field_id that maps to this cell
        model_field_id = None
        for mf, cid in field_map.items():
            if cid == cell_id:
                model_field_id = mf
                break

        if model_field_id is None:
            # Try reverse lookup from label keywords
            pass

        # Get model reading
        rd = extracted.get(model_field_id) if model_field_id else None

        got = rd.value if rd else None
        confidence = rd.confidence if rd else 0.0
        raw_text = rd.raw_text if rd else ""

        if expected is None:
            match = got is None  # both null = match
            status = "null_match" if match else "null_mismatch"
        elif got is None:
            match = False
            status = "missing"
        else:
            # ±2°F tolerance
            match = abs(got - expected) <= 2
            status = "match" if match else "mismatch"

        rows.append({
            "cell_id": cell_id,
            "model_field": model_field_id or "?",
            "label": cell_gt.get("label", ""),
            "expected": expected,
            "got": got,
            "confidence": confidence,
            "raw_text": raw_text,
            "match": match,
            "status": status,
        })

        icon = "✅" if match else ("⬜" if expected is None else "❌")
        exp_str = str(expected) if expected is not None else "null"
        got_str = str(got) if got is not None else "null"
        conf_str = f"{confidence:.2f}" if confidence > 0 else "—"
        note = cell_gt.get("note", "")
        note_str = f"  [{note[:50]}]" if note else ""
        print(f"  {icon} {cell_id:8s} {field_id:30s}  GT={exp_str:>6s}  Model={got_str:>6s}  conf={conf_str}{note_str}")

    correct = sum(1 for r in rows if r["match"])
    total = len(rows)
    null_cells = sum(1 for r in rows if r["expected"] is None)
    value_cells = total - null_cells
    value_correct = sum(1 for r in rows if r["match"] and r["expected"] is not None)
    accuracy = (value_correct / value_cells * 100) if value_cells > 0 else 0

    print(f"\n  SUMMARY: {value_correct}/{value_cells} value cells correct = {accuracy:.1f}%")
    print(f"  ({null_cells} null/empty cells, {total} total)")

    return {
        "form_key": form_key,
        "store": form_gt.get("store"),
        "image": str(image_path),
        "shift": shift,
        "provider": result.extraction.provider,
        "model": result.extraction.model,
        "latency_s": round(latency, 2),
        "provider_latency_ms": result.extraction.latency_ms,
        "overall_confidence": result.extraction.overall_confidence,
        "total_cells": total,
        "value_cells": value_cells,
        "null_cells": null_cells,
        "correct": value_correct,
        "accuracy_pct": round(accuracy, 1),
        "cells": rows,
    }


def confidence_calibration(all_results):
    """Check if low-confidence predictions are actually wrong more often."""
    below_85 = []
    above_85 = []
    for result in all_results:
        for cell in result["cells"]:
            if cell["expected"] is None:
                continue  # skip null cells
            if cell["got"] is None:
                continue  # skip missing
            entry = {"cell_id": cell["cell_id"], "confidence": cell["confidence"], "correct": cell["match"]}
            if cell["confidence"] < 0.85:
                below_85.append(entry)
            else:
                above_85.append(entry)

    print(f"\n{'='*70}")
    print("CONFIDENCE CALIBRATION")
    print(f"{'='*70}")
    if below_85:
        error_rate = sum(1 for e in below_85 if not e["correct"]) / len(below_85) * 100
        print(f"  Cells with confidence < 0.85: {len(below_85)} cells, error rate: {error_rate:.1f}%")
        for e in below_85:
            icon = "✅" if e["correct"] else "❌"
            print(f"    {icon} {e['cell_id']}: confidence={e['confidence']:.2f}")
    else:
        print(f"  No cells with confidence < 0.85 (all above threshold)")
        print(f"  This may indicate the model is over-confident — need more ambiguous forms to test")

    if above_85:
        error_rate = sum(1 for e in above_85 if not e["correct"]) / len(above_85) * 100
        print(f"  Cells with confidence >= 0.85: {len(above_85)} cells, error rate: {error_rate:.1f}%")
    return {
        "below_0.85": {"count": len(below_85), "error_rate_pct": round(sum(1 for e in below_85 if not e["correct"]) / len(below_85) * 100, 1) if below_85 else None},
        "above_0.85": {"count": len(above_85), "error_rate_pct": round(sum(1 for e in above_85 if not e["correct"]) / len(above_85) * 100, 1) if above_85 else None},
    }



PROVIDER_FACTORY = {
    "gemini": lambda: GeminiFlashProvider(),
    "claude": lambda: ClaudeVisionProvider(),
}


def run_eval_with_provider(provider_name, gt):
    """Run the full eval for one provider. Writes locked_eval_results_{provider}.json."""
    print("=" * 70)
    print("D2 LOCKED GROUND TRUTH EVALUATION  (%s)" % provider_name.upper())
    print("GT file: %s" % LOCKED_GT_PATH)
    print("GT is LOCKED — do not modify during eval run")
    print("=" * 70)

    factory = PROVIDER_FACTORY[provider_name]
    pipeline = FormPipeline(primary=factory())
    forms = gt.get("forms", {})
    all_results = []

    for form_key, form_gt in forms.items():
        # Determine image path and shift
        image_ref = form_gt.get("image", "")
        # Try fixtures first, then eval dir
        image_name = Path(image_ref).name
        image_path = FIXTURES_DIR / image_name
        if not image_path.exists():
            image_path = EVAL_DIR / image_name
        if not image_path.exists():
            base = Path(image_ref).stem
            image_path = EVAL_DIR / f"{base}.png"

        fmt = form_gt.get("format", "")
        if "OLD" in fmt.upper() or "legacy" in fmt.lower() or "old" in form_key.lower():
            field_map = SO_OLD_FIELD_TO_ROW
        elif "RIM" in form_key:
            field_map = RIM_FIELD_TO_CELL
        elif "SO" in form_key:
            field_map = SO_FIELD_TO_CELL
        elif "BAN" in form_key:
            field_map = BAN_FIELD_TO_CELL
        else:
            field_map = SO_OLD_FIELD_TO_ROW

        shifts = form_gt.get("shifts", [])
        if len(shifts) == 1:
            shift = shifts[0]
        elif "4PM" in shifts:
            shift = "4PM"
        else:
            shift = shifts[0] if shifts else None

        result = evaluate_form(pipeline, image_path, form_key, form_gt, field_map, shift=shift)
        if result:
            all_results.append(result)

    if all_results:
        total_cells = sum(r["value_cells"] for r in all_results)
        total_correct = sum(r["correct"] for r in all_results)
        overall_accuracy = (total_correct / total_cells * 100) if total_cells > 0 else 0
        latencies = [r["latency_s"] for r in all_results]
        latencies.sort()
        p95_idx = int(len(latencies) * 0.95) if latencies else 0
        p95_latency = latencies[min(p95_idx, len(latencies) - 1)] if latencies else 0

        print(f"\n{'='*70}")
        print("OVERALL SUMMARY")
        print(f"{'='*70}")
        print(f"  Forms tested: {len(all_results)}")
        print(f"  Total value cells: {total_cells}")
        print(f"  Correct: {total_correct}")
        print(f"  Accuracy: {overall_accuracy:.1f}%")
        print(f"  Accuracy >= 95%: {'YES \u2705' if overall_accuracy >= 95 else 'NO \u26d4'}")
        print(f"  Latency p95: {p95_latency:.2f}s")
        print(f"  Latency p95 <= 8s: {'YES \u2705' if p95_latency <= 8 else 'NO \u26d4'}")

        for r in all_results:
            print(f"  {r['store']:20s}: {r['correct']}/{r['value_cells']} = {r['accuracy_pct']}% ({r['latency_s']}s)")

        calibration = confidence_calibration(all_results)

        output = {
            "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
            "model": all_results[0]["model"] if all_results else "unknown",
            "gt_file": str(LOCKED_GT_PATH),
            "gt_locked": True,
            "overall_accuracy_pct": round(overall_accuracy, 1),
            "total_value_cells": total_cells,
            "total_correct": total_correct,
            "latency_p95_s": round(p95_latency, 2),
            "per_form": all_results,
            "confidence_calibration": calibration,
        }
        output_path = Path(__file__).parent / f"locked_eval_results_{provider_name}.json"
        with open(output_path, "w") as f:
            json.dump(output, f, indent=2)
        print(f"\nResults saved to: {output_path}")
    else:
        print("\nNo forms evaluated. Check image paths in locked_ground_truth.json")


def main():
    parser = argparse.ArgumentParser(description="D2 locked ground truth evaluation")
    parser.add_argument(
        "--provider",
        choices=["gemini", "claude", "both"],
        default="gemini",
        help="Which vision provider to evaluate. 'both' runs them sequentially "
             "and writes separate result files for comparison."
    )
    args = parser.parse_args()

    gt = load_locked_gt()

    if args.provider == "both":
        for p in ("gemini", "claude"):
            print()  # blank line between runs
            run_eval_with_provider(p, gt)
    else:
        run_eval_with_provider(args.provider, gt)

if __name__ == '__main__':
    main()

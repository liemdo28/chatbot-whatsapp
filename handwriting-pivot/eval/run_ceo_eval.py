"""
D2 CEO-Evaluated Accuracy Test (Updated)
=========================================
Runs Vision LLM pipeline on real form images and compares results against
ground truth values verified by CEO (visual reading of the original forms).

Updated to cover BOTH Stone Oak and Bandera forms.

Usage:
    cd handwriting-pivot
    python eval/run_ceo_eval.py

Output:
    eval/ceo_eval_results.json
"""

import json
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from code.pipeline import FormPipeline
from code.providers.gemini_flash import GeminiFlashProvider

# ─── CEO Ground Truth (verified by visual reading) ───────────────────────
GROUND_TRUTH = {
    "stone_oak_0619_4pm": {
        "image": "eval/form_stone_oak.png",
        "group_name": "B2 Kitchen Log",
        "store": "Stone Oak",
        "shift": "4:00 PM",
        "readings": {
            "WALK_IN_COOLER": 40,
            "WALK_IN_FREEZER": 0,
            "PREP_AREA_COOLER": 37,
            "RAMEN_REACH_BELOW": 38,
            "RAMEN_REACH_TOP": 36,
            "LINE_FREEZER": 0,
            "TAPAS_REACH_BELOW": 39,
            "TAPAS_REACH_TOP": 33,
            "PORK_CHASHU_COLD": 38,
            "CHICKEN_CHASHU_COLD": 38,
            "SEASONED_EGGS": 100,
            "FRYER_1": 300,
            "FRYER_2": 350,
            "PASTA_BOILER_1": 215,
            "PASTA_BOILER_2": 210,
        },
        "notes": {
            "FRYER_1": "CEO flagged as needs_recheck — handwriting ambiguous",
        },
    },
    "bandera_form": {
        "image": "eval/form_bandera.png",
        "group_name": "B3 Kitchen Log",
        "store": "Bandera Road",
        "readings": {
            "WALK_IN_COOLER": 42,
            "WALK_IN_FREEZER": -7,
            "BOWL_WARMERS": 100,
            "RAMEN_REACH_TOP": 43,
            "RAMEN_REACH_BELOW": 42,
            "LINE_FREEZER": 12,
            "PORK_CHASHU_COLD": 109,
            "SEASONED_EGGS": 104,
            "TAPAS_REACH_TOP": 43,
            "TAPAS_REACH_BELOW": 40,
            "FRYER_1": 350,
            "FRYER_2": 350,
            "PASTA_BOILER_1": 240,
        },
        "notes": {},
    },
}


def run_eval():
    """Run evaluation on all images with CEO ground truth."""
    pipeline = FormPipeline(primary=GeminiFlashProvider())
    results = []
    
    print("=" * 60)
    print("D2 CEO-EVALUATED ACCURACY TEST (Both Forms)")
    print("=" * 60)
    
    for test_name, test_case in GROUND_TRUTH.items():
        image_path = test_case["image"]
        group_name = test_case["group_name"]
        expected = test_case["readings"]
        
        print(f"\n--- {test_name} ---")
        print(f"Image: {image_path}")
        print(f"Store: {test_case['store']}")
        
        if not os.path.exists(image_path):
            print(f"  SKIP: Image not found at {image_path}")
            continue
        
        with open(image_path, "rb") as f:
            img = f.read()
        
        print(f"Image size: {len(img) / 1024:.1f} KB")
        
        t0 = time.time()
        result = pipeline.process(image_bytes=img, group_name=group_name)
        latency = time.time() - t0
        
        print(f"Store detected: {result.extraction.store}")
        print(f"Confidence: {result.extraction.overall_confidence}")
        print(f"Readings: {len(result.extraction.readings)}")
        print(f"Latency: {latency:.1f}s")
        
        # Build extracted dict by field_id
        extracted = {}
        for rd in result.extraction.readings:
            extracted[rd.field_id.upper().replace("-", "_").replace(" ", "_")] = rd
        
        # Compare against CEO ground truth
        matches = 0
        misses = 0
        miss_details = []
        
        for field_id, expected_val in expected.items():
            rd = extracted.get(field_id)
            if rd is None:
                misses += 1
                miss_details.append({
                    "field": field_id,
                    "expected": expected_val,
                    "actual": None,
                    "confidence": 0,
                    "note": "Field not in model output",
                })
                continue
            
            actual_val = rd.value
            # Allow ±2°F tolerance for handwritten digit ambiguity
            match = actual_val is not None and abs(actual_val - expected_val) <= 2
            if match:
                matches += 1
            else:
                misses += 1
                miss_details.append({
                    "field": field_id,
                    "expected": expected_val,
                    "actual": actual_val,
                    "confidence": rd.confidence,
                    "note": test_case.get("notes", {}).get(field_id, ""),
                })
        
        total = matches + misses
        accuracy = (matches / total * 100) if total > 0 else 0
        
        print(f"\nAccuracy: {matches}/{total} = {accuracy:.1f}%")
        
        if miss_details:
            print("Misses:")
            for m in miss_details:
                note = f" ({m['note']})" if m["note"] else ""
                print(f"  {m['field']}: expected={m['expected']}, got={m['actual']}, conf={m['confidence']:.2f}{note}")
        
        results.append({
            "test_name": test_name,
            "image": image_path,
            "store": test_case["store"],
            "total_fields": total,
            "matches": matches,
            "misses": misses,
            "accuracy": accuracy,
            "latency_s": round(latency, 2),
            "model_confidence": result.extraction.overall_confidence,
            "readings_count": len(result.extraction.readings),
            "miss_details": miss_details,
        })
    
    # Overall summary
    print("\n" + "=" * 60)
    print("OVERALL SUMMARY")
    print("=" * 60)
    
    total_matches = sum(r["matches"] for r in results)
    total_fields = sum(r["total_fields"] for r in results)
    avg_latency = sum(r["latency_s"] for r in results) / len(results) if results else 0
    
    overall_accuracy = (total_matches / total_fields * 100) if total_fields > 0 else 0
    
    print(f"Images tested: {len(results)}")
    print(f"Total fields: {total_fields}")
    print(f"Total matches: {total_matches}")
    print(f"Overall accuracy: {overall_accuracy:.1f}%")
    print(f"Average latency: {avg_latency:.1f}s")
    
    # Per-image breakdown
    for r in results:
        print(f"  {r['store']}: {r['matches']}/{r['total_fields']} = {r['accuracy']:.1f}% (latency {r['latency_s']}s)")
    
    # Save results
    output = {
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
        "overall_accuracy": overall_accuracy,
        "total_fields": total_fields,
        "total_matches": total_matches,
        "average_latency_s": round(avg_latency, 2),
        "per_image": results,
    }
    
    output_path = Path(__file__).parent / "ceo_eval_results.json"
    with open(output_path, "w") as f:
        json.dump(output, f, indent=2)
    
    print(f"\nResults saved to: {output_path}")
    
    return overall_accuracy


if __name__ == "__main__":
    accuracy = run_eval()
    if accuracy >= 95:
        print("\n✅ PASS: Accuracy >= 95%")
    else:
        print(f"\n⚠️  BELOW TARGET: Accuracy {accuracy:.1f}% < 95%")
        print("Consider: try Claude Vision provider, tune prompts, or add ±2 tolerance")

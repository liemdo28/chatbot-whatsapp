"""
D2 Accuracy Evaluation — runs pipeline on evidence images and compares to ground truth.
"""
import sys
import os
import time
import json
import glob
import io
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from code.pipeline import FormPipeline
from code.providers.gemini_flash import GeminiFlashProvider

# Load ground truth files
GT_DIR = os.path.join(os.path.dirname(__file__), 'ground_truth')
EVIDENCE_DIR = r'C:\Ld-project\whatsapp-ai-gateway\data\evidence'

def compress_image(path, max_width=1024, quality=85):
    """Compress image for API upload."""
    img = Image.open(path)
    ratio = max_width / img.width if img.width > max_width else 1.0
    new_size = (int(img.width * ratio), int(img.height * ratio))
    resized = img.resize(new_size, Image.LANCZOS)
    buf = io.BytesIO()
    resized.save(buf, format='JPEG', quality=quality, optimize=True)
    return buf.getvalue(), new_size

def load_ground_truth():
    """Load all ground truth files and map to field IDs."""
    gt = {}
    gt_file = os.path.join(GT_DIR, 'ground_truth.json')
    if os.path.exists(gt_file):
        with open(gt_file) as f:
            data = json.load(f)
        for entry in data:
            gt[entry['image']] = {
                'store': entry.get('store'),
                'readings': entry.get('readings', {})
            }
    return gt

def evaluate_single(pipeline, img_path, ground_truth_entry):
    """Run pipeline on one image and evaluate accuracy."""
    img_bytes, (w, h) = compress_image(img_path)
    
    # Guess group from store name
    store = ground_truth_entry.get('store', '')
    group_map = {
        'Bandera Road': 'B3 Kitchen Log',
        'Stone Oak': 'B2 Kitchen Log',
        'Rim': 'B1 Kitchen Log',
    }
    group_name = group_map.get(store, 'B3 Kitchen Log')
    
    t0 = time.time()
    result = pipeline.process(image_bytes=img_bytes, group_name=group_name)
    elapsed = time.time() - t0
    
    expected_readings = ground_truth_entry.get('readings', {})
    
    # Compare
    extracted = {}
    for r in result.extraction.readings:
        extracted[r.field_id] = {
            'value': r.value,
            'confidence': r.confidence,
            'raw_text': r.raw_text,
            'notes': r.notes,
        }
    
    field_results = []
    for field_id, expected_val in expected_readings.items():
        ext = extracted.get(field_id)
        if ext is None:
            field_results.append({
                'field_id': field_id,
                'expected': expected_val,
                'got': None,
                'match': False,
                'confidence': 0,
                'status': 'missing',
            })
        elif ext['value'] is None:
            field_results.append({
                'field_id': field_id,
                'expected': expected_val,
                'got': None,
                'match': False,
                'confidence': ext['confidence'],
                'status': 'null_value',
            })
        else:
            match = ext['value'] == expected_val or abs(ext['value'] - expected_val) <= 2
            field_results.append({
                'field_id': field_id,
                'expected': expected_val,
                'got': ext['value'],
                'match': match,
                'confidence': ext['confidence'],
                'raw_text': ext['raw_text'],
                'status': 'match' if match else 'mismatch',
            })
    
    correct = sum(1 for f in field_results if f['match'])
    total = len(field_results)
    accuracy = correct / total * 100 if total > 0 else 0
    
    return {
        'image': os.path.basename(img_path),
        'store_detected': result.extraction.store,
        'expected_store': store,
        'latency_s': round(elapsed, 2),
        'ok': result.extraction.ok,
        'error': result.extraction.error,
        'accuracy_pct': round(accuracy, 1),
        'correct': correct,
        'total': total,
        'field_results': field_results,
        'reply_text': result.reply_text[:500],
    }


def main():
    pipeline = FormPipeline(primary=GeminiFlashProvider())
    
    ground_truth = load_ground_truth()
    if not ground_truth:
        print("No ground truth found. Creating placeholder...")
        print("Place ground truth in eval/ground_truth/ground_truth.json")
        sys.exit(1)
    
    print(f"Loaded ground truth for {len(ground_truth)} images")
    print(f"Evidence dir: {EVIDENCE_DIR}")
    
    # Find evidence images (check local eval dir first, then evidence dir)
    eval_dir = os.path.dirname(os.path.abspath(__file__))
    local_files = glob.glob(os.path.join(eval_dir, '*.jpg')) + glob.glob(os.path.join(eval_dir, '*.png'))
    evidence_files = sorted(glob.glob(os.path.join(EVIDENCE_DIR, '*.jpg')))
    all_images = local_files + evidence_files
    print(f"Found {len(local_files)} local + {len(evidence_files)} evidence = {len(all_images)} total images")
    
    # Run eval on images we have ground truth for
    all_results = []
    latencies = []
    
    for img_name, gt_entry in ground_truth.items():
        # Try to find matching image (check local first, then evidence)
        img_path = None
        for f in all_images:
            basename = os.path.splitext(os.path.basename(f))[0]
            if img_name == basename or img_name in basename:
                img_path = f
                break
        
        if img_path is None:
            print(f"\nSKIP: No image found for ground truth entry '{img_name}'")
            continue
        
        print(f"\n=== Evaluating: {img_name} (store={gt_entry.get('store')}) ===")
        result = evaluate_single(pipeline, img_path, gt_entry)
        all_results.append(result)
        latencies.append(result['latency_s'])
        
        print(f"  Store detected: {result['store_detected']} (expected: {result['expected_store']})")
        print(f"  Latency: {result['latency_s']}s")
        print(f"  Accuracy: {result['accuracy_pct']}% ({result['correct']}/{result['total']})")
        
        if result['error']:
            print(f"  Error: {result['error']}")
        
        for fr in result['field_results']:
            status_icon = 'Y' if fr['match'] else 'N'
            print(f"    {status_icon} {fr['field_id']}: expected={fr['expected']}, got={fr.get('got')}, conf={fr['confidence']} [{fr['status']}]")
    
    # Overall stats
    if all_results:
        total_correct = sum(r['correct'] for r in all_results)
        total_fields = sum(r['total'] for r in all_results)
        overall_accuracy = total_correct / total_fields * 100 if total_fields > 0 else 0
        
        latencies.sort()
        p95_idx = int(len(latencies) * 0.95) if latencies else 0
        p95_latency = latencies[p95_idx] if latencies else 0
        
        print(f"\n{'='*50}")
        print(f"OVERALL RESULTS:")
        print(f"  Images tested: {len(all_results)}")
        print(f"  Total fields: {total_fields}")
        print(f"  Correct: {total_correct}")
        print(f"  Accuracy: {overall_accuracy:.1f}%")
        print(f"  Latency p95: {p95_latency:.1f}s")
        print(f"  Accuracy >= 95%: {'YES' if overall_accuracy >= 95 else 'NO'}")
        print(f"  Latency p95 <= 8s: {'YES' if p95_latency <= 8 else 'NO'}")
    
    # Save results
    results_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'results.json')
    with open(results_path, 'w') as f:
        json.dump({
            'overall_accuracy_pct': round(overall_accuracy, 1) if all_results else 0,
            'total_correct': total_correct if all_results else 0,
            'total_fields': total_fields if all_results else 0,
            'latency_p95_s': round(p95_latency, 2) if all_results else 0,
            'results': all_results,
        }, f, indent=2, default=str)
    print(f"\nResults saved to {results_path}")


if __name__ == '__main__':
    main()

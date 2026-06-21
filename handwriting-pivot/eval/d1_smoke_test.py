"""
D1 Smoke Test — Verify prototype runs on a real form image.
Acceptance criteria:
  1. result.reply_text has store name + at least 1 reading
  2. Latency < 8 seconds
  3. No error in result.extraction.error
"""
import sys
import os
import time

# Add parent dir so we can import code.*
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from code.pipeline import FormPipeline
from code.providers.gemini_flash import GeminiFlashProvider

# Find the test image
img_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'test_form.jpg')
if not os.path.exists(img_path):
    print(f"FAIL: test image not found at {img_path}")
    sys.exit(1)

print(f"Image: {img_path} ({os.path.getsize(img_path)} bytes)")

with open(img_path, 'rb') as f:
    img = f.read()

# Detect store from filename or use Bandera as default
# The evidence images are from various stores; let the vision LLM figure it out
pipeline = FormPipeline(primary=GeminiFlashProvider())

print("\n--- Running pipeline.process() ---")
t0 = time.time()
result = pipeline.process(image_bytes=img, group_name="B3 Kitchen Log")
elapsed = time.time() - t0

print(f"\n=== RESULTS ===")
print(f"Latency: {elapsed:.1f}s (total), {result.total_latency_ms}ms (pipeline)")
print(f"Trace ID: {result.trace_id}")
print(f"Used fallback: {result.used_fallback}")
print(f"Provider: {result.extraction.provider}")
print(f"Model: {result.extraction.model}")

print(f"\n--- reply_text ---")
print(result.reply_text)

print(f"\n--- extraction dict ---")
import json
print(json.dumps(result.extraction.to_dict(), indent=2, default=str))

# === ACCEPTANCE CHECKS ===
print(f"\n=== ACCEPTANCE CHECKS ===")

# 1. reply_text has store name + at least 1 reading
has_store = result.extraction.store is not None
has_readings = len(result.extraction.readings) > 0
print(f"{'✓' if has_store else '✗'} Store name: {result.extraction.store}")
print(f"{'✓' if has_readings else '✗'} Readings count: {len(result.extraction.readings)}")

# 2. Latency < 8 seconds
latency_ok = elapsed < 8.0
print(f"{'✓' if latency_ok else '✗'} Latency: {elapsed:.1f}s (< 8s)")

# 3. No error
no_error = result.extraction.error is None
print(f"{'✓' if no_error else '✗'} No error: {result.extraction.error}")

# Overall
all_pass = has_store and has_readings and latency_ok and no_error
print(f"\n{'=== ALL CHECKS PASSED ===' if all_pass else '=== SOME CHECKS FAILED ==='}")

if all_pass:
    print("D1 smoke test: works as expected")
else:
    print("D1 smoke test: ISSUES DETECTED — report to CEO")

sys.exit(0 if all_pass else 1)

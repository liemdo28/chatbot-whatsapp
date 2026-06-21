"""
D1 Smoke Test v2 — with image compression for better latency.
"""
import sys
import os
import time
import json

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from code.pipeline import FormPipeline
from code.providers.gemini_flash import GeminiFlashProvider
from PIL import Image
import io

# Find and compress the test image
img_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'test_form.jpg')
if not os.path.exists(img_path):
    print(f"FAIL: test image not found at {img_path}")
    sys.exit(1)

print(f"Image: {img_path} ({os.path.getsize(img_path)} bytes)")

# Compress for faster upload
img = Image.open(img_path)
ratio = 1024 / img.width if img.width > 1024 else 1.0
new_size = (int(img.width * ratio), int(img.height * ratio))
resized = img.resize(new_size, Image.LANCZOS)
buf = io.BytesIO()
resized.save(buf, format='JPEG', quality=85, optimize=True)
img_bytes = buf.getvalue()
print(f"Compressed: {len(img_bytes)} bytes, {new_size}")

# Run pipeline
pipeline = FormPipeline(primary=GeminiFlashProvider())

print("\n--- Running pipeline.process() ---")
t0 = time.time()
result = pipeline.process(image_bytes=img_bytes, group_name="B3 Kitchen Log")
elapsed = time.time() - t0

print(f"\n=== RESULTS ===")
print(f"Latency: {elapsed:.1f}s (total), {result.total_latency_ms}ms (pipeline)")
print(f"Trace ID: {result.trace_id}")
print(f"Provider: {result.extraction.provider} / {result.extraction.model}")
print(f"Store: {result.extraction.store}")
print(f"Readings: {len(result.extraction.readings)}")
print(f"Overall confidence: {result.extraction.overall_confidence}")

print(f"\n--- reply_text ---")
print(result.reply_text)

print(f"\n--- readings ---")
for rd in result.extraction.readings:
    print(f"  {rd.field_id}: {rd.value} ({rd.confidence}) {rd.notes[:80]}")

# Acceptance checks
print(f"\n=== ACCEPTANCE CHECKS ===")
has_store = result.extraction.store is not None
has_readings = len(result.extraction.readings) > 0
latency_ok = elapsed < 8.0
no_error = result.extraction.error is None

print(f"{'Y' if has_store else 'N'} Store name: {result.extraction.store}")
print(f"{'Y' if has_readings else 'N'} Readings count: {len(result.extraction.readings)}")
print(f"{'Y' if latency_ok else 'N'} Latency: {elapsed:.1f}s (< 8s)")
print(f"{'Y' if no_error else 'N'} No error: {result.extraction.error}")

all_pass = has_store and has_readings and latency_ok and no_error
print(f"\n{'ALL CHECKS PASSED' if all_pass else 'SOME CHECKS FAILED'}")

if all_pass:
    print("D1 smoke test: works as expected")
else:
    print("D1 smoke test: ISSUES DETECTED")

sys.exit(0 if all_pass else 1)

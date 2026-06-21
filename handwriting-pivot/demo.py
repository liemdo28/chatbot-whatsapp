"""
Demo: run the pipeline with mocked Bandera form (the one with the
infamous Line Freezer 10°F sensor issue + cooler too warm + Bowl Warmers cold).

Shows what the kitchen staff actually sees in WhatsApp.
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))

from tests.test_pipeline import MockProvider, stone_oak_normal, bandera_with_problems, rim_with_implausible
from code.pipeline import FormPipeline

def demo(scenario, group_name, label):
    print("=" * 70)
    print(f"  SCENARIO: {label}")
    print("=" * 70)
    primary = MockProvider(scenario)
    audit_events = []
    pipeline = FormPipeline(primary=primary, on_audit=audit_events.append)
    result = pipeline.process(image_bytes=b"<fake-jpeg>", group_name=group_name)

    print(f"\n[trace_id: {result.trace_id}]")
    print(f"[provider: {result.extraction.provider} · model: {result.extraction.model}]")
    print(f"[total latency: {result.total_latency_ms}ms · readings: {len(result.extraction.readings)}]")

    print(f"\n─── Kitchen group reply ───")
    print(result.reply_text)

    if result.alert_text:
        print(f"\n─── Management group alert ───")
        print(result.alert_text)

    print(f"\n─── Audit event ───")
    if audit_events:
        ev = audit_events[-1]
        for k in ("event", "store", "provider", "ok", "n_readings", "needs_review", "n_fails", "overall_confidence"):
            print(f"  {k}: {ev.get(k)}")
    print()

demo("stone_oak_normal",      "B2 Kitchen Log", "Stone Oak — one minor fail")
demo("bandera_with_problems", "B3 Kitchen Log", "Bandera — multiple issues incl. broken sensor")
demo("rim_with_implausible",  "B1 Kitchen Log", "Rim — implausible reading + blank cell")

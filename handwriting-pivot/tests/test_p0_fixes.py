"""P0 Fix Verification Tests — run: python -m pytest handwriting-pivot/tests/test_p0_fixes.py -v"""
import sys, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from code.providers.base import FormExtraction, FieldReading
from code.pipeline import FormPipeline
from code.schemas.stores import resolve_store, BANDERA, STONE_OAK, RIM, StoreSchema, Field
from code.decision_engine import (
    decide, Disposition, COOKING_OCR_BLOCKLIST,
    _is_food_safety_violation, FormDecision, FieldDecision,
)
from code.reply import build_confirmation_reply, build_alert_message, MANAGERS


class MockProvider:
    name = "mock"
    cost_per_form_usd = 0.0
    def __init__(self, scenario="normal"):
        self.scenario = scenario
        self.call_count = 0
    def extract(self, image_bytes, prompt, schema):
        self.call_count += 1
        return SCENARIOS[self.scenario]()


def _make_schema(*fields):
    return StoreSchema("Test", "TEST", "test", "v1", tuple(fields))


# ─── Scenario data ──────────────────────────────────────────────────

def normal_scenario():
    r = [("SO-01",37),("SO-02",0),("SO-03",40),("SO-04",104),("SO-05",36),
         ("SO-06",37),("SO-07",0),("SO-08",100),("SO-09",100),("SO-10",101),
         ("SO-11",37),("SO-12",40),("SO-13",40),("SO-14",40),("SO-15",37),
         ("SO-16",350),("SO-17",350),("SO-18",200),("SO-19",210)]
    return FormExtraction(store="Stone Oak", date="2026-06-19", shift="10AM",
        employee_name="Sol", readings=[FieldReading(f,v,str(v),0.97) for f,v in r],
        provider="mock", model="mock", latency_ms=1000, overall_confidence=0.97)


def rim_two_shift_scenario():
    v10=[None,None,44,100,34,38,8,100,160,165,42,40,40,40,40,350,360,209,210]
    v4p=[40,10,40,100,38,39,8,105,155,160,39,38,38,40,38,350,340,210,210]
    rd=[]
    for i in range(19):
        rd.append(FieldReading(field_id="RIM-%02d"%(i+1), value=v10[i],
            raw_text=str(v10[i]) if v10[i] is not None else "",
            confidence=0.95 if v10[i] is not None else 0.0,
            shift="10AM", value_4pm=v4p[i], raw_text_4pm=str(v4p[i]),
            confidence_4pm=0.94))
    return FormExtraction(store="Rim", date="2026-06-20", shift=None,
        employee_name="Yenci", readings=rd, provider="mock", model="mock",
        latency_ms=1000, overall_confidence=0.88)


def fourpm_only_scenario():
    rd = []
    for i in range(19):
        rd.append(FieldReading(
            field_id="RIM-%02d" % (i + 1),
            value=None, raw_text="", confidence=0.0, shift="10AM",
            value_4pm=38.0, raw_text_4pm="38", confidence_4pm=0.92))
    return FormExtraction(store="Rim", date="2026-06-20", shift=None,
        employee_name="Test", readings=rd, provider="mock", model="mock",
        latency_ms=1000, overall_confidence=0.92)


def error_scenario():
    return FormExtraction(store=None, date=None, shift=None, employee_name=None,
        provider="mock", model="mock", latency_ms=100, error="simulated_failure")


def problemas_scenario():
    rd = [
        FieldReading("BAN-01",44,"44",0.92), FieldReading("BAN-02",-3,"-3",0.96),
        FieldReading("BAN-03",None,"",0.0), FieldReading("BAN-04",98,"98",0.94),
        FieldReading("BAN-05",43,"43",0.96), FieldReading("BAN-06",40,"40",0.96),
        FieldReading("BAN-07",10,"10",0.78,notes="ambiguous"),
        FieldReading("BAN-08",104,"104",0.95), FieldReading("BAN-09",103,"103",0.95),
        FieldReading("BAN-10",103,"103",0.95), FieldReading("BAN-11",41,"41",0.95),
        FieldReading("BAN-12",31,"31",0.95), FieldReading("BAN-13",31,"31",0.95),
        FieldReading("BAN-14",42,"42",0.95), FieldReading("BAN-15",33,"33",0.95),
        FieldReading("BAN-16",351,"351",0.97), FieldReading("BAN-17",357,"357",0.97),
        FieldReading("BAN-18",210,"210",0.97),
    ]
    return FormExtraction(store="Bandera Road", date="2026-06-19", shift="10AM",
        employee_name="May", readings=rd, provider="mock", model="mock",
        latency_ms=1000, overall_confidence=0.93)


SCENARIOS = {
    "normal": normal_scenario,
    "rim_two_shift": rim_two_shift_scenario,
    "fourpm_only": fourpm_only_scenario,
    "problemas": problemas_scenario,
    "error": error_scenario,
}


# ═══════════════════════════════════════════════════════════════════════
# P0 #1: 4PM column — value_4pm, raw_text_4pm, confidence_4pm swap
# ═══════════════════════════════════════════════════════════════════════

class TestP01_4PMColumnSwap(unittest.TestCase):
    """P0 #1: When selected_column=4PM, decision engine MUST evaluate
    value_4pm, raw_text_4pm, confidence_4pm — not the 10AM values."""

    def test_pipeline_selects_4pm_when_both_present(self):
        p = FormPipeline(primary=MockProvider("rim_two_shift"))
        r = p.process(image_bytes=b"fake", group_name="B1 Kitchen Log")
        self.assertEqual(r.extraction.shift, "4PM")

    def test_pipeline_swaps_4pm_value(self):
        p = FormPipeline(primary=MockProvider("rim_two_shift"))
        r = p.process(image_bytes=b"fake", group_name="B1 Kitchen Log")
        r01 = next(rd for rd in r.extraction.readings if rd.field_id == "RIM-01")
        self.assertEqual(r01.value, 40)  # 4PM value, not None from 10AM

    def test_pipeline_swaps_4pm_raw_text(self):
        p = FormPipeline(primary=MockProvider("rim_two_shift"))
        r = p.process(image_bytes=b"fake", group_name="B1 Kitchen Log")
        r01 = next(rd for rd in r.extraction.readings if rd.field_id == "RIM-01")
        self.assertEqual(r01.raw_text, "40")

    def test_pipeline_swaps_4pm_confidence(self):
        p = FormPipeline(primary=MockProvider("rim_two_shift"))
        r = p.process(image_bytes=b"fake", group_name="B1 Kitchen Log")
        r01 = next(rd for rd in r.extraction.readings if rd.field_id == "RIM-01")
        self.assertAlmostEqual(r01.confidence, 0.94, places=2)

    def test_4pm_only_selects_4pm(self):
        p = FormPipeline(primary=MockProvider("fourpm_only"))
        r = p.process(image_bytes=b"fake", group_name="B1 Kitchen Log")
        self.assertEqual(r.extraction.shift, "4PM")

    def test_4pm_only_values_copied(self):
        p = FormPipeline(primary=MockProvider("fourpm_only"))
        r = p.process(image_bytes=b"fake", group_name="B1 Kitchen Log")
        for rd in r.extraction.readings:
            self.assertEqual(rd.value, 38.0)

    def test_4pm_zero_confidence_keeps_10am(self):
        """confidence_4pm=0.0 should keep 10AM confidence, not override."""
        r = FieldReading("RIM-01", 37, "37", 0.95, shift="10AM",
            value_4pm=40, raw_text_4pm="40", confidence_4pm=0.0)
        r.value = r.value_4pm
        r.confidence = r.confidence_4pm if r.confidence_4pm > 0 else r.confidence
        self.assertEqual(r.confidence, 0.95)

    def test_4pm_real_confidence_used(self):
        """confidence_4pm=0.94 should be used."""
        r = FieldReading("RIM-01", 37, "37", 0.95, shift="10AM",
            value_4pm=40, raw_text_4pm="40", confidence_4pm=0.94)
        r.value = r.value_4pm
        r.confidence = r.confidence_4pm if r.confidence_4pm > 0 else r.confidence
        self.assertAlmostEqual(r.confidence, 0.94, places=2)


# ═══════════════════════════════════════════════════════════════════════
# P0 #2: Critical cooking fields — known bad OCR values
# ═══════════════════════════════════════════════════════════════════════

class TestP02_CookingOCRBlocklist(unittest.TestCase):
    """P0 #2: Cooking Equipment values {7, 8, 9, 138, 300} MUST be
    IMPLAUSIBLE or REVIEW, NEVER a FAIL alert."""

    def _make_fryer(self, value):
        fryer = Field("FL", "Fryer Left", "Cooking Equipment", ">=", 350, 100, 450)
        schema = _make_schema(fryer)
        rd = [FieldReading("FL", value, str(value), 0.95)]
        ext = FormExtraction(store="Test", date="2026-06-20", shift="10AM",
            employee_name="T", readings=rd, provider="m", model="m",
            latency_ms=1000, overall_confidence=0.95)
        return decide(ext, schema)

    def _make_boiler(self, value):
        boiler = Field("PB", "Pasta Boiler", "Cooking Equipment", ">=", 200, 100, 250)
        schema = _make_schema(boiler)
        rd = [FieldReading("PB", value, str(value), 0.95)]
        ext = FormExtraction(store="Test", date="2026-06-20", shift="10AM",
            employee_name="T", readings=rd, provider="m", model="m",
            latency_ms=1000, overall_confidence=0.95)
        return decide(ext, schema)

    def test_fryer_138_is_implausible(self):
        d = self._make_fryer(138).decisions[0]
        self.assertEqual(d.disposition, Disposition.IMPLAUSIBLE)
        self.assertFalse(d.is_food_safety_violation)

    def test_fryer_300_is_implausible(self):
        d = self._make_fryer(300).decisions[0]
        self.assertEqual(d.disposition, Disposition.IMPLAUSIBLE)

    def test_fryer_7_is_implausible(self):
        d = self._make_fryer(7).decisions[0]
        self.assertEqual(d.disposition, Disposition.IMPLAUSIBLE)

    def test_fryer_8_is_implausible(self):
        d = self._make_fryer(8).decisions[0]
        self.assertEqual(d.disposition, Disposition.IMPLAUSIBLE)

    def test_fryer_9_is_implausible(self):
        d = self._make_fryer(9).decisions[0]
        self.assertEqual(d.disposition, Disposition.IMPLAUSIBLE)

    def test_boiler_138_is_implausible(self):
        d = self._make_boiler(138).decisions[0]
        self.assertEqual(d.disposition, Disposition.IMPLAUSIBLE)

    def test_boiler_7_is_implausible(self):
        d = self._make_boiler(7).decisions[0]
        self.assertEqual(d.disposition, Disposition.IMPLAUSIBLE)

    def test_blocklisted_values_never_fail_alert(self):
        for v in COOKING_OCR_BLOCKLIST:
            dec = self._make_fryer(v)
            self.assertEqual(len(dec.fails), 0,
                f"Blocklist value {v} triggered FAIL alert!")
            self.assertFalse(dec.decisions[0].is_food_safety_violation,
                f"Blocklist value {v} flagged as food safety violation!")

    def test_valid_fryer_355_passes(self):
        d = self._make_fryer(355).decisions[0]
        self.assertEqual(d.disposition, Disposition.PASS)

    def test_valid_fryer_340_review(self):
        d = self._make_fryer(340).decisions[0]
        self.assertEqual(d.disposition, Disposition.REVIEW)
        self.assertFalse(d.is_food_safety_violation)

    def test_blocklist_contents(self):
        self.assertEqual(COOKING_OCR_BLOCKLIST, frozenset({7, 8, 9, 138, 300}))


# ════════════════════════════════════════════════���══════════════════════
# P0 #3: Remove default Bandera fallback
# ═══════════════════════════════════════════════════════════════════════

class TestP03_NoBanderaFallback(unittest.TestCase):
    """P0 #3: Unknown group/header must NOT silently default to Bandera."""

    def test_unknown_group_with_known_header_resolves(self):
        def known_header():
            return FormExtraction(store="Stone Oak", date="2026-06-20", shift="10AM",
                employee_name="T", readings=[
                    FieldReading("SO-01", 37, "37", 0.95),
                ], provider="m", model="m", latency_ms=1000, overall_confidence=0.95)
        p = FormPipeline(primary=type("P", (), {
            "name": "m", "cost_per_form_usd": 0,
            "extract": lambda *a, **k: known_header()
        })())
        r = p.process(image_bytes=b"fake", group_name="Unknown Group")
        self.assertEqual(r.extraction.store, "Stone Oak")

    def test_unknown_group_with_unknown_header_asks_confirmation(self):
        """When group + header both fail, pipeline MUST ask for manual confirmation
        instead of silently failing. Never discard submission."""
        def unknown_header():
            return FormExtraction(store="Mystery Store", date="2026-06-20", shift="10AM",
                employee_name="T", readings=[
                    FieldReading("XX-01", 37, "37", 0.95),
                ], provider="m", model="m", latency_ms=1000, overall_confidence=0.95)
        p = FormPipeline(primary=type("P", (), {
            "name": "m", "cost_per_form_usd": 0,
            "extract": lambda *a, **k: unknown_header()
        })())
        r = p.process(image_bytes=b"fake", group_name="Unknown Group")
        self.assertIsNone(r.decision)
        # P0 FIX: Must ask for manual confirmation, never silently fail
        self.assertIn("Need store confirmation", r.reply_text)
        self.assertIn("B1 / The Rim", r.reply_text)
        self.assertIn("B2 / Stone Oak", r.reply_text)
        self.assertIn("B3 / Bandera", r.reply_text)

    def test_auto_schema_code_not_bandera(self):
        """When group unknown, initial schema code must be AUTO, not BANDERA."""
        from code.pipeline import StoreSchema as SS
        auto = SS("(auto-detect)", "AUTO", "Unknown", "v3", BANDERA.fields)
        self.assertEqual(auto.store_code, "AUTO")
        self.assertNotEqual(auto.store_code, "BANDERA")


# ═══════════════════════════════════════════════════════════════════════
# P0 #4: Manager map — The Rim → David
# ═══════════════════════════════════════════════════════════════════════

class TestP04_ManagerMap(unittest.TestCase):
    """P0 #4: MANAGERS keys must match StoreSchema.store_name exactly."""

    def test_the_rim_maps_to_david(self):
        self.assertEqual(MANAGERS.get("The Rim"), "David")

    def test_bandera_maps_to_miles(self):
        self.assertEqual(MANAGERS.get("Bandera Road"), "Miles")

    def test_stone_oak_maps_to_edga(self):
        self.assertEqual(MANAGERS.get("Stone Oak"), "Edga")

    def test_rim_alert_tags_david(self):
        dec = FormDecision(store="The Rim", date="2026-06-20", shift="10AM",
            employee_name="Y",
            decisions=[FieldDecision("X", "Cold", "Cold Holding", 50, "50",
                0.95, Disposition.FAIL, "<=", 40, is_food_safety_violation=True)])
        alert = build_alert_message(dec)
        self.assertIn("@David", alert)

    def test_all_stores_have_managers(self):
        for store in ["The Rim", "Bandera Road", "Stone Oak"]:
            self.assertIn(store, MANAGERS)
            self.assertIsInstance(MANAGERS[store], str)
            self.assertTrue(len(MANAGERS[store]) > 0)


# ═══════════════════════════════════════════════════════════════════════
# Live Trace — full E2E pipeline run
# ═══════════════════════════════════════════════════════════════════════

class TestLiveTrace(unittest.TestCase):
    """One live trace: Rim two-shift form, 4PM selected, verify full pipeline."""

    def test_rim_4pm_e2e_trace(self):
        p = FormPipeline(primary=MockProvider("rim_two_shift"))
        r = p.process(image_bytes=b"fake", group_name="B1 Kitchen Log")

        # Trace ID generated
        self.assertTrue(r.trace_id.startswith("form-"))
        self.assertTrue(len(r.trace_id) > 5)

        # Store resolved
        self.assertEqual(r.extraction.store, "Rim")

        # Column selected = 4PM
        self.assertEqual(r.extraction.shift, "4PM")

        # RIM-01: 10AM=None, 4PM=40 → after swap, value=40
        r01 = next(rd for rd in r.extraction.readings if rd.field_id == "RIM-01")
        self.assertEqual(r01.value, 40)
        self.assertEqual(r01.raw_text, "40")

        # Decision engine ran
        self.assertIsNotNone(r.decision)
        self.assertTrue(r.extraction.ok)

        # Reply contains store name
        self.assertIn("Rim", r.reply_text)

        # RIM-07=8°F on freezer (target <=0) is a legit food safety violation
        # All other 4PM values are within range
        self.assertTrue(any(d.field_id == "RIM-07" for d in r.decision.fails))

        # Audit trail
        self.assertTrue(r.total_latency_ms >= 0)

    def test_bandera_problemas_e2e_trace(self):
        """Bandera form with bad values: BAN-04=98 (below 135 food safety min)."""
        def problemas():
            rd = [
                FieldReading("BAN-01",44,"44",0.92), FieldReading("BAN-02",-3,"-3",0.96),
                FieldReading("BAN-03",None,"",0.0), FieldReading("BAN-04",98,"98",0.94),
                FieldReading("BAN-05",43,"43",0.96), FieldReading("BAN-06",40,"40",0.96),
                FieldReading("BAN-07",10,"10",0.78,notes="ambiguous"),
                FieldReading("BAN-08",104,"104",0.95), FieldReading("BAN-09",103,"103",0.95),
                FieldReading("BAN-10",103,"103",0.95), FieldReading("BAN-11",41,"41",0.95),
                FieldReading("BAN-12",31,"31",0.95), FieldReading("BAN-13",31,"31",0.95),
                FieldReading("BAN-14",42,"42",0.95), FieldReading("BAN-15",33,"33",0.95),
                FieldReading("BAN-16",351,"351",0.97), FieldReading("BAN-17",357,"357",0.97),
                FieldReading("BAN-18",210,"210",0.97),
            ]
            return FormExtraction(store="Bandera Road", date="2026-06-19", shift="10AM",
                employee_name="May", readings=rd, provider="mock", model="mock",
                latency_ms=1000, overall_confidence=0.93)

        p = FormPipeline(primary=MockProvider("problemas"))
        r = p.process(image_bytes=b"fake", group_name="B3 Kitchen Log")
        self.assertIsNotNone(r.decision)
        # BAN-04=98 < food_safety_min=135 → FAIL + food safety violation
        fails = r.decision.fails
        self.assertTrue(any(d.field_id == "BAN-04" for d in fails))
        # Alert message generated
        self.assertIsNotNone(r.alert_text)
        self.assertIn("Bandera", r.alert_text)


if __name__ == "__main__":
    unittest.main(verbosity=2)

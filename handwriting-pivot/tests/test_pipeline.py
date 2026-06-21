"""Pipeline tests - run: python -m unittest handwriting-pivot.tests.test_pipeline -v"""
import sys, json, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))
from code.providers.base import FormExtraction, FieldReading
from code.pipeline import FormPipeline
from code.schemas.stores import resolve_store, BANDERA, STONE_OAK, RIM, ALL_SCHEMAS, StoreSchema, Field
from code.prompts import build_prompt, build_json_schema
from code.decision_engine import decide, Disposition, _is_food_safety_violation
from code.reply import build_confirmation_reply, build_alert_message, MANAGERS
from code.decision_engine import FormDecision, FieldDecision


class MockProvider:
    name = "mock"
    cost_per_form_usd = 0.0
    def __init__(self, scenario="normal"):
        self.scenario = scenario
        self.call_count = 0
    def extract(self, image_bytes, prompt, schema):
        self.call_count += 1
        return SCENARIOS[self.scenario]()


def normal_scenario():
    # SO-03=40 (target <=40, so PASS). SO-12/13=40 (target <=40).
    r = [("SO-01",37),("SO-02",0),("SO-03",40),("SO-04",104),("SO-05",36),
         ("SO-06",37),("SO-07",0),("SO-08",100),("SO-09",100),("SO-10",101),
         ("SO-11",37),("SO-12",40),("SO-13",40),("SO-14",40),("SO-15",37),
         ("SO-16",350),("SO-17",350),("SO-18",200),("SO-19",210)]
    return FormExtraction(store="Stone Oak", date="2026-06-19", shift="10AM",
        employee_name="Sol", readings=[FieldReading(f,v,str(v),0.97) for f,v in r],
        provider="mock", model="mock", latency_ms=1000, overall_confidence=0.97)


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


def rim_food_scenario():
    # RIM-09=140, RIM-10=145: above target (>=100) so PASS
    # The decision engine: 140 >= 100 (target) -> PASS
    # food_safety_min only matters when value < target
    rd = [
        FieldReading("RIM-01",None,"",0.0), FieldReading("RIM-02",None,"",0.0),
        FieldReading("RIM-03",44,"44",0.97), FieldReading("RIM-04",100,"100",0.96),
        FieldReading("RIM-05",34,"34",0.96), FieldReading("RIM-06",38,"38",0.96),
        FieldReading("RIM-07",8,"8",0.98), FieldReading("RIM-08",100,"100",0.96),
        FieldReading("RIM-09",140,"140",0.95), FieldReading("RIM-10",145,"145",0.95),
        FieldReading("RIM-11",42,"42",0.96), FieldReading("RIM-12",40,"40",0.97),
        FieldReading("RIM-13",40,"40",0.97), FieldReading("RIM-14",40,"40",0.97),
        FieldReading("RIM-15",40,"40",0.97), FieldReading("RIM-16",350,"350",0.97),
        FieldReading("RIM-17",360,"360",0.97), FieldReading("RIM-18",209,"209",0.98),
        FieldReading("RIM-19",210,"210",0.98),
    ]
    return FormExtraction(store="Rim", date="2026-06-20", shift="10AM",
        employee_name="Yenci", readings=rd, provider="mock", model="mock",
        latency_ms=1000, overall_confidence=0.88)


def rim_two_shift_scenario():
    # v10/v4p: index 8=RIM-09, index 9=RIM-10
    # 160/165 (above 100 target, below 135 food-safe) -> food safety violation
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


def error_scenario():
    return FormExtraction(store=None, date=None, shift=None, employee_name=None,
        provider="mock", model="mock", latency_ms=100, error="simulated_failure")


SCENARIOS = {
    "normal": normal_scenario,
    "problemas": problemas_scenario,
    "rim_food": rim_food_scenario,
    "rim_two_shift": rim_two_shift_scenario,
    "error": error_scenario,
}


class TestStoreResolution(unittest.TestCase):
    def test_resolve_by_group(self):
        self.assertEqual(resolve_store(group_name="B2 Kitchen Log").store_code, "STONE_OAK")
        self.assertEqual(resolve_store(group_name="B3 Kitchen Log").store_code, "BANDERA")
        self.assertEqual(resolve_store(group_name="B1 Kitchen Log").store_code, "RIM")
    def test_resolve_by_header(self):
        self.assertEqual(resolve_store(header_text="BANDERA").store_code, "BANDERA")
        self.assertEqual(resolve_store(header_text="Stone Oak").store_code, "STONE_OAK")
        self.assertEqual(resolve_store(header_text="THE RIM").store_code, "RIM")
    def test_unknown_returns_none(self):
        self.assertIsNone(resolve_store(group_name="random"))
        self.assertIsNone(resolve_store(header_text="DELI"))


class TestPromptBuilder(unittest.TestCase):
    def test_all_field_ids_present(self):
        for schema in [BANDERA, STONE_OAK, RIM]:
            p = build_prompt(schema)
            for f in schema.fields:
                self.assertIn(f.id, p)
    def test_food_safety_min_in_prompt(self):
        self.assertIn("food-safe", build_prompt(BANDERA))
    def test_json_schema_enum_matches(self):
        schema = build_json_schema(STONE_OAK)
        eid = schema["properties"]["readings"]["items"]["properties"]["field_id"]["enum"]
        self.assertEqual(set(eid), {f.id for f in STONE_OAK.fields})


class TestDecisionEngine(unittest.TestCase):
    def test_clean_form_all_pass(self):
        dec = decide(normal_scenario(), STONE_OAK)
        self.assertEqual(len(dec.passes), 19)
        self.assertEqual(len(dec.fails), 0)
    def test_low_confidence_review(self):
        dec = decide(problemas_scenario(), BANDERA)
        lf = next(d for d in dec.decisions if d.field_id == "BAN-07")
        self.assertEqual(lf.disposition, Disposition.REVIEW)
    def test_food_safety_violation(self):
        dec = decide(problemas_scenario(), BANDERA)
        bowl = next(d for d in dec.decisions if d.field_id == "BAN-04")
        self.assertEqual(bowl.disposition, Disposition.FAIL)
        self.assertTrue(bowl.is_food_safety_violation)
    def test_missing_field(self):
        dec = decide(problemas_scenario(), BANDERA)
        m = next(d for d in dec.decisions if d.field_id == "BAN-03")
        self.assertEqual(m.disposition, Disposition.MISSING)
    def test_unknown_field(self):
        dec = decide(problemas_scenario(), BANDERA)
        u = next(d for d in dec.decisions if d.field_id == "BAN-19")
        self.assertEqual(u.disposition, Disposition.UNKNOWN)
    def test_corrective_action(self):
        dec = decide(problemas_scenario(), BANDERA)
        self.assertIsNotNone(dec.fails[0].corrective_action)
    def test_review_reasons(self):
        dec = decide(problemas_scenario(), BANDERA)
        self.assertTrue(dec.needs_human_review)
        self.assertGreater(len(dec.review_reasons), 0)


class TestFoodSafetyMin(unittest.TestCase):
    def test_135_in_schema(self):
        for schema in [BANDERA, STONE_OAK, RIM]:
            for f in schema.fields:
                if f.food_safety_min is not None:
                    self.assertEqual(f.food_safety_min, 135)
    def test_hot_above_target_passes(self):
        # RIM-09=140, RIM-10=145: both >= target (100) -> PASS
        # The food_safety_min only applies when value < target
        dec = decide(rim_food_scenario(), RIM)
        r9 = next(d for d in dec.decisions if d.field_id == "RIM-09")
        r10 = next(d for d in dec.decisions if d.field_id == "RIM-10")
        self.assertEqual(r9.disposition, Disposition.PASS)
        self.assertEqual(r10.disposition, Disposition.PASS)

    def test_hot_below_target_below_135_is_violation(self):
        # BAN-04=98: below target (100) and below food_safety_min (135) -> FAIL
        dec = decide(problemas_scenario(), BANDERA)
        bowl = next(d for d in dec.decisions if d.field_id == "BAN-04")
        self.assertEqual(bowl.disposition, Disposition.FAIL)
        self.assertTrue(bowl.is_food_safety_violation)
    def test_bowl_98_below_135_violation(self):
        # BAN-04 (Bowl Warmer) = 98: below both target (100) and food_safety_min (135)
        dec = decide(problemas_scenario(), BANDERA)
        bowl = next(d for d in dec.decisions if d.field_id == "BAN-04")
        self.assertTrue(bowl.is_food_safety_violation)
    def test_helper_logic(self):
        from code.schemas.stores import Field
        h = Field("T","Test","Hot Holding",">=",100,50,200,food_safety_min=135)
        self.assertFalse(_is_food_safety_violation(140, h))
        self.assertFalse(_is_food_safety_violation(135, h))
        self.assertTrue(_is_food_safety_violation(130, h))
        self.assertTrue(_is_food_safety_violation(98, h))


class TestEquipmentWarnings(unittest.TestCase):
    def test_clean_no_warnings(self):
        dec = decide(normal_scenario(), STONE_OAK)
        self.assertEqual(len(dec.equipment_warnings), 0)
    def test_equipment_warnings_empty_for_food_safe_values(self):
        # When all hot holding values >= target, no equipment warnings
        dec = decide(rim_food_scenario(), RIM)
        ew = dec.equipment_warnings
        # RIM-09=140 >= 100 target -> PASS, not an equipment warning
        # RIM-07=8 <= 0 is a cold holding fail, but food_safety_violation=True
        ids = [d.field_id for d in ew]
        self.assertNotIn("RIM-09", ids)
        self.assertNotIn("RIM-10", ids)
    def test_bowl_not_in_equipment_warnings(self):
        dec = decide(problemas_scenario(), BANDERA)
        ids = [d.field_id for d in dec.equipment_warnings]
        self.assertNotIn("BAN-04", ids)


class TestTwoShift(unittest.TestCase):
    def test_has_4pm(self):
        ext = rim_two_shift_scenario()
        for r in ext.readings:
            self.assertIsNotNone(r.value_4pm)
    def test_4pm_null_when_10am_null(self):
        ext = rim_two_shift_scenario()
        r01 = next(r for r in ext.readings if r.field_id == "RIM-01")
        self.assertIsNone(r01.value)
        self.assertEqual(r01.value_4pm, 40)
    def test_19_readings(self):
        self.assertEqual(len(rim_two_shift_scenario().readings), 19)


class TestGtSchemaConsistency(unittest.TestCase):
    def test_gt_ids_in_schema(self):
        gt_path = Path(__file__).parent.parent / "eval" / "locked_ground_truth.json"
        if not gt_path.exists():
            self.skipTest("GT file not present")
        gt = json.loads(gt_path.read_text(encoding="utf-8"))
        for form_id, form in gt["forms"].items():
            sc = form.get("store_code", None)
            fmt = form.get("format", "")
            if sc is None:
                if "BAN-XX" in fmt: sc = "BANDERA"
                elif "SO-XX" in fmt: sc = "STONE_OAK"
                elif "RIM-XX" in fmt: sc = "RIM"
                else: continue
            if sc not in ALL_SCHEMAS: continue
            # skip legacy old-format (row_XX generic IDs)
            if "OLD" in fmt.upper() or "legacy" in fmt.lower():
                continue
            sids = {f.id for f in ALL_SCHEMAS[sc].fields}
            gids = set(form["cells"].keys())
            missing = gids - sids
            self.assertEqual(missing, set(), "GT %s missing: %s" % (form_id, missing))


class TestReplyBuilder(unittest.TestCase):
    def test_clean_reply(self):
        dec = decide(normal_scenario(), STONE_OAK)
        msg = build_confirmation_reply(dec)
        self.assertIn("Stone Oak", msg)
    def test_alert_for_fails(self):
        dec = decide(problemas_scenario(), BANDERA)
        alert = build_alert_message(dec)
        self.assertIsNotNone(alert)
        self.assertIn("Bandera", alert)
    def test_no_alert_when_clean(self):
        dec = decide(normal_scenario(), STONE_OAK)
        self.assertIsNone(build_alert_message(dec))


class TestPipelineIntegration(unittest.TestCase):
    def test_e2e_success(self):
        p = FormPipeline(primary=MockProvider("normal"))
        r = p.process(image_bytes=b"fake", group_name="B2 Kitchen Log")
        self.assertTrue(r.extraction.ok)
        self.assertEqual(r.extraction.store, "Stone Oak")
        self.assertIn("Stone Oak", r.reply_text)
        self.assertFalse(r.used_fallback)
    def test_failover(self):
        p = FormPipeline(primary=MockProvider("error"), fallback=MockProvider("normal"))
        r = p.process(image_bytes=b"fake", group_name="B2 Kitchen Log")
        self.assertTrue(r.used_fallback)
        self.assertTrue(r.extraction.ok)
    def test_no_fallback(self):
        p = FormPipeline(primary=MockProvider("error"))
        r = p.process(image_bytes=b"fake", group_name="B2 Kitchen Log")
        self.assertFalse(r.extraction.ok)
    def test_audit_emitted(self):
        evs = []
        p = FormPipeline(primary=MockProvider("problemas"), on_audit=evs.append)
        p.process(image_bytes=b"fake", group_name="B3 Kitchen Log")
        forms = [e for e in evs if e.get("event") == "form_processed"]
        self.assertEqual(len(forms), 1)
        self.assertEqual(forms[0]["store"], "Bandera Road")


# =====================================================
# CTO bug-fix verification tests (#3, #4, #5, #6)
# =====================================================

def _make_schema(*fields):
    return StoreSchema("Test", "TEST", "test", "v1", tuple(fields))


class TestFryerNotFoodViolation(unittest.TestCase):
    """Bug #4: Cooking Equipment failures are equipment issues, NOT food safety violations."""

    def test_fryer_138_is_implausible_not_fail(self):
        """P0 #2: 138 is a known bad OCR value for cooking equipment → IMPLAUSIBLE."""
        fryer = Field("FL", "Fryer Left", "Cooking Equipment", ">=", 350, 100, 450)
        schema = _make_schema(fryer)
        rd = [FieldReading("FL", 138, "138", 0.95)]
        ext = FormExtraction(store="Test", date="2026-06-20", shift="10AM",
            employee_name="T", readings=rd, provider="m", model="m",
            latency_ms=1000, overall_confidence=0.95)
        dec = decide(ext, schema)
        fd = dec.decisions[0]
        self.assertEqual(fd.disposition, Disposition.IMPLAUSIBLE)
        self.assertFalse(fd.is_food_safety_violation)

    def test_fryer_138_no_manager_alert(self):
        fryer = Field("FL", "Fryer Left", "Cooking Equipment", ">=", 350, 100, 450)
        schema = _make_schema(fryer)
        rd = [FieldReading("FL", 138, "138", 0.95)]
        ext = FormExtraction(store="Test", date="2026-06-20", shift="10AM",
            employee_name="T", readings=rd, provider="m", model="m",
            latency_ms=1000, overall_confidence=0.95)
        dec = decide(ext, schema)
        self.assertEqual(len(dec.fails), 0)

    def test_boiler_180_is_review_not_fail(self):
        boiler = Field("PB", "Pasta Boiler", "Cooking Equipment", ">=", 200, 100, 250)
        schema = _make_schema(boiler)
        rd = [FieldReading("PB", 180, "180", 0.95)]
        ext = FormExtraction(store="Test", date="2026-06-20", shift="10AM",
            employee_name="T", readings=rd, provider="m", model="m",
            latency_ms=1000, overall_confidence=0.95)
        dec = decide(ext, schema)
        fd = dec.decisions[0]
        self.assertEqual(fd.disposition, Disposition.REVIEW)
        self.assertFalse(fd.is_food_safety_violation)

    def test_hot_holding_below_food_safety_min_still_fails(self):
        warm = Field("BW", "Bowl Warmer", "Hot Holding", ">=", 100, 50, 200,
                      food_safety_min=135)
        schema = _make_schema(warm)
        rd = [FieldReading("BW", 98, "98", 0.95)]
        ext = FormExtraction(store="Test", date="2026-06-20", shift="10AM",
            employee_name="T", readings=rd, provider="m", model="m",
            latency_ms=1000, overall_confidence=0.95)
        dec = decide(ext, schema)
        fd = dec.decisions[0]
        self.assertEqual(fd.disposition, Disposition.FAIL)
        self.assertTrue(fd.is_food_safety_violation)


class TestFourPMValueSwap(unittest.TestCase):
    """Bug #3: When 4PM column selected, value_4pm must be swapped into value."""

    def test_pipeline_swaps_4pm_values(self):
        ext = rim_two_shift_scenario()
        ext.store = "Rim"
        p = FormPipeline(primary=MockProvider("rim_two_shift"))
        r = p.process(image_bytes=b"fake", group_name="B1 Kitchen Log")
        self.assertEqual(r.extraction.shift, "4PM")
        r01 = next(rd for rd in r.extraction.readings if rd.field_id == "RIM-01")
        self.assertEqual(r01.value, 40)

    def test_pipeline_4pm_swaps_read_text(self):
        ext = rim_two_shift_scenario()
        p = FormPipeline(primary=MockProvider("rim_two_shift"))
        r = p.process(image_bytes=b"fake", group_name="B1 Kitchen Log")
        r03 = next(rd for rd in r.extraction.readings if rd.field_id == "RIM-03")
        self.assertEqual(r03.raw_text, "40")


class TestNoDefaultBandera(unittest.TestCase):
    """Bug #5: Unknown group should not silently default to Bandera."""

    def test_unknown_group_with_recognizable_header_resolves(self):
        def unknown_group_scenario():
            return FormExtraction(store="Stone Oak", date="2026-06-20", shift="10AM",
                employee_name="T", readings=[
                    FieldReading("SO-01", 37, "37", 0.95),
                ], provider="m", model="m", latency_ms=1000, overall_confidence=0.95)
        p = FormPipeline(primary=MockProvider("normal"))
        p.primary = type("P", (), {
            "name": "m", "cost_per_form_usd": 0,
            "extract": lambda *a, **k: unknown_group_scenario()
        })()
        r = p.process(image_bytes=b"fake", group_name="Unknown Group")
        self.assertEqual(r.extraction.store, "Stone Oak")


class TestManagerMapping(unittest.TestCase):
    """Bug #6: MANAGERS keys must match StoreSchema.store_name exactly."""

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


class TestColdHoldingStillFailsAsViolation(unittest.TestCase):
    """Cold holding above target is still a food safety violation."""

    def test_cold_above_40_is_food_violation(self):
        cooler = Field("WC", "Walk-In", "Cold Holding", "<=", 40, -20, 80)
        schema = _make_schema(cooler)
        rd = [FieldReading("WC", 50, "50", 0.95)]
        ext = FormExtraction(store="Test", date="2026-06-20", shift="10AM",
            employee_name="T", readings=rd, provider="m", model="m",
            latency_ms=1000, overall_confidence=0.95)
        dec = decide(ext, schema)
        fd = dec.decisions[0]
        self.assertEqual(fd.disposition, Disposition.FAIL)
        self.assertTrue(fd.is_food_safety_violation)


if __name__ == "__main__":
    unittest.main(verbosity=2)

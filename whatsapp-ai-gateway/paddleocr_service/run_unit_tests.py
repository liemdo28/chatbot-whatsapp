"""Quick unit test runner - verifies routing logic without requiring cv2."""
import sys
sys.path.insert(0, '.')

# 1. Form header detector routing tests
print("=" * 60)
print("[1] Form Header Detector Routing Tests")
print("=" * 60)
from form_header_detector import route_submission
tests = [
    ("STORE: THE RIM",      "THE RIM",    "FoodSafety-Rim-v3",       "Explicit rim header"),
    ("STORE: STONE OAK",    "STONE OAK",  "FoodSafety-StoneOak-v3", "Explicit stone oak header"),
    ("STORE: BANDERA",      "BANDERA",    "FoodSafety-Bandera-v3",  "Explicit bandera header"),
    ("LOCATION: THE RIM",  "THE RIM",    "FoodSafety-Rim-v3",      "Location rim header"),
    ("STORE: rim",         "THE RIM",    "FoodSafety-Rim-v3",      "Lowercase rim"),
    ("STORE: Stone Oak",    "STONE OAK",  "FoodSafety-StoneOak-v3", "Mixed case stone oak"),
    ("LD Agent-Logtest - The Rim",  "THE RIM",  "FoodSafety-Rim-v3",      "Logtest group rim"),
    ("LD Agent-Logtest - Stone Oak", "STONE OAK", "FoodSafety-StoneOak-v3", "Logtest group stone oak"),
    ("B1 Kitchen Log",     "THE RIM",    "FoodSafety-Rim-v3",      "Production B1 group"),
    ("B2 Kitchen Log",     "STONE OAK",  "FoodSafety-StoneOak-v3", "Production B2 group"),
    ("B3 Kitchen Log",     "BANDERA",    "FoodSafety-Bandera-v3",  "Production B3 group"),
    ("The Rim Food Safety","THE RIM",    "FoodSafety-Rim-v3",      "Partial rim text"),
    ("Stone Oak Form",     "STONE OAK",  "FoodSafety-StoneOak-v3", "Partial stone oak text"),
]
all_pass = True
for input_text, exp_store, exp_tmpl, desc in tests:
    r = route_submission(input_text)
    ok = r["store_name"] == exp_store and r["template_id"] == exp_tmpl
    status = "PASS" if ok else "FAIL"
    print("  [%s] %s" % (status, desc))
    print("         input='%s'" % input_text)
    print("         store=%s (exp %s), template=%s (exp %s)" % (
        r["store_name"], exp_store, r["template_id"], exp_tmpl))
    if not ok:
        all_pass = False
print("\nForm Header Detection: %s" % ("ALL PASS" if all_pass else "SOME FAILURES"))

# 2. Template cell maps verification (no cv2 required)
print("\n" + "=" * 60)
print("[2] Template Cell Maps Tests")
print("=" * 60)
from template_cell_maps import get_template, get_all_templates, get_field_ids

# Verify B1 uses RIM-* not IM-*
rim_tmpl = get_template("FoodSafety-Rim-v3")
rim_fields = get_field_ids("FoodSafety-Rim-v3")
rim_ok = all(f.startswith("RIM-") for f in rim_fields)
rim_prefix_ok = rim_tmpl["field_prefix"] == "RIM"
print("  [%s] RIM fields are RIM-* (not IM-*): %s..." % (
    "PASS" if rim_ok else "FAIL", rim_fields[:5]))
print("  [%s] RIM template field_prefix = 'RIM' (was 'IM'): %s" % (
    "PASS" if rim_prefix_ok else "FAIL", rim_tmpl["field_prefix"]))

# Verify freezer ranges
rim02 = rim_tmpl["fields"]["RIM-02"]
rim07 = rim_tmpl["fields"]["RIM-07"]
print("  [%s] RIM-02 range_min = -20: %s" % (
    "PASS" if rim02["range_min"] == -20 else "FAIL", rim02["range_min"]))
print("  [%s] RIM-07 range_min = -20: %s" % (
    "PASS" if rim07["range_min"] == -20 else "FAIL", rim07["range_min"]))
print("  [%s] RIM-07 range_max = 0: %s" % (
    "PASS" if rim07["range_max"] == 0 else "FAIL", rim07["range_max"]))

# Verify all 3 templates exist
all_tmpls = get_all_templates()
all_ok = True
for tid, name in [("FoodSafety-Rim-v3", "The Rim"),
                   ("FoodSafety-StoneOak-v3", "Stone Oak"),
                   ("FoodSafety-Bandera-v3", "Bandera")]:
    ok = tid in all_tmpls
    print("  [%s] Template '%s' exists (%s)" % ("PASS" if ok else "FAIL", tid, name))
    if not ok:
        all_ok = False

# Verify BAN-02 freezer range
ban_tmpl = get_template("FoodSafety-Bandera-v3")
ban02 = ban_tmpl["fields"]["BAN-02"]
print("  [%s] BAN-02 range_min = -20 (Walk-In Freezer): %s" % (
    "PASS" if ban02["range_min"] == -20 else "FAIL", ban02["range_min"]))

print("\n" + "=" * 60)
overall = "ALL PASS" if (all_pass and all_ok) else "SOME FAILURES"
print("OVERALL: %s" % overall)
print("=" * 60)
print("")
print("NOTE: Negative temperature tests require cv2 (OpenCV).")
print("Run after 'pip install opencv-python':")
print("  python test_cell_extraction.py")

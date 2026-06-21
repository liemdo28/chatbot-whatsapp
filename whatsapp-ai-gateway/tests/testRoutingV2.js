/**
 * testRoutingV2.js — CEO Directive Routing Tests
 *
 * Tests the formImageRouter.js for correct store/template resolution
 * based on group name and OCR text content.
 */

const router = require("../src/formImageRouter");

let passed = 0;
let failed = 0;

function assert(condition, desc) {
    if (condition) {
        console.log(`  ✅ PASS: ${desc}`);
        passed++;
    } else {
        console.log(`  ❌ FAIL: ${desc}`);
        failed++;
    }
}

function assertEqual(actual, expected, desc) {
    if (actual === expected) {
        console.log(`  ✅ PASS: ${desc}`);
        passed++;
    } else {
        console.log(`  ❌ FAIL: ${desc} — expected "${expected}", got "${actual}"`);
        failed++;
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
console.log("\n=== Test 1: Enabled Groups ===");
// ═══════════════════════════════════════════════════════════════════════════════
assert(router.ENABLED_GROUPS.includes("b1 kitchen log"), "B1 Kitchen Log enabled");
assert(router.ENABLED_GROUPS.includes("b2 kitchen log"), "B2 Kitchen Log enabled");
assert(router.ENABLED_GROUPS.includes("b3 kitchen log"), "B3 Kitchen Log enabled");
assert(router.ENABLED_GROUPS.includes("ld agent-logtest"), "LD Agent-Logtest enabled");
assert(router.ENABLED_GROUPS.includes("ld agent logtest"), "LD Agent Logtest enabled");
assert(router.ENABLED_GROUPS.includes("bakudan management team"), "Bakudan Management Team enabled");

// ═══════════════════════════════════════════════════════════════════════════════
console.log("\n=== Test 2: Form Detection (isFormLikely) ===");
// ═══════════════════════════════════════════════════════════════════════════════
assert(router.isFormLikely("FOOD SAFETY LINE CHECK"), "Detects FOOD SAFETY LINE CHECK");
assert(router.isFormLikely("STONE OAK LINE CHECK"), "Detects STONE OAK LINE CHECK");
assert(router.isFormLikely("THE RIM LINE CHECK"), "Detects THE RIM LINE CHECK");
assert(router.isFormLikely("BANDERA LINE CHECK"), "Detects BANDERA LINE CHECK");
assert(router.isFormLikely("FOOD SAFETY LINE CHECK\nSO-01 Walk-In Cooler 35\nSO-02 Walk-In Freezer 0"), "Detects structured SO form");
assert(router.isFormLikely("FOOD SAFETY LINE CHECK\nRIM-01 Walk-In Cooler 38\nRIM-02 Walk-In Freezer -5"), "Detects structured RIM form");
assert(router.isFormLikely("FOOD SAFETY LINE CHECK\nBAN-01 Walk-In Cooler 40\nBAN-02 Walk-In Freezer -5"), "Detects structured BAN form");
assert(!router.isFormLikely("Walk-In Cooler 35°F"), "Does NOT detect single temperature row as a form");
assert(!router.isFormLikely("Just a random photo of lunch"), "Does NOT detect random food photo");
assert(!router.isFormLikely("Hey team, how's it going?"), "Does NOT detect chat message");
assert(!router.isFormLikely(""), "Does NOT detect empty text");
assert(!router.isFormLikely(null), "Does NOT detect null");

// ═══════════════════════════════════════════════════════════════════════════════
console.log("\n=== Test 3: Store Detection from Text (detectStoreFromText) ===");
// ═══════════════════════════════════════════════════════════════════════════════
assertEqual(router.detectStoreFromText("STORE: THE RIM"), "THE RIM", "Explicit STORE: THE RIM");
assertEqual(router.detectStoreFromText("STORE: STONE OAK"), "STONE OAK", "Explicit STORE: STONE OAK");
assertEqual(router.detectStoreFromText("STORE: BANDERA"), "BANDERA", "Explicit STORE: BANDERA");
assertEqual(router.detectStoreFromText("LOCATION: THE RIM"), "THE RIM", "Location THE RIM");
assertEqual(router.detectStoreFromText("LOCATION: STONE OAK"), "STONE OAK", "Location STONE OAK");
assertEqual(router.detectStoreFromText("STONE OAK LINE CHECK"), "STONE OAK", "Legacy STONE OAK LINE CHECK");
assertEqual(router.detectStoreFromText("THE RIM LINE CHECK"), "THE RIM", "Legacy THE RIM LINE CHECK");
assertEqual(router.detectStoreFromText("BANDERA LINE CHECK"), "BANDERA", "Legacy BANDERA LINE CHECK");
assertEqual(router.detectStoreFromText("FOOD SAFETY LINE CHECK RIM-01 35"), "THE RIM", "Food Safety Line Check with RIM fields");
assertEqual(router.detectStoreFromText("FOOD SAFETY LINE CHECK SO-01 35"), "STONE OAK", "Food Safety Line Check with SO fields");
assertEqual(router.detectStoreFromText("FOOD SAFETY LINE CHECK BAN-01 35"), "BANDERA", "Food Safety Line Check with BAN fields");
assertEqual(router.detectStoreFromText("SO-01 Walk-In Cooler 35"), "STONE OAK", "SO field ID → Stone Oak");
assertEqual(router.detectStoreFromText("RIM-01 Walk-In Cooler 38"), "THE RIM", "RIM field ID → The Rim");
assertEqual(router.detectStoreFromText("BAN-01 Walk-In Cooler 40"), "BANDERA", "BAN field ID → Bandera");
assertEqual(router.detectStoreFromText("random text with no store info"), null, "No store info → null");
assertEqual(router.detectStoreFromText(""), null, "Empty text → null");
assertEqual(router.detectStoreFromText(null), null, "Null text → null");

// ═══════════════════════════════════════════════════════════════════════════════
console.log("\n=== Test 4: Store Detection from Group Name (detectStoreFromGroupName) ===");
// ═══════════════════════════════════════════════════════════════════════════════
const b1 = router.detectStoreFromGroupName("B1 Kitchen Log");
assertEqual(b1.storeCode, "B1", "B1 Kitchen Log → B1");
assertEqual(b1.storeName, "The Rim", "B1 Kitchen Log → The Rim");
assertEqual(b1.templateId, "FoodSafety-Rim-v3", "B1 Kitchen Log → Rim-v3");

const b2 = router.detectStoreFromGroupName("B2 Kitchen Log");
assertEqual(b2.storeCode, "B2", "B2 Kitchen Log → B2");
assertEqual(b2.storeName, "Stone Oak", "B2 Kitchen Log → Stone Oak");
assertEqual(b2.templateId, "FoodSafety-StoneOak-v3", "B2 Kitchen Log → StoneOak-v3");

const b3 = router.detectStoreFromGroupName("B3 Kitchen Log");
assertEqual(b3.storeCode, "B3", "B3 Kitchen Log → B3");
assertEqual(b3.storeName, "Bandera", "B3 Kitchen Log → Bandera");
assertEqual(b3.templateId, "FoodSafety-Bandera-v3", "B3 Kitchen Log → Bandera-v3");

const ldRim = router.detectStoreFromGroupName("LD Agent-Logtest - The Rim");
assertEqual(ldRim.storeCode, "B1", "LD Agent-Logtest - The Rim → B1");

const ldSO = router.detectStoreFromGroupName("LD Agent-Logtest - Stone Oak");
assertEqual(ldSO.storeCode, "B2", "LD Agent-Logtest - Stone Oak → B2");
assertEqual(router.getGroupScope({ chatName: "Bakudan Management Team" }).processingEnabled, false, "Management group is alerts-only");

// ══════════════════════════════���════════════════════════════════════════════════
console.log("\n=== Test 5: Full Context Resolution (resolveStoreFromContext) ===");
// ═══════════════════════════════════════════════════════════════════════════════
// Production groups
const prodB1 = router.resolveStoreFromContext("B1 Kitchen Log", null);
assertEqual(prodB1.storeCode, "B1", "Production B1 group → B1");
assertEqual(prodB1.routingSource, "production_group", "Production B1 → production_group source");

const prodB2 = router.resolveStoreFromContext("B2 Kitchen Log", null);
assertEqual(prodB2.storeCode, "B2", "Production B2 group → B2");
assertEqual(prodB2.routingSource, "production_group", "Production B2 → production_group source");

const prodB3 = router.resolveStoreFromContext("B3 Kitchen Log", null);
assertEqual(prodB3.storeCode, "B3", "Production B3 group → B3");

// Test group: form header determines routing
const testRim = router.resolveStoreFromContext("LD Agent-Logtest", "FOOD SAFETY LINE CHECK RIM-01 35");
assertEqual(testRim.storeCode, "B1", "Logtest + RIM text → B1");
assertEqual(testRim.routingSource, "form_header", "Logtest + RIM → form_header source");

const testSO = router.resolveStoreFromContext("LD Agent-Logtest", "STONE OAK LINE CHECK SO-01 35");
assertEqual(testSO.storeCode, "B2", "Logtest + Stone Oak text → B2");
assertEqual(testSO.routingSource, "form_header", "Logtest + Stone Oak → form_header source");

const testBAN = router.resolveStoreFromContext("LD Agent-Logtest", "BANDERA LINE CHECK BAN-01 40");
assertEqual(testBAN.storeCode, "B3", "Logtest + Bandera text → B3");
assertEqual(testBAN.routingSource, "form_header", "Logtest + Bandera → form_header source");

// ═══════════════════════════════════════════════════════════════════════════════
console.log("\n=== Test 6: Group Validation (validateStoreGroupMatch) ===");
// ═══════════════════════════════════════════════════════════════════════════════
const validB2 = router.validateStoreGroupMatch("B2 Kitchen Log", { storeCode: "B2" });
assert(validB2.valid, "B2 form in B2 group → valid");

const invalidB2 = router.validateStoreGroupMatch("B2 Kitchen Log", { storeCode: "B1" });
assert(!invalidB2.valid, "B1 form in B2 group → invalid");
assert(invalidB2.message.includes("does not match"), "Rejection message mentions mismatch");

// LD Agent-Logtest: always valid (any store can be uploaded)
const logtestAny = router.validateStoreGroupMatch("LD Agent-Logtest", { storeCode: "B1" });
assert(logtestAny.valid, "LD Agent-Logtest always valid");

// ═══════════════════════════════════════════════════════════════════════════════
console.log("\n=== SUMMARY ===");
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log(`  Total:  ${passed + failed}`);
console.log("");

if (failed > 0) {
    console.log("❌ SOME TESTS FAILED");
    process.exit(1);
} else {
    console.log("✅ ALL TESTS PASSED");
    process.exit(0);
}

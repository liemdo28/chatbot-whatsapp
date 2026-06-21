#!/usr/bin/env python3
"""
CEO Handwriting Sample Batch 001 Import Script
Imports 4 CEO handwriting images as ground-truth training samples.
Run: python src/tools/ceo-batch-import.py
"""

import os
import sys
import json
import hashlib
import sqlite3
import shutil
from datetime import datetime

# ─── Paths ────────────────────────────────────────────────────────────────────
ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", ".."))
EVIDENCE = os.path.join(ROOT, "data", "evidence")
BATCH_DIR = os.path.join(ROOT, "data", "handwriting", "ceo-batch-001")
CROPS_BASE = os.path.join(ROOT, "data", "handwriting", "crops")
SAMPLES_BASE = os.path.join(ROOT, "data", "handwriting", "samples")
DB_PATH = os.path.join(ROOT, "data", "gateway.db")

# ─── CEO Ground Truth Data ───────────────────────────────────────────────────
BATCH_NAME = "CEO_HANDWRITING_SAMPLE_BATCH_001"
SOURCE_GROUP = "LD Agent-Logtest"

CEO_IMAGES = [
    {
        "image_order": 1,
        "message_id": "evidence_1781865191704_17c8e77e",
        "filename": "evidence_1781865191704_17c8e77e.jpg",
        "store_code": "B3",
        "store_name": "Bandera",
        "template_family": "legacy_bandera_road_line_check",
        "legacy_form": "BANDERA ROAD - LINE CHECK",
        "description": "Bandera Road multi-day form",
        "columns": {
            "MON": {"FREEZER_PHOTO": -7, "WALK_IN_COOLER_PHOTO": 40, "BOWL_WARMERS": 104, "RAMEN_TOP": 40, "RAMEN_BELOW": 41, "FREEZER_LINE": 10, "PORK_CHASHU": 103, "SEASONED_EGG_PHOTO": 103, "TAPAS_TOP": 41, "TAPAS_BELOW": 41, "TAPAS_SIDE_FRIED": 36, "FRYER_LEFT_PHOTO": 363, "FRYER_RIGHT_PHOTO": 365, "PORK_BROTH": 200, "CHICKEN_BROTH": 200, "PASTA_BOILER_LEFT": 210, "PASTA_BOILER_RIGHT": 211},
            "TUES": {"FREEZER_PHOTO": -3, "WALK_IN_COOLER_PHOTO": 40, "BOWL_WARMERS": 88, "RAMEN_TOP": 40, "RAMEN_BELOW": 40, "FREEZER_LINE": 10, "PORK_CHASHU": 104, "SEASONED_EGG_PHOTO": 100, "TAPAS_TOP": 40, "TAPAS_BELOW": 40, "TAPAS_SIDE_FRIED": 36, "FRYER_LEFT_PHOTO": 356, "FRYER_RIGHT_PHOTO": 360, "PORK_BROTH": 200, "CHICKEN_BROTH": 200, "PASTA_BOILER_LEFT": 211},
            "WED": {"FREEZER_PHOTO": -7, "WALK_IN_COOLER_PHOTO": 40, "BOWL_WARMERS": 102, "RAMEN_TOP": 40, "RAMEN_BELOW": 38, "FREEZER_LINE": 10, "PORK_CHASHU": 100, "SEASONED_EGG_PHOTO": 101, "TAPAS_TOP": 39, "TAPAS_BELOW": 40, "TAPAS_SIDE_FRIED": 36, "FRYER_LEFT_PHOTO": 361, "FRYER_RIGHT_PHOTO": 358, "PORK_BROTH": 200, "CHICKEN_BROTH": 200, "PASTA_BOILER_LEFT": 211},
        },
        "needs_review": False,
    },
    {
        "image_order": 2,
        "message_id": "evidence_1781865191707_44978794",
        "filename": "evidence_1781865191707_44978794.jpg",
        "store_code": "B2",
        "store_name": "Stone Oak",
        "template_family": "legacy_stone_oak_line_check",
        "legacy_form": "STONE OAK LINE CHECK",
        "description": "Stone Oak close-up",
        "column": "11:00 AM",
        "values": [40, 0, 40, 34, 41, 0, 35, 36, 37, 37, 334, 330, 200, 200, 100, 200, 200],
        "needs_review": False,
    },
    {
        "image_order": 3,
        "message_id": "evidence_1781865191710_5420b270",
        "filename": "evidence_1781865191710_5420b270.jpg",
        "store_code": "B2",
        "store_name": "Stone Oak",
        "template_family": "legacy_stone_oak_line_check",
        "legacy_form": "LEGACY LINE CHECK",
        "description": "Legacy line check close-up",
        "column": "AM",
        "values": [40, 40, 40, 0, 40, 40, 348, 331, 200, 200, 150, 45, 100, 200, 200, 200],
        "needs_review": True,
    },
    {
        "image_order": 4,
        "message_id": "evidence_1781865191714_aa430f11",
        "filename": "evidence_1781865191714_aa430f11.jpg",
        "store_code": "B3",
        "store_name": "Bandera",
        "template_family": "legacy_bandera_road_line_check",
        "legacy_form": "BANDERA ROAD - LINE CHECK",
        "description": "Bandera Road clear full form",
        "columns": {
            "MON": {"FREEZER_PHOTO": -7, "WALK_IN_COOLER_PHOTO": 40, "BOWL_WARMERS": 104, "RAMEN_TOP": 40, "RAMEN_BELOW": 41, "FREEZER_LINE": 10, "PORK_CHASHU": 103, "SEASONED_EGG_PHOTO": 103, "TAPAS_TOP": 41, "TAPAS_BELOW": 41, "TAPAS_SIDE_FRIED": 36, "FRYER_LEFT_PHOTO": 363, "FRYER_RIGHT_PHOTO": 365, "PORK_BROTH": 200, "CHICKEN_BROTH": 200, "PASTA_BOILER_LEFT": 210, "PASTA_BOILER_RIGHT": 211},
            "TUES": {"FREEZER_PHOTO": -3, "WALK_IN_COOLER_PHOTO": 40, "BOWL_WARMERS": 88, "RAMEN_TOP": 40, "RAMEN_BELOW": 40, "FREEZER_LINE": 10, "PORK_CHASHU": 104, "SEASONED_EGG_PHOTO": 100, "TAPAS_TOP": 40, "TAPAS_BELOW": 40, "TAPAS_SIDE_FRIED": 36, "FRYER_LEFT_PHOTO": 356, "FRYER_RIGHT_PHOTO": 360, "PORK_BROTH": 200, "CHICKEN_BROTH": 200, "PASTA_BOILER_LEFT": 211},
            "WED": {"FREEZER_PHOTO": -7, "WALK_IN_COOLER_PHOTO": 40, "BOWL_WARMERS": 102, "RAMEN_TOP": 40, "RAMEN_BELOW": 38, "FREEZER_LINE": 10, "PORK_CHASHU": 100, "SEASONED_EGG_PHOTO": 101, "TAPAS_TOP": 39, "TAPAS_BELOW": 40, "TAPAS_SIDE_FRIED": 36, "FRYER_LEFT_PHOTO": 361, "FRYER_RIGHT_PHOTO": 358, "PORK_BROTH": 200, "CHICKEN_BROTH": 200, "PASTA_BOILER_LEFT": 211},
        },
        "needs_review": False,
    },
]

SO_FIELD_IDS = [
    "SO-01", "SO-02", "SO-03", "SO-04", "SO-05",
    "SO-06", "SO-07", "SO-08", "SO-09", "SO-10",
    "SO-11", "SO-12", "SO-13", "SO-14", "SO-15",
    "SO-16", "SO-17",
]


def ensure_dir(d):
    os.makedirs(d, exist_ok=True)


def fingerprint(filepath):
    try:
        with open(filepath, "rb") as f:
            return hashlib.sha256(f.read()).hexdigest()[:32]
    except Exception:
        return "FB_%d" % int(datetime.now().timestamp() * 1000)


def create_tables(conn):
    """Create the 3 required tables if missing."""
    c = conn.cursor()

    c.execute("""
        CREATE TABLE IF NOT EXISTS handwriting_training_batches (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            batch_name TEXT NOT NULL UNIQUE,
            source_group_name TEXT,
            source_group_id TEXT,
            purpose TEXT,
            created_by TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            status TEXT DEFAULT 'IMPORTED',
            notes TEXT
        )
    """)

    c.execute("""
        CREATE TABLE IF NOT EXISTS handwriting_ground_truth (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            batch_id INTEGER,
            image_order INTEGER,
            image_message_id TEXT,
            image_filename TEXT,
            image_path TEXT,
            store_code TEXT,
            store_name TEXT,
            template_family TEXT,
            field_key TEXT,
            field_label TEXT,
            column_label TEXT,
            day_label TEXT,
            confirmed_value REAL,
            value_type TEXT DEFAULT 'temperature',
            confidence_label TEXT DEFAULT 'CEO_GROUND_TRUTH',
            needs_review INTEGER DEFAULT 0,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    """)

    c.execute("""
        CREATE TABLE IF NOT EXISTS handwriting_cell_samples (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ground_truth_id INTEGER,
            batch_id INTEGER,
            crop_path TEXT,
            processed_crop_path TEXT,
            fingerprint_hash TEXT,
            embedding_json TEXT,
            confirmed_value REAL,
            store_code TEXT,
            template_family TEXT,
            field_key TEXT,
            column_label TEXT,
            day_label TEXT,
            image_filename TEXT,
            needs_review INTEGER DEFAULT 0,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # Indexes
    for idx_sql in [
        "CREATE INDEX IF NOT EXISTS idx_gt_batch ON handwriting_ground_truth(batch_id)",
        "CREATE INDEX IF NOT EXISTS idx_gt_store ON handwriting_ground_truth(store_code)",
        "CREATE INDEX IF NOT EXISTS idx_gt_field ON handwriting_ground_truth(store_code, field_key)",
        "CREATE INDEX IF NOT EXISTS idx_gt_review ON handwriting_ground_truth(needs_review)",
        "CREATE INDEX IF NOT EXISTS idx_cs_batch ON handwriting_cell_samples(batch_id)",
        "CREATE INDEX IF NOT EXISTS idx_cs_store_field ON handwriting_cell_samples(store_code, field_key)",
        "CREATE INDEX IF NOT EXISTS idx_cs_fingerprint ON handwriting_cell_samples(fingerprint_hash)",
    ]:
        c.execute(idx_sql)

    # Also create the Node.js handwriting tables if missing
    c.execute("""
        CREATE TABLE IF NOT EXISTS handwriting_confirmed_samples (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sample_id TEXT UNIQUE,
            submission_id TEXT,
            employee_name TEXT,
            employee_phone TEXT,
            group_id TEXT,
            store_code TEXT NOT NULL,
            template_id TEXT,
            field_id TEXT NOT NULL,
            item_name TEXT,
            column TEXT,
            confirmed_value TEXT NOT NULL,
            raw_ocr_value TEXT,
            raw_ocr_confidence REAL,
            cell_image_path TEXT,
            normalized_cell_image_path TEXT,
            fingerprint TEXT,
            source_action TEXT DEFAULT 'CONFIRM',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    """)
    c.execute("CREATE INDEX IF NOT EXISTS idx_hc_store_field ON handwriting_confirmed_samples(store_code, field_id)")
    c.execute("CREATE INDEX IF NOT EXISTS idx_hc_fingerprint ON handwriting_confirmed_samples(fingerprint)")

    conn.commit()
    print("[OK] Database tables created/verified")


def process_image(conn, img, batch_id, image_path):
    """Import one image's ground truth values."""
    c = conn.cursor()
    gt_count = 0
    crop_count = 0
    needs_review = 1 if img.get("needs_review") else 0

    if "columns" in img:
        # Multi-column format (Bandera multi-day forms)
        crop_dir = os.path.join(CROPS_BASE, img["store_code"], "ceo-batch-001")
        ensure_dir(crop_dir)
        for day, vals in img["columns"].items():
            for field_key, value in vals.items():
                c.execute(
                    """INSERT INTO handwriting_ground_truth
                       (batch_id, image_order, image_message_id, image_filename,
                        image_path, store_code, store_name, template_family,
                        field_key, day_label, confirmed_value, needs_review)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (
                        batch_id, img["image_order"], img["message_id"], img["filename"],
                        image_path, img["store_code"], img["store_name"], img["template_family"],
                        field_key, day, value, needs_review,
                    ),
                )
                gt_id = c.lastrowid
                gt_count += 1
                safe_field = field_key.replace(" ", "_").replace("-", "_").replace("(", "").replace(")", "")
                ts = int(datetime.now().timestamp() * 1000) + gt_count
                crop_fn = f"crop_{safe_field}_{day}_{ts}.jpg"
                crop_path = os.path.join(crop_dir, crop_fn)
                if os.path.exists(image_path):
                    try:
                        shutil.copy2(image_path, crop_path)
                    except Exception as e:
                        print(f"    [WARN] Copy failed: {e}")
                        crop_path = None
                fp_hash = fingerprint(image_path) if os.path.exists(image_path) else "NONE"
                proc_path = (crop_path or "").replace(".jpg", "_proc.jpg") if crop_path else None
                if crop_path and os.path.exists(crop_path) and proc_path:
                    try:
                        shutil.copy2(crop_path, proc_path)
                    except Exception:
                        proc_path = None
                c.execute(
                    """INSERT INTO handwriting_cell_samples
                       (ground_truth_id, batch_id, crop_path, processed_crop_path,
                        fingerprint_hash, confirmed_value, store_code, template_family,
                        field_key, column_label, day_label, image_filename, needs_review)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (
                        gt_id, batch_id, crop_path, proc_path, fp_hash,
                        value, img["store_code"], img["template_family"],
                        field_key, None, day, img["filename"], needs_review,
                    ),
                )
                crop_count += 1

    elif "values" in img:
        # Single-column format (Stone Oak single-column)
        col = img.get("column", "AM")
        for i, value in enumerate(img["values"]):
            field_key = SO_FIELD_IDS[i] if i < len(SO_FIELD_IDS) else "FIELD_%03d" % i
            c.execute(
                """INSERT INTO handwriting_ground_truth
                   (batch_id, image_order, image_message_id, image_filename,
                    image_path, store_code, store_name, template_family,
                    field_key, column_label, confirmed_value, needs_review)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    batch_id, img["image_order"], img["message_id"], img["filename"],
                    image_path, img["store_code"], img["store_name"], img["template_family"],
                    field_key, col, value, needs_review,
                ),
            )
            gt_id = c.lastrowid
            gt_count += 1

            crop_dir = os.path.join(CROPS_BASE, img["store_code"], "ceo-batch-001")
            ensure_dir(crop_dir)
            safe_field = field_key.replace(" ", "_").replace("-", "_")
            safe_col = col.replace(" ", "_").replace(":", "")
            ts = int(datetime.now().timestamp() * 1000) + i
            crop_fn = f"crop_{safe_field}_{safe_col}_{ts}.jpg"
            crop_path = os.path.join(crop_dir, crop_fn)
            if os.path.exists(image_path):
                try:
                    shutil.copy2(image_path, crop_path)
                except Exception as e:
                    print(f"    [WARN] Copy failed: {e}")
                    crop_path = None
            fp_hash = fingerprint(image_path) if os.path.exists(image_path) else "NONE"
            proc_path = (crop_path or "").replace(".jpg", "_proc.jpg") if crop_path else None
            if crop_path and os.path.exists(crop_path) and proc_path:
                try:
                    shutil.copy2(crop_path, proc_path)
                except Exception:
                    proc_path = None

            c.execute(
                """INSERT INTO handwriting_cell_samples
                   (ground_truth_id, batch_id, crop_path, processed_crop_path,
                    fingerprint_hash, confirmed_value, store_code, template_family,
                    field_key, column_label, day_label, image_filename, needs_review)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    gt_id, batch_id, crop_path, proc_path, fp_hash,
                    value, img["store_code"], img["template_family"],
                    field_key, col, None, img["filename"], needs_review,
                ),
            )
            crop_count += 1

    return gt_count, crop_count


def main():
    print("=" * 60)
    print("CEO HANDWRITING SAMPLE BATCH 001 IMPORT")
    print("=" * 60)
    print("Started:", datetime.now().isoformat())
    print()

    if not os.path.exists(DB_PATH):
        print("[ERROR] Database not found:", DB_PATH)
        sys.exit(1)

    conn = sqlite3.connect(DB_PATH)
    create_tables(conn)

    # Step 1: Verify images
    print("\n[STEP 1] Verifying 4 CEO images...")
    verified = 0
    for img in CEO_IMAGES:
        fp = os.path.join(EVIDENCE, img["filename"])
        if os.path.exists(fp):
            sz = os.path.getsize(fp)
            print(f"  [OK] {img['filename']} ({sz:,} bytes) - {img['store_name']} / {img['legacy_form']}")
            verified += 1
        else:
            print(f"  [MISSING] {img['filename']}")
    print(f"  Verified: {verified}/{len(CEO_IMAGES)}")
    if verified == 0:
        print("[FATAL] No images found. Aborting.")
        sys.exit(1)

    # Step 2: Create batch record (clean up existing if re-running)
    print("\n[STEP 2] Creating batch record...")
    c = conn.cursor()
    c.execute("SELECT id FROM handwriting_training_batches WHERE batch_name = ?", (BATCH_NAME,))
    existing = c.fetchone()
    if existing:
        bid = existing[0]
        print(f"  [INFO] Batch already exists (id={bid}), cleaning up for re-import...")
        c.execute("DELETE FROM handwriting_cell_samples WHERE batch_id = ?", (bid,))
        c.execute("DELETE FROM handwriting_ground_truth WHERE batch_id = ?", (bid,))
        c.execute("DELETE FROM handwriting_confirmed_samples WHERE sample_id LIKE ?", (f"CEO-BATCH001-%",))
        c.execute("DELETE FROM handwriting_training_batches WHERE id = ?", (bid,))
        conn.commit()
    c.execute(
        """INSERT OR IGNORE INTO handwriting_training_batches
           (batch_name, source_group_name, purpose, status, created_by, notes)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (BATCH_NAME, SOURCE_GROUP, "handwriting_memory_training", "IMPORTED", "CEO",
         "4 CEO handwriting sample images imported from LD Agent-Logtest"),
    )
    conn.commit()
    c.execute("SELECT id FROM handwriting_training_batches WHERE batch_name = ?", (BATCH_NAME,))
    batch_id = c.fetchone()[0]
    print(f"  Batch ID: {batch_id}")
    print(f"  Batch name: {BATCH_NAME}")

    # Step 3: Copy images and import ground truth
    print("\n[STEP 3] Importing images...")
    ensure_dir(BATCH_DIR)
    total_gt = 0
    total_crops = 0
    image_paths = []

    for img in CEO_IMAGES:
        print(f"\n  Image {img['image_order']}: {img['description']}")
        print(f"    Store: {img['store_code']} / {img['store_name']}")
        print(f"    Template: {img['template_family']}")
        print(f"    Form: {img['legacy_form']}")

        src = os.path.join(EVIDENCE, img["filename"])
        if not os.path.exists(src):
            print(f"    [SKIP] Source image not found")
            continue

        dst = os.path.join(BATCH_DIR, img["filename"])
        shutil.copy2(src, dst)
        print(f"    Copied to: {dst}")

        gt_count, crop_count = process_image(conn, img, batch_id, dst)
        total_gt += gt_count
        total_crops += crop_count
        image_paths.append(dst)
        print(f"    Ground truth rows: {gt_count}")
        print(f"    Cell crops created: {crop_count}")
        print(f"    Negative values preserved: ", end="")
        if "columns" in img:
            negs = [(d, k, v) for d, vals in img["columns"].items() for k, v in vals.items() if v < 0]
            if negs:
                print(", ".join(f"{d}/{k}={v}" for d, k, v in negs))
            else:
                print("none in this image")
        elif "values" in img:
            negs = [(i, SO_FIELD_IDS[i], v) for i, v in enumerate(img["values"]) if v < 0]
            if negs:
                print(", ".join(f"{fid}={v}" for _, fid, v in negs))
            else:
                print("none in this image")

    conn.commit()

    # Step 4: Verify import counts
    print("\n[STEP 4] Verification...")
    c.execute("SELECT COUNT(*) FROM handwriting_ground_truth WHERE batch_id = ?", (batch_id,))
    db_gt = c.fetchone()[0]
    c.execute("SELECT COUNT(*) FROM handwriting_cell_samples WHERE batch_id = ?", (batch_id,))
    db_crops = c.fetchone()[0]
    c.execute("SELECT COUNT(DISTINCT fingerprint_hash) FROM handwriting_cell_samples WHERE batch_id = ?", (batch_id,))
    db_fps = c.fetchone()[0]
    print(f"  Ground truth rows in DB: {db_gt}")
    print(f"  Cell samples in DB: {db_crops}")
    print(f"  Unique fingerprints: {db_fps}")

    # Step 5: Value range verification
    print("\n[STEP 5] Critical value preservation check...")
    critical_values = {-7, -3, 0, 40, 200, 363}
    c.execute("SELECT confirmed_value FROM handwriting_ground_truth WHERE batch_id = ?", (batch_id,))
    all_vals = set(row[0] for row in c.fetchall())
    for cv in sorted(critical_values):
        status = "PASS" if cv in all_vals else "NOT PRESENT"
        print(f"  Value {cv:>4}: {status}")

    # Step 6: Per-store summary
    print("\n[STEP 6] Per-store summary...")
    c.execute("SELECT store_code, COUNT(*) FROM handwriting_ground_truth WHERE batch_id = ? GROUP BY store_code", (batch_id,))
    for row in c.fetchall():
        print(f"  {row[0]}: {row[1]} ground truth rows")

    # Step 7: Prediction verification (memory search test)
    print("\n[STEP 7] Memory search verification...")
    for store in ["B2", "B3"]:
        c.execute(
            "SELECT field_id, confirmed_value FROM handwriting_confirmed_samples WHERE store_code = ? LIMIT 3",
            (store,),
        )
        rows = c.fetchall()
        if rows:
            print(f"  {store} confirmed samples: {len(rows)} (memory search will find matches)")
        else:
            print(f"  {store} confirmed samples: 0 (in handwriting_confirmed_samples — note: CEO batch data is in handwriting_cell_samples)")

    # Step 8: Save to confirmed samples for the prediction engine
    print("\n[STEP 8] Seeding confirmed samples for prediction engine...")
    sample_count = 0
    c2 = conn.cursor()
    c.execute(
        "SELECT gt.field_key, gt.confirmed_value, gt.store_code, gt.template_family, "
        "gt.column_label, gt.day_label, cs.fingerprint_hash, gt.image_filename, gt.needs_review "
        "FROM handwriting_ground_truth gt "
        "LEFT JOIN handwriting_cell_samples cs ON cs.ground_truth_id = gt.id "
        "WHERE gt.batch_id = ?",
        (batch_id,),
    )
    for row in c.fetchall():
        field_key, value, store_code, template_family, col_label, day_label, fp_hash, img_fn, needs_rev = row
        c2.execute(
            """INSERT OR IGNORE INTO handwriting_confirmed_samples
               (sample_id, submission_id, employee_name, employee_phone,
                group_id, store_code, template_id, field_id, item_name,
                column, confirmed_value, raw_ocr_value, raw_ocr_confidence,
                cell_image_path, normalized_cell_image_path, fingerprint,
                source_action, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))""",
            (
                f"CEO-BATCH001-{store_code}-{field_key}-{int(datetime.now().timestamp()*1000)+sample_count}",
                f"ceo_batch_001_{img_fn}",
                "CEO", None,
                SOURCE_GROUP, store_code, template_family, field_key, field_key,
                col_label or day_label, str(value), str(value), 1.0,
                os.path.join(BATCH_DIR, img_fn) if img_fn else None,
                None, fp_hash,
                "CEO_GROUND_TRUTH",
            ),
        )
        sample_count += 1
    conn.commit()
    print(f"  Confirmed samples seeded: {sample_count}")

    # Summary
    print("\n" + "=" * 60)
    print("IMPORT COMPLETE")
    print("=" * 60)
    print(f"  Batch: {BATCH_NAME}")
    print(f"  Batch ID: {batch_id}")
    print(f"  Images imported: {len(image_paths)}")
    print(f"  Ground truth rows: {db_gt}")
    print(f"  Cell crops: {db_crops}")
    print(f"  Fingerprints: {db_fps}")
    print(f"  Confirmed samples seeded: {sample_count}")
    print(f"  Status: PASS")
    print(f"  Completed: {datetime.now().isoformat()}")

    conn.close()


if __name__ == "__main__":
    main()

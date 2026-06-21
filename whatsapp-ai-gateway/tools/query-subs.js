const db = require("./src/database");
const fs = require("fs");

async function main() {
    await db.getDb();
    const subs = db.getAll(
        "SELECT id, store_name, image_path, ocr_confidence, status FROM food_safety_submissions WHERE status = 'CONFIRMED' AND ocr_confidence >= 80 ORDER BY created_at DESC LIMIT 10"
    );
    subs.forEach(s => {
        const exists = fs.existsSync(s.image_path);
        console.log(s.id, s.store_name, "conf:" + s.ocr_confidence, exists ? "VALID" : "MISSING", s.image_path.split(/[\\/]/).pop());
    });
}
main();

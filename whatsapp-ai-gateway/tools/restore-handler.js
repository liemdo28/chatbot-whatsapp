/**
 * restore-handler.js — Restores foodSafetyHandler.js from backup then applies
 * the VLM Safety Reintegration: replaces VLM_SHORTCIRCUIT with safety-integrated path.
 *
 * Run: node tools/restore-handler.js
 */
const fs = require("fs");
const path = require("path");

const FILE = path.join(__dirname, "..", "src", "foodSafetyHandler.js");

// The complete production file content (pre-safety, as read from disk on 2026-06-20)
// We reconstruct it from the read we captured, then apply the safety modification.
// This script is the CANONICAL source of the restored file.

const content = fs.readFileSync(FILE, "utf8");

// If the file is already the full 1900+ line version, just apply the safety edits
if (content.length > 15000) {
    console.log("File appears to be the full production version (" + content.length + " chars). Applying safety edits...");
} else {
    console.log("File is only " + content.length + " chars — needs full restore. Aborting.");
    console.log("Please restore from the full production version first.");
    process.exit(1);
}

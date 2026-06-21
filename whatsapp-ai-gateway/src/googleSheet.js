const logger = require("./logger");

// Google Sheet sync module
// This is a safe-failure implementation:
// If Google Sheet API is not configured or fails, the local DB record is NOT lost.
// The record is saved locally first, then sync is attempted asynchronously.

let googleAuth = null;
let sheetsApi = null;

const SHEET_ID = process.env.GOOGLE_SHEET_ID || "";
const SERVICE_ACCOUNT_PATH = process.env.GOOGLE_SERVICE_ACCOUNT_PATH || "";

async function initGoogleSheets() {
    try {
        if (!SERVICE_ACCOUNT_PATH || !SHEET_ID) {
            logger.warn("Google Sheets not configured - sync will be queued but not executed", {
                sheetId: SHEET_ID ? "SET" : "NOT SET",
                serviceAccount: SERVICE_ACCOUNT_PATH ? "SET" : "NOT SET",
            });
            return false;
        }

        const { google } = require("googleapis");
        const auth = new google.auth.GoogleAuth({
            keyFile: SERVICE_ACCOUNT_PATH,
            scopes: ["https://www.googleapis.com/auth/spreadsheets"],
        });

        googleAuth = await auth.getClient();
        sheetsApi = google.sheets({ version: "v4", auth: googleAuth });
        logger.info("Google Sheets API initialized successfully");
        return true;
    } catch (err) {
        logger.error("Failed to initialize Google Sheets", { error: err.message });
        return false;
    }
}

async function syncSubmission(submissionId, subData) {
    try {
        if (!sheetsApi) {
            logger.info("Google Sheets not initialized - skipping sync (safe failure)", { submissionId });
            // Mark as pending sync
            return { status: "PENDING", message: "Google Sheets not configured" };
        }

        const parsed = subData.parsed;
        const row = [
            subData.storeName,
            submissionId,
            new Date().toISOString(),
            subData.phone_number || "",
            parsed.confidence,
            ...parsed.items.map((item) => `${item.detectedValue !== null ? item.detectedValue : "N/A"} ${item.unit}`),
            parsed.issues.length === 0 ? "ALL_SAFE" : parsed.issues.map((i) => i.type).join(", "),
        ];

        await sheetsApi.spreadsheets.values.append({
            spreadsheetId: SHEET_ID,
            range: "FoodSafety!A:Z",
            valueInputOption: "USER_ENTERED",
            resource: { values: [row] },
        });

        logger.info("Google Sheet sync completed", { submissionId });
        return { status: "OK" };
    } catch (err) {
        logger.error("Google Sheet sync failed (safe failure - local data preserved)", {
            submissionId,
            error: err.message,
        });
        return { status: "FAILED", error: err.message };
    }
}

module.exports = {
    initGoogleSheets,
    syncSubmission,
};

// Language support: Spanish (Mexico) by default, with English (US) on request.
// Option C is numeric-only. Photo/OCR prompts are retired in employee-facing text.

const PHOTO_RETIRED_TEXT = [
    "Food Safety photo processing is retired for this pilot.",
    "",
    "Please type /agent and enter the 19 temperature readings.",
    "Paper forms should still be completed and kept for records.",
].join("\n");

const NUMERIC_HELP_TEXT = [
    "Food Safety numeric workflow:",
    "",
    "1. Type /agent",
    "2. Enter the 19 temperature readings as numbers",
    "3. Review the summary",
    "4. Reply 1 to save, 2 to cancel, 3 to re-enter, or 4 to cancel",
    "",
    "Paper forms should still be completed and kept for records.",
].join("\n");

const CONFIRM_INSTRUCTIONS = [
    "",
    "Reply with one option:",
    "",
    "1 = save the record",
    "2 = cancel this submission",
    "3 = re-enter all values",
    "4 = cancel this submission",
    "",
    "You can also use EDIT, MANAGER, CANCEL, or HELP if asked by the bot.",
].join("\n");

const messages = {
    ES: {
        form_received: "Numeric Food Safety submission received.",
        ocr_processing: PHOTO_RETIRED_TEXT,
        ocr_completed: "Numeric Food Safety submission received.\n\nDetected values:",
        ocr_failed: PHOTO_RETIRED_TEXT,
        unknown_image: PHOTO_RETIRED_TEXT,
        confirm_instructions: CONFIRM_INSTRUCTIONS,
        saved_success: "Record saved successfully.\n\nID: {id}\nStore: {store}\nDate: {date}",
        save_failed: "Error saving the record. Please try again.",
        edit_applied: "Edit applied: {field} updated from {old} to {new}",
        retake_prompt: PHOTO_RETIRED_TEXT,
        manager_sent: "Sent to manager review. The manager will be notified.",
        cancelled: "Record cancelled.",
        help_text: NUMERIC_HELP_TEXT,
        language_switched: "Idioma cambiado a espanol (Mexico).",
        unsafe_warning: "Please verify before saving.\n\nItem: {item}\nExpected range: {range}\nDetected value: {value}\nStatus: UNSAFE\n\nReply 1 to save or EDIT {idx} {val} to correct it.",
        missing_field: "Missing field detected: {field}. Please review the numeric submission.",
        low_confidence: "Review needed ({confidence}%). Please verify the numeric values.",
        low_confidence_block: "Review needed. I cannot save this record automatically.\n\nUse EDIT {example_id} 40 to correct manually or MANAGER for review.",
        column_selection_prompt: "Detected values for {columns}.\nWhich column should be saved?\n\n1 = {first}\n2 = {second}",
        invalid_column_selection: "Please reply 1 for {first} or 2 for {second}.",
        column_required_before_confirm: "Please select the column to save first.\n\n1 = {first}\n2 = {second}",
        duplicate_photo: "Duplicate image ignored. Photo processing is retired for this pilot.",
        evidence_saved: "Numeric Food Safety record saved.",
        sheet_sync_pending: "Google Sheet sync queued...",
        sheet_sync_ok: "Synced to Google Sheet.",
        sheet_sync_fail: "Google Sheet sync failed. The local record was saved successfully.",
        no_pending: "No active numeric submission to process.",
        mi_disabled: "Mi is not available in this bot. This bot is only for Food Safety and team support.",
        team_help: "Available commands:\n\nFood Safety:\n/agent, HELP, EDIT, MANAGER, CANCEL\n\nTeam:\n/status = check bot status\n/help = show this help",
        team_status: "Estado del bot:\n\nEstado: {status}\nStore: Stone Oak\nIdioma: Espanol (Mexico)\nGoogle Sheet: {sheet}",
    },
    EN: {
        form_received: "Numeric Food Safety submission received.",
        ocr_processing: PHOTO_RETIRED_TEXT,
        ocr_completed: "Numeric Food Safety submission received.\n\nDetected values:",
        ocr_failed: PHOTO_RETIRED_TEXT,
        unknown_image: PHOTO_RETIRED_TEXT,
        confirm_instructions: CONFIRM_INSTRUCTIONS,
        saved_success: "Record saved successfully.\n\nID: {id}\nStore: {store}\nDate: {date}",
        save_failed: "Error saving the record. Please try again.",
        edit_applied: "Edit applied: {field} updated from {old} to {new}",
        retake_prompt: PHOTO_RETIRED_TEXT,
        manager_sent: "Sent to manager review. The manager will be notified.",
        cancelled: "Record cancelled.",
        help_text: NUMERIC_HELP_TEXT,
        language_switched: "Language switched to English (US).",
        unsafe_warning: "Please verify before saving.\n\nItem: {item}\nExpected range: {range}\nDetected value: {value}\nStatus: UNSAFE\n\nReply 1 to save or EDIT {idx} {val} to correct it.",
        missing_field: "Missing field detected: {field}. Please review the numeric submission.",
        low_confidence: "Review needed ({confidence}%). Please verify the numeric values.",
        low_confidence_block: "Review needed. I cannot save this record automatically.\n\nUse EDIT {example_id} 40 to correct manually or MANAGER for review.",
        column_selection_prompt: "Detected values for {columns}.\nWhich column should be saved?\n\n1 = {first}\n2 = {second}",
        invalid_column_selection: "Please reply 1 for {first} or 2 for {second}.",
        column_required_before_confirm: "Please select the column to save first.\n\n1 = {first}\n2 = {second}",
        duplicate_photo: "Duplicate image ignored. Photo processing is retired for this pilot.",
        evidence_saved: "Numeric Food Safety record saved.",
        sheet_sync_pending: "Google Sheet sync queued...",
        sheet_sync_ok: "Synced to Google Sheet.",
        sheet_sync_fail: "Google Sheet sync failed. The local record was saved successfully.",
        no_pending: "No active numeric submission to process.",
        mi_disabled: "Mi is not available in this bot. This bot is only for Food Safety and team support.",
        team_help: "Available commands:\n\nFood Safety:\n/agent, HELP, EDIT, MANAGER, CANCEL\n\nTeam:\n/status = check bot status\n/help = show this help",
        team_status: "Bot Status:\n\nStatus: {status}\nStore: Stone Oak\nLanguage: English (US)\nGoogle Sheet: {sheet}",
    },
};

function t(lang, key, replacements = {}) {
    const langKey = (lang || "ES").toUpperCase();
    let text = (messages[langKey] && messages[langKey][key]) || messages.ES[key] || `[${key}]`;
    for (const [k, v] of Object.entries(replacements)) {
        text = text.replace(new RegExp(`\\{${k}\\}`, "g"), v);
    }
    return text;
}

function normalizeLanguage(input) {
    const upper = (input || "").trim().toUpperCase();
    if (["EN", "EN-US", "ENGLISH", "ENGLISH US", "US ENGLISH", "INGLES"].includes(upper)) return "EN";
    if ([
        "ES",
        "ES-MX",
        "ESPANOL",
        "ESPANOL MX",
        "SPANISH",
        "SPANISH MEXICO",
        "MEXICAN SPANISH",
        "MEXICAN",
        "MEX",
    ].includes(upper)) return "ES";
    return null;
}

module.exports = { t, normalizeLanguage, messages };

// Language support: Spanish (default) and English
// All employee-facing text in both languages
// NO Vietnamese, NO French, NO Mi assistant behavior

const messages = {
    ES: {
        form_received: "Recibí el formulario de Food Safety.",
        ocr_processing: "🔍 Analizando imagen... Por favor espere.",
        ocr_completed: "Recibí el formulario de Food Safety.\n\nValores detectados:",
        ocr_failed: "❌ No pude leer la imagen claramente. Por favor envíe una foto más clara del formulario completo.",
        unknown_image: "Recibí la imagen, pero no pude identificarla como un formulario de Food Safety.\n\nPor favor envíe una foto clara del formulario completo, o responda MANAGER para revisión.",
        confirm_instructions: "\nResponde con una opción:\n\nCONFIRM = guardar el registro\nEjemplo: CONFIRM\n\nEDIT = corregir una temperatura\nEjemplo: EDIT 3 38\nEjemplo: EDIT SO-03 38\n\nRETAKE = enviar una foto más clara\nEjemplo: RETAKE\n\nMANAGER = enviar a revisión del manager\nEjemplo: MANAGER\n\nCANCEL = cancelar este registro\nEjemplo: CANCEL\n\nHELP = ver instrucciones\nEjemplo: HELP",
        saved_success: "✅ Registro guardado exitosamente.\n\nID: {id}\nTienda: {store}\nFecha: {date}",
        save_failed: "❌ Error al guardar el registro. Por favor intente de nuevo.",
        edit_applied: "✏️ Edición aplicada: {field} actualizado de {old} a {new}",
        retake_prompt: "📸 Por favor envíe una nueva foto clara del formulario.",
        manager_sent: "👨‍💼 Enviado a revisión del manager. El manager será notificado.",
        cancelled: "❌ Registro cancelado.",
        help_text: "Cómo usar este bot:\n\n1. Complete el formulario de Food Safety.\n2. Tome una foto clara.\n3. Envíela a este grupo.\n4. Revise los valores detectados.\n5. Use CONFIRM, EDIT, RETAKE, MANAGER o CANCEL.\n\nEjemplos:\nCONFIRM\nEDIT 3 38\nEDIT SO-03 38\nRETAKE\nMANAGER\nCANCEL",
        language_switched: "🌐 Idioma cambiado a Español.",
        unsafe_warning: "⚠️ Verifique antes de guardar.\n\nArtículo: {item}\nRango esperado: {range}\nValor detectado: {value}\nEstado: UNSAFE\n\nPuede responder:\nCONFIRM = guardar de todos modos\nEDIT {idx} {val} = corregir\nMANAGER = enviar a revisión\nRETAKE = enviar nueva foto",
        missing_field: "⚠️ Campo faltante detectado: {field}. Por favor revise el formulario.",
        low_confidence: "⚠️ Vision confidence baja ({confidence}%). Por favor verifique los valores.",
        low_confidence_block: "⚠️ La vision confidence es baja. No puedo guardar este registro automáticamente.\n\nPuede responder:\nRETAKE = enviar una foto más clara\nEDIT {example_id} 40 = corregir manualmente\nMANAGER = enviar a revisión",
        column_selection_prompt: "Detecté valores para {columns}.\n¿Qué columna desea guardar?\n\n1 = {first}\n2 = {second}",
        invalid_column_selection: "Por favor responda 1 para {first} o 2 para {second}.",
        column_required_before_confirm: "Primero seleccione la columna que desea guardar.\n\n1 = {first}\n2 = {second}",
        duplicate_photo: "⚠️ Esta foto parece ser un duplicado de una submission anterior.",
        evidence_saved: "Foto de evidencia recibida y guardada.",
        sheet_sync_pending: "📊 Sincronización con Google Sheet en cola...",
        sheet_sync_ok: "📊 Sincronizado con Google Sheet.",
        sheet_sync_fail: "⚠️ Error al sincronizar con Google Sheet. El registro local se guardó correctamente.",
        no_pending: "No hay submission pendiente para procesar.",
        // Mi rejection messages
        mi_disabled: "Mi no está disponible en este bot. Este bot es solo para Food Safety y soporte del equipo.",
        // Team support commands
        team_help: "Comandos disponibles:\n\nFood Safety:\nCONFIRM, EDIT, RETAKE, MANAGER, CANCEL, HELP\n\nEquipo:\n/status = ver estado del bot\n/help = ver esta ayuda",
        team_status: "📊 Estado del bot:\n\nEstado: {status}\nTienda: Stone Oak\nIdioma: Español (default)\nGoogle Sheet: {sheet}",
    },
    EN: {
        form_received: "I received the Food Safety form.",
        ocr_processing: "🔍 Analyzing image... Please wait.",
        ocr_completed: "I received the Food Safety form.\n\nDetected values:",
        ocr_failed: "❌ I couldn't read the image clearly. Please send a clearer photo of the completed form.",
        unknown_image: "I received the image, but I could not identify it as a Food Safety form.\n\nPlease send a clear photo of the completed form, or reply MANAGER for review.",
        confirm_instructions: "\nReply with one option:\n\nCONFIRM = save the record\nExample: CONFIRM\n\nEDIT = correct a temperature\nExample: EDIT 3 38\nExample: EDIT SO-03 38\n\nRETAKE = send a clearer photo\nExample: RETAKE\n\nMANAGER = send to manager review\nExample: MANAGER\n\nCANCEL = cancel this record\nExample: CANCEL\n\nHELP = show instructions\nExample: HELP",
        saved_success: "✅ Record saved successfully.\n\nID: {id}\nStore: {store}\nDate: {date}",
        save_failed: "❌ Error saving the record. Please try again.",
        edit_applied: "✏️ Edit applied: {field} updated from {old} to {new}",
        retake_prompt: "📸 Please send a new clear photo of the form.",
        manager_sent: "👨‍💼 Sent to manager review. The manager will be notified.",
        cancelled: "❌ Record cancelled.",
        help_text: "How to use this bot:\n\n1. Complete the Food Safety form.\n2. Take a clear photo.\n3. Send it to this group.\n4. Review the detected values.\n5. Use CONFIRM, EDIT, RETAKE, MANAGER, or CANCEL.\n\nExamples:\nCONFIRM\nEDIT 3 38\nEDIT SO-03 38\nRETAKE\nMANAGER\nCANCEL",
        language_switched: "🌐 Language switched to English.",
        unsafe_warning: "⚠️ Please verify before saving.\n\nItem: {item}\nExpected range: {range}\nDetected value: {value}\nStatus: UNSAFE\n\nYou can reply:\nCONFIRM = save anyway\nEDIT {idx} {val} = correct it\nMANAGER = send to review\nRETAKE = upload new photo",
        missing_field: "⚠️ Missing field detected: {field}. Please review the form.",
        low_confidence: "⚠️ Vision confidence ({confidence}%). Please verify the values.",
        low_confidence_block: "⚠️ Low vision confidence. I cannot save this record automatically.\n\nYou can reply:\nRETAKE = send a clearer photo\nEDIT {example_id} 40 = correct manually\nMANAGER = send to review",
        column_selection_prompt: "I detected values for {columns}.\nWhich column should be saved?\n\n1 = {first}\n2 = {second}",
        invalid_column_selection: "Please reply 1 for {first} or 2 for {second}.",
        column_required_before_confirm: "Please select the column to save first.\n\n1 = {first}\n2 = {second}",
        duplicate_photo: "⚠️ This photo appears to be a duplicate of a previous submission.",
        evidence_saved: "Evidence photo received and saved.",
        sheet_sync_pending: "📊 Google Sheet sync queued...",
        sheet_sync_ok: "📊 Synced to Google Sheet.",
        sheet_sync_fail: "⚠️ Google Sheet sync failed. Local record saved successfully.",
        no_pending: "No pending submission to process.",
        // Mi rejection messages
        mi_disabled: "Mi is not available in this bot. This bot is only for Food Safety and team support.",
        // Team support commands
        team_help: "Available commands:\n\nFood Safety:\nCONFIRM, EDIT, RETAKE, MANAGER, CANCEL, HELP\n\nTeam:\n/status = check bot status\n/help = show this help",
        team_status: "📊 Bot Status:\n\nStatus: {status}\nStore: Stone Oak\nLanguage: Spanish (default)\nGoogle Sheet: {sheet}",
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
    if (["EN", "ENGLISH"].includes(upper)) return "EN";
    if (["ES", "ESPAÑOL", "SPANISH"].includes(upper)) return "ES";
    return null;
}

module.exports = { t, normalizeLanguage, messages };

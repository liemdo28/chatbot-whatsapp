# Food Safety Language Report

**Date:** 2026-06-17
**Languages Supported:** Spanish (ES), English (EN)

---

## Language Behavior

| Feature | Implementation |
|---------|---------------|
| Default language | **Spanish (ES)** |
| Secondary language | English (EN) |
| Vietnamese | ❌ Not included (per requirement) |
| French | ❌ Not included (per requirement) |
| Switch trigger | Employee sends: `EN`, `English`, `ES`, `Español`, `Spanish` |
| Scope | Per-session (resets on new photo upload) |

---

## All Employee-Facing Messages

| Message Key | Spanish | English |
|-------------|---------|---------|
| form_received | Foto recibida. Procesando formulario de Food Safety... | Photo received. Processing Food Safety form... |
| ocr_processing | Analizando imagen... Por favor espere. | Analyzing image... Please wait. |
| ocr_completed | Analisis completado. Valores detectados: | Analysis complete. Detected values: |
| ocr_failed | No pude leer la imagen claramente... | I couldn't read the image clearly... |
| unknown_image | Esta imagen no parece ser un formulario... | This image doesn't appear to be a Food Safety form... |
| confirm_instructions | (Full CONFIRM/EDIT/RETAKE/MANAGER/CANCEL/HELP examples) | (Same in English) |
| saved_success | Registro guardado exitosamente. ID: {id}... | Record saved successfully. ID: {id}... |
| save_failed | Error al guardar el registro... | Error saving the record... |
| edit_applied | Edicion aplicada: {field}... | Edit applied: {field}... |
| retake_prompt | Por favor envie una nueva foto clara... | Please send a new clear photo... |
| manager_sent | Enviado a revision del manager... | Sent to manager review... |
| cancelled | Registro cancelado. | Record cancelled. |
| help_text | (Full help with examples in Spanish) | (Same in English) |
| language_switched | Idioma cambiado a Espanol. | Language switched to English. |
| unsafe_warning | Verifique antes de guardar. Articulo: {item}... | Please verify before saving. Item: {item}... |
| missing_field | Campo faltante detectado: {field}... | Missing field detected: {field}... |
| low_confidence | Confianza OCR baja ({confidence}%)... | Low OCR confidence ({confidence}%)... |
| duplicate_photo | Esta foto parece ser un duplicado... | This photo appears to be a duplicate... |
| evidence_saved | Foto de evidencia guardada. | Evidence photo saved. |
| sheet_sync_pending | Sincronizacion con Google Sheet en cola... | Google Sheet sync queued... |
| sheet_sync_ok | Sincronizado con Google Sheet. | Synced to Google Sheet. |
| sheet_sync_fail | Error al sincronizar con Google Sheet... | Google Sheet sync failed... |
| no_pending | No hay submission pendiente para procesar. | No pending submission to process. |

---

## Language Test Results

| Test | Result |
|------|--------|
| Default language is Spanish | ✅ PASS |
| English switch response | ✅ PASS |
| normalizeLanguage EN | ✅ PASS |
| normalizeLanguage ES | ✅ PASS |
| normalizeLanguage unknown | ✅ PASS |
| HELP command Spanish | ✅ PASS |
| HELP command English | ✅ PASS |
| Unsafe warning Spanish | ✅ PASS |
| Unsafe warning English | ✅ PASS |
| Saved success with replacements | ✅ PASS |
| Missing field warning | ✅ PASS |
| Low confidence warning | ✅ PASS |
| No Vietnamese or French in messages | ✅ PASS |
| Language switch to English (handler) | ✅ PASS |
| Language switch to Spanish (handler) | ✅ PASS |

**15/15 language tests passed**

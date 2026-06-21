# LD Agent-Logtest Group Enablement Report

Status: FAIL / PENDING LIVE INBOUND TEST

Reason PASS is not allowed yet: after the fix and gateway restart, no new CEO-origin `/help` or image upload was observed during the live watch window. The group is discovered, enabled, non-silent, and now classified as BOT, but the CEO Approval Rule also requires a real `/help` reply and one OCR image reply.

## Group Discovery

- group_name: LD Agent-Logtest
- group_id: 120363426386364543@g.us
- is_bot_member: true, inferred from the live WhatsApp client listing the group after restart and the gateway being WhatsApp-ready. Direct participant metadata from the admin endpoint reported participant_count=0.
- participants observed in WhatsApp OS store:
  - 172425924882645@lid / Liem Do / participant / last_seen_at=2026-06-19 06:51:06 UTC
- last_message_timestamp:
  - WhatsApp admin discovery: 2026-06-19T06:51:09.000Z
  - WhatsApp OS store: 2026-06-19 06:51:06 UTC

## Group Config Row

```json
{
  "chat_id": "120363426386364543@g.us",
  "group_name": "LD Agent-Logtest",
  "store_id": "test",
  "store_name": "Test",
  "group_type": "test",
  "workflow": "food_safety_capture",
  "store_resolution_mode": "form_header",
  "enabled_workflows": "food_safety_capture",
  "active": 1,
  "enabled": 1,
  "locked": 0,
  "silent": 0,
  "allowed_templates": [
    "FoodSafety-Rim-v3",
    "FoodSafety-StoneOak-v3",
    "FoodSafety-Bandera-v3"
  ],
  "updated_at": "2026-06-19 07:25:08"
}
```

Policy row:

```json
{
  "chat_id": "120363426386364543@g.us",
  "group_name": "LD Agent-Logtest",
  "mode": "BOT",
  "wake_words_enabled": 1,
  "bot_workflows": "food_safety_capture",
  "store_id": "test",
  "active": 1,
  "policy_json": {
    "source": "DEV1_P0",
    "group_type": "test",
    "workflow": "food_safety_capture",
    "store_resolution_mode": "form_header",
    "silent": false,
    "allowed_templates": [
      "FoodSafety-Rim-v3",
      "FoodSafety-StoneOak-v3",
      "FoodSafety-Bandera-v3"
    ]
  },
  "updated_at": "2026-06-19 07:25:08"
}
```

Store mapping row:

```json
{
  "chat_id": "120363426386364543@g.us",
  "group_name": "LD Agent-Logtest",
  "store_id": "test",
  "store_name": "Test",
  "active": 1,
  "locked": 0,
  "updated_at": "2026-06-19 07:25:08"
}
```

## Env Value

Only non-secret values are recorded here.

```text
FOOD_SAFETY_ENABLED_GROUPS=120363365547218966@g.us,120363349425133238@g.us,120363409731424335@g.us,120363426386364543@g.us
GROUP_SILENT_MODE=false
GROUP_TEXT_COMMANDS_ENABLED=true
```

Runtime after restart:

```json
{
  "pid": 17704,
  "cwd": "C:\\Users\\hoang\\Downloads\\source\\setup-all\\whatsapp-ai-gateway",
  "build_id": "202606190743-unknown",
  "started_at": "2026-06-19T07:43:41.786Z",
  "whatsapp_ready": true,
  "whatsapp_status": "ready"
}
```

## Listener Log

Pre-fix image upload from CEO:

```text
[2026-06-18 23:51:06] INFO: Food safety image received {"chatId":"120363426386364543@g.us","messageId":"false_120363426386364543@g.us_3A38892B350A2347D3AB_172425924882645@lid"}
[2026-06-18 23:51:06] INFO: [WHATSAPP_OS] mode_selected {"chatId":"120363426386364543@g.us","phone":"172425924882645@lid","isGroup":true,"buildId":"202606190541-unknown","pid":17072,"mode":"OBSERVER","route":"image_os_collect","wake":false}
[2026-06-18 23:51:06] INFO: [MESSAGE_FLOW] observer_image_silent {"chatId":"120363426386364543@g.us","phone":"172425924882645@lid","isGroup":true,"buildId":"202606190541-unknown","pid":17072,"route":"observer_image_silent"}
```

Post-fix mode verification:

```text
LD Agent-Logtest now resolves as mode=BOT, source=stored_policy, updated_at=2026-06-19 07:25:08.
```

Temporary proof logging added for the next live image:

```text
message_received
media_downloaded
food_safety_capture_start
bot_reply_sent
ignored_reason
```

## /help Test Result

Result: PENDING

No new CEO-origin `/help` message was observed during the 90-second watch window after restart. This must be tested from the CEO account inside LD Agent-Logtest.

Expected proof when it happens:

```text
[WHATSAPP_OS] mode_selected ... mode=BOT ... chatId=120363426386364543@g.us
[MESSAGE_FLOW] command_handled ... route=command
Group command handled ... preview=/help
```

## Image Upload Test Result

Pre-fix result: FAIL

- Existing CEO image was seen by the listener.
- The group was classified OBSERVER.
- Exact ignored reason: observer_image_silent.
- No template_ocr_runs were created for the test group.
- No evidence_photos were created for the test group.

Post-fix result: PENDING

No new image upload was observed after the gateway restart. The next image should produce:

```text
message_received
group_id=120363426386364543@g.us
has_media=true
media_downloaded=true
workflow=food_safety_capture
store_resolution_mode=form_header
ocr_started=true
bot_reply_sent=true
```

## Store/Header Detection Expected

The test group now bypasses the old test-store default template mapping so the form header can select the real store template.

Expected outputs:

- Rim form -> B1 / The Rim / RIM-*
- Stone Oak form -> B2 / Stone Oak / SO-*
- Bandera form -> B3 / Bandera / BAN-*

Code changes applied in the live runtime:

- `src/template-ocr/template-image-router.js`: test group no longer forces `daily-entry-v1`; Rim display name is `The Rim`.
- `src/workflows/form-photo-ocr.js`: Rim field IDs now remain `RIM-*`.
- `src/workflows/form-photo-workflow.js`: detected OCR store replaces the test placeholder in group replies; reply includes `Store: B1 / The Rim`, `Store: B2 / Stone Oak`, or `Store: B3 / Bandera`.
- `src/whatsapp/message-listener.js`: temporary proof logs added for message/media/OCR/reply/ignore path.

## Screenshots

Not captured. Verification was done through live gateway APIs and listener logs. A WhatsApp UI screenshot still needs to be captured after CEO sends `/help` and the three form images.

## Known Blockers

- Need CEO to send `/help` in LD Agent-Logtest after the 2026-06-19T07:43:41.786Z restart.
- Need CEO to upload one form image after `/help`.
- Need final Rim, Stone Oak, and Bandera form uploads after the single-image smoke test.
- Do not mark PASS until `/help` receives a bot response and at least one form image receives exactly one OCR reply.


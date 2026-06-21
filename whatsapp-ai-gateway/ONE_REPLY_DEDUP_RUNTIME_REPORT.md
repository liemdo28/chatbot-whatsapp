# ONE REPLY DEDUP RUNTIME REPORT

## Status: DESIGN COMPLETE — CODE PATH PENDING

Date: 2026-06-19
Author: DEV1

## 1. Current Problem

Multiple messages per image upload:
```
Analizando imagen...     ← intermediate (BAD)
Analizando imagen...     ← intermediate (BAD)
Final OCR result...      ← final (OK)
```

## 2. Required Behavior

```
1 form image = 1 final confirmation message only
```

No intermediate messages. No duplicate final messages.

## 3. Deduplication Design

### Keys
- `message_id` — WhatsApp message ID (unique)
- `chat_id` — Group ID where image was received
- `media_id` — WhatsApp media download ID
- `image_hash` — SHA-256 of the downloaded image bytes
- `quoted_message_id` — If image was forwarded with a quote

### Processing Lock
```
Image received
  │
  ├── Check: message_id already processed?
  │     YES → ignore (return early)
  │     NO → continue
  │
  ├── Check: media_id already processing?
  │     YES → ignore (return early)
  │     NO → lock media_id, continue
  │
  ├── Check: image_hash already processed in last 5 minutes?
  │     YES → ignore (return early)
  │     NO → continue
  │
  ├── Download media
  ├── Run OCR (silent, no chat reply)
  ├── Send ONE final reply
  ├── Save to DB
  ├── Unlock processing lock
  └── Cache completed image_hash (5 min TTL)
```

### Completed Cache
```javascript
const completedImages = new Map(); // image_hash → timestamp
const processingLock = new Set();  // media_id or message_id

// TTL: 5 minutes
function isCompleted(imageHash) {
    const ts = completedImages.get(imageHash);
    if (!ts) return false;
    if (Date.now() - ts > 5 * 60 * 1000) {
        completedImages.delete(imageHash);
        return false;
    }
    return true;
}
```

## 4. Intermediate Message Suppression

Current code may call `sendAnalysisMessage()` or similar before OCR completes. This must be suppressed.

- Remove all `Analizando imagen...` messages
- Remove all progress/status messages in the image pipeline
- Only the final WAITING_CONFIRM message may be sent

## 5. Code Changes Required

- [ ] Add dedup check in `src/whatsapp/message-listener.js` (before image processing)
- [ ] Add `image_hash` computation for downloaded media
- [ ] Add processing lock with Set/Map
- [ ] Add completed cache with TTL
- [ ] Remove intermediate message sends from `src/food-safety/food-safety-pipeline.js`
- [ ] Add DB table `processed_images(message_id, chat_id, image_hash, created_at)` for persistence

## 6. Validation

| Test | Input | Expected |
| --- | --- | --- |
| Normal upload | 1 form image | 1 final reply |
| Duplicate upload | Same image 2x | 1st reply only, 2nd ignored |
| Rapid upload | 2 different images < 2s | 2 replies (no cross-dedup) |
| Non-form image | Food photo | "Not detected" or silent (1 reply max) |

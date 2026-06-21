# Modifications Required for Heartbeat Installation

## File 1: Created ✅
`src/sync/heartbeat.ts` — created in this project at:
`integration-system-laptop2-CQB-20260615-025044/src/sync/heartbeat.ts`

## File 2: Edit `src/server/index.ts` (on laptop1)
This file lives on laptop1 in the doordash-campaigns Node.js project.
Open it and make TWO changes:

### Change A — Add import (near top of file)
Find this block:
```typescript
import { scheduleWeeklyLoop } from '../automation/weekly-loop.js';
import { startMISyncScheduler } from '../sync/mi-core-sync.js';
```

Add one line **after** it:
```typescript
import { startHeartbeatScheduler } from '../sync/heartbeat.js';
```

### Change B — Add scheduler call (in app.listen)
Find this block:
```typescript
app.listen(PORT, () => {
  console.log(`...`);
  scheduleWeeklyLoop();
  startMISyncScheduler();
});
```

Add `startHeartbeatScheduler();` inside:
```typescript
app.listen(PORT, () => {
  console.log(`...`);
  scheduleWeeklyLoop();
  startMISyncScheduler();
  startHeartbeatScheduler();   // <-- ADD THIS LINE
});
```

## File 3: Verify `.env` (on laptop1)
Ensure `<project root>\.env` contains:
```
MI_CORE_URL=http://<main-pc-ip>:4001
PORT=3000
NODE_ENV=development
```

## Step 4: Restart
Stop START.bat (Ctrl+C), then run START.bat again.
You should see: `[heartbeat] Scheduler started -- pushing to CEO app every 5 min`

---
Note: The heartbeat sends to the CEO's doordash-campaigns app (port 3000, derived from MI_CORE_URL by changing port 4001→3000).
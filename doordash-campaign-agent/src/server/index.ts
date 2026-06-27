/**
 * DoorDash Campaign Agent — Server Entry Point
 * Express API server for multi-account DoorDash campaign management.
 */
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { getDb, closeDb } from './db/init.js';
import executorRoutes from './routes/executor-routes.js';
import storeCredentialsRoutes from './routes/store-credentials.js';
import { startWeeklyLoop, stopWeeklyLoop } from '../automation/weekly-loop.js';
import { startMiCoreSync, stopMiCoreSync } from '../sync/mi-core-sync.js';
import { startHeartbeatScheduler } from '../sync/heartbeat.js';
import { closeAllSessions } from '../executor/account-session-manager.js';
import { closeStagehand } from '../browser/stagehand-navigation.js';

const PORT = parseInt(process.env['PORT'] || '3001', 10);

const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use('/app', express.static(path.resolve(process.cwd(), 'src/client')));

getDb();
console.log('[DB] Database initialized.');

app.use(executorRoutes);
app.use(storeCredentialsRoutes);

// ── Runtime routes ───────────────────────────────────────────────────────────

app.get('/', (_req: express.Request, res: express.Response) => {
    res.json({
        ok: true,
        app: 'DoorDash Campaign Agent',
        version: '1.0.0',
        status: 'running',
        routes: ['/api/stores', '/health', '/api/status'],
    });
});

app.get('/health', (_req: express.Request, res: express.Response) => {
    res.json({ ok: true, status: 'healthy' });
});

app.get('/api/status', (_req: express.Request, res: express.Response) => {
    res.json({
        ok: true,
        app: 'DoorDash Campaign Agent',
        status: 'running',
        port: PORT,
    });
});

app.get('/api/health', (_req: express.Request, res: express.Response) => {
    res.json({
        ok: true,
        service: 'doordash-campaign-agent',
        version: '1.0.0',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
    });
});

app.listen(PORT, () => {
    console.log(`\n====================================`);
    console.log(`  DoorDash Campaign Agent v1.0.0`);
    console.log(`  Running on http://localhost:${PORT}`);
    console.log(`====================================\n`);
    startWeeklyLoop();
    startMiCoreSync();
    startHeartbeatScheduler();
    console.log('[Server] All services started.');
    console.log('[Server] Stores: Bakudan The Rim, Bakudan Stone Oak, Bakudan Bandera, Raw Sushi Bar');
});

async function shutdown() {
    console.log('\n[Server] Shutting down...');
    stopWeeklyLoop();
    stopMiCoreSync();
    await closeStagehand();
    await closeAllSessions();
    closeDb();
    process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('uncaughtException', (error: Error) => {
    console.error('[Server] Uncaught exception:', error);
});
process.on('unhandledRejection', (reason: any) => {
    console.error('[Server] Unhandled rejection:', reason);
});

export default app;

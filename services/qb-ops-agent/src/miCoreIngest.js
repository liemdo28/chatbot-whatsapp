/**
 * Mi-Core Ingest Endpoint
 * This file provides the server-side endpoint that receives QB data from qb-ops-agent
 * Deploy this on mi-core-primary (the Windows PC running mi-core OS)
 *
 * Add this route to your mi-core Express app, or run standalone for testing.
 */

const express = require('express');
const app = express();
const PORT = process.env.MICORE_INGEST_PORT || 4001;

// ─── Middleware ──────────────────────────────────────────────────────────────
app.use(express.raw({ type: 'application/xml', limit: '10mb' }));
app.use(express.json());

// ─── API Key middleware ──────────────────────────────────────────────────────
function authMiddleware(req, res, next) {
    const apiKey = req.headers['x-qb-api-key'] || '';
    const expectedKey = process.env.QB_API_KEY || '';

    if (!expectedKey) {
        // No key configured = skip auth (dev mode)
        return next();
    }

    if (apiKey !== expectedKey) {
        console.log(`[mi-core] Unauthorized QB ingest attempt from ${req.ip}`);
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
}

// ─── QuickBooks Status endpoint ─────────────────────────────────────────────
app.get('/api/connectors/quickbooks/status', (req, res) => {
    res.json({
        connected: true,
        last_sync: lastSyncTime || null,
        data_available: hasData,
        service: 'qb-ops-agent',
    });
});

// ─── QuickBooks Data Ingest endpoint ────────────────────────────────────────
app.post('/api/qb/ingest', authMiddleware, (req, res) => {
    console.log(`[mi-core] Received QB data ingest — ${req.body ? req.body.length : 0} bytes`);

    lastSyncTime = new Date().toISOString();

    if (req.body && req.body.length > 0) {
        hasData = true;

        // Store the raw XML for later processing
        lastQBResponse = req.body.toString('utf8');

        // TODO: Parse and store in your database
        // const { parseQBResponse } = require('./qbHandlers');
        // const parsed = await parseQBResponse(lastQBResponse);
        // await db.storeFinancialData(parsed);

        console.log(`[mi-core] QB data stored successfully`);
    }

    res.json({ status: 'ok', received: true });
});

// ─── QuickBooks Financial Reports endpoint ──────────────────────────────────
app.get('/api/connectors/quickbooks/reports', (req, res) => {
    if (!hasData || !lastQBResponse) {
        return res.json({
            available: false,
            message: 'No QB data synced yet. Wait for next QBWC cycle.',
        });
    }

    res.json({
        available: true,
        last_sync: lastSyncTime,
        // Return parsed report summary (placeholder)
        reports: {
            profit_loss: 'Parse from lastQBResponse',
            tax_summary: 'Parse from lastQBResponse',
            payroll: 'Parse from lastQBResponse',
            ar_aging: 'Parse from lastQBResponse',
            ap_aging: 'Parse from lastQBResponse',
        },
    });
});

// ─── State ──────────────────────────────────────────────────────────────────
let lastSyncTime = null;
let hasData = false;
let lastQBResponse = null;

// ─── Start ──────────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
    console.log(`[mi-core] QuickBooks ingest endpoint listening on port ${PORT}`);
    console.log(`[mi-core] GET  /api/connectors/quickbooks/status`);
    console.log(`[mi-core] POST /api/qb/ingest`);
    console.log(`[mi-core] GET  /api/connectors/quickbooks/reports`);
});

module.exports = app;

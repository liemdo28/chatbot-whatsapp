/**
 * Financial API Endpoint — exposes parsed QuickBooks financial data
 * for the CEO dashboard.
 *
 * GET /api/qb/financial           → full financial summary + data
 * GET /api/qb/financial/summary   → summary only
 * GET /api/qb/financial/accounts  → accounts only
 * GET /api/qb/financial/invoices  → invoices only
 * GET /api/qb/financial/sales     → sales receipts only
 * GET /api/qb/financial/raw       → raw sync status
 */
import { Router, Request, Response } from 'express';
import { loadLatestFinancialData, getSyncStatus } from '../soap/qb-data-store';

const router = Router();

function notSynced(res: Response): void {
    res.status(503).json({
        status: 'no_data',
        message: 'QBWC sync has not completed yet. No financial data available.',
        hint: 'Run the QBWC sync from QuickBooks Web Connector, then retry.',
        next_steps: [
            'Open QuickBooks Desktop → open MI_CEO.qbw',
            'Open Web Connector → click Update Selected',
            'Wait for sync to complete',
            'Re-test: GET /api/qb/financial',
        ],
    });
}

// ── GET /api/qb/financial — full payload ─────────────────────────────────────
router.get('/qb/financial', (_req: Request, res: Response) => {
    const data = loadLatestFinancialData();
    const sync = getSyncStatus();

    if (!data) {
        notSynced(res);
        return;
    }

    res.json({
        status: 'ok',
        sync_status: sync,
        financial: data,
    });
});

// ── GET /api/qb/financial/summary — summary only ────────────────────────────
router.get('/qb/financial/summary', (_req: Request, res: Response) => {
    const data = loadLatestFinancialData();
    const sync = getSyncStatus();

    if (!data) {
        notSynced(res);
        return;
    }

    res.json({
        status: 'ok',
        last_sync: sync.last_sync,
        last_company_file: sync.last_company_file,
        requests_received: sync.requests_received,
        summary: data.summary,
        parsed_at: data.parsed_at,
    });
});

// ── GET /api/qb/financial/accounts — accounts only ──────────────────────────
router.get('/qb/financial/accounts', (_req: Request, res: Response) => {
    const data = loadLatestFinancialData();
    if (!data) { notSynced(res); return; }

    res.json({
        status: 'ok',
        accounts: data.accounts,
        count: data.accounts.length,
        parsed_at: data.parsed_at,
    });
});

// ── GET /api/qb/financial/invoices — invoices only ──────────────────────────
router.get('/qb/financial/invoices', (_req: Request, res: Response) => {
    const data = loadLatestFinancialData();
    if (!data) { notSynced(res); return; }

    res.json({
        status: 'ok',
        invoices: data.invoices,
        count: data.invoices.length,
        total_outstanding: data.summary.total_invoices_outstanding,
        parsed_at: data.parsed_at,
    });
});

// ── GET /api/qb/financial/sales — sales receipts only ───────────────────────
router.get('/qb/financial/sales', (_req: Request, res: Response) => {
    const data = loadLatestFinancialData();
    if (!data) { notSynced(res); return; }

    res.json({
        status: 'ok',
        sales_receipts: data.sales_receipts,
        count: data.sales_receipts.length,
        total_30d: data.summary.total_sales_receipts_30d,
        parsed_at: data.parsed_at,
    });
});

// ── GET /api/qb/financial/raw — raw sync status ─────────────────────────────
router.get('/qb/financial/raw', (_req: Request, res: Response) => {
    const sync = getSyncStatus();
    res.json({
        status: 'ok',
        sync,
    });
});

export { router as financialRouter };

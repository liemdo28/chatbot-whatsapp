/**
 * Campaign Reader
 *
 * Reads campaign data from DoorDash Merchant Portal for a specific store.
 * Extracts: campaign name, type, status, budget, spend, sales, orders, ROAS, dates.
 * Saves to campaign_snapshots table.
 */
import { Page } from 'playwright';
import { getPage, markSessionExpired, takeScreenshot } from './account-session-manager.js';
import { getDb } from '../server/db/init.js';
import { v4 as uuidv4 } from 'uuid';
import { stagehandAct, AiBrowserStepResult } from '../browser/stagehand-navigation.js';
import { validateCampaignPage, BrowserQaResult } from '../qa/browser-use-qa.js';

const DOORDASH_CAMPAIGN_URLS = [
    'https://merchant.doordash.com/en-US/marketing/campaigns',
    'https://merchant.doordash.com/en-US/marketing/overview',
    'https://merchant.doordash.com/en-US/marketing',
    'https://www.doordash.com/merchant/marketing/report',
    'https://www.doordash.com/merchant/marketing/home',
    'https://www.doordash.com/merchant/marketing',
    'https://www.doordash.com/merchant/summary',
    'https://merchant.doordash.com',
];

interface CandidateField {
    label: string;
    value: string;
}

interface CampaignCandidate {
    source: 'table' | 'card' | 'json';
    text: string;
    fields: CandidateField[];
}

export interface CampaignData {
    id: string;
    storeId: string;
    campaignName: string;
    campaignType: string;
    status: string;
    budget: number | null;
    spend: number | null;
    sales: number | null;
    orders: number | null;
    roas: number | null;
    startDate: string | null;
    endDate: string | null;
    currency: string;
    rawData: string;
    screenshotPath?: string;
}

export interface CampaignReadResult {
    success: boolean;
    message: string;
    storeId: string;
    campaigns: CampaignData[];
    snapshotIds: string[];
    screenshotPaths: string[];
    aiNavigation?: AiBrowserStepResult;
    qa?: BrowserQaResult;
}

function getWeekStart(): string {
    const now = new Date();
    const day = now.getDay();
    const diff = now.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(now.setDate(diff));
    return monday.toISOString().split('T')[0];
}

function normalizeText(value: string): string {
    return value.replace(/\s+/g, ' ').trim();
}

function normalizeKey(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function parseNumber(value: string): number | null {
    const match = value.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
    if (!match) return null;
    const parsed = Number(match[0]);
    return Number.isFinite(parsed) ? parsed : null;
}

function parseInteger(value: string): number | null {
    const parsed = parseNumber(value);
    return parsed === null ? null : Math.round(parsed);
}

function readField(fields: CandidateField[], labels: string[]): string | null {
    const normalizedLabels = labels.map(normalizeKey);
    for (const field of fields) {
        const key = normalizeKey(field.label);
        if (normalizedLabels.some(label => key.includes(label))) {
            const value = normalizeText(field.value);
            if (value) return value;
        }
    }
    return null;
}

function parseMetricFromText(text: string, labels: string[]): number | null {
    for (const label of labels) {
        const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regexes = [
            new RegExp(`${escaped}\\s*[:\\-]?\\s*\\$?\\s*(-?\\d[\\d,.]*(?:\\.\\d+)?)\\s*x?`, 'i'),
            new RegExp(`\\$?\\s*(-?\\d[\\d,.]*(?:\\.\\d+)?)\\s*x?\\s+${escaped}`, 'i'),
        ];
        for (const regex of regexes) {
            const match = text.match(regex);
            if (match) return parseNumber(match[1]);
        }
    }
    return null;
}

function parseCurrencyMetric(candidate: CampaignCandidate, labels: string[]): number | null {
    const fromField = readField(candidate.fields, labels);
    if (fromField) {
        const parsed = parseNumber(fromField);
        if (parsed !== null) return parsed;
    }
    return parseMetricFromText(candidate.text, labels);
}

function parseOrders(candidate: CampaignCandidate): number | null {
    const fromField = readField(candidate.fields, ['orders', 'order count', 'redemptions']);
    if (fromField) {
        const parsed = parseInteger(fromField);
        if (parsed !== null) return parsed;
    }
    const parsed = parseMetricFromText(candidate.text, ['orders', 'order count', 'redemptions']);
    return parsed === null ? null : Math.round(parsed);
}

function parseRoas(candidate: CampaignCandidate, spend: number | null, sales: number | null): number | null {
    const fromField = readField(candidate.fields, ['roas', 'return on ad spend']);
    if (fromField) {
        const parsed = parseNumber(fromField);
        if (parsed !== null) return parsed;
    }

    const fromText = parseMetricFromText(candidate.text, ['roas', 'return on ad spend']);
    if (fromText !== null) return fromText;

    const roasMatch = candidate.text.match(/(\d+(?:\.\d+)?)\s*x\b/i);
    if (roasMatch) return parseNumber(roasMatch[1]);

    if (spend && spend > 0 && sales !== null) {
        return Math.round((sales / spend) * 100) / 100;
    }

    return null;
}

function parseStatus(text: string): string {
    const lowered = text.toLowerCase();
    if (/\bactive\b/.test(lowered) || /\brunning\b/.test(lowered) || /\blive\b/.test(lowered)) return 'active';
    if (/\bpaused?\b/.test(lowered)) return 'paused';
    if (/\bended\b/.test(lowered) || /\bexpired\b/.test(lowered) || /\bcomplete\b/.test(lowered)) return 'ended';
    if (/\bdraft\b/.test(lowered)) return 'draft';
    if (/\bscheduled\b/.test(lowered)) return 'scheduled';
    return 'unknown';
}

function parseCampaignType(text: string): string {
    const lowered = text.toLowerCase();
    if (lowered.includes('sponsored listing') || lowered.includes('sponsored list')) return 'sponsored_listing';
    if (lowered.includes('sponsored')) return 'sponsored';
    if (lowered.includes('promotion') || lowered.includes('promo')) return 'promotion';
    if (lowered.includes('marketplace')) return 'marketplace';
    if (lowered.includes('boost')) return 'boost';
    if (lowered.includes('ad campaign') || lowered.includes('ads')) return 'ads';
    return 'unknown';
}

function parseDateRange(text: string): { startDate: string | null; endDate: string | null } {
    const numeric = text.match(/(\d{1,2}\/\d{1,2}\/\d{2,4})\s*(?:-|to|through)\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i);
    if (numeric) return { startDate: numeric[1], endDate: numeric[2] };

    const iso = text.match(/(\d{4}-\d{2}-\d{2})\s*(?:-|to|through)\s*(\d{4}-\d{2}-\d{2})/i);
    if (iso) return { startDate: iso[1], endDate: iso[2] };

    return { startDate: null, endDate: null };
}

function extractCampaignName(candidate: CampaignCandidate): string | null {
    const fieldName = readField(candidate.fields, ['campaign name', 'name', 'promotion name', 'ad name']);
    if (fieldName && fieldName.length > 1) return normalizeText(fieldName);

    const lines = candidate.text
        .split(/\r?\n| {2,}/)
        .map(line => normalizeText(line))
        .filter(Boolean);

    const ignored = /^(edit|manage|view|details|budget|spend|sales|orders|roas|active|paused|ended|draft|scheduled|status|campaigns?|promotions?|marketing|ads?)$/i;
    const metric = /(budget|spend|sales|orders|roas|return on ad spend|\$\d|\d+(?:\.\d+)?x)/i;

    for (const line of lines) {
        if (line.length < 2 || line.length > 120) continue;
        if (ignored.test(line)) continue;
        if (metric.test(line)) continue;
        return line;
    }

    const campaignMatch = candidate.text.match(/(?:campaign|promotion|ad)\s*(?:name)?\s*[:\-]\s*([^\n\r|]+)/i);
    if (campaignMatch) return normalizeText(campaignMatch[1]);

    return null;
}

function hasCampaignSignal(candidate: CampaignCandidate): boolean {
    const text = candidate.text.toLowerCase();
    const metricSignals = ['budget', 'spend', 'sales', 'orders', 'roas', 'return on ad spend', '$'];
    const domainSignals = ['campaign', 'promotion', 'sponsored', 'boost', 'ads', 'advertise', 'discount', 'marketing', 'marketplace'];
    const fieldLabels = candidate.fields.map(field => normalizeKey(field.label));
    const tableCampaignFields = ['name', 'channel', 'status', 'sales', 'spend', 'roas']
        .filter(label => fieldLabels.some(fieldLabel => fieldLabel.includes(label))).length;
    if (candidate.source === 'table' && tableCampaignFields >= 4) return true;
    return metricSignals.some(signal => text.includes(signal)) && domainSignals.some(signal => text.includes(signal));
}

export function parseCampaignCandidate(candidate: CampaignCandidate, storeId: string): CampaignData | null {
    if (!candidate.text || candidate.text.length < 8) return null;
    if (!hasCampaignSignal(candidate)) return null;

    const campaignName = extractCampaignName(candidate);
    if (!campaignName) return null;

    const budget = parseCurrencyMetric(candidate, ['budget', 'weekly budget', 'daily budget', 'monthly budget']);
    const spend = parseCurrencyMetric(candidate, ['spend', 'ad spend', 'amount spent']);
    const sales = parseCurrencyMetric(candidate, ['sales', 'revenue', 'attributed sales', 'total sales']);
    const orders = parseOrders(candidate);
    const roas = parseRoas(candidate, spend, sales);
    const { startDate, endDate } = parseDateRange(candidate.text);

    return {
        id: uuidv4(),
        storeId,
        campaignName,
        campaignType: parseCampaignType(candidate.text),
        status: parseStatus(candidate.text),
        budget,
        spend,
        sales,
        orders,
        roas,
        startDate,
        endDate,
        currency: 'USD',
        rawData: JSON.stringify(candidate),
        screenshotPath: undefined,
    };
}

async function pageLooksLikeLogin(page: Page): Promise<boolean> {
    const url = page.url().toLowerCase();
    const text = (await page.innerText('body').catch(() => '')).toLowerCase();
    return url.includes('login') || url.includes('signin') || text.includes('sign in') || text.includes('log in');
}

async function readBodyText(page: Page): Promise<string> {
    return page.innerText('body').catch(() => '');
}

function textHasCampaignReport(text: string): boolean {
    const normalized = text.toLowerCase().replace(/\s+/g, ' ');
    const signals = [
        // DoorDash marketing page indicators
        /marketing\s*(campaign|promotion|overview|home|report)/i,
        /paid\s*(marketing|advertising|campaign)/i,
        /run\s*a\s*campaign/i,
        /boost\s*your\s*sales/i,
        /sponsored\s*(listing|product|restaurants?)/i,
        /promote\s*your\s*business/i,
        /advertising\s*(overview|dashboard|performance)/i,
        // Campaign table indicators (table headers)
        /name.*channel.*status/i,
        /channel.*status.*spend/i,
        /campaign.*name.*status/i,
        /spend.*roas.*orders/i,
        // Pagination / data indicators
        /1-\d+\s+of\s+\d+/,
        /see\s+more/i,
        /last\s+30\s+days/i,
        /no\s+(active\s+)?campaign/i,
        /0\s+campaign/i,
        /all\s+statuses/i,
        /all\s+campaigns/i,
        // Section headers
        /campaigns?\s*(overview|performance|summary|report)/i,
        /promotions?\s*(overview|performance|summary|report)/i,
    ];
    return signals.some(s => s.test(normalized));
}

async function pageLooksLikeCampaigns(page: Page): Promise<boolean> {
    if (await pageLooksLikeLogin(page)) return false;
    const text = await readBodyText(page);
    return textHasCampaignReport(text);
}

function withCurrentStoreId(page: Page, targetUrl: string): string {
    try {
        const current = new URL(page.url());
        const storeId = current.searchParams.get('store_id');
        if (!storeId) return targetUrl;

        const target = new URL(targetUrl);
        if (!target.searchParams.has('store_id')) {
            target.searchParams.set('store_id', storeId);
        }
        return target.toString();
    } catch {
        return targetUrl;
    }
}

async function closeDoorDashInterruptions(page: Page): Promise<void> {
    await page.keyboard.press('Escape').catch(() => undefined);
    const closeTargets = [
        page.getByRole('button', { name: /close|dismiss|no thanks|not now/i }).first(),
        page.locator('[aria-label*="Close"], [aria-label*="close"], button:has-text("×"), button:has-text("X")').first(),
        page.getByText('×', { exact: true }).first(),
    ];

    for (const target of closeTargets) {
        const count = await target.count().catch(() => 0);
        if (count === 0) continue;
        const visible = await target.isVisible().catch(() => false);
        if (!visible) continue;
        await target.click().catch(() => undefined);
        await page.waitForTimeout(500);
        break;
    }
}

async function waitForCampaignContent(page: Page, timeoutMs: number = 25000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        await closeDoorDashInterruptions(page);
        if (await pageLooksLikeLogin(page)) return false;

        const text = await readBodyText(page);
        if (textHasCampaignReport(text)) return true;

        await page.waitForTimeout(1000);
    }

    return pageLooksLikeCampaigns(page);
}

async function clickNavText(page: Page, label: string): Promise<boolean> {
    const locator = page.getByText(label, { exact: true }).first();
    const count = await locator.count().catch(() => 0);
    if (count === 0) return false;
    const visible = await locator.isVisible().catch(() => false);
    if (!visible) return false;
    await locator.click().catch(() => undefined);
    await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => undefined);
    await page.waitForTimeout(1500);
    return true;
}

async function navigateToCampaigns(storeId: string, page: Page): Promise<{ ok: boolean; aiNavigation?: AiBrowserStepResult }> {
    try {
        await page.goto('https://merchant.doordash.com', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => undefined);
        await page.waitForTimeout(4000);
        await closeDoorDashInterruptions(page);
        if (await pageLooksLikeLogin(page)) return { ok: false };

        for (const url of DOORDASH_CAMPAIGN_URLS) {
            await page.goto(withCurrentStoreId(page, url), { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => undefined);
            if (await waitForCampaignContent(page)) return { ok: true };
            if (await pageLooksLikeLogin(page)) return { ok: false };
        }

        for (const label of ['Campaigns', 'Run a campaign', 'Marketing']) {
            if (await clickNavText(page, label) && await waitForCampaignContent(page)) {
                return { ok: true };
            }
        }

        const aiNavigation = await stagehandAct(page, 'Open the DoorDash Merchant campaigns, promotions, or marketing performance page for the current store. Stop on the page that shows campaign budget, spend, sales, orders, or ROAS data.', {
            storeId,
            purpose: 'campaign_read_navigation',
        });
        if (aiNavigation.ok && await waitForCampaignContent(page, 15000)) {
            return { ok: true, aiNavigation };
        }

        return { ok: false, aiNavigation };
    } catch (error) {
        console.error(`[CampaignReader] Navigation failed for ${storeId}:`, error);
        return { ok: false };
    }
}

async function safeValidateCampaignPage(page: Page, storeId: string): Promise<BrowserQaResult> {
    try {
        return await validateCampaignPage(page, storeId);
    } catch (error: any) {
        return {
            ok: false,
            provider: 'deterministic',
            risk: 'high',
            pageUrl: page.url(),
            title: await page.title().catch(() => ''),
            findings: [`QA validation failed: ${error.message}`],
            signals: [],
            checkedAt: new Date().toISOString(),
        };
    }
}

async function extractCandidates(page: Page): Promise<CampaignCandidate[]> {
    await page.evaluate('globalThis.__name = globalThis.__name || ((fn) => fn)').catch(() => undefined);
    return page.evaluate(() => {
        const doc = (globalThis as any).document;
        const candidates: CampaignCandidate[] = [];
        const seen = new Set<string>();

        const textOf = (element: any): string => (element?.innerText || element?.textContent || '').replace(/\s+\n/g, '\n').trim();
        const compact = (value: string): string => value.replace(/\s+/g, ' ').trim();
        const push = (candidate: CampaignCandidate) => {
            const text = compact(candidate.text);
            if (text.length < 8 || text.length > 4000) return;
            const key = `${candidate.source}:${text.slice(0, 500)}`;
            if (seen.has(key)) return;
            seen.add(key);
            candidates.push({ ...candidate, text });
        };

        for (const table of Array.from(doc.querySelectorAll('table')) as any[]) {
            const headerCells = Array.from(table.querySelectorAll('thead th')) as any[];
            let headers = headerCells.map(textOf).map(compact);
            let rows = Array.from(table.querySelectorAll('tbody tr')) as any[];

            if (rows.length === 0) {
                const allRows = Array.from(table.querySelectorAll('tr')) as any[];
                if (headers.length === 0 && allRows.length > 0) {
                    headers = Array.from(allRows[0].querySelectorAll('th,td')).map(textOf).map(compact);
                    rows = allRows.slice(1);
                } else {
                    rows = allRows;
                }
            }

            for (const row of rows) {
                const cells = Array.from(row.querySelectorAll('th,td')) as any[];
                const fields = cells.map((cell, index) => ({
                    label: headers[index] || `column_${index + 1}`,
                    value: compact(textOf(cell)),
                }));
                push({ source: 'table', text: textOf(row), fields });
            }
        }

        const campaignish = /(campaign|promotion|sponsored|boost|ads?|marketing|budget|spend|sales|orders|roas|\$\d)/i;
        const cardSelectors = [
            '[role="row"]',
            '[data-testid]',
            'article',
            'li',
            'section',
            'div',
        ].join(',');

        for (const element of Array.from(doc.querySelectorAll(cardSelectors)) as any[]) {
            const text = textOf(element);
            if (!campaignish.test(text)) continue;
            if (text.length < 20 || text.length > 2000) continue;
            const children = Array.from(element.children || []) as any[];
            const fields = children
                .map(child => compact(textOf(child)))
                .filter(Boolean)
                .slice(0, 20)
                .map((value, index) => ({ label: `line_${index + 1}`, value }));
            push({ source: 'card', text, fields });
        }

        const objectLooksUseful = (value: any): boolean => {
            if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
            const keys = Object.keys(value).join(' ').toLowerCase();
            const values = Object.values(value)
                .filter(item => typeof item === 'string' || typeof item === 'number')
                .join(' ')
                .toLowerCase();
            return /(campaign|promotion|budget|spend|sales|orders|roas|status|sponsored)/.test(`${keys} ${values}`);
        };

        const collectJsonObjects = (value: any, depth: number, remaining: { count: number }) => {
            if (remaining.count <= 0 || depth > 8 || value === null || value === undefined) return;

            if (Array.isArray(value)) {
                for (const item of value) collectJsonObjects(item, depth + 1, remaining);
                return;
            }

            if (typeof value !== 'object') return;

            if (objectLooksUseful(value)) {
                const fields = Object.entries(value)
                    .filter(([, item]) => typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean')
                    .slice(0, 30)
                    .map(([label, item]) => ({ label, value: String(item) }));
                push({ source: 'json', text: fields.map(field => `${field.label}: ${field.value}`).join('\n'), fields });
                remaining.count -= 1;
            }

            for (const item of Object.values(value)) collectJsonObjects(item, depth + 1, remaining);
        };

        for (const script of Array.from(doc.querySelectorAll('script[type="application/json"], script#__NEXT_DATA__')) as any[]) {
            const raw = script.textContent || '';
            if (!raw.trim()) continue;
            try {
                collectJsonObjects(JSON.parse(raw), 0, { count: 120 });
            } catch {
                // Ignore non-JSON scripts.
            }
        }

        return candidates.slice(0, 250);
    });
}

async function extractCampaigns(page: Page, storeId: string): Promise<CampaignData[]> {
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => undefined);
    await page.waitForTimeout(1500);

    const candidates = await extractCandidates(page);
    const campaigns: CampaignData[] = [];
    const seen = new Set<string>();

    for (const candidate of candidates) {
        const campaign = parseCampaignCandidate(candidate, storeId);
        if (!campaign) continue;

        const key = [
            normalizeKey(campaign.campaignName),
            campaign.campaignType,
            campaign.status,
            campaign.budget ?? '',
            campaign.spend ?? '',
            campaign.sales ?? '',
        ].join('|');
        if (seen.has(key)) continue;
        seen.add(key);
        campaigns.push(campaign);
    }

    return campaigns;
}

export async function readCampaigns(storeId: string): Promise<CampaignReadResult> {
    const result: CampaignReadResult = {
        success: false,
        message: '',
        storeId,
        campaigns: [],
        snapshotIds: [],
        screenshotPaths: [],
    };

    try {
        const page = await getPage(storeId);
        const navigation = await navigateToCampaigns(storeId, page);
        result.aiNavigation = navigation.aiNavigation;
        const campaignsScreenshot = await takeScreenshot(storeId, `campaigns-${storeId}`);
        result.screenshotPaths.push(campaignsScreenshot);
        result.qa = await safeValidateCampaignPage(page, storeId);

        if (!navigation.ok) {
            const loginPage = await pageLooksLikeLogin(page);
            if (loginPage) {
                markSessionExpired(storeId);
            }
            result.message = loginPage
                ? 'DoorDash session is not logged in. Login is required before reading campaigns.'
                : `Could not navigate to a DoorDash campaigns/promotions page. QA risk: ${result.qa.risk}.`;
            return result;
        }

        const campaigns = await extractCampaigns(page, storeId);
        for (const campaign of campaigns) {
            campaign.screenshotPath = campaignsScreenshot || undefined;
        }
        result.campaigns = campaigns;

        if (campaigns.length === 0) {
            result.message = `No campaign rows could be parsed from the current DoorDash page. Screenshot saved for selector review. QA risk: ${result.qa.risk}.`;
            return result;
        }

        const db = getDb();
        const insertSnapshot = db.prepare(`
            INSERT INTO campaign_snapshots (id, store_id, campaign_name, campaign_type, status, budget, spend, sales, orders, roas, start_date, end_date, snapshot_date, week_start, raw_data, screenshot_path)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, ?, ?)
        `);

        const weekStart = getWeekStart();
        const tx = db.transaction(() => {
            for (const campaign of campaigns) {
                insertSnapshot.run(
                    campaign.id,
                    campaign.storeId,
                    campaign.campaignName,
                    campaign.campaignType,
                    campaign.status,
                    campaign.budget,
                    campaign.spend,
                    campaign.sales,
                    campaign.orders,
                    campaign.roas,
                    campaign.startDate,
                    campaign.endDate,
                    weekStart,
                    campaign.rawData,
                    campaignsScreenshot || '',
                );
                result.snapshotIds.push(campaign.id);
            }
        });
        tx();

        result.success = true;
        result.message = `Read ${campaigns.length} campaigns for ${storeId}. Snapshots saved.`;
        return result;
    } catch (error: any) {
        console.error(`[CampaignReader] Error for ${storeId}:`, error);
        result.message = `Campaign read error: ${error.message}`;
        return result;
    }
}

export async function readAllStoreCampaigns(): Promise<Record<string, CampaignReadResult>> {
    const db = getDb();
    const stores = db.prepare('SELECT id FROM stores WHERE active = 1').all() as any[];
    const results: Record<string, CampaignReadResult> = {};

    for (const store of stores) {
        results[store.id] = await readCampaigns(store.id);
    }

    return results;
}

export function getStoredCampaigns(storeId: string, limit: number = 50): CampaignData[] {
    const db = getDb();
    const rows = db.prepare(`
        SELECT * FROM campaign_snapshots
        WHERE store_id = ?
        ORDER BY snapshot_date DESC
        LIMIT ?
    `).all(storeId, limit) as any[];

    return rows.map(row => ({
        id: row.id,
        storeId: row.store_id,
        campaignName: row.campaign_name,
        campaignType: row.campaign_type,
        status: row.status,
        budget: row.budget,
        spend: row.spend,
        sales: row.sales,
        orders: row.orders,
        roas: row.roas,
        startDate: row.start_date,
        endDate: row.end_date,
        currency: row.currency,
        rawData: row.raw_data,
        screenshotPath: row.screenshot_path,
    }));
}

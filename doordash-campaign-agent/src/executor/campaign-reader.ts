/**
 * Campaign Reader
 * Reads campaign data from DoorDash Merchant Portal for a specific store.
 * Extracts: campaign name, type, status, budget, spend, sales, orders, ROAS, dates.
 * Saves to campaign_snapshots table.
 */
import { Page } from 'playwright';
import { getPage, takeScreenshot } from './account-session-manager.js';
import { getDb } from '../server/db/init.js';
import { v4 as uuidv4 } from 'uuid';

const DOORDASH_CAMPAIGNS_URL = 'https://merchant.doordash.com/campaigns';
const DOORDASH_PROMOTIONS_URL = 'https://merchant.doordash.com/promotions';

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
}

export interface CampaignReadResult {
    success: boolean;
    message: string;
    storeId: string;
    campaigns: CampaignData[];
    snapshotIds: string[];
    screenshotPaths: string[];
}

/**
 * Navigate to campaigns page for a store.
 */
async function navigateToCampaigns(storeId: string, page: Page): Promise<boolean> {
    try {
        // Try campaigns page first
        await page.goto(DOORDASH_CAMPAIGNS_URL, { waitUntil: 'networkidle', timeout: 30000 });
        const url = page.url();
        if (url.includes('/campaign') || url.includes('/promotion')) return true;

        // Try promotions page
        await page.goto(DOORDASH_PROMOTIONS_URL, { waitUntil: 'networkidle', timeout: 30000 });
        const url2 = page.url();
        return url2.includes('/campaign') || url2.includes('/promotion');
    } catch (error) {
        console.error(`[CampaignReader] Navigation failed for ${storeId}:`, error);
        return false;
    }
}

/**
 * Get week start date (Monday) for the current week
 */
function getWeekStart(): string {
    const now = new Date();
    const day = now.getDay();
    const diff = now.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(now.setDate(diff));
    return monday.toISOString().split('T')[0];
}

/**
 * Extract campaign data from the current page.
 * Uses selectors common in DoorDash Merchant Portal.
 */
async function extractCampaigns(page: Page, storeId: string): Promise<CampaignData[]> {
    const campaigns: CampaignData[] = [];
    const weekStart = getWeekStart();

    try {
        // Wait for campaign table/grid to load
        await page.waitForSelector('table, [data-testid*="campaign"], [class*="campaign"], [role="table"]', { timeout: 10000 }).catch(() => { });
        await page.waitForTimeout(2000);

        // Extract page content to parse campaign data
        const pageContent = await page.content();

        // Try to parse structured data from the page
        // DoorDash typically shows campaigns in a table or card layout

        // Look for campaign cards/rows
        const campaignElements = await page.$$('[class*="campaign"], [data-testid*="campaign"], tr[class*="row"], [role="row"]');

        if (campaignElements.length > 0) {
            for (const el of campaignElements) {
                try {
                    const text = await el.innerText().catch(() => '');
                    const html = await el.innerHTML().catch(() => '');

                    if (!text.trim()) continue;

                    // Parse campaign name (usually first strong/bold text or header)
                    const nameMatch = text.match(/^([A-Za-z0-9\s\-_]+?)(?:\n|$)/);
                    const campaignName = nameMatch ? nameMatch[1].trim() : 'Unknown';

                    // Parse budget
                    const budgetMatch = text.match(/Budget[:\s]*\$?([0-9,.]+)/i);
                    const budget = budgetMatch ? parseFloat(budgetMatch[1].replace(/,/g, '')) : null;

                    // Parse spend
                    const spendMatch = text.match(/Spend[:\s]*\$?([0-9,.]+)/i);
                    const spend = spendMatch ? parseFloat(spendMatch[1].replace(/,/g, '')) : null;

                    // Parse sales
                    const salesMatch = text.match(/Sales[:\s]*\$?([0-9,.]+)/i);
                    const sales = salesMatch ? parseFloat(salesMatch[1].replace(/,/g, '')) : null;

                    // Parse orders
                    const ordersMatch = text.match(/Orders[:\s]*([0-9,.]+)/i);
                    const orders = ordersMatch ? parseInt(ordersMatch[1].replace(/,/g, ''), 10) : null;

                    // Parse ROAS
                    const roasMatch = text.match(/ROAS[:\s]*([0-9.]+)/i);
                    const roas = roasMatch ? parseFloat(roasMatch[1]) : null;

                    // Parse status (Active, Paused, Ended, Draft)
                    let status = 'unknown';
                    if (text.match(/Active/i)) status = 'active';
                    else if (text.match(/Paused/i)) status = 'paused';
                    else if (text.match(/Ended/i)) status = 'ended';
                    else if (text.match(/Draft/i)) status = 'draft';

                    // Parse campaign type
                    let campaignType = 'unknown';
                    if (text.match(/Sponsored List/i)) campaignType = 'sponsored_listing';
                    else if (text.match(/Promotion/i)) campaignType = 'promotion';
                    else if (text.match(/Boost/i)) campaignType = 'boost';

                    // Parse dates
                    const dateMatch = text.match(/(\d{1,2}\/\d{1,2}\/\d{4})\s*-\s*(\d{1,2}\/\d{1,2}\/\d{4})/);
                    const startDate = dateMatch ? dateMatch[1] : null;
                    const endDate = dateMatch ? dateMatch[2] : null;

                    campaigns.push({
                        id: uuidv4(),
                        storeId,
                        campaignName,
                        campaignType,
                        status,
                        budget,
                        spend,
                        sales,
                        orders,
                        roas,
                        startDate,
                        endDate,
                        currency: 'USD',
                        rawData: JSON.stringify({ text, html }),
                    });
                } catch (elError) {
                    console.warn(`[CampaignReader] Error parsing element:`, elError);
                }
            }
        } else {
            // Fallback: extract all text and try to parse
            const allText = await page.innerText('body').catch(() => '');
            if (allText) {
                campaigns.push({
                    id: uuidv4(),
                    storeId,
                    campaignName: 'All Campaigns (Parsed)',
                    campaignType: 'unknown',
                    status: 'unknown',
                    budget: null,
                    spend: null,
                    sales: null,
                    orders: null,
                    roas: null,
                    startDate: null,
                    endDate: null,
                    currency: 'USD',
                    rawData: allText.substring(0, 5000),
                });
            }
        }
    } catch (error) {
        console.error(`[CampaignReader] Extraction error for ${storeId}:`, error);
    }

    return campaigns;
}

/**
 * Read campaigns for a specific store.
 * Returns campaigns and saves them to the database.
 */
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

        // Navigate to campaigns page
        const navigated = await navigateToCampaigns(storeId, page);
        if (!navigated) {
            result.message = 'Could not navigate to campaigns page. Check login status.';
            return result;
        }

        // Take screenshot of campaigns page
        const campaignsScreenshot = await takeScreenshot(storeId, `campaigns-${storeId}`);
        result.screenshotPaths.push(campaignsScreenshot);

        // Extract campaign data
        const campaigns = await extractCampaigns(page, storeId);
        result.campaigns = campaigns;

        if (campaigns.length === 0) {
            result.message = 'No campaigns found.';
            return result;
        }

        // Save to database
        const db = getDb();
        const insertSnapshot = db.prepare(`
            INSERT INTO campaign_snapshots (id, store_id, campaign_name, campaign_type, status, budget, spend, sales, orders, roas, start_date, end_date, snapshot_date, week_start, raw_data, screenshot_path)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, ?, ?)
        `);

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
                    getWeekStart(),
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

/**
 * Read campaigns for all active stores.
 */
export async function readAllStoreCampaigns(): Promise<Record<string, CampaignReadResult>> {
    const db = getDb();
    const stores = db.prepare('SELECT id FROM stores WHERE active = 1').all() as any[];
    const results: Record<string, CampaignReadResult> = {};

    for (const store of stores) {
        results[store.id] = await readCampaigns(store.id);
    }

    return results;
}

/**
 * Get latest campaign snapshots from the database for a store.
 */
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
    }));
}
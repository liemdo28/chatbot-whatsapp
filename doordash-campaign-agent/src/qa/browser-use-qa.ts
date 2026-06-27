import type { Page } from 'playwright';

export type BrowserQaProvider = 'browser-use-compatible' | 'deterministic';
export type BrowserQaRisk = 'low' | 'medium' | 'high';

export interface BrowserQaResult {
    ok: boolean;
    provider: BrowserQaProvider;
    risk: BrowserQaRisk;
    pageUrl: string;
    title: string;
    findings: string[];
    signals: string[];
    checkedAt: string;
}

function envFlag(name: string): boolean {
    const value = process.env[name];
    return value === 'true' || value === '1' || value === 'yes';
}

function classifyRisk(ok: boolean, findings: string[]): BrowserQaRisk {
    if (ok && findings.length === 0) return 'low';
    if (findings.some(finding => /login|blocked|error|denied/i.test(finding))) return 'high';
    return 'medium';
}

async function collectText(page: Page): Promise<string> {
    const text = await page.innerText('body', { timeout: 5000 }).catch(() => '');
    return text.replace(/\s+/g, ' ').trim().slice(0, 12000);
}

export async function validateCampaignPage(page: Page, storeId: string): Promise<BrowserQaResult> {
    const text = await collectText(page);
    const lowerText = text.toLowerCase();
    const url = page.url();
    const title = await page.title().catch(() => '');
    const findings: string[] = [];
    const signals: string[] = [];

    if (/login|sign in|sign-in|authentication/.test(url.toLowerCase()) || /sign in to your account|log in to continue/.test(lowerText)) {
        findings.push('DoorDash appears to be on a login or authentication page.');
    }
    if (/access denied|forbidden|blocked|something went wrong|try again later/.test(lowerText)) {
        findings.push('DoorDash page shows an access, blocked, or generic error state.');
    }
    if (/campaign|promotion|marketing|sponsored|ad/.test(lowerText)) {
        signals.push('campaign_page_language');
    }
    if (/budget|spend|sales|orders|roas|return on ad spend/.test(lowerText)) {
        signals.push('performance_metrics_language');
    }
    if (url.includes('merchant.doordash.com') || url.includes('doordash.com/merchant')) {
        signals.push('merchant_domain');
    } else {
        findings.push(`Unexpected domain for ${storeId}: ${url}`);
    }

    const ok = findings.length === 0 && signals.length >= 2;
    return {
        ok,
        provider: envFlag('BROWSER_USE_QA_ENABLED') ? 'browser-use-compatible' : 'deterministic',
        risk: classifyRisk(ok, findings),
        pageUrl: url,
        title,
        findings: findings.length ? findings : ['Campaign page readiness signals detected.'],
        signals,
        checkedAt: new Date().toISOString(),
    };
}

export async function validateExecutionPage(page: Page, targetDescription: string): Promise<BrowserQaResult> {
    const text = await collectText(page);
    const lowerText = text.toLowerCase();
    const url = page.url();
    const title = await page.title().catch(() => '');
    const findings: string[] = [];
    const signals: string[] = [];

    if (/login|sign in|sign-in|authentication/.test(url.toLowerCase()) || /sign in to your account|log in to continue/.test(lowerText)) {
        findings.push('DoorDash appears to require login before execution.');
    }
    if (/access denied|forbidden|blocked|something went wrong|try again later/.test(lowerText)) {
        findings.push('DoorDash page shows an access, blocked, or generic error state.');
    }
    if (/campaign|promotion|marketing|sponsored|ad/.test(lowerText)) {
        signals.push('campaign_management_language');
    }
    if (/edit|manage|save|review|confirm|pause|resume|budget/.test(lowerText)) {
        signals.push('execution_controls_language');
    }
    if (targetDescription && lowerText.includes(targetDescription.toLowerCase().slice(0, 60))) {
        signals.push('target_campaign_text');
    }

    const ok = findings.length === 0 && signals.length >= 1;
    return {
        ok,
        provider: envFlag('BROWSER_USE_QA_ENABLED') ? 'browser-use-compatible' : 'deterministic',
        risk: classifyRisk(ok, findings),
        pageUrl: url,
        title,
        findings: findings.length ? findings : ['Execution page readiness signals detected.'],
        signals,
        checkedAt: new Date().toISOString(),
    };
}

/**
 * DoorDash Merchant Portal scraper using Playwright.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { waitForDoorDashOTP } = require('./gmail-otp');

const SESSION_DIR = path.join(__dirname, '../data/sessions');
const PORTAL_URL = 'https://merchant-portal.doordash.com/';
const LOGIN_URL = 'https://identity.doordash.com/auth/user/login?layout=merchant_web_v2&redirect_uri=https%3A%2F%2Fmerchant-portal.doordash.com%2Fauth_callback';

function sessionPath(accountId) {
  return path.join(SESSION_DIR, `${accountId}.json`);
}

function saveSession(accountId, cookies) {
  fs.mkdirSync(SESSION_DIR, { recursive: true });
  fs.writeFileSync(sessionPath(accountId), JSON.stringify({ cookies, savedAt: Date.now() }, null, 2));
}

function loadSession(accountId) {
  try {
    const p = sessionPath(accountId);
    if (!fs.existsSync(p)) return null;
    const data = JSON.parse(fs.readFileSync(p, 'utf-8'));
    if (Date.now() - data.savedAt > 8 * 60 * 60 * 1000) return null;
    return data;
  } catch { return null; }
}

async function login(page, account) {
  console.log(`[${account.id}] Navigating to merchant portal...`);

  // Navigate to portal — it will redirect to identity login page
  await page.goto(PORTAL_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);

  const currentUrl = page.url();
  console.log(`[${account.id}] URL after nav: ${currentUrl}`);

  // Check if already on portal (session still valid)
  if (currentUrl.includes('merchant-portal.doordash.com') && !currentUrl.includes('login') && !currentUrl.includes('auth')) {
    console.log(`[${account.id}] Already authenticated`);
    return true;
  }

  try {
    // Wait for email field — DoorDash uses specific data-testid attrs
    const emailSelectors = [
      'input[type="email"]',
      'input[name="email"]',
      'input[autocomplete="email"]',
      '[data-testid="email-input"]',
    ];

    let emailFilled = false;
    for (const sel of emailSelectors) {
      try {
        await page.waitForSelector(sel, { timeout: 5000 });
        await page.fill(sel, account.email);
        emailFilled = true;
        console.log(`[${account.id}] Filled email with selector: ${sel}`);
        break;
      } catch { continue; }
    }

    if (!emailFilled) {
      // Take screenshot to see what's on page
      const ss = path.join(SESSION_DIR, `${account.id}-login-debug.png`);
      await page.screenshot({ path: ss });
      console.log(`[${account.id}] Could not find email field. Screenshot: ${ss}`);
      return false;
    }

    await page.waitForTimeout(500);

    // Click Continue/Next
    const nextSelectors = [
      'button:has-text("Continue to Log In")',
      'button:has-text("Continue")',
      'button:has-text("Log in")',
      'button:has-text("Sign in")',
      '[data-testid="submit-button"]',
      'button[type="submit"]',
    ];

    for (const sel of nextSelectors) {
      try {
        const btn = page.locator(sel).first();
        if (await btn.isVisible()) {
          await btn.click();
          break;
        }
      } catch { continue; }
    }

    await page.waitForTimeout(2000);

    // Fill password (may be on same or next page)
    const passSelectors = [
      '[data-testid="password-input"]',
      'input[name="password"]',
      'input[type="password"]',
      'input[autocomplete="current-password"]',
    ];

    let passFilled = false;
    for (const sel of passSelectors) {
      try {
        await page.waitForSelector(sel, { timeout: 5000 });
        await page.fill(sel, account.password);
        passFilled = true;
        console.log(`[${account.id}] Filled password with selector: ${sel}`);
        break;
      } catch { continue; }
    }

    if (!passFilled) {
      const ss = path.join(SESSION_DIR, `${account.id}-pass-debug.png`);
      await page.screenshot({ path: ss });
      console.log(`[${account.id}] Could not find password field. Screenshot: ${ss}`);
      return false;
    }

    await page.waitForTimeout(500);

    // Submit
    for (const sel of nextSelectors) {
      try {
        const btn = page.locator(sel).first();
        if (await btn.isVisible()) {
          await btn.click();
          break;
        }
      } catch { continue; }
    }

    // Wait for redirect to portal
    await page.waitForTimeout(5000);

    const finalUrl = page.url();
    console.log(`[${account.id}] Final URL: ${finalUrl}`);

    // Check for 2FA on page (DoorDash shows it on same URL)
    const bodyText = await page.textContent('body').catch(() => '');
    if (bodyText.includes('two-factor') || bodyText.includes('2-Step Verification') || bodyText.includes('6-digit')) {
      console.log(`[${account.id}] 2FA detected — requesting OTP from Gmail...`);
      const otp = await waitForDoorDashOTP(account.email, 90000);
      if (!otp) {
        const ss = path.join(SESSION_DIR, `${account.id}-2fa-timeout.png`);
        await page.screenshot({ path: ss });
        return '2FA_TIMEOUT';
      }
      // Enter OTP
      const otpInput = await page.$('input[name="otp"], input[autocomplete="one-time-code"], input[inputmode="numeric"], input[type="text"], input[type="tel"]');
      if (otpInput) {
        await otpInput.fill(otp);
        await page.waitForTimeout(500);
        await page.keyboard.press('Enter');
        await page.waitForTimeout(5000);
        console.log(`[${account.id}] OTP entered: ${otp}, URL: ${page.url()}`);
      } else {
        console.log(`[${account.id}] Could not find OTP input field`);
        return '2FA_INPUT_NOT_FOUND';
      }
    }

    const currentUrl = page.url();
    if (currentUrl.includes('merchant-portal.doordash.com') && !currentUrl.includes('login')) {
      console.log(`[${account.id}] Login successful`);
      return true;
    }

    // Still on auth page — login failed
    const ss = path.join(SESSION_DIR, `${account.id}-login-fail.png`);
    await page.screenshot({ path: ss });
    console.log(`[${account.id}] Login failed, URL: ${currentUrl}`);
    return false;

  } catch (err) {
    console.error(`[${account.id}] Login error: ${err.message}`);
    return false;
  }
}

async function scrapeMetrics(page, accountId) {
  const metrics = {
    account_id: accountId,
    scraped_at: new Date().toISOString(),
    stores: [],
    error: null,
  };

  try {
    // Take screenshot of portal home
    const ss = path.join(SESSION_DIR, `${accountId}-portal.png`);
    await page.screenshot({ path: ss });

    const bodyText = await page.textContent('body').catch(() => '');
    const pageUrl = page.url();

    // Try to find store switcher or navigate to analytics
    const analyticsUrls = [
      `${PORTAL_URL}analytics`,
      `${PORTAL_URL}home`,
      `${PORTAL_URL}store`,
    ];

    let analyticsText = bodyText;
    for (const url of analyticsUrls) {
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await page.waitForTimeout(2000);
        analyticsText = await page.textContent('body').catch(() => '');
        const analyticsSS = path.join(SESSION_DIR, `${accountId}-analytics.png`);
        await page.screenshot({ path: analyticsSS });
        break;
      } catch { continue; }
    }

    const store = {
      store_name: 'default',
      page_url: page.url(),
      orders_today: null,
      orders_week: null,
      revenue_today: null,
      revenue_week: null,
      avg_rating: null,
      total_reviews: null,
    };

    // Parse metrics from page text
    const ordersMatch = analyticsText.match(/(\d+)\s*orders?\s*today/i) ||
                        analyticsText.match(/today[:\s]*(\d+)\s*orders?/i) ||
                        analyticsText.match(/orders?\s*today[:\s]*(\d+)/i);
    if (ordersMatch) store.orders_today = parseInt(ordersMatch[1]);

    const revenueMatch = analyticsText.match(/\$\s*([0-9,]+(?:\.\d{2})?)\s*(?:today|revenue|net sales)/i);
    if (revenueMatch) store.revenue_today = revenueMatch[1].replace(',', '');

    const ratingMatch = analyticsText.match(/([3-5]\.\d)\s*(?:stars?|\/\s*5)/i) ||
                        analyticsText.match(/(?:rating|score)[:\s]*([3-5]\.\d)/i);
    if (ratingMatch) store.avg_rating = parseFloat(ratingMatch[1]);

    store.raw_text_snippet = analyticsText.slice(0, 500);
    metrics.stores.push(store);

  } catch (err) {
    metrics.error = err.message;
  }

  return metrics;
}

async function runScrape(account, headless = true) {
  const browser = await chromium.launch({
    headless,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
  });

  // Restore saved session cookies
  const session = loadSession(account.id);
  if (session?.cookies?.length) {
    await context.addCookies(session.cookies);
    console.log(`[${account.id}] Restored ${session.cookies.length} cookies`);
  }

  const page = await context.newPage();

  try {
    const loginResult = await login(page, account);

    if (loginResult === '2FA_REQUIRED') {
      await browser.close();
      return { account_id: account.id, brand: account.brand, error: '2FA_REQUIRED', scraped_at: new Date().toISOString(), stores: [] };
    }

    if (!loginResult) {
      await browser.close();
      return { account_id: account.id, brand: account.brand, error: 'LOGIN_FAILED', scraped_at: new Date().toISOString(), stores: [] };
    }

    // Save session
    const cookies = await context.cookies();
    saveSession(account.id, cookies);

    const metrics = await scrapeMetrics(page, account.id);
    await browser.close();
    return metrics;

  } catch (err) {
    try { await browser.close(); } catch {}
    return { account_id: account.id, error: err.message, scraped_at: new Date().toISOString(), stores: [] };
  }
}

module.exports = { runScrape };

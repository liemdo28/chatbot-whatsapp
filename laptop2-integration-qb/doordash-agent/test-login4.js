const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();

  await page.goto('https://merchant-portal.doordash.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2000);

  await page.fill('input[type="email"]', 'bakudanramen210@gmail.com');
  await page.waitForTimeout(500);
  await page.click('button:has-text("Continue to Log In")');
  await page.waitForTimeout(2000);

  await page.fill('input[type="password"]', 'Rawsushi123');
  await page.waitForTimeout(500);
  await page.click('button:has-text("Log In")');

  await page.waitForTimeout(5000);

  const bodyText = await page.textContent('body');
  console.log('Body snippet:', bodyText.slice(0, 800));

  const allText = bodyText.toLowerCase();
  ['incorrect', 'invalid', 'wrong', 'error', 'failed', 'captcha', 'verify', 'check'].forEach(word => {
    const idx = allText.indexOf(word);
    if (idx >= 0) console.log(`Found "${word}":`, bodyText.slice(Math.max(0,idx-20), idx+60));
  });

  await browser.close();
})().catch(e => console.error('Fatal:', e.message));

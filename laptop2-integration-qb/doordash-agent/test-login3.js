const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false, args: ['--no-sandbox'] });
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

  // Try pressing Enter
  await page.keyboard.press('Enter');

  try {
    await page.waitForURL(url => !url.includes('identity.doordash.com'), { timeout: 10000 });
    console.log('SUCCESS - URL:', page.url());
  } catch {
    console.log('Still on identity page after Enter');
    // Check for error
    const bodyText = await page.textContent('body');
    const errIdx = bodyText.toLowerCase().indexOf('incorrect');
    if (errIdx >= 0) console.log('Error found:', bodyText.slice(errIdx, errIdx+100));
    else console.log('No "incorrect" error found on page');
  }

  await page.screenshot({ path: 'data/sessions/test3-result.png' });
  console.log('Screenshot saved');

  // Keep browser open for 10s to inspect manually
  await page.waitForTimeout(10000);
  await browser.close();
})().catch(e => console.error('Fatal:', e.message));

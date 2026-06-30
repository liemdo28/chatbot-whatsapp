const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();

  await page.goto('https://merchant-portal.doordash.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);
  console.log('1. URL:', page.url());

  // Fill email
  await page.fill('input[type="email"]', 'bakudanramen210@gmail.com');
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'data/sessions/step1-email.png' });
  console.log('2. Email filled');

  // Click Continue to Log In
  await page.click('button:has-text("Continue to Log In")');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'data/sessions/step2-after-continue.png' });
  console.log('3. After clicking Continue, URL:', page.url());

  // Check what inputs exist now
  const inputs = await page.evaluate(() =>
    Array.from(document.querySelectorAll('input')).map(e => ({ type: e.type, placeholder: e.placeholder }))
  );
  console.log('4. Inputs after Continue:', JSON.stringify(inputs));

  // Look for password
  const hasPassword = await page.$('input[type="password"]');
  if (hasPassword) {
    await page.fill('input[type="password"]', 'Rawsushi123');
    console.log('5. Password filled');
    await page.screenshot({ path: 'data/sessions/step3-password.png' });

    // Submit
    const btns = await page.evaluate(() =>
      Array.from(document.querySelectorAll('button')).map(e => e.textContent.trim().slice(0, 40))
    );
    console.log('6. Buttons before submit:', btns);

    // Try clicking submit
    await page.click('button[type="submit"], button:has-text("Log In"), button:has-text("Sign in"), button:has-text("Continue")');

    // Wait for navigation
    try {
      await page.waitForNavigation({ timeout: 8000 });
    } catch {}

    await page.waitForTimeout(3000);
    await page.screenshot({ path: 'data/sessions/step4-after-submit.png' });
    console.log('7. Final URL:', page.url());

    // Check for error messages
    const errorText = await page.evaluate(() => {
      const err = document.querySelector('[class*="error"], [class*="Error"], [role="alert"]');
      return err ? err.textContent.trim() : null;
    });
    console.log('8. Error on page:', errorText);
  } else {
    console.log('5. No password field found');
  }

  await browser.close();
})().catch(e => console.error('Fatal:', e.message));

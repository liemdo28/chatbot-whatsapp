const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();
  await page.goto('https://merchant-portal.doordash.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(4000);
  console.log('URL:', page.url());

  const inputs = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('input')).map(e => ({
      type: e.type, name: e.name, id: e.id, placeholder: e.placeholder,
      testid: e.getAttribute('data-testid'), class: e.className.slice(0, 60)
    }));
  });
  console.log('Inputs:', JSON.stringify(inputs, null, 2));

  const btns = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('button')).map(e => ({
      text: e.textContent.trim().slice(0, 40), type: e.type,
      testid: e.getAttribute('data-testid')
    }));
  });
  console.log('Buttons:', JSON.stringify(btns, null, 2));

  await page.screenshot({ path: 'data/sessions/inspect-login.png' });
  await browser.close();
})().catch(e => console.error('Error:', e.message));

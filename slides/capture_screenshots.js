const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, 'img');
const BASE = 'http://127.0.0.1:8899/';
const VENDOR = process.env.NODE_PATH || path.join(__dirname, '..', 'node_modules');
const CHART = fs.readFileSync(`${VENDOR}/chart.js/dist/chart.min.js`, 'utf8');
const LABELS = fs.readFileSync(`${VENDOR}/chartjs-plugin-datalabels/dist/chartjs-plugin-datalabels.min.js`, 'utf8');

const CROPS = [
  { tab: 'ai-devices',     sel: '#ai-devices-stats',  file: 'crop-ai-devices.png' },
  { tab: 'ai-devices',     sel: '#ai-timeline-chart', file: 'crop-ai-timeline.png' },
  { tab: 'fda-extraction', sel: '#fda-model-cards',   file: 'crop-models.png' },
];

(async () => {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1150 }, deviceScaleFactor: 2 });
  await ctx.route('**cdn.jsdelivr.net/**', r =>
    r.fulfill({ status: 200, contentType: 'application/javascript',
                body: r.request().url().includes('datalabels') ? LABELS : CHART }));
  await ctx.route('**fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await ctx.route('**fonts.gstatic.com/**', r => r.abort());
  await ctx.addInitScript(() => { try { sessionStorage.setItem('betaExtractionUnlocked', '1'); } catch (e) {} });

  const page = await ctx.newPage();
  for (const c of CROPS) {
    await page.goto(BASE + '#' + c.tab, { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(4000);
    await page.click(`.tab[data-tab="${c.tab}"]`, { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(6000);
    const el = page.locator(c.sel).first();
    await el.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(1200);
    await el.screenshot({ path: `${OUT}/${c.file}` });
    const box = await el.boundingBox();
    console.log(`${c.file.padEnd(24)} ${c.sel.padEnd(22)} ${box ? Math.round(box.width)+'x'+Math.round(box.height) : 'no box'}`);
  }
  await browser.close();
})();

const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, 'img');
const BASE = 'http://127.0.0.1:8899/';
const VENDOR = process.env.NODE_PATH || path.join(__dirname, '..', 'node_modules');
const CHART = fs.readFileSync(`${VENDOR}/chart.js/dist/chart.min.js`, 'utf8');
const LABELS = fs.readFileSync(`${VENDOR}/chartjs-plugin-datalabels/dist/chartjs-plugin-datalabels.min.js`, 'utf8');
// The Geography tab lazy-loads these three from d3js.org / jsdelivr.
const D3 = fs.readFileSync(`${VENDOR}/d3/dist/d3.min.js`, 'utf8');
const TOPOJSON = fs.readFileSync(`${VENDOR}/topojson-client/dist/topojson-client.min.js`, 'utf8');
const USATLAS = fs.readFileSync(`${VENDOR}/us-atlas/states-albers-10m.json`, 'utf8');

const CROPS = [
  // Demographic dimensions — what the clinical-trial work established.
  { tab: 'race',           sel: '#race-distribution-chart',      file: 'crop-race.png' },
  { tab: 'race',           sel: '#race-trends-chart',            file: 'crop-race-trend.png' },
  { tab: 'ethnicity',      sel: '#ethnicity-distribution-chart', file: 'crop-ethnicity.png' },
  { tab: 'sex',            sel: '#sex-distribution-chart',       file: 'crop-sex.png' },
  { tab: 'geography',      sel: '#us-map-row',                   file: 'crop-geography.png' },
  // The AI/ML device frontier, and the extraction pilot.
  { tab: 'ai-devices',     sel: '#ai-devices-stats',             file: 'crop-ai-devices.png' },
  { tab: 'ai-devices',     sel: '#ai-timeline-chart',            file: 'crop-ai-timeline.png' },
  { tab: 'fda-extraction', sel: '#fda-model-cards',              file: 'crop-models.png' },
];

(async () => {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  // Wide viewport: the Geography tab refuses to render below desktop width.
  const ctx = await browser.newContext({ viewport: { width: 1680, height: 1200 }, deviceScaleFactor: 2 });
  await ctx.route('**d3js.org/**', r =>
    r.fulfill({ status: 200, contentType: 'application/javascript', body: D3 }));
  await ctx.route('**cdn.jsdelivr.net/**', r => {
    const url = r.request().url();
    if (url.includes('us-atlas')) return r.fulfill({ status: 200, contentType: 'application/json', body: USATLAS });
    if (url.includes('topojson')) return r.fulfill({ status: 200, contentType: 'application/javascript', body: TOPOJSON });
    if (url.includes('datalabels')) return r.fulfill({ status: 200, contentType: 'application/javascript', body: LABELS });
    return r.fulfill({ status: 200, contentType: 'application/javascript', body: CHART });
  });
  await ctx.route('**fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await ctx.route('**fonts.gstatic.com/**', r => r.abort());
  await ctx.addInitScript(() => { try { sessionStorage.setItem('betaExtractionUnlocked', '1'); } catch (e) {} });

  const page = await ctx.newPage();
  for (const c of CROPS) {
    await page.goto(BASE + '#' + c.tab, { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(4000);
    await page.click(`.tab[data-tab="${c.tab}"]`, { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(7000);
    const el = page.locator(c.sel).first();
    await el.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(1200);
    await el.screenshot({ path: `${OUT}/${c.file}` });
    const box = await el.boundingBox();
    console.log(`${c.file.padEnd(24)} ${c.sel.padEnd(22)} ${box ? Math.round(box.width)+'x'+Math.round(box.height) : 'no box'}`);
  }
  await browser.close();
})();

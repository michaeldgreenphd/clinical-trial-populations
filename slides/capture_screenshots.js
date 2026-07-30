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
  { tab: 'race',      sel: '#race-distribution-chart',      file: 'crop-race.png',      annotate: true, allStudyTypes: true },
  { tab: 'race',      sel: '#race-trends-chart',            file: 'crop-race-trend.png',                 allStudyTypes: true },
  { tab: 'ethnicity', sel: '#ethnicity-distribution-chart', file: 'crop-ethnicity.png', annotate: true, allStudyTypes: true },
  { tab: 'sex',       sel: '#sex-distribution-chart',       file: 'crop-sex.png',       annotate: true, allStudyTypes: true },
  { tab: 'geography', sel: '#us-map-row',                   file: 'crop-geography.png',
    allStudyTypes: true, readChart: 'regional-diversity-chart' },
  // The AI/ML device frontier, and the extraction pilot.
  { tab: 'ai-devices',     sel: '#ai-devices-stats',             file: 'crop-ai-devices.png' },
  { tab: 'ai-devices',     sel: '#ai-timeline-chart',            file: 'crop-ai-timeline.png' },
  { tab: 'fda-extraction', sel: '#fda-model-cards',              file: 'crop-models.png' },
];

/**
 * Re-render a doughnut with its slices labelled in place.
 *
 * The dashboard attaches chartjs-plugin-datalabels per chart rather than
 * globally, and Chart.js caches the plugin list per instance — so enabling it
 * on a live chart does nothing. The chart is destroyed and rebuilt with the
 * same data instead. Slices under MIN_PCT are left unlabelled so the small
 * categories don't collide; the slide's footnote says so.
 */
function annotateDonut(sel) {
  const MIN_PCT = 3;
  const chart = Chart.getChart(sel.replace('#', ''));
  if (!chart) return 'no chart found';
  const canvas = chart.canvas;
  const data = chart.config.data;
  const options = chart.config.options || {};

  options.animation = false;
  options.radius = '40%';                       // leave room for outside labels
  options.layout = { padding: 6 };
  options.plugins = options.plugins || {};
  options.plugins.legend = { display: false };  // the labels replace the legend
  options.plugins.civicWatermark = false;       // illegible at slide scale
  options.plugins.datalabels = {
    display(ctx) {
      const d = ctx.dataset.data;
      const total = d.reduce((a, b) => a + Number(b), 0);
      return Number(d[ctx.dataIndex]) / total * 100 >= MIN_PCT;
    },
    formatter(value, ctx) {
      const d = ctx.dataset.data;
      const total = d.reduce((a, b) => a + Number(b), 0);
      const label = String(ctx.chart.data.labels[ctx.dataIndex])
        .replace('Black/African American', 'Black/African Am.')
        .replace('Not Hispanic/Latino', 'Not Hispanic')
        .replace('Native Hawaiian/Pacific Islander', 'Native Hawaiian/PI')
        .replace('American Indian/Alaska Native', 'Am. Indian/AK Native');
      return [label, (Number(value) / total * 100).toFixed(1) + '%'];
    },
    anchor: 'end',
    align: 'end',
    offset: 8,
    clamp: true,
    color: '#111827',
    textAlign: 'center',
    font: { size: 19, weight: '600', family: 'Arial, Helvetica, sans-serif', lineHeight: 1.15 },
  };

  chart.destroy();
  new Chart(canvas, { type: 'doughnut', data, options, plugins: [ChartDataLabels] });
  return 'annotated';
}

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

  const chartData = {};
  const page = await ctx.newPage();
  for (const c of CROPS) {
    await page.goto(BASE + '#' + c.tab, { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(4000);
    await page.click(`.tab[data-tab="${c.tab}"]`, { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(7000);
    // The dashboard defaults to the Interventional filter; the slide quotes the
    // all-study-types cohort (79,297 trials), so switch before capturing.
    if (c.allStudyTypes) {
      await page.evaluate(() => {
        const sel = document.getElementById('study-type');
        if (!sel) return;
        sel.value = 'all';
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await page.waitForTimeout(6000);
    }
    if (c.annotate) {
      const res = await page.evaluate(annotateDonut, c.sel);
      console.log(`   annotate ${c.sel}: ${res}`);
      await page.waitForTimeout(2500);
    }
    if (c.readChart) {
      chartData[c.readChart] = await page.evaluate((id) => {
        const ch = Chart.getChart(id);
        if (!ch) return null;
        const ds = ch.config.data.datasets[0].data.map(Number);
        const total = ds.reduce((a, b) => a + b, 0);
        return ch.config.data.labels.map((l, i) => ({
          label: String(l), value: ds[i], pct: +(ds[i] / total * 100).toFixed(1),
        })).sort((a, b) => b.value - a.value);
      }, c.readChart);
    }
    const el = page.locator(c.sel).first();
    await el.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(1200);
    await el.screenshot({ path: `${OUT}/${c.file}` });
    const box = await el.boundingBox();
    console.log(`${c.file.padEnd(24)} ${c.sel.padEnd(22)} ${box ? Math.round(box.width)+'x'+Math.round(box.height) : 'no box'}`);
  }
  fs.writeFileSync(path.join(OUT, 'chart-data.json'), JSON.stringify(chartData, null, 2));
  console.log('wrote chart-data.json for: ' + Object.keys(chartData).join(', '));
  await browser.close();
})();

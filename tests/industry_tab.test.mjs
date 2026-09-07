/**
 * Industry Sponsors tab wiring. The view used to be reachable only by typing
 * /#industry; it now has a button in the Tools nav group, and both entries
 * must stay behind the shared Beta password gate. These tests read the
 * markup and script statically — the served-page behaviour (prompt appears,
 * wrong password refused, right password renders) is checked by hand on a
 * served page, as AGENTS.md requires, and is not repeatable from node.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(repo, p), 'utf8');
const html = read('index.html');
const app = read('app.js');

test('the first Industry load restores shared parameters before rewriting the URL', () => {
  const loader = app.match(/async function loadIndustryView\(\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(loader, 'loadIndustryView() is missing');
  const apply = loader.indexOf('applyIndustryShareParams()');
  const update = loader.indexOf('updateIndustryShareUrl()');
  assert.ok(apply >= 0 && update > apply, 'shared parameters must be read before the hash is rewritten');
  // The sponsor menu lists the top 10 or every sponsor depending on scope, so
  // it has to be built after a shared scope=all is restored, not before.
  const menu = loader.indexOf('renderIndustrySponsorMenu()');
  assert.ok(menu > apply, 'the sponsor menu is built before shared parameters are applied, so a scope=all link lists only the top 10');
  assert.match(loader, /catch \(e\) \{\s*updateIndustryShareUrl\(\)/);
});

// The <details id="nav-tools"> block, from its opening tag to its closing tag.
function toolsGroup() {
  const m = html.match(/<details class="nav-group" id="nav-tools">[\s\S]*?<\/details>/);
  assert.ok(m, 'index.html has no <details class="nav-group" id="nav-tools"> group');
  return m[0];
}

test('the Industry Sponsors button sits inside the Tools nav group', () => {
  const group = toolsGroup();
  assert.match(group, /<button class="tab" data-tab="industry">Industry Sponsors<\/button>/,
    'the Tools group has no Industry Sponsors tab button — the view is only reachable by URL again');
  const all = [...html.matchAll(/data-tab="industry"/g)];
  assert.equal(all.length, 1, `expected exactly one data-tab="industry" button in the nav, found ${all.length}`);
  assert.match(html, /<section id="industry" class="tab-content">/,
    'the button points at #industry but there is no <section id="industry" class="tab-content">');
});

test('the Industry tab is in the Beta-gated set, so the tab button prompts for the password', () => {
  const m = app.match(/const BETA_GATED_TABS = new Set\(\[([^\]]*)\]\);/);
  assert.ok(m, 'initTabs() no longer declares BETA_GATED_TABS as a Set literal');
  const gated = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  assert.ok(gated.includes('industry'),
    `BETA_GATED_TABS is [${gated.join(', ')}] — 'industry' is missing, so the Tools button opens the view without the password`);
  for (const still of ['fda-extraction', 'lit-extraction', 'approval-queue']) {
    assert.ok(gated.includes(still), `BETA_GATED_TABS lost '${still}'`);
  }
});

test('both entries reach the same gate and the same loader', () => {
  // Tab click: initTabs() dispatches industry to loadIndustryView().
  assert.match(app, /if \(tab\.dataset\.tab === 'industry'\) \{\s*loadIndustryView\(\);/,
    'the tab click handler no longer dispatches industry to loadIndustryView(), so the tab shows an empty section');
  // Hash route: openIndustryView() still gates, then calls the same loader.
  const route = app.match(/async function openIndustryView\(\) \{[\s\S]*?\n\}/);
  assert.ok(route, 'openIndustryView() is gone; the /#industry route and the industry/ stub have nothing to land on');
  assert.match(route[0], /^\s*const granted = await promptForBetaAccess\(\);\s*\n\s*if \(!granted\)/m,
    'openIndustryView() no longer gates on promptForBetaAccess() — the /#industry deep link opens without the password');
  assert.match(route[0], /await loadIndustryView\(\)/, 'openIndustryView() no longer calls loadIndustryView()');
  assert.match(route[0], /querySelector\('\.tab\[data-tab="industry"\]'\)/,
    'openIndustryView() no longer marks the nav button active, so the Tools group does not light up on a deep link');
  // The gate itself still validates against the shared Beta password constant.
  assert.match(app, /const BETA_PASSWORD = '[^']+';/, 'BETA_PASSWORD constant is gone');
  assert.match(app, /validator: \(pw\) => pw === BETA_PASSWORD/,
    'promptForBetaAccess() no longer validates against BETA_PASSWORD');
});


test('Industry trend uses point shapes and keeps deviation hues out of its line palette', () => {
  const trend = app.match(/function renderIndustryTrend\(rows\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(trend);
  assert.match(trend, /pointStyle:/);
  assert.match(trend, /plugins: \[industryTrendEndLabels\]/,
    'the trend chart no longer registers the end-label plugin, so its lines lose their names');
  const palette = app.match(/const INDUSTRY_LINE_COLORS = \[[\s\S]*?\];/)?.[0];
  assert.ok(palette);
  for (const name of ['INDUSTRY_PINK', 'INDUSTRY_BLUE']) {
    const hex = app.match(new RegExp('const ' + name + " = '([^']+)'"))[1];
    assert.ok(!palette.toLowerCase().includes(hex.toLowerCase()), name + ' belongs to deviations');
  }
});

// The end labels replaced a right-hand legend, so they have to stay readable
// where sponsor medians converge. The plugin's job is that separation; these
// check the two guards that keep it honest, since neither is visible from a
// screenshot of the default ten-sponsor page.
test('Industry trend end labels are pushed apart and give up rather than overlap', () => {
  const plugin = app.match(/const industryTrendEndLabels = \{[\s\S]*?\n\};/)?.[0];
  assert.ok(plugin, 'the trend end-label plugin is gone');
  assert.match(plugin, /INDUSTRY_ENDLABEL_GAP/,
    'labels are drawn without enforcing a minimum spacing, so converging lines overstrike');
  assert.match(plugin, /items\.length \* INDUSTRY_ENDLABEL_GAP > room/,
    'the plugin no longer bails when the labels cannot fit, so a long sponsor page smears them together');
  // Bailing must not leave the lines unnamed: when the labels cannot fit, the
  // legend has to come back, decided from the room the chart actually has.
  assert.match(plugin, /beforeLayout\(chart, _args, opts\) \{[\s\S]*?legend\.display = !fits/,
    'the plugin no longer restores the legend when the labels do not fit, so a narrowed desktop window loses the series names');
  // Names in the page text colour, series colour on the marker only: several
  // line hues are under 4.5:1 against white at this size.
  assert.match(plugin, /ctx\.fillStyle = opts\.textColor/,
    'end labels are drawn in the series colour again, which fails contrast for the lighter hues');
  // A median outside the fixed Sex axis (above 80%) sits outside the plot;
  // its label has to start inside or it is drawn off the canvas, unnamed.
  assert.match(plugin, /Math\.min\(Math\.max\(it\.y, chartArea\.top\), chartArea\.bottom\)/,
    'end labels are no longer clamped into the plot, so an out-of-range median loses its name');
  // Reference lines are named in the footnote; labelling them too is what put
  // "All industry (pooled)" on top of "50% parity".
  assert.match(plugin, /if \(!ds\.industryEndLabel\) return;/,
    'every dataset gets an end label again, including the pooled and parity reference lines');
  const trend = app.match(/function renderIndustryTrend\(rows\) \{[\s\S]*?\n\}/)?.[0];
  const sponsorBlock = trend.match(/const datasets = sponsors\.map\([\s\S]*?\n    \}\);/)?.[0];
  assert.ok(sponsorBlock, 'the sponsor dataset block moved; check it still opts into end labels');
  assert.match(sponsorBlock, /industryEndLabel: true/, 'sponsor lines no longer opt into end labels');
  for (const ref of ['All industry (pooled)', 'Census share', '50% parity']) {
    const idx = trend.indexOf(ref);
    assert.ok(idx > 0, `the ${ref} dataset is gone`);
    const block = trend.slice(idx, idx + 400);
    assert.ok(!/industryEndLabel/.test(block), `${ref} opted into an end label; it belongs in the footnote`);
  }
});

// AGENTS.md: every rendered percentage names its denominator. The Sex tier's
// only always-visible statement of it is the subtitle, which exists twice:
// the markup's initial text and the string app.js swaps in on tier changes.
test('the Sex subtitle names the percent-female denominator, identically in markup and script', () => {
  const fromScript = app.match(/const INDUSTRY_SUBTITLES = \{[\s\S]*?sex: '([^']+)'/)?.[1];
  const fromMarkup = html.match(/<p class="note industry-subtitle" id="industry-subtitle">([^<]+)<\/p>/)?.[1];
  assert.ok(fromScript && fromMarkup, 'the Sex subtitle is missing from app.js or index.html');
  assert.match(fromScript, /female \/ \(female \+ male\)/,
    'the visible Sex subtitle no longer names the denominator; the FAQ alone is collapsed by default');
  assert.equal(fromMarkup, fromScript, 'the initial subtitle in index.html differs from the one app.js restores');
});

// An uncoloured (n) cell can sit above a user-set maximum as well as below
// the minimum, so the legend has to describe the window, not just "too few".
test('the heatmap legend describes uncoloured cells by the trials-per-cell window', () => {
  const heat = app.match(/function renderIndustryHeatmap\(rows\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(heat, 'renderIndustryHeatmap() is missing');
  assert.match(heat, /industry-legend-thin">\(n\)<\/span> \$\{rangeDesc\} \(n shown\)/,
    'the legend calls every uncoloured cell "too few trials", which is backwards for cells above a user-set maximum');
});

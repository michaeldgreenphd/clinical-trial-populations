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

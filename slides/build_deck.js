/**
 * Builds the two-slide Anthropic interim-progress deck.
 *
 *   node slides/build_deck.js
 *
 * Screenshots in slides/img/ are element-scoped captures of the live dashboard
 * (see slides/README.md for how to regenerate them). Every figure below is
 * traceable to a file in this repo — sources are noted per block.
 */
const pptx = require('pptxgenjs');
const path = require('path');

const IMG = path.join(__dirname, 'img');
const OUT = path.join(__dirname, 'anthropic-interim-progress.pptx');

// Forest palette — matches the Civic Sample dashboard's own identity.
const INK = '14382B';   // deep forest (dark slide background)
const FOREST = '2C5F2D';
const MOSS = '97BC62';
const PAPER = 'FFFFFF';
const MUTED = '6B7C71';
const CREAMTEXT = 'DCE8DC';
const FLAG = 'B85042';  // terracotta, for the things we want feedback on

const deck = new pptx();
deck.layout = 'LAYOUT_WIDE';        // 13.333 x 7.5
deck.author = 'Civic Sample';
deck.title = 'Civic Sample — interim progress & API credit usage';

/* ------------------------------------------------------------------ *
 * SLIDE 1 — Conclusions, and the method transferring to AI studies
 * ------------------------------------------------------------------ */
const s1 = deck.addSlide();
s1.background = { color: INK };

s1.addText('Same question, new frontier', {
  x: 0.6, y: 0.42, w: 9.5, h: 0.6,
  fontSize: 40, bold: true, color: PAPER, fontFace: 'Cambria', margin: 0,
});
s1.addText(
  'What we built for clinical trials is now pointed at the AI/ML devices already on the market',
  { x: 0.6, y: 1.06, w: 10.6, h: 0.4, fontSize: 15, italic: true, color: MOSS, fontFace: 'Calibri', margin: 0 }
);

// ---- Left column: the clinical-trial findings (established work) ----
s1.addShape(deck.ShapeType.roundRect, {
  x: 0.6, y: 1.7, w: 5.65, h: 4.3,
  fill: { color: '1B4635' }, rectRadius: 0.08,
  line: { color: '2E5C48', width: 1 },
});
s1.addText('WHAT WE FOUND — CLINICAL TRIALS', {
  x: 0.9, y: 1.92, w: 5.05, h: 0.3, fontSize: 11, bold: true,
  color: MOSS, charSpacing: 1.5, fontFace: 'Calibri', margin: 0,
});

// Source: data/dashboard-summary.json (snapshot 2026-07-26), all study types.
const trialStats = [
  ['79,297', 'trials with posted results, 2009–2026'],
  ['57.0%', 'report race · 39.1% ethnicity · 2.1% gender identity'],
  ['52.4%', 'of participants have no ethnicity recorded at all'],
  ['64.2%', 'of participants with known race are White'],
];
let ty = 2.34;
trialStats.forEach(([big, small]) => {
  s1.addText(big, {
    x: 0.9, y: ty, w: 1.5, h: 0.42, fontSize: 25, bold: true,
    color: PAPER, fontFace: 'Cambria', margin: 0, valign: 'middle',
  });
  s1.addText(small, {
    x: 2.45, y: ty, w: 3.5, h: 0.42, fontSize: 11.5,
    color: CREAMTEXT, fontFace: 'Calibri', margin: 0, valign: 'middle',
  });
  ty += 0.62;
});

s1.addText(
  [{ text: 'Reporting is improving, slowly. ', options: { bold: true, color: PAPER } },
   { text: 'Race reporting rose from 35.6% of trials in 2009 to 81.6% in 2025 — but gender identity has never cleared 3%, and the ethnicity gap has barely moved.',
     options: { color: CREAMTEXT } }],
  { x: 0.9, y: 4.66, w: 5.05, h: 1.1, fontSize: 12, fontFace: 'Calibri', margin: 0, lineSpacing: 17 }
);

// ---- Right column: the AI/ML device frontier ----
s1.addShape(deck.ShapeType.roundRect, {
  x: 7.1, y: 1.7, w: 5.65, h: 4.3,
  fill: { color: '1B4635' }, rectRadius: 0.08,
  line: { color: '2E5C48', width: 1 },
});
s1.addText('WHERE IT GOES NEXT — AI/ML DEVICES', {
  x: 7.4, y: 1.92, w: 5.05, h: 0.3, fontSize: 11, bold: true,
  color: MOSS, charSpacing: 1.5, fontFace: 'Calibri', margin: 0,
});

// Source: ai-ml-enabled-devices-csv_20260305.csv, rendered live on the AI Devices tab.
s1.addImage({ path: path.join(IMG, 'crop-ai-devices.png'), x: 7.4, y: 2.3, w: 5.05, h: 0.97 });

s1.addText(
  [{ text: '96.2% arrive by the 510(k) predicate route', options: { bold: true, color: PAPER, breakLine: true } },
   { text: 'Substantial equivalence to a device already on the market — no new clinical evidence required. Only 18 of 1,451 (1.2%) went through full PMA review.',
     options: { color: CREAMTEXT, breakLine: true } },
   { text: '\n' , options: { color: CREAMTEXT, breakLine: true } },
   { text: 'The FDA publishes no demographics for these validation studies.', options: { bold: true, color: PAPER, breakLine: true } },
   { text: 'So we have Claude read each device’s public 510(k)/De Novo/PMA summary PDF and its open-access manuscripts, and reconstruct who was actually in the validation cohort — evidence quote first, then the value.',
     options: { color: CREAMTEXT } }],
  { x: 7.4, y: 3.45, w: 5.05, h: 2.3, fontSize: 12, fontFace: 'Calibri', margin: 0, lineSpacing: 17 }
);

// ---- Transfer arrow, sitting in the gutter between the two panels ----
s1.addShape(deck.ShapeType.rightArrow, {
  x: 6.42, y: 3.62, w: 0.51, h: 0.44,
  fill: { color: MOSS }, line: { color: MOSS, width: 0 },
});

s1.addText('Sources: dashboard-summary.json (2026-07-26 snapshot) · FDA AI/ML-Enabled Device List (2026-03-05) · screenshot: civicsample.com AI Devices tab', {
  x: 0.6, y: 6.62, w: 12.15, h: 0.3, fontSize: 9, color: '7E9A88', fontFace: 'Calibri', margin: 0,
});

s1.addNotes(
  'Slide 1 shell. Left panel is the established clinical-trials finding; right panel is the same method pointed at FDA-authorized AI/ML devices. ' +
  'The transfer argument: registry reporting is measurable and improving because FDAAA forced it. AI/ML devices have no equivalent disclosure regime, ' +
  '96% clear via predicate equivalence, and nobody publishes who was in the validation cohorts. That gap is what the Claude extraction pipeline fills. ' +
  'Trial figures are all study types from the 2026-07-26 snapshot; note the live dashboard defaults to the Interventional filter, which shows 74,617.'
);

/* ------------------------------------------------------------------ *
 * SLIDE 2 — API credit usage and where we want feedback
 * ------------------------------------------------------------------ */
const s2 = deck.addSlide();
s2.background = { color: PAPER };

s2.addText('How we’ve used the API credits', {
  x: 0.6, y: 0.42, w: 8.5, h: 0.55,
  fontSize: 38, bold: true, color: INK, fontFace: 'Cambria', margin: 0,
});
s2.addText('Pilot runs to date — and the four things we’d like your read on', {
  x: 0.6, y: 1.0, w: 9.0, h: 0.35, fontSize: 15, italic: true, color: FOREST, fontFace: 'Calibri', margin: 0,
});

// ---- Stat row. Source: data/*_token_metrics.json ----
const usage = [
  ['2.63M', 'tokens processed', '2.41M in · 220K out'],
  ['36', 'documents', 'across 373 PDF pages'],
  ['$11.11', 'spent to date', 'at current list rates'],
  ['3×', 'models per document', 'Haiku · Sonnet · Opus'],
];
usage.forEach(([big, lab, sub], i) => {
  const x = 0.6 + i * 3.11;
  s2.addShape(deck.ShapeType.roundRect, {
    x, y: 1.55, w: 2.88, h: 1.15,
    fill: { color: 'F2F6F1' }, rectRadius: 0.06, line: { color: 'DCE6DA', width: 1 },
  });
  s2.addText(big, { x: x + 0.2, y: 1.66, w: 2.5, h: 0.45, fontSize: 27, bold: true, color: FOREST, fontFace: 'Cambria', margin: 0 });
  s2.addText(lab, { x: x + 0.2, y: 2.11, w: 2.5, h: 0.24, fontSize: 12, bold: true, color: INK, fontFace: 'Calibri', margin: 0 });
  s2.addText(sub, { x: x + 0.2, y: 2.34, w: 2.5, h: 0.24, fontSize: 10, color: MUTED, fontFace: 'Calibri', margin: 0 });
});

// ---- Left: what a run costs, screenshot of the live comparison ----
s2.addText('WHAT A FULL-SCALE RUN WOULD COST', {
  x: 0.6, y: 2.98, w: 6.2, h: 0.25, fontSize: 11, bold: true, color: FOREST, charSpacing: 1.5, fontFace: 'Calibri', margin: 0,
});
s2.addImage({ path: path.join(IMG, 'crop-models.png'), x: 0.6, y: 3.3, w: 6.2, h: 1.61 });
s2.addText(
  [{ text: 'All three models over every document: ', options: { bold: true, color: INK } },
   { text: '~$44K. Sonnet alone with the Batch API: ~$6.2K. ', options: { color: INK } },
   { text: 'The projections shown on the dashboard price Opus at $15/$75 per 1M — the current rate is $5/$25, so our own estimates are ~3× high.',
     options: { color: FLAG, bold: true } }],
  { x: 0.6, y: 5.02, w: 6.2, h: 0.95, fontSize: 11, fontFace: 'Calibri', margin: 0, lineSpacing: 15 }
);

// ---- Right: the questions ----
s2.addShape(deck.ShapeType.roundRect, {
  x: 7.15, y: 2.98, w: 5.6, h: 3.35,
  fill: { color: 'F7F3F1' }, rectRadius: 0.08, line: { color: 'E4D3CE', width: 1 },
});
s2.addText('WHERE WE’D WANT YOUR FEEDBACK', {
  x: 7.45, y: 3.16, w: 5.0, h: 0.25, fontSize: 11, bold: true, color: FLAG, charSpacing: 1.5, fontFace: 'Calibri', margin: 0,
});

const asks = [
  ['Is 3-model agreement the right reliability signal?',
   'We run every doc through Haiku, Sonnet and Opus and compare. It triples cost. Would one model plus a verification pass buy more?'],
  ['We aren’t using prompt caching.',
   'The system prompt and evidence-first tool schema are identical on every call and re-billed each time.'],
  ['We aren’t using the Batch API.',
   'These runs are offline and nightly — nothing is latency-sensitive. That looks like 50% left on the table.'],
  ['Haiku leaked tool-call markup into 4 extracted values.',
   'Sonnet and Opus: zero. Is our paired evidence/value schema too deep for Haiku, or is that a prompt fix?'],
];
let ay = 3.5;
asks.forEach(([q, sub], i) => {
  s2.addText(`${i + 1}`, {
    x: 7.45, y: ay, w: 0.3, h: 0.24, fontSize: 13, bold: true, color: FLAG, fontFace: 'Cambria', margin: 0,
  });
  s2.addText(q, { x: 7.8, y: ay, w: 4.7, h: 0.24, fontSize: 12, bold: true, color: INK, fontFace: 'Calibri', margin: 0 });
  s2.addText(sub, { x: 7.8, y: ay + 0.245, w: 4.7, h: 0.42, fontSize: 10, color: MUTED, fontFace: 'Calibri', margin: 0, lineSpacing: 13 });
  ay += 0.72;
});

s2.addText('Token and cost figures: data/fda_token_metrics.json, lit_token_metrics.json, trials_lit_token_metrics.json · rates per Anthropic list pricing, June 2026', {
  x: 0.6, y: 6.62, w: 12.15, h: 0.3, fontSize: 9, color: MUTED, fontFace: 'Calibri', margin: 0,
});

s2.addNotes(
  'Slide 2 shell. Spend to date is real: $11.11 across three pilot batches. The $44K vs $6.2K contrast is the decision we want help with. ' +
  'Note the rate-card bug candidly — data/*_token_metrics.json hardcodes Opus at $15/$75 while scripts/utils/cost_tracker.py has $5/$25, ' +
  'so the dashboard projection and the logged cost disagree. Fixing that is on us; the four questions are what we want the room to answer.'
);

deck.writeFile({ fileName: OUT }).then(() => console.log('wrote ' + OUT));

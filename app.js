// ClinicalTrials.gov Demographics Dashboard - Enhanced Version

let data = null;
let detailCache = {};  // Lazy-loaded study detail data keyed by nct_id
let detailsLoaded = false;  // Whether detail files have been fetched
let charts = {};
let currentSort = { field: null, direction: 'asc' };
let currentPage = 0;
let studiesPageSize = 15;   // rows per page (15 default, selectable 25/50)

// ── Mobile / low-memory detection ──
// Mobile browsers struggle with the full 136 MB dataset (780 MB uncompressed).
// When detected, load a pre-computed 15 KB summary instead of 77K study records.
const isMobileDevice = (() => {
    const ua = navigator.userAgent || '';
    const isMobileUA = /Android|iPhone|iPad|iPod|Mobile|webOS/i.test(ua);
    const isSmallScreen = window.innerWidth <= 768;
    // deviceMemory is a Chrome-only API (GB); treat ≤4 GB as constrained
    const isLowMemory = navigator.deviceMemory != null && navigator.deviceMemory <= 4;
    return isMobileUA || isSmallScreen || isLowMemory;
})();
// Pre-computed dashboard summary for mobile (set after loading)
let dashboardSummary = null;

// Chart legends sit to the right of the plot on desktop. On narrow phone
// screens that side column doesn't fit and Chart.js clips the labels at the
// canvas edge instead of wrapping them, so legends go below the chart there —
// bottom legends flow items into as many rows as needed. The long
// "% of Total Enrollment" axis title has the same problem (taller than the
// mobile plot area), so it gets a compact variant.
const CHART_LEGEND_POSITION = isMobileDevice ? 'bottom' : 'right';
const ENROLLMENT_AXIS_TITLE = isMobileDevice ? '% Enrollment' : '% of Total Enrollment';
// Square charts on mobile: the default 2:1 canvas leaves too little plot
// height once a bottom legend and rotated year labels take their share.
// undefined on desktop = Chart.js keeps its per-type default.
const CHART_ASPECT_RATIO = isMobileDevice ? 1 : undefined;

// ── Snapshot cache: avoids re-downloading previously loaded snapshots ──
const snapshotCache = new Map(); // key: date string ('latest' | 'YYYY-MM-DD'), value: { data, dateLabel }

// ── Toast notifications ──
function showToast(message, type = 'error', durationMs = 5000) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    const icon = type === 'error' ? '⚠' : '✓';
    toast.innerHTML = `<span class="toast-icon">${icon}</span><span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => {
        toast.classList.add('removing');
        toast.addEventListener('animationend', () => toast.remove());
    }, durationMs);
}

// ── Snapshot switching overlay ──
function showSnapshotLoading(label) {
    let overlay = document.getElementById('snapshot-loading');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'snapshot-loading';
        overlay.className = 'snapshot-loading-overlay';
        overlay.innerHTML = '<div class="loading-spinner"></div><p>Loading snapshot…</p>';
        document.body.appendChild(overlay);
    }
    overlay.querySelector('p').textContent = label || 'Loading snapshot…';
    overlay.style.display = 'flex';
}

function hideSnapshotLoading() {
    const overlay = document.getElementById('snapshot-loading');
    if (overlay) overlay.style.display = 'none';
}

// Historical snapshots are served from the snapshots/ directory on GitHub Pages (same origin)

// Colors for charts
// ── Chart colour tokens ───────────────────────────────────────────────────
// One palette for every chart, replacing the three that had drifted apart
// (Tailwind defaults on Overview/Race, a pink/blue pair on Sex/Gender, a
// custom trio on FDA Oversight). Validated for CVD separation, chroma and
// contrast against the card surface rather than picked by eye; the previous
// FDA trio failed — #C26C8E vs #4A7BA6 separated by only ΔE 4.4 under
// protanopia, and two of the three read grey at mark size.
//
// Assigned by ENTITY, in this fixed order, so a filter that drops a series
// never repaints the survivors. The brand green #1b4332 stays on chrome:
// as a chart mark it falls under the chroma floor and reads dark grey, so
// data gets its chart-grade sibling --c1 instead.
const CHART_COLORS = {
    c1: '#0F7A4F',   // green — same hue family as the brand, chart-grade chroma
    c2: '#C2477E',   // rose
    c3: '#2E6FB7',   // blue
    c4: '#C77A0A',   // amber
    c5: '#7A4FCF',   // violet
    // Absence, not a series. Deliberately below the chroma floor: "not
    // reported" should read as grey and never compete with a real category.
    notReported: '#8A968F'
};

// Race has seven categories plus "unknown", more than any categorical palette
// can separate safely (an eight-hue set fails the normal-vision floor, never
// mind CVD). So the race compositions use one hue as a ramp: a step per
// category, assigned by FIXED category — not by rank — so the donut and the
// stacked distribution bar always agree and no filter repaints a category.
// Steps run dark to light in typical-share order, which keeps the sorted
// donut close to monotonic without the colour depending on the data.
// Identity comes from the direct labels on the arcs, never from the hue.
//
// The light end stops at 2:1 against the white card rather than running to
// near-white: the palest step carries Native Hawaiian/Pacific Islander at
// 0.4%, and a near-white sliver with a white border between arcs is simply
// invisible. (The 3:1 mark-contrast rule is a categorical-palette rule; a
// sequential ramp is judged on lightness monotonicity, which this holds —
// luminance 0.06 to 0.47, every step at least 1.25x the one before.)
const RACE_RAMP = ['#0B5137', '#156944', '#1F7E55', '#2E9268', '#43A57D', '#5BB694', '#77C6AA'];

const COLORS = {
    // Composition of participants by race: ramp steps, one per category.
    race: {
        white: RACE_RAMP[0],
        black_african_american: RACE_RAMP[1],
        asian: RACE_RAMP[2],
        other: RACE_RAMP[3],
        more_than_one_race: RACE_RAMP[4],
        american_indian_alaska_native: RACE_RAMP[5],
        native_hawaiian_pacific_islander: RACE_RAMP[6],
        unknown_not_reported: CHART_COLORS.notReported
    },
    // Three race series tracked over time is a different job from a
    // composition: these are identities on a line chart, so they take
    // distinct hues. They are not meant to match the ramp above.
    raceTrend: {
        white: CHART_COLORS.c5,
        black_african_american: CHART_COLORS.c2,
        asian: CHART_COLORS.c4
    },
    ethnicity: {
        hispanic_latino: CHART_COLORS.c4,
        not_hispanic_latino: CHART_COLORS.c3,
        unknown_not_reported: CHART_COLORS.notReported
    },
    sex: {
        female: CHART_COLORS.c2,
        male: CHART_COLORS.c3,
        unknown: CHART_COLORS.notReported
    },
    gender: {
        // woman/man keep sex's hues so the two tabs agree
        woman: CHART_COLORS.c2,
        man: CHART_COLORS.c3,
        // amber before green before violet: violet adjacent to Man's blue
        // failed both the CVD and normal-vision separation floors
        nonbinary: CHART_COLORS.c4,
        transgender: CHART_COLORS.c1,
        other: CHART_COLORS.c5,
        unknown: CHART_COLORS.notReported
    },
    // Reporting-trend series (Race / Ethnicity / Both), shared by the
    // Overview trend line and the FDA regulatory-status bars.
    reporting: {
        race: CHART_COLORS.c1,
        ethnicity: CHART_COLORS.c4,
        both: CHART_COLORS.c3
    }
};

// AI Study identification keywords (case-insensitive matching)
const AI_KEYWORDS = [
    'artificial intelligence', 'machine learning', 'deep learning',
    'neural network', 'large language model', 'llm',
    'natural language processing', 'computer vision',
    'reinforcement learning', 'generative ai', 'chatbot',
    'predictive algorithm', 'clinical decision support algorithm',
    'algorithm-based', 'algorithm-driven', 'ai-based', 'ai-driven',
    'ai-powered', 'ml-based', 'ml-driven'
];

// Precompiled regex for AI keyword matching (word-boundary-aware)
const AI_REGEX = new RegExp(
    AI_KEYWORDS.map(k => '\\b' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b').join('|'),
    'i'
);

/**
 * Determine whether a study is AI-related by searching its text fields
 * for known AI/ML keywords.  The result is memoized on the study object.
 */
function isAIStudy(study) {
    if (study._isAI !== undefined) return study._isAI;
    const text = [
        study.brief_title,
        study.primary_endpoint,
        study.conditions?.join?.(' '),
        study.primary_condition,
        study.secondary_condition
    ].filter(Boolean).join(' ');
    study._isAI = AI_REGEX.test(text);
    return study._isAI;
}

// Update loading progress bar
function updateLoadingProgress(percent, statusText) {
    const bar = document.getElementById('loading-progress-bar');
    const status = document.getElementById('loading-status');
    if (bar) bar.style.width = percent + '%';
    if (status) status.textContent = statusText || '';
}

// Hide loading overlay after initial render is complete
function hideLoadingOverlay() {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) {
        overlay.classList.add('fade-out');
        // Remove from DOM after animation completes
        setTimeout(() => {
            overlay.remove();
        }, 400);
    }
}

// ---------------------------------------------------------------------------
// Hierarchical Condition Ontology
// Primary Category -> Secondary Category -> keywords[]
// Loaded from condition_ontology.json at build time; embedded here for the
// GitHub-Pages frontend so no extra fetch is needed.
// ---------------------------------------------------------------------------
let CONDITION_ONTOLOGY = null;   // { primary: { secondary: [keywords] } }
let _conditionKeywordIndex = []; // [{keyword, primary, secondary}] sorted longest-first

async function loadConditionOntology() {
    try {
        const resp = await fetch('condition_ontology.json');
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const json = await resp.json();
        CONDITION_ONTOLOGY = json.categories;
    } catch (e) {
        console.warn('Could not load condition_ontology.json, using inline fallback', e);
        CONDITION_ONTOLOGY = _INLINE_ONTOLOGY;
    }
    _buildKeywordIndex();
}

function _buildKeywordIndex() {
    _conditionKeywordIndex = [];
    for (const [primary, secondaries] of Object.entries(CONDITION_ONTOLOGY)) {
        for (const [secondary, keywords] of Object.entries(secondaries)) {
            for (const kw of keywords) {
                _conditionKeywordIndex.push({ keyword: kw.toLowerCase(), primary, secondary });
            }
        }
    }
    // Sort longest-first so "heart failure" matches before "heart"
    _conditionKeywordIndex.sort((a, b) => b.keyword.length - a.keyword.length);
}

// Minimal inline fallback in case the JSON fails to load
const _INLINE_ONTOLOGY = {
    "Cardiovascular": { "Other Cardiovascular": ["heart", "cardiac", "cardiovascular", "coronary", "hypertension", "myocardial", "ventricular"] },
    "Oncology": { "Other Oncology": ["cancer", "carcinoma", "tumor", "tumour", "neoplasm", "malignant", "leukemia", "lymphoma", "melanoma", "sarcoma", "myeloma", "metastatic"] },
    "Neurology": { "Other Neurological": ["neurological", "parkinson", "epilepsy", "multiple sclerosis", "alzheimer", "dementia", "migraine", "stroke", "neuropathy"] },
    "Respiratory": { "Other Respiratory": ["copd", "asthma", "pulmonary", "respiratory", "lung", "pneumonia"] },
    "Mental Health": { "Other Mental Health": ["depression", "anxiety", "bipolar", "schizophrenia", "psychiatric", "ptsd", "mental health"] },
    "Endocrine and Metabolic": { "Diabetes (General)": ["diabetes", "diabetic", "insulin", "glycemic", "obesity"] },
    "Infectious Disease": { "Other Infectious": ["hiv", "hepatitis", "tuberculosis", "covid", "coronavirus", "infection", "sepsis", "malaria"] },
    "Autoimmune and Inflammatory": { "Other Autoimmune": ["autoimmune", "lupus", "rheumatoid", "crohn", "colitis", "psoriasis", "celiac"] },
    "Gastrointestinal": { "Other Gastrointestinal": ["gastrointestinal", "liver", "cirrhosis", "hepatic", "gastric", "ibd", "gerd"] },
    "Kidney and Urological": { "Other Kidney": ["kidney", "renal", "nephropathy", "dialysis", "ckd"] },
    "Musculoskeletal": { "Other Musculoskeletal": ["arthritis", "osteoarthritis", "osteoporosis", "musculoskeletal", "fibromyalgia", "fracture", "bone", "joint"] },
    "Dermatology": { "Other Dermatology": ["dermatitis", "eczema", "psoriasis", "acne", "skin", "wound"] },
    "Substance Use Disorders": { "Other Substance Use": ["substance abuse", "addiction", "alcohol", "opioid", "smoking", "tobacco", "nicotine"] },
    "Hematology": { "Other Hematology": ["anemia", "sickle cell", "hemophilia", "thrombosis", "blood disorder"] },
    "Ophthalmology": { "Other Ophthalmology": ["macular degeneration", "glaucoma", "retinal", "cataract", "eye", "ocular"] },
    "Reproductive and Sexual Health": { "Other Reproductive": ["infertility", "pregnancy", "menopause", "endometriosis", "contraception"] },
    "Transplant and Immunology": { "Other Immunology": ["transplant", "graft", "immunosuppression", "allergy"] },
    "Rare Diseases": { "Other Rare Diseases": ["cystic fibrosis", "huntington", "amyloidosis", "rare disease"] },
    "Pain": { "Other Pain": ["chronic pain", "neuropathic pain", "pain management", "pain"] }
};

/**
 * Classify a single condition string into {primary, secondary}.
 * Uses the Python-side classification if available, else JS keyword match.
 */
function classifyCondition(condition) {
    if (!condition) return { primary: 'Other', secondary: 'Uncategorized' };
    const lower = condition.toLowerCase();
    for (const entry of _conditionKeywordIndex) {
        if (lower.includes(entry.keyword)) {
            return { primary: entry.primary, secondary: entry.secondary };
        }
    }
    return { primary: 'Other', secondary: 'Uncategorized' };
}

/**
 * Get the primary + secondary classification for a study.
 * Prefers pre-computed fields from the Python pipeline; falls back to JS-side
 * keyword classification of the raw conditions array.
 */
function getStudyClassification(study) {
    // If the Python pipeline already classified this study, use those values
    if (study.primary_condition && study.primary_condition !== 'Other') {
        return { primary: study.primary_condition, secondary: study.secondary_condition || 'Uncategorized' };
    }

    // Fall back to JS-side classification
    const conditions = study.conditions || [];
    if (conditions.length === 0) return { primary: 'Other', secondary: 'Uncategorized' };

    // Pick the most common primary across all conditions (same logic as Python)
    const primaryCounts = {};
    const primaryToSecondary = {};
    for (const cond of conditions) {
        const { primary, secondary } = classifyCondition(cond);
        primaryCounts[primary] = (primaryCounts[primary] || 0) + 1;
        if (!primaryToSecondary[primary]) primaryToSecondary[primary] = secondary;
    }
    let bestPrimary = 'Other';
    let bestCount = 0;
    for (const [p, count] of Object.entries(primaryCounts)) {
        if (count > bestCount || (count === bestCount && p < bestPrimary)) {
            bestPrimary = p;
            bestCount = count;
        }
    }
    return { primary: bestPrimary, secondary: primaryToSecondary[bestPrimary] || 'Uncategorized' };
}

/**
 * Check if a study matches the selected primary and/or secondary category.
 * A study matches if ANY of its conditions map to the selected categories.
 */
function studyMatchesConditionFilter(study, primaryFilter, secondaryFilter) {
    if (primaryFilter === 'all' && secondaryFilter === 'all') return true;

    const conditions = study.conditions || [];

    // Use all_classifications from Python if available
    let classifications = study.condition_classifications;
    if (!classifications || classifications.length === 0) {
        // Fallback: classify in JS
        classifications = conditions.map(c => {
            const cls = classifyCondition(c);
            return { primary: cls.primary, secondary: cls.secondary };
        });
        if (classifications.length === 0) {
            // Study has no conditions — only matches "Other"
            return primaryFilter === 'Other' || primaryFilter === 'all';
        }
    }

    for (const cls of classifications) {
        const priMatch = primaryFilter === 'all' || cls.primary === primaryFilter;
        const secMatch = secondaryFilter === 'all' || cls.secondary === secondaryFilter;
        if (priMatch && secMatch) return true;
    }
    return false;
}

/**
 * Populate the primary condition dropdown from the ontology.
 */
function populatePrimaryConditionDropdown() {
    const select = document.getElementById('condition-primary');
    if (!select || !CONDITION_ONTOLOGY) return;

    // Preserve current selection
    const current = select.value;

    // Clear existing options except "All"
    select.innerHTML = '<option value="all">All Categories</option>';

    const primaries = Object.keys(CONDITION_ONTOLOGY).sort();
    primaries.push('Other'); // Always include "Other" at the end

    for (const primary of primaries) {
        const opt = document.createElement('option');
        opt.value = primary;
        opt.textContent = primary;
        select.appendChild(opt);
    }

    // Restore selection if still valid
    if (current && select.querySelector(`option[value="${CSS.escape(current)}"]`)) {
        select.value = current;
    }
}

/**
 * Populate the secondary condition dropdown based on the selected primary.
 */
function populateSecondaryConditionDropdown(selectedPrimary) {
    const select = document.getElementById('condition-secondary');
    if (!select) return;

    select.innerHTML = '<option value="all">All Subcategories</option>';

    if (!selectedPrimary || selectedPrimary === 'all' || !CONDITION_ONTOLOGY) {
        select.disabled = true;
        return;
    }

    const secondaries = CONDITION_ONTOLOGY[selectedPrimary];
    if (!secondaries) {
        select.disabled = true;
        return;
    }

    select.disabled = false;
    const keys = Object.keys(secondaries).sort();
    for (const sec of keys) {
        const opt = document.createElement('option');
        opt.value = sec;
        opt.textContent = sec;
        select.appendChild(opt);
    }
}

// ---------------------------------------------------------------------------
// Pediatric status helper — works with pre-computed field or falls back to
// std_ages / min_age / max_age from the raw data.
// ---------------------------------------------------------------------------
function getStudyPediatricStatus(study) {
    if (study.pediatric_status) return study.pediatric_status;

    const stdAges = study.std_ages || [];
    if (stdAges.length > 0) {
        const hasChild = stdAges.includes('CHILD');
        const hasAdult = stdAges.includes('ADULT') || stdAges.includes('OLDER_ADULT');
        if (hasChild && !hasAdult) return 'Pediatric Only';
        if (hasChild && hasAdult) return 'Pediatric Included';
        if (!hasChild) return 'Adult Only';
    }

    // Last-resort fallback: parse min_age / max_age strings
    const parseAgeYears = (ageStr) => {
        if (!ageStr || ageStr === 'N/A') return null;
        const match = ageStr.match(/(\d+)/);
        if (!match) return null;
        const num = parseInt(match[1], 10);
        const lower = ageStr.toLowerCase();
        if (lower.includes('month')) return num / 12;
        if (lower.includes('week')) return num / 52;
        if (lower.includes('day')) return num / 365;
        return num; // assume years
    };

    const minYears = parseAgeYears(study.min_age);
    const maxYears = parseAgeYears(study.max_age);

    if (minYears === null && maxYears === null) return 'Not Specified';
    if (maxYears !== null && maxYears < 18) return 'Pediatric Only';
    if (minYears !== null && minYears >= 18) return 'Adult Only';
    if ((minYears !== null && minYears < 18) || (maxYears !== null && maxYears >= 18)) return 'Pediatric Included';

    return 'Not Specified';
}

// ── Chart plugins: provenance watermark + event annotations ────────────────
// Watermark: every canvas carries "civicsample.com · data YYYY-MM-DD" in a
// reserved strip under the plot, so screenshots keep their provenance.
const civicWatermarkPlugin = {
    id: 'civicWatermark',
    // Bottom padding for the strip is reserved globally via
    // Chart.defaults.layout.padding at bootstrap — per-chart option
    // mutation here would tangle Chart.js's proxy-backed config.
    afterDraw(chart) {
        const ctx = chart.ctx;
        ctx.save();
        ctx.font = "9px 'DM Mono', ui-monospace, monospace";
        ctx.fillStyle = 'rgba(108, 117, 125, 0.55)';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'bottom';
        ctx.fillText('civicsample.com' + (window.__dataExtractedAt ? ' · data ' + window.__dataExtractedAt : ''),
            chart.width - 6, chart.height - 3);
        ctx.restore();
    }
};

// A hairline between the lowest and highest value on each row of the FDA
// dot plot. The length of that connector IS the finding — short where a
// regulator is watching, long where nobody is — so it is drawn as data,
// behind the points, rather than left for the reader to measure by eye.
const fdaRowConnectorPlugin = {
    id: 'fdaRowConnector',
    beforeDatasetsDraw(chart) {
        const { ctx, scales } = chart;
        if (!scales || !scales.y || chart.canvas.id !== 'fda-reporting-chart') return;
        const points = {};
        chart.data.datasets.forEach((ds, di) => {
            const meta = chart.getDatasetMeta(di);
            if (meta.hidden) return;
            meta.data.forEach((pt, pi) => {
                const key = ds.data[pi] && ds.data[pi].y;
                if (key == null) return;
                (points[key] = points[key] || []).push(pt);
            });
        });
        ctx.save();
        ctx.strokeStyle = 'rgba(27, 67, 50, 0.22)';
        ctx.lineWidth = 2;
        Object.values(points).forEach(pts => {
            if (pts.length < 2) return;
            const xs = pts.map(p => p.x);
            ctx.beginPath();
            ctx.moveTo(Math.min(...xs), pts[0].y);
            ctx.lineTo(Math.max(...xs), pts[0].y);
            ctx.stroke();
        });
        ctx.restore();
    }
};

// ── Composition donuts: the number goes on the chart ──────────────────────
// Every donut used to hide its headline behind a hover tooltip and identify
// its categories with a colour key alone. These two pieces put the value on
// the arc and the finding in the hole, so the chart states its own result.
//
// The centre carries the largest slice — including "not reported" when that
// is the largest, because on some tabs the absence IS the finding.
const donutCentreFindingPlugin = {
    id: 'donutCentreFinding',
    afterDatasetsDraw(chart) {
        const f = chart.options.plugins && chart.options.plugins.donutCentreFinding;
        if (!f || !f.value) return;
        const meta = chart.getDatasetMeta(0);
        if (!meta || !meta.data || !meta.data.length) return;
        const arc = meta.data[0];
        const { x, y } = arc.tooltipPosition ? arc.tooltipPosition() : arc;
        // The hole's diameter caps how much text can sit inside it.
        const hole = (arc.innerRadius || 0) * 2;
        if (hole < 54) return;                       // too small to read: skip
        const big = Math.max(15, Math.min(30, Math.round(hole * 0.30)));
        const small = Math.max(9, Math.round(big * 0.42));
        const ctx = chart.ctx;
        ctx.save();
        ctx.textAlign = 'center';
        const cx = arc.x !== undefined ? arc.x : x;
        const cy = arc.y !== undefined ? arc.y : y;
        ctx.textBaseline = 'alphabetic';
        ctx.font = `700 ${big}px ${Chart.defaults.font.family}`;
        ctx.fillStyle = '#212529';
        ctx.fillText(f.value, cx, cy + big * 0.1);
        ctx.font = `500 ${small}px ${Chart.defaults.font.family}`;
        ctx.fillStyle = '#6c757d';
        ctx.fillText(f.label, cx, cy + big * 0.1 + small * 1.35);
        ctx.restore();
    }
};

// Arcs at or above this share are labelled in place; the rest keep their
// slice and appear in the legend below, which carries nothing else.
const DONUT_LABEL_MIN_PCT = 3;

// In the hole the text is read as a finding, so absence is spelled out:
// "45.2% not reported" says what "45.2% Unknown" only implies.
const DONUT_CENTRE_LABEL = {
    'Unknown': 'not reported',
    'Unknown or Not Reported': 'not reported'
};

// Long OMB category names need shortening to sit beside an arc.
const DONUT_LABEL_SHORT = {
    'Black/African American': 'Black/African Am.',
    'American Indian/Alaska Native': 'Am. Indian/AK Native',
    'Native Hawaiian/Pacific Islander': 'Native Hawaiian/PI',
    'More than one race': 'Two or more races',
    'Not Hispanic/Latino': 'Not Hispanic',
    'Unknown or Not Reported': 'Not reported'
};

// Donut colours keyed by the display labels the totals objects use, so the
// mapping is visible next to the palette instead of riding on key order.
// Race has no entry: eight categories exceed what colour can separate, so it
// uses the sequential ramp (see donutConfig).
const DONUT_COLORS = {
    ethnicity: {
        'Hispanic/Latino': COLORS.ethnicity.hispanic_latino,
        'Not Hispanic/Latino': COLORS.ethnicity.not_hispanic_latino,
        'Unknown': COLORS.ethnicity.unknown_not_reported
    },
    sex: {
        'Female': COLORS.sex.female,
        'Male': COLORS.sex.male,
        'Unknown': COLORS.sex.unknown
    },
    gender: {
        'Woman': COLORS.gender.woman,
        'Man': COLORS.gender.man,
        'Non-binary': COLORS.gender.nonbinary,
        'Transgender': COLORS.gender.transgender,
        'Other': COLORS.gender.other,
        'Unknown or Not Reported': COLORS.gender.unknown
    }
};

// Category names that mean absence rather than a group. They keep the
// neutral grey and, in ramp mode, sort to the end instead of joining the
// magnitude ramp.
const DONUT_ABSENT_LABELS = new Set(['Unknown', 'Unknown or Not Reported', 'Not reported']);

/**
 * Build a Chart.js doughnut config that labels its own arcs.
 *
 * totals   {label: value} in category order
 * colors   {label: hex} for entity-coloured dimensions, or null to use
 *          RACE_RAMP: slices sort by share and take ramp steps, which is a
 *          magnitude encoding for a composition too large to colour by
 *          identity. Absence categories keep the grey either way.
 * noun     what the values count, for the tooltip and the centre caption
 *
 * On mobile the arc labels are dropped and the full legend returns: outside
 * labels collide on a square canvas at phone width.
 */
function donutConfig(totals, colors, noun) {
    let entries = Object.entries(totals).filter(([, v]) => Number(v) > 0);
    const total = entries.reduce((a, [, v]) => a + Number(v), 0);

    let backgroundColor;
    if (colors) {
        backgroundColor = entries.map(([k]) => colors[k] || CHART_COLORS.notReported);
    } else {
        const absent = entries.filter(([k]) => DONUT_ABSENT_LABELS.has(k));
        const present = entries.filter(([k]) => !DONUT_ABSENT_LABELS.has(k))
            .sort((a, b) => Number(b[1]) - Number(a[1]));
        entries = present.concat(absent);
        backgroundColor = entries.map(([k], i) =>
            DONUT_ABSENT_LABELS.has(k) ? CHART_COLORS.notReported
                : RACE_RAMP[Math.min(i, RACE_RAMP.length - 1)]);
    }

    const labels = entries.map(([k]) => k);
    const values = entries.map(([, v]) => Number(v));
    const pct = (v) => total > 0 ? (v / total) * 100 : 0;
    const top = values.indexOf(Math.max(...values));

    return {
        type: 'doughnut',
        data: { labels, datasets: [{ data: values, backgroundColor, borderColor: '#ffffff', borderWidth: 2 }] },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            aspectRatio: CHART_ASPECT_RATIO,
            // Room for the outside labels; on mobile the legend needs it instead.
            radius: isMobileDevice ? '90%' : '68%',
            layout: { padding: isMobileDevice ? 0 : { left: 8, right: 8, top: 4 } },
            plugins: {
                donutCentreFinding: top >= 0 ? {
                    value: pct(values[top]).toFixed(1) + '%',
                    label: DONUT_CENTRE_LABEL[labels[top]]
                        || DONUT_LABEL_SHORT[labels[top]] || labels[top]
                } : null,
                legend: {
                    // Desktop: the arc labels are the key, so the legend is
                    // left holding only what they could not label.
                    display: isMobileDevice || values.some(v => pct(v) < DONUT_LABEL_MIN_PCT),
                    position: isMobileDevice ? 'bottom' : 'bottom',
                    labels: {
                        boxWidth: 10, boxHeight: 10, padding: 12, font: { size: 11 },
                        filter: (item) => isMobileDevice
                            || pct(values[item.index]) < DONUT_LABEL_MIN_PCT
                    }
                },
                datalabels: isMobileDevice ? { display: false } : {
                    display: (c) => pct(c.dataset.data[c.dataIndex]) >= DONUT_LABEL_MIN_PCT,
                    formatter: (v, c) => {
                        const name = String(c.chart.data.labels[c.dataIndex]);
                        return [DONUT_LABEL_SHORT[name] || name, pct(v).toFixed(1) + '%'];
                    },
                    anchor: 'end', align: 'end', offset: 7, clamp: true,
                    textAlign: 'center',
                    color: '#212529',
                    font: { size: 11, weight: '500', lineHeight: 1.25 }
                },
                tooltip: {
                    callbacks: {
                        label: (context) => ` ${context.parsed.toLocaleString()} ${noun} (${pct(context.parsed).toFixed(1)}%)`
                    }
                }
            }
        },
        plugins: [ChartDataLabels, donutCentreFindingPlugin]
    };
}

// Event annotations: a dashed vertical marker with a mono caption, drawn
// behind the data. Charts opt in via options.plugins.eventLines or by
// canvas id below — regulatory context rendered as data, not prose.
const CHART_EVENT_LINES = {
    'reporting-trends-chart': [{ x: '2017', label: 'FDAAA Final Rule effective' }],
    'race-trends-chart':      [{ x: '2017', label: 'FDAAA Final Rule effective' }],
    'ethnicity-trends-chart': [{ x: '2017', label: 'FDAAA Final Rule effective' }],
    'sex-trends-chart':       [{ x: '2017', label: 'FDAAA Final Rule effective' }],
    'gender-trends-chart':    [{ x: '2017', label: 'FDAAA Final Rule effective' }],
    'ai-timeline-chart': [
        { x: '2017', label: 'Digital Health Action Plan' },
        { x: '2019', label: 'AI/ML SaMD framework' }
    ],
    'ai-nonk-chart': [
        { x: '2017', label: 'Digital Health Action Plan' },
        { x: '2019', label: 'AI/ML SaMD framework' }
    ]
};

const civicEventLinesPlugin = {
    id: 'eventLines',
    beforeDatasetsDraw(chart) {
        // Chart.js materializes an empty options node for every registered
        // plugin id, so only an actual array counts as a per-chart override.
        const optEv = chart.options.plugins && chart.options.plugins.eventLines;
        const events = (Array.isArray(optEv) && optEv.length ? optEv
            : CHART_EVENT_LINES[chart.canvas && chart.canvas.id]) || [];
        if (!events.length) return;
        const { ctx, chartArea, scales } = chart;
        const xs = scales.x;
        if (!xs || !chartArea) return;
        events.forEach((ev, i) => {
            const idx = chart.data.labels.findIndex(l => String(l) === String(ev.x));
            if (idx < 0) return;
            const px = xs.getPixelForValue(idx);
            if (px < chartArea.left || px > chartArea.right) return;
            ctx.save();
            ctx.strokeStyle = 'rgba(107, 114, 128, 0.5)';
            ctx.setLineDash([3, 3]);
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(px, chartArea.top);
            ctx.lineTo(px, chartArea.bottom);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.font = "9px 'DM Mono', ui-monospace, monospace";
            ctx.fillStyle = '#6b7280';
            const y = chartArea.top + 9 + i * 11;
            const fitsRight = px + 16 + ctx.measureText(ev.label).width < chartArea.right;
            const dir = fitsRight ? 1 : -1;
            // Leader arrow from the label to its line — with several
            // staggered labels the pointer says which line is which.
            ctx.strokeStyle = '#6b7280';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(px + dir * 13, y - 3);
            ctx.lineTo(px + dir * 2, y - 3);
            ctx.moveTo(px + dir * 2, y - 3);
            ctx.lineTo(px + dir * 6, y - 6);
            ctx.moveTo(px + dir * 2, y - 3);
            ctx.lineTo(px + dir * 6, y);
            ctx.stroke();
            ctx.textAlign = fitsRight ? 'left' : 'right';
            ctx.fillText(ev.label, px + dir * 16, y);
            ctx.restore();
        });
    }
};

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    try {
        // Match chart typography to the page. Chart.js otherwise renders
        // legends, ticks, and axis titles in its own default font stack.
        if (typeof Chart !== 'undefined') {
            Chart.defaults.font.family = "'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
            Chart.defaults.color = '#6c757d';
            // Tufte pass: category axes drop their gridlines entirely, value
            // axes fade to a whisper, and axis border boxes disappear.
            // (Direct property writes only — Chart.defaults are proxy-backed
            // and cloning them with Object.assign creates cyclic options.)
            Chart.defaults.scale.grid.color = 'rgba(27, 67, 50, 0.07)';
            Chart.defaults.layout.padding = { top: 0, right: 0, bottom: 12, left: 0 };
            if (Chart.defaults.scale.border) Chart.defaults.scale.border.display = false;
            const catDefaults = Chart.defaults.scales && Chart.defaults.scales.category;
            if (catDefaults) {
                if (catDefaults.grid) catDefaults.grid.display = false;
                else catDefaults.grid = { display: false };
            }
            Chart.register(civicWatermarkPlugin, civicEventLinesPlugin);
        }
        updateLoadingProgress(5, 'Preparing dashboard...');
        // Condition ontology is only needed by the desktop filter dropdown.
        // Mobile doesn't render filters, so skip the fetch to save bandwidth.
        if (!isMobileDevice) {
            await loadConditionOntology();
        }
        updateLoadingProgress(10, 'Downloading clinical trial data...');
        await loadData();
        updateLoadingProgress(78, 'Initializing filters and controls...');
        initTabs();
        if (!dashboardSummary) {
            // Full desktop mode: initialize filters, table, geography
            initFilters();
            initTable();
            initGeographyTab();
            populatePrimaryConditionDropdown();
        } else {
            // Mobile summary mode: disable filters, show "desktop only" on heavy tabs
            disableFiltersForMobile();
        }
        // Rows-per-page applies in both desktop and mobile summary modes
        // (initTable is desktop-only; wireRowsControl guards double-wiring).
        wireRowsControl('studies-rows', n => {
            studiesPageSize = n;
            currentPage = 0;
            renderStudiesTable();
        });
        initSubcategoryButtons();
        initFilterSummary();
        updateLoadingProgress(90, 'Rendering charts...');
        renderDashboard();
        updateLoadingProgress(100, 'Done');

        // Deep links: restore the tab (and desktop filter state) from the
        // hash once the first render is up, then start writing share URLs.
        shareUrlReady = true;
        applyRouteFromHash();
        labelChartsForA11y();

        // Hide loading overlay after everything is initialized and rendered
        hideLoadingOverlay();

        if (!dashboardSummary) {
            initHistorySelector();   // populate archive dropdown (non-blocking; runs after first render)
        }
    } catch (err) {
        console.error('Dashboard initialization failed:', err);
        const overlay = document.getElementById('loading-overlay');
        if (overlay) {
            const status = document.getElementById('loading-status');
            if (status) {
                status.textContent = `Error: ${err.message}. Please refresh the page.`;
                status.style.color = '#ef4444';
            }
        }
    }
});

// Feature-detect DecompressionStream (not available on Safari iOS, older mobile browsers)
const hasDecompressionStream = typeof DecompressionStream !== 'undefined';

// Dynamically load pako only when needed (avoids blocking page load on desktop)
let _pakoReady = hasDecompressionStream ? Promise.resolve() : null;
function ensurePako() {
    if (_pakoReady) return _pakoReady;
    _pakoReady = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/pako@2.1.0/dist/pako.min.js';
        s.onload = resolve;
        s.onerror = () => reject(new Error('Failed to load pako library for gzip decompression'));
        document.head.appendChild(s);
    });
    return _pakoReady;
}

// Session-level cache buster: same value for the entire page session so the
// browser HTTP cache is effective within a session, but a new tab/refresh
// after deployment gets fresh data.  Changes daily to pick up weekly extractions.
const DATA_CACHE_VERSION = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"

// Decompress a single .json.gz response body and return parsed JSON.
async function fetchAndDecompress(url) {
    console.log(`Fetching: ${url}`);
    const response = await fetch(`${url}?v=${DATA_CACHE_VERSION}`);
    console.log(`Response status for ${url}: ${response.status}`);
    if (!response.ok) {
        throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);
    }

    let json;
    if (hasDecompressionStream) {
        // Fast path: native streaming decompression
        const decompressedStream = response.body.pipeThrough(new DecompressionStream('gzip'));
        const decompressedResponse = new Response(decompressedStream);
        json = await decompressedResponse.json();
    } else {
        // Fallback for Safari iOS / older browsers: load pako on demand
        console.log('DecompressionStream not available, using pako fallback');
        await ensurePako();
        const compressed = new Uint8Array(await response.arrayBuffer());
        const decompressed = pako.inflate(compressed, { to: 'string' });
        json = JSON.parse(decompressed);
    }

    const count = Array.isArray(json.data) ? json.data.length : Object.keys(json.data).length;
    console.log(`Successfully loaded ${count} records from ${url}`);
    return json;
}

// Lazy-load detail data (study_sites full records, secondary_outcomes, references, etc.)
// Called on-demand when a user opens a study detail modal.
async function loadDetailData() {
    if (detailsLoaded) return;
    // Details aren't published for mobile; fetching would crash low-memory
    // devices and the files may not even exist. Mark as loaded so callers
    // fall through to whatever compact data is already in `data`.
    if (isMobileDevice) {
        detailsLoaded = true;
        return;
    }
    try {
        const [d1, d2] = await Promise.all([
            fetchAndDecompress('data/details.part1.json.gz'),
            fetchAndDecompress('data/details.part2.json.gz')
        ]);
        Object.assign(detailCache, d1.data, d2.data);
        detailsLoaded = true;
        console.log(`✓ Loaded detail data for ${Object.keys(detailCache).length} studies`);
    } catch (e) {
        console.warn('Could not load detail data:', e.message);
    }
}

// Number of data file parts per snapshot
const NUM_PARTS = 8;

// Generate an array of part filenames: demographics.part1.json.gz … partN.json.gz
function partFiles(n) {
    return Array.from({ length: n }, (_, i) => `demographics.part${i + 1}.json.gz`);
}

// Build list of URL strategies to try for fetching data.
// Historical snapshots are stored in snapshots/{date}/ on GitHub Pages (same origin).
// Mobile uses pre-computed dashboard-summary.json loaded in loadData() — no part files needed.
function getUrlStrategies(date) {
    const parts8 = partFiles(8);

    if (!date || date === 'latest') {
        return [
            { name: 'Local', urls: parts8.map(f => `data/${f}`) }
        ];
    }

    return [
        {
            name: 'Snapshot',
            urls: parts8.map(f => `snapshots/${date}/${f}`)
        }
    ];
}

async function loadData(date) {
    const cacheKey = date || 'latest';

    // ── Mobile: load pre-computed summary (~15 KB) instead of 77K studies ──
    if (isMobileDevice && (!date || date === 'latest')) {
        try {
            console.log('📱 Mobile detected — loading pre-computed dashboard summary');
            const resp = await fetch(`data/dashboard-summary.json?v=${DATA_CACHE_VERSION}`);
            if (resp.ok) {
                dashboardSummary = await resp.json();
                // Use the compact recent-studies list so the Studies tab renders
                // with real rows + horizontal scroll. Full 77K dataset + details
                // files aren't served to mobile (would crash low-memory devices).
                data = dashboardSummary.recentStudies || [];
                const dateLabel = dashboardSummary.extracted_at
                    ? new Date(dashboardSummary.extracted_at).toLocaleDateString()
                    : '';
                document.getElementById('last-updated').textContent = dateLabel;
                setDataPulledDate(dashboardSummary.extracted_at);
                console.log(`✓ Mobile summary loaded: ${dashboardSummary.totalStudies} studies pre-aggregated (${data.length} recent shown in table)`);
                return;
            }
            console.warn('Mobile summary not available, falling back to full data');
        } catch (e) {
            console.warn('Mobile summary failed:', e.message, '— falling back to full data');
        }
    }

    // ── Check snapshot cache first ──
    if (snapshotCache.has(cacheKey)) {
        const cached = snapshotCache.get(cacheKey);
        console.log(`⚡ Snapshot "${cacheKey}" loaded from cache (${cached.data.length} studies)`);
        data = cached.data;
        // Aggregate-archive snapshots restore their summary; full snapshots
        // clear any summary left by a previously viewed aggregate archive.
        if (!isMobileDevice) dashboardSummary = cached.summary || null;
        detailCache = {};
        detailsLoaded = false;
        studiesTabReady = false;
        document.getElementById('last-updated').textContent = cached.dateLabel;
        if (cached.extractedAt) setDataPulledDate(cached.extractedAt);
        return;
    }

    // Reset detail cache when loading new data
    detailCache = {};
    detailsLoaded = false;
    studiesTabReady = false;

    const strategies = getUrlStrategies(date);
    let lastError = null;

    for (const strategy of strategies) {
        try {
            const numParts = strategy.urls.length;
            console.log(`Trying ${strategy.name} strategy (${numParts} parts)...`);

            // Fetch all parts in parallel, but track individual completions
            let partsCompleted = 0;
            const promises = strategy.urls.map((url) => {
                return fetchAndDecompress(url).then(result => {
                    partsCompleted++;
                    updateLoadingProgress(
                        15 + Math.round((partsCompleted / numParts) * 55),
                        `Downloaded ${partsCompleted} of ${numParts} data files...`
                    );
                    return result;
                });
            });

            const parts = await Promise.all(promises);

            updateLoadingProgress(72, 'Merging dataset...');
            data = parts.flatMap(p => p.data);
            console.log(`✓ Loaded ${data.length} studies via ${strategy.name}`);

            // Debug: Log exact keys of first study for data mapping verification
            if (data.length > 0) {
                const sample = data[0];
                console.log('📋 Study data keys:', Object.keys(sample).sort());
                console.log('📋 study.race keys:', sample.race ? Object.keys(sample.race) : 'MISSING');
                console.log('📋 study.sex keys:', sample.sex ? Object.keys(sample.sex) : 'MISSING');
                console.log('📋 study.gender keys:', sample.gender ? Object.keys(sample.gender) : 'MISSING');
                console.log('📋 study.ethnicity keys:', sample.ethnicity ? Object.keys(sample.ethnicity) : 'MISSING');
                console.log('📋 study.sex.reported:', sample.sex?.reported, '| study.sex.totals:', sample.sex?.totals);
                console.log('📋 study.race.reported:', sample.race?.reported, '| study.race.omb_totals:', sample.race?.omb_totals);
            }

            // Show which snapshot is loaded
            let dateLabel = '';
            if (date && date !== 'latest') {
                if (strategy.name.includes('fallback')) {
                    dateLabel = ` (showing latest - ${date} unavailable)`;
                } else {
                    dateLabel = ` (${date} snapshot)`;
                }
            }
            const fullDateLabel = new Date(parts[0].extracted_at).toLocaleDateString() + dateLabel;
            document.getElementById('last-updated').textContent = fullDateLabel;
            setDataPulledDate(parts[0].extracted_at);

            // Leaving a previously viewed aggregate archive: back to full mode.
            if (!isMobileDevice) dashboardSummary = null;

            // ── Cache this snapshot for instant re-access ──
            snapshotCache.set(cacheKey, { data: data, dateLabel: fullDateLabel, summary: null, extractedAt: window.__dataExtractedAt });
            console.log(`💾 Cached snapshot "${cacheKey}" (${data.length} studies)`);

            return; // Success!

        } catch (error) {
            console.warn(`✗ ${strategy.name} failed:`, error.message);
            lastError = error;
        }
    }

    // ── Aggregate-archive fallback ──
    // Monthly-tier snapshots are retained as dashboard-summary.json only
    // (the heavy part files are stripped to keep the published site under
    // GitHub Pages' size cap). Render them the way mobile renders the live
    // data: every chart from the pre-computed aggregates, with the recent-
    // studies list in the table.
    if (date && date !== 'latest') {
        try {
            const resp = await fetch(`snapshots/${date}/dashboard-summary.json?v=${DATA_CACHE_VERSION}`);
            if (resp.ok) {
                const summary = await resp.json();
                dashboardSummary = summary;
                data = summary.recentStudies || [];
                const dateLabel = `${new Date(summary.extracted_at).toLocaleDateString()} (${date} archive · aggregate view)`;
                document.getElementById('last-updated').textContent = dateLabel;
                setDataPulledDate(summary.extracted_at);
                snapshotCache.set(cacheKey, { data: data, dateLabel: dateLabel, summary: summary, extractedAt: window.__dataExtractedAt });
                console.log(`✓ Loaded ${date} as aggregate archive (summary-only snapshot)`);
                showToast(`${date} is an archived monthly snapshot: charts show its full-dataset aggregates. Filters and the full study table are available on bi-weekly and latest data.`, 'info', 9000);
                return;
            }
        } catch (e) {
            console.warn('Aggregate archive fallback failed:', e.message);
        }
    }

    // All strategies failed — throw so callers (change handler) can handle
    console.error('All fetch strategies failed:', lastError);
    throw new Error(`Could not load data for ${date || 'latest'}: ${lastError?.message || 'Unknown error'}`);
}

// Wrapper function to reload with a specific date (called from error recovery buttons)
async function loadDataAndRender(date) {
    const select = document.getElementById('history-date');
    if (select) select.value = date;

    const isCached = snapshotCache.has(date || 'latest');
    if (!isCached) showSnapshotLoading(date === 'latest' ? 'Loading latest data…' : `Loading ${date} snapshot…`);

    try {
        await loadData(date);
        if (data && data.length > 0) {
            populateConditionsDropdown();
            populateCountriesDropdown();
            populatePrimaryConditionDropdown();
            renderDashboard();
        }
    } catch (err) {
        showToast(`Failed to load ${date || 'latest'} snapshot: ${err.message}`, 'error');
    } finally {
        hideSnapshotLoading();
    }
}
window.loadDataAndRender = loadDataAndRender;

// Fetch history.json, populate the date-selector dropdown, and wire up
// the change handler so selecting a historical date reloads + re-renders.
async function initHistorySelector() {
    const select = document.getElementById('history-date');
    if (!select) return;

    try {
        const resp = await fetch('history.json');
        if (!resp.ok) {
            // No manifest yet — dropdown stays at "Latest" only
            console.log('history.json not available; archive selector disabled.');
            return;
        }
        const manifest = await resp.json();
        const dates = (manifest.dates || []).slice().sort().reverse(); // newest first

        // Trust the manifest — the GitHub Actions workflow only appends a date
        // after verifying the release and its assets exist.  The loadData()
        // function already handles failures gracefully (toast + revert), so
        // we don't need a HEAD-probe gate here.  Previous probes used jsDelivr,
        // which 403s on files >50 MB, hiding every valid date.
        dates.forEach(d => {
            const opt = document.createElement('option');
            opt.value = d;
            opt.textContent = d;
            select.appendChild(opt);
        });
    } catch (e) {
        console.warn('Could not load history manifest:', e);
    }

    // Initialize tracking so revert-on-error knows the starting state
    select.dataset.lastValue = 'latest';

    select.addEventListener('change', async () => {
        const chosen = select.value;
        const previousValue = select.dataset.lastValue || 'latest';
        console.log(`Switching to snapshot: ${chosen}`);

        const isCached = snapshotCache.has(chosen === 'latest' ? 'latest' : chosen);
        const label = chosen === 'latest' ? 'Loading latest data…' : `Loading ${chosen} snapshot…`;
        if (!isCached) showSnapshotLoading(label);

        try {
            await loadData(chosen);

            if (!data || data.length === 0) throw new Error('No data returned');

            // Re-populate dynamic dropdowns whose options come from the dataset
            populateConditionsDropdown();
            populateCountriesDropdown();
            populatePrimaryConditionDropdown();
            renderDashboard();

            select.dataset.lastValue = chosen;
            const snapshotLabel = chosen === 'latest' ? 'latest' : chosen;
            showToast(`Loaded ${snapshotLabel} snapshot${isCached ? ' (cached)' : ''} — ${data.length} studies`, 'info', 3000);
        } catch (err) {
            console.error('Snapshot switch failed:', err);
            showToast(`Snapshot "${chosen}" unavailable: ${err.message}. Reverting.`, 'error', 5000);
            // Revert dropdown and reload previous data
            select.value = previousValue;
            if (previousValue !== chosen) {
                try { await loadData(previousValue === 'latest' ? undefined : previousValue); } catch (_) {}
                renderDashboard();
            }
        } finally {
            hideSnapshotLoading();
        }
    });
}

// Provenance: the extraction date feeds the chart watermark and the footer.
function setDataPulledDate(iso) {
    if (!iso) return;
    window.__dataExtractedAt = String(iso).slice(0, 10);
    const el = document.getElementById('footer-extracted');
    if (el) el.textContent = ' · Data last pulled ' + window.__dataExtractedAt;
}

// Every chart canvas advertises its container's title and note as its text
// alternative — the chart's abstract for screen readers and failed loads.
function labelChartsForA11y() {
    document.querySelectorAll('canvas').forEach(c => {
        const box = c.closest('.chart-container');
        const h = box && box.querySelector('h3, h2');
        if (!h) return;
        const note = box.querySelector('.note');
        c.setAttribute('role', 'img');
        c.setAttribute('aria-label', h.textContent.trim() + (note ? '. ' + note.textContent.trim() : ''));
    });
}

// ── Shareable URLs ──────────────────────────────────────────────────────
// Every tab writes /#<tab> (path-style /<tab>/ redirect stubs exist for
// each), and the desktop filters serialize into query-style params after
// the tab, so a pasted link reproduces the exact view. The industry view
// manages its own #industry?… state in renderIndustry().
let shareUrlReady = false;
const SHARE_FILTERS = [
    ['year-start', 'ys'], ['year-end', 'ye'], ['study-type', 'st'],
    ['sponsor-class', 'sp'], ['primary-purpose', 'pu'],
    ['condition-primary', 'pri'], ['condition-secondary', 'sec'],
    ['fda-status', 'fda']
];

function shareFilterDefault(el) {
    if (el.type === 'range') return el.id === 'year-start' ? el.min : el.max;
    const first = el.querySelector('option');
    return first ? first.value : '';
}

function updateShareUrl() {
    if (!shareUrlReady) return;
    const active = document.querySelector('.tab.active');
    const tabId = active ? active.dataset.tab : 'overview';
    if (!tabId || tabId === 'industry') return;
    const p = new URLSearchParams();
    SHARE_FILTERS.forEach(([id, key]) => {
        const el = document.getElementById(id);
        if (el && el.value && el.value !== shareFilterDefault(el)) p.set(key, el.value);
    });
    const q = p.toString();
    history.replaceState(null, '', '#' + tabId + (q ? '?' + q : ''));
}

function applyShareParams(query) {
    const p = new URLSearchParams(query);
    SHARE_FILTERS.forEach(([id, key]) => {
        if (!p.has(key)) return;
        const el = document.getElementById(id);
        if (!el) return;
        el.value = p.get(key);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
    });
}

function applyRouteFromHash() {
    const raw = location.hash.replace(/^#/, '');
    if (!raw || raw === 'industry' || raw.indexOf('industry?') === 0) return; // industryRoute owns it
    const parts = raw.split('?');
    const tabId = parts[0], query = parts[1];
    if (query && !isMobileDevice && !dashboardSummary) applyShareParams(query);
    const btn = tabId && document.querySelector('.tab[data-tab="' + CSS.escape(tabId) + '"]');
    if (btn && !btn.classList.contains('active')) btn.click();
}

function initTabs() {
    const BETA_GATED_TABS = new Set(['fda-extraction', 'lit-extraction', 'approval-queue', 'industry']);

    // Nav groups: a tab inside a menu closes it on the way through, and the
    // menus behave like menus — Escape closes, and opening one closes the
    // others. The <details> element supplies the keyboard handling.
    const navGroups = () => document.querySelectorAll('.nav-group');
    const closeNavGroups = (except) => navGroups().forEach(g => {
        if (g !== except) g.removeAttribute('open');
    });
    navGroups().forEach(group => {
        group.addEventListener('toggle', () => {
            if (group.open) closeNavGroups(group);
        });
    });
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.nav-group')) closeNavGroups();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        const open = document.querySelector('.nav-group[open]');
        if (!open) return;
        open.removeAttribute('open');
        const summary = open.querySelector('summary');
        if (summary) summary.focus();
    });

    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', async () => {
            closeNavGroups();

            // Gate the Beta extraction tabs behind a session-scoped password.
            // If the user cancels or enters the wrong password we leave the
            // currently active tab in place rather than surfacing a dead state.
            if (BETA_GATED_TABS.has(tab.dataset.tab)) {
                const granted = await promptForBetaAccess();
                if (!granted) return;
            }

            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

            tab.classList.add('active');
            document.getElementById(tab.dataset.tab).classList.add('active');

            // Hide filters on FAQ, About, and AI Devices tabs
            const filtersSection = document.getElementById('filters');
            const filterSummary = document.getElementById('filter-summary');
            const noFilterTabs = ['faq', 'about', 'ai-devices', 'geography', 'fda-extraction', 'lit-extraction', 'approval-queue'];
            const hideFilters = noFilterTabs.includes(tab.dataset.tab);
            // style.display governs whether this tab has filters at all;
            // the panel's `hidden` attribute governs whether they are expanded.
            filtersSection.style.display = hideFilters ? 'none' : '';
            if (filterSummary) filterSummary.style.display = hideFilters ? 'none' : '';

            // Render table when Studies tab is selected - preload ALL data first
            if (tab.dataset.tab === 'studies') {
                prepareStudiesTab();
            }

            // Re-render charts when their tab becomes visible
            // (Chart.js renders at 0x0 on hidden canvases)
            const filtered = data.length > 0 ? getFilteredData() : [];
            if (tab.dataset.tab === 'sex' && filtered.length > 0) {
                renderSexReportedParticipants(filtered);
                renderSexFullDistribution(filtered);
                renderSexDistribution(filtered);
                renderSexTrends(filtered);
            }
            if (tab.dataset.tab === 'gender' && filtered.length > 0) {
                renderGenderReportedParticipants(filtered);
                renderGenderFullDistribution(filtered);
                renderGenderDistribution(filtered);
                renderGenderTrends(filtered);
            }
            if (tab.dataset.tab === 'race' && filtered.length > 0) {
                renderRaceDistribution(filtered);
                renderRaceTrends(filtered);
                renderRaceSubcategories('asian');
                renderRaceReportedParticipants(filtered);
                renderRaceFullDistribution(filtered);
            }
            if (tab.dataset.tab === 'ethnicity' && filtered.length > 0) {
                renderEthnicityDistribution(filtered);
                renderEthnicityTrends(filtered);
                renderEthnicitySubcategories(filtered);
                renderEthnicityReportedParticipants(filtered);
                renderEthnicityFullDistribution(filtered);
            }

            // Rendered unconditionally: with a zero-result filter the tab
            // must show zeros, not the previous filter's stale numbers.
            if (tab.dataset.tab === 'fda-oversight') {
                renderFdaOversight(filtered);
            }

            // Geography tab: renders from the frozen contract in data/geo/,
            // independent of the study dataset and of every dashboard filter.
            if (tab.dataset.tab === 'geography') {
                renderGeographyDashboard();
            }

            // Lazy-load tabs on first visit
            if (tab.dataset.tab === 'ai-devices') {
                loadAIDevicesTab();
            }
            if (tab.dataset.tab === 'fda-extraction') {
                loadFDAExtractionTab();
            }
            if (tab.dataset.tab === 'lit-extraction') {
                loadLitExtractionTab();
            }
            if (tab.dataset.tab === 'approval-queue') {
                loadApprovalQueueTab();
            }
            // Industry Sponsors sits in the Tools group behind the same gate as
            // the extraction tabs (BETA_GATED_TABS above). The /#industry route
            // reaches the same loader through openIndustryView().
            if (tab.dataset.tab === 'industry') {
                loadIndustryView();
            }

            updateShareUrl();
            labelChartsForA11y();
        });
    });
}

function disableFiltersForMobile() {
    // Mobile renders pre-computed aggregates, so the filters cannot apply.
    // Disable every control, dim the panel, park the year slider at its
    // full static range (its tooltip chips are positioned by the desktop
    // init that never runs here — unpositioned they pile up half-off-screen
    // at the track's left edge), and say so plainly.
    const filterSection = document.getElementById('filters');
    if (filterSection) {
        filterSection.classList.add('filters-disabled');
        filterSection.querySelectorAll('select, input, button').forEach(el => {
            el.disabled = true;
            el.title = 'Filters available on desktop only';
        });
        document.querySelectorAll('.range-tooltip').forEach(t => { t.style.display = 'none'; });
        const fill = document.getElementById('year-range-fill');
        if (fill) { fill.style.left = '0%'; fill.style.right = '0%'; fill.style.width = '100%'; }
        const hint = filterSection.querySelector('.filter-hint');
        if (hint) hint.textContent = '(2009–2026 · full range shown)';
        const note = document.createElement('p');
        note.className = 'mobile-note';
        note.textContent = 'Filters are a desktop feature — this phone view shows pre-computed aggregates of the full dataset.';
        filterSection.prepend(note);
    }

    // The Geography tab renders from the small frozen contract CSVs in
    // data/geo/ and works on mobile; no desktop-only placeholder needed.

    // Add a note above the Studies table explaining the recent-N limit.
    const readyContent = document.getElementById('studies-ready-content');
    if (readyContent && !readyContent.querySelector('.mobile-studies-note')) {
        const total = dashboardSummary?.totalStudies || 0;
        const shown = (dashboardSummary?.recentStudies || []).length;
        const note = document.createElement('p');
        note.className = 'mobile-studies-note note';
        note.style.cssText = 'background:#eff6ff;border-left:3px solid #3b82f6;padding:0.5rem 0.75rem;margin:0 0 0.75rem;font-size:0.85rem;color:#1e40af;';
        note.textContent = `Showing ${shown.toLocaleString()} most recent studies (of ${total.toLocaleString()} total). Full table with search and filters available on desktop.`;
        readyContent.prepend(note);
    }
}

function initFilters() {
    // Populate condition and country dropdowns
    populateConditionsDropdown();
    populateCountriesDropdown();

    const filterIds = [
        'year-start', 'year-end', 'study-type', 'phase', 'sponsor-class',
        'intervention-model', 'masking', 'primary-purpose',
        'enrollment-type', 'healthy-volunteers', 'population-age', 'condition', 'condition-primary', 'condition-secondary', 'country',
        'fda-status'
    ];
    filterIds.forEach(id => {
        const element = document.getElementById(id);
        if (element) {
            element.addEventListener('change', () => {
                // When primary changes, update secondary dropdown options
                if (id === 'condition-primary') {
                    populateSecondaryConditionDropdown(element.value);
                }
                renderDashboard();
                updateActiveFilters();
            });
        }
    });

    // AI study checkbox
    const aiCheckbox = document.getElementById('ai-study-filter');
    if (aiCheckbox) {
        aiCheckbox.addEventListener('change', () => {
            renderDashboard();
            updateActiveFilters();
        });
    }

    // Participant range inputs (fire on every keystroke)
    ['min-participants', 'max-participants'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('input', () => {
                renderDashboard();
                updateActiveFilters();
            });
        }
    });

    // Year dual-range slider with floating tooltip bubbles
    const yearStartInput = document.getElementById('year-start');
    const yearEndInput = document.getElementById('year-end');

    function updateYearSlider() {
        const fill = document.getElementById('year-range-fill');
        const startTip = document.getElementById('year-start-tooltip');
        const endTip = document.getElementById('year-end-tooltip');
        if (!fill || !yearStartInput || !yearEndInput) return;

        const min = parseInt(yearStartInput.min);
        const max = parseInt(yearStartInput.max);
        const range = max - min;
        const startVal = parseInt(yearStartInput.value);
        const endVal = parseInt(yearEndInput.value);
        const startPct = ((startVal - min) / range) * 100;
        const endPct = ((endVal - min) / range) * 100;

        // Update fill bar
        fill.style.left = startPct + '%';
        fill.style.width = (endPct - startPct) + '%';

        // Position tooltip bubbles above thumbs
        if (startTip) startTip.style.left = startPct + '%';
        if (endTip) endTip.style.left = endPct + '%';
    }

    if (yearStartInput) {
        yearStartInput.addEventListener('input', (e) => {
            if (parseInt(e.target.value) > parseInt(yearEndInput.value)) {
                e.target.value = yearEndInput.value;
            }
            document.getElementById('year-start-label').textContent = e.target.value;
            updateYearSlider();
        });
    }

    if (yearEndInput) {
        yearEndInput.addEventListener('input', (e) => {
            if (parseInt(e.target.value) < parseInt(yearStartInput.value)) {
                e.target.value = yearStartInput.value;
            }
            document.getElementById('year-end-label').textContent = e.target.value;
            updateYearSlider();
        });
    }

    // Initialize slider fill + tooltip positions
    updateYearSlider();

    // Reset filters button
    const resetBtn = document.getElementById('reset-filters');
    if (resetBtn) {
        resetBtn.addEventListener('click', resetFilters);
    }

    // Toggle expanded filters
    const toggleBtn = document.getElementById('toggle-more-filters');
    const expandedSection = document.getElementById('expanded-filters');
    if (toggleBtn && expandedSection) {
        toggleBtn.addEventListener('click', () => {
            const isHidden = expandedSection.style.display === 'none';
            expandedSection.style.display = isHidden ? '' : 'none';
            toggleBtn.innerHTML = isHidden ? 'Show Fewer Filters &#9650;' : 'Show More Filters &#9660;';
        });
    }
}

function populateConditionsDropdown() {
    const select = document.getElementById('condition');
    if (!select || !data) return;

    // Extract all unique conditions from all studies
    const conditionsSet = new Set();
    data.forEach(study => {
        if (study.conditions && Array.isArray(study.conditions)) {
            study.conditions.forEach(condition => {
                if (condition && condition.trim()) {
                    conditionsSet.add(condition.trim());
                }
            });
        }
    });

    // Sort alphabetically
    const sortedConditions = Array.from(conditionsSet).sort((a, b) => a.localeCompare(b));

    // Clear existing options (except "All")
    select.innerHTML = '<option value="all">All Conditions</option>';

    // Add condition options
    sortedConditions.forEach(condition => {
        const option = document.createElement('option');
        option.value = condition;
        option.textContent = condition;
        select.appendChild(option);
    });
}

function populateCountriesDropdown() {
    const select = document.getElementById('country');
    if (!select || !data) return;

    // Extract all unique countries from all studies
    const countriesSet = new Set();
    data.forEach(study => {
        if (study.countries && Array.isArray(study.countries)) {
            study.countries.forEach(countryObj => {
                const country = countryObj.country;
                if (country && country.trim()) {
                    countriesSet.add(country.trim());
                }
            });
        }
    });

    // Sort alphabetically
    const sortedCountries = Array.from(countriesSet).sort((a, b) => a.localeCompare(b));

    // Clear existing options (except "All")
    select.innerHTML = '<option value="all">All Countries</option>';

    // Add country options
    sortedCountries.forEach(country => {
        const option = document.createElement('option');
        option.value = country;
        option.textContent = country;
        select.appendChild(option);
    });
}

function resetFilters() {
    document.getElementById('year-start').value = 2009;
    document.getElementById('year-end').value = 2026;
    document.getElementById('year-start-label').textContent = '2009';
    document.getElementById('year-end-label').textContent = '2026';
    // Re-paint the dual-range fill bar and tooltip positions
    const fill = document.getElementById('year-range-fill');
    if (fill) { fill.style.left = '0%'; fill.style.width = '100%'; }
    const sTip = document.getElementById('year-start-tooltip');
    const eTip = document.getElementById('year-end-tooltip');
    if (sTip) sTip.style.left = '0%';
    if (eTip) eTip.style.left = '100%';
    document.getElementById('study-type').value = 'INTERVENTIONAL';
    document.getElementById('phase').value = 'all';
    document.getElementById('sponsor-class').value = 'all';
    document.getElementById('intervention-model').value = 'all';
    document.getElementById('masking').value = 'all';
    document.getElementById('primary-purpose').value = 'all';
    document.getElementById('enrollment-type').value = 'all';
    document.getElementById('healthy-volunteers').value = 'all';
    document.getElementById('population-age').value = 'all';
    document.getElementById('condition').value = 'all';
    document.getElementById('condition-primary').value = 'all';
    const secSelect = document.getElementById('condition-secondary');
    if (secSelect) { secSelect.value = 'all'; secSelect.disabled = true; }
    document.getElementById('country').value = 'all';
    document.getElementById('min-participants').value = '';
    document.getElementById('max-participants').value = '';
    const fdaStatusSelect = document.getElementById('fda-status');
    if (fdaStatusSelect) fdaStatusSelect.value = 'all';
    const aiCheckbox = document.getElementById('ai-study-filter');
    if (aiCheckbox) aiCheckbox.checked = false;

    renderDashboard();
    updateActiveFilters();
}

function updateActiveFilters() {
    const container = document.getElementById('active-filters');
    if (!container) return;

    const filters = [];

    const yearStart = document.getElementById('year-start').value;
    const yearEnd = document.getElementById('year-end').value;
    if (yearStart != 2009 || yearEnd != 2026) {
        filters.push({ label: `Years: ${yearStart}-${yearEnd}`, reset: () => {
            document.getElementById('year-start').value = 2009;
            document.getElementById('year-end').value = 2026;
            document.getElementById('year-start-label').textContent = '2009';
            document.getElementById('year-end-label').textContent = '2026';
            const f = document.getElementById('year-range-fill');
            if (f) { f.style.left = '0%'; f.style.width = '100%'; }
            const st = document.getElementById('year-start-tooltip');
            const et = document.getElementById('year-end-tooltip');
            if (st) st.style.left = '0%';
            if (et) et.style.left = '100%';
        }});
    }

    const studyType = document.getElementById('study-type').value;
    if (studyType !== 'INTERVENTIONAL') {
        const typeLabel = studyType === 'all' ? 'All' : studyType;
        filters.push({ label: `Type: ${typeLabel}`, reset: () => {
            document.getElementById('study-type').value = 'INTERVENTIONAL';
        }});
    }

    const phase = document.getElementById('phase').value;
    if (phase !== 'all') {
        filters.push({ label: `Phase: ${phase}`, reset: () => {
            document.getElementById('phase').value = 'all';
        }});
    }

    const sponsor = document.getElementById('sponsor-class').value;
    if (sponsor !== 'all') {
        filters.push({ label: `Sponsor: ${sponsor}`, reset: () => {
            document.getElementById('sponsor-class').value = 'all';
        }});
    }

    const popAge = document.getElementById('population-age')?.value;
    if (popAge && popAge !== 'all') {
        filters.push({ label: `Age: ${popAge}`, reset: () => {
            document.getElementById('population-age').value = 'all';
        }});
    }

    const conditionPrimary = document.getElementById('condition-primary')?.value;
    if (conditionPrimary && conditionPrimary !== 'all') {
        filters.push({ label: `Category: ${conditionPrimary}`, reset: () => {
            document.getElementById('condition-primary').value = 'all';
            const sec = document.getElementById('condition-secondary');
            if (sec) { sec.value = 'all'; sec.disabled = true; }
        }});
    }

    const conditionSecondary = document.getElementById('condition-secondary')?.value;
    if (conditionSecondary && conditionSecondary !== 'all') {
        filters.push({ label: `Subcategory: ${conditionSecondary}`, reset: () => {
            document.getElementById('condition-secondary').value = 'all';
        }});
    }

    const condition = document.getElementById('condition').value;
    if (condition !== 'all') {
        // Truncate long condition names
        const displayCondition = condition.length > 30 ? condition.substring(0, 30) + '...' : condition;
        filters.push({ label: `Condition: ${displayCondition}`, reset: () => {
            document.getElementById('condition').value = 'all';
        }});
    }

    const country = document.getElementById('country').value;
    if (country !== 'all') {
        filters.push({ label: `Country: ${country}`, reset: () => {
            document.getElementById('country').value = 'all';
        }});
    }

    const minPart = document.getElementById('min-participants').value;
    const maxPart = document.getElementById('max-participants').value;
    if (minPart !== '' || maxPart !== '') {
        const label = minPart !== '' && maxPart !== ''
            ? `Participants: ${minPart}–${maxPart}`
            : minPart !== '' ? `Participants: ≥${minPart}`
            : `Participants: ≤${maxPart}`;
        filters.push({ label, reset: () => {
            document.getElementById('min-participants').value = '';
            document.getElementById('max-participants').value = '';
        }});
    }

    const fdaStatusVal = document.getElementById('fda-status')?.value;
    if (fdaStatusVal && fdaStatusVal !== 'all') {
        const fdaLabels = { drug: 'FDA Drug', device: 'FDA Device', unapproved: 'Unapproved Device', 'non-regulated': 'Non-Regulated', unreported: 'Oversight Not Reported' };
        filters.push({ label: `FDA: ${fdaLabels[fdaStatusVal] || fdaStatusVal}`, reset: () => {
            document.getElementById('fda-status').value = 'all';
        }});
    }

    const aiChecked = document.getElementById('ai-study-filter')?.checked;
    if (aiChecked) {
        filters.push({ label: 'AI Studies Only', reset: () => {
            document.getElementById('ai-study-filter').checked = false;
        }});
    }

    container.innerHTML = filters.map(f => `
        <span class="filter-tag">
            ${f.label}
            <button onclick="removeFilter(this, event)">&times;</button>
        </span>
    `).join('');

    // Store reset functions
    container.querySelectorAll('.filter-tag').forEach((tag, i) => {
        tag.dataset.resetIndex = i;
        tag._resetFn = filters[i].reset;
    });
}

function removeFilter(button, event) {
    event.preventDefault();
    const tag = button.closest('.filter-tag');
    if (tag._resetFn) {
        tag._resetFn();
        renderDashboard();
        updateActiveFilters();
    }
}

// Make removeFilter available globally
window.removeFilter = removeFilter;

function initSubcategoryButtons() {
    document.querySelectorAll('.subcat-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.subcat-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            renderRaceSubcategories(btn.dataset.category);
        });
    });
}

// Shared rows-per-page control (15 default / 25 / 50) for the list tables —
// the familiar list-app pattern: a short first page, expandable before paging.
function wireRowsControl(id, onChange) {
    const box = document.getElementById(id);
    if (!box || box.dataset.wired) return;
    box.dataset.wired = '1';
    box.querySelectorAll('.rows-btn').forEach(btn => btn.addEventListener('click', () => {
        box.querySelectorAll('.rows-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        onChange(parseInt(btn.dataset.rows, 10));
    }));
}

// Prev / range / Next pager for tables that page via a global go-function.
function renderSimplePager(containerId, total, page, pageSize, goFnName) {
    const el = document.getElementById(containerId);
    if (!el) return;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    if (totalPages <= 1) { el.innerHTML = ''; return; }
    el.innerHTML = `
        <button class="page-btn" ${page === 0 ? 'disabled' : ''} onclick="${goFnName}(${page - 1})">&#8592; Prev</button>
        <span class="pager-range">${(page * pageSize + 1).toLocaleString()}&ndash;${Math.min((page + 1) * pageSize, total).toLocaleString()} of ${total.toLocaleString()}</span>
        <button class="page-btn" ${page >= totalPages - 1 ? 'disabled' : ''} onclick="${goFnName}(${page + 1})">Next &#8594;</button>`;
}

function initTable() {
    // Table search
    const tableSearch = document.getElementById('study-table-search');
    if (tableSearch) {
        tableSearch.addEventListener('input', () => {
            currentPage = 0;
            renderStudiesTable();
        });
    }

    wireRowsControl('studies-rows', n => {
        studiesPageSize = n;
        currentPage = 0;
        renderStudiesTable();
    });

    // Sortable headers
    document.querySelectorAll('.studies-table th.sortable').forEach(th => {
        th.addEventListener('click', () => {
            const field = th.dataset.sort;
            if (currentSort.field === field) {
                currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
            } else {
                currentSort.field = field;
                currentSort.direction = 'asc';
            }
            currentPage = 0;
            renderStudiesTable();
        });
    });
}

function getFilteredData() {
    if (!data) return [];

    // Mobile summary mode: `data` is the pre-trimmed recent-studies list and
    // the filter controls are disabled. The compact records omit fields the
    // filters test (e.g. study_type), so running the filter chain below would
    // wrongly reject every row (the default Study Type of INTERVENTIONAL
    // matches nothing when study_type is undefined). Return the list as-is;
    // the table's own search box is applied separately in renderStudiesTable.
    if (dashboardSummary) return [...data];

    const yearStart = parseInt(document.getElementById('year-start')?.value || 2009);
    const yearEnd = parseInt(document.getElementById('year-end')?.value || 2026);
    const studyType = document.getElementById('study-type')?.value || 'all';
    const phase = document.getElementById('phase')?.value || 'all';
    const sponsorClass = document.getElementById('sponsor-class')?.value || 'all';
    const interventionModel = document.getElementById('intervention-model')?.value || 'all';
    const masking = document.getElementById('masking')?.value || 'all';
    const primaryPurpose = document.getElementById('primary-purpose')?.value || 'all';
    const enrollmentType = document.getElementById('enrollment-type')?.value || 'all';
    const healthyVolunteers = document.getElementById('healthy-volunteers')?.value || 'all';
    const populationAge = document.getElementById('population-age')?.value || 'all';
    const conditionFilter = document.getElementById('condition')?.value || 'all';
    const conditionPrimaryFilter = document.getElementById('condition-primary')?.value || 'all';
    const conditionSecondaryFilter = document.getElementById('condition-secondary')?.value || 'all';
    const countryFilter = document.getElementById('country')?.value || 'all';
    const aiOnly = document.getElementById('ai-study-filter')?.checked || false;
    const fdaStatus = document.getElementById('fda-status')?.value || 'all';

    return data.filter(study => {
        if (aiOnly && !isAIStudy(study)) return false;
        const year = parseInt(study.results_date?.substring(0, 4));
        if (isNaN(year) || year < yearStart || year > yearEnd) return false;
        if (studyType !== 'all' && study.study_type !== studyType) return false;
        if (phase !== 'all') {
            if (phase === 'NA') {
                // Match "NA" or empty/missing phase
                if (study.phase && study.phase !== 'NA') return false;
            } else {
                // Check if the selected phase is included in the study's phase(s)
                // Handles both single phases (e.g., "PHASE1") and combined (e.g., "PHASE1, PHASE2")
                const studyPhases = study.phase?.split(',').map(p => p.trim()) || [];
                if (!studyPhases.includes(phase)) return false;
            }
        }
        if (sponsorClass !== 'all' && study.sponsor_class !== sponsorClass) return false;
        if (interventionModel !== 'all' && study.intervention_model !== interventionModel) return false;
        if (masking !== 'all' && study.masking !== masking) return false;
        if (primaryPurpose !== 'all' && study.primary_purpose !== primaryPurpose) return false;
        if (enrollmentType !== 'all' && study.enrollment_type !== enrollmentType) return false;
        if (healthyVolunteers !== 'all') {
            const acceptsHealthy = study.healthy_volunteers === true;
            if (healthyVolunteers === 'true' && !acceptsHealthy) return false;
            if (healthyVolunteers === 'false' && acceptsHealthy) return false;
        }
        if (populationAge !== 'all') {
            if (getStudyPediatricStatus(study) !== populationAge) return false;
        }
        if (conditionFilter !== 'all') {
            const conditions = study.conditions || [];
            if (!conditions.includes(conditionFilter)) return false;
        }
        // Hierarchical condition category filter
        if (conditionPrimaryFilter !== 'all' || conditionSecondaryFilter !== 'all') {
            if (!studyMatchesConditionFilter(study, conditionPrimaryFilter, conditionSecondaryFilter)) return false;
        }
        if (countryFilter !== 'all') {
            const countries = study.countries || [];
            const countryNames = countries.map(c => c.country);
            if (!countryNames.includes(countryFilter)) return false;
        }

        // Participant count range — null/undefined enrollment is excluded
        // whenever either bound is active
        const minPart = document.getElementById('min-participants')?.value;
        const maxPart = document.getElementById('max-participants')?.value;
        if (minPart !== '' || maxPart !== '') {
            const enroll = study.enrollment;
            if (enroll == null) return false;
            if (minPart !== '' && enroll < parseInt(minPart, 10)) return false;
            if (maxPart !== '' && enroll > parseInt(maxPart, 10)) return false;
        }

        // FDA regulatory status filter. A preserved null means the sponsor
        // never reported oversight status — distinct from an explicit "No"
        // (extractions before mid-2026 coerced nulls to false, so the
        // Unreported option only matches data extracted after that fix).
        if (fdaStatus !== 'all') {
            const dr = study.is_fda_regulated_drug, dv = study.is_fda_regulated_device;
            if (fdaStatus === 'drug' && dr !== true) return false;
            if (fdaStatus === 'device' && dv !== true) return false;
            if (fdaStatus === 'unapproved' && study.is_unapproved_device !== true) return false;
            if (fdaStatus === 'unreported' && !(dr == null && dv == null)) return false;
            if (fdaStatus === 'non-regulated' && (dr === true || dv === true ||
                study.is_unapproved_device === true || (dr == null && dv == null))) return false;
        }

        return true;
    });
}

function showDashboardSpinner() {
    const el = document.getElementById('dashboard-loading');
    if (el) el.style.display = 'flex';
}
function hideDashboardSpinner() {
    const el = document.getElementById('dashboard-loading');
    if (el) el.style.display = 'none';
}

// Each Overview tile says what its figure counts. The percentages get their
// own numerator, which is the number a reader reaches for next; the total
// gets the year window it was drawn from.
function renderOverviewTileContext(total, raceCount, ethCount, bothCount) {
    const set = (id, text) => {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    };
    const y0 = document.getElementById('year-start');
    const y1 = document.getElementById('year-end');
    set('stat-sub-total', y0 && y1 && !dashboardSummary
        ? `results posted ${y0.value}\u2013${y1.value}`
        : 'trials with results posted');
    const n = (c) => `${c.toLocaleString()} of ${total.toLocaleString()} trials`;
    set('stat-sub-race', total ? n(raceCount) : '\u2014');
    set('stat-sub-ethnicity', total ? n(ethCount) : '\u2014');
    set('stat-sub-both', total ? n(bothCount) : '\u2014');
}

// ── The Overview finding, and the filter selection in words ───────────────
// Both are generated from values already on this page. The finding quotes the
// four stat tiles and states the gap between two of them; it derives no new
// statistic, cites no year (the most recent year in the data is partial, so
// an endpoint would mislead), and asserts nothing when the cohort is empty.
// This is the geography tab's pattern generalised: a tab opens by saying what
// its data says.
function renderOverviewFinding(total, raceCount, ethCount, bothCount) {
    const box = document.getElementById('overview-finding');
    const head = document.getElementById('finding-headline');
    const ctx = document.getElementById('finding-context');
    if (!box || !head || !ctx) return;

    if (!total) {
        box.hidden = false;
        head.textContent = 'No trials match these filters.';
        ctx.textContent = 'Widen the year range or clear a filter to see a result.';
        return;
    }

    // Below this many trials a percentage in a headline reads as a finding
    // when it is really two or three studies. The geography tab withholds an
    // estimand under its support floor rather than printing a fragile number;
    // this is the same discipline on a filtered cohort — the counts are
    // reported instead, and nothing is asserted.
    const HEADLINE_MIN_TRIALS = 100;

    if (total < HEADLINE_MIN_TRIALS) {
        const verb = (n) => (n === 1 ? 'reports' : 'report');
        head.innerHTML = `<strong>${raceCount.toLocaleString()}</strong> of ` +
            `${total.toLocaleString()} trials ${verb(raceCount)} race; ` +
            `<strong>${bothCount.toLocaleString()}</strong> ${verb(bothCount)} ` +
            'race and ethnicity together.';
        ctx.textContent = `Too few trials to state a rate — under ${HEADLINE_MIN_TRIALS}, ` +
            'counts are reported instead. Widen the filters for a percentage.';
        box.hidden = false;
        return;
    }

    const pct = (n) => (n / total) * 100;
    const race = pct(raceCount), eth = pct(ethCount), both = pct(bothCount);
    const gap = race - both;

    head.innerHTML = `<strong>${race.toFixed(1)}%</strong> of these trials report race, ` +
        `but only <strong>${both.toFixed(1)}%</strong> report race and ethnicity together.`;
    ctx.textContent = `${total.toLocaleString()} trials · ` +
        `${gap.toFixed(1)}-point gap · ethnicity reported by ${eth.toFixed(1)}%`;
    box.hidden = false;
}

// The words above the filter panel. Reads the controls rather than the data,
// so it says what was ASKED for — which is what a reader needs in order to
// know what the numbers below it are about.
function renderFilterSummary(total, unfiltered) {
    const el = document.getElementById('filter-summary-text');
    if (!el) return;

    // The phone view renders pre-computed aggregates of the whole dataset and
    // applies no filters, so reading the (desktop) controls here would claim
    // a narrowing that was never applied.
    if (unfiltered) {
        el.innerHTML = `<b>${escapeHtml(total.toLocaleString())}</b> trials \u00b7 ` +
            'the full dataset, unfiltered \u00b7 filters are a desktop feature';
        return;
    }
    const val = (id) => {
        const n = document.getElementById(id);
        if (!n) return null;
        const v = n.tagName === 'SELECT' ? (n.options[n.selectedIndex] || {}).text : n.value;
        return v == null ? null : String(v).trim();
    };
    const isAll = (v) => !v || /^all\b/i.test(v);
    const bold = (v) => `<b>${escapeHtml(v)}</b>`;

    const parts = [];
    if (typeof total === 'number') parts.push(`${bold(total.toLocaleString())} trials`);

    const type = val('study-type');
    if (!isAll(type) && type) parts.push(bold(type.toLowerCase()));

    const y0 = val('year-start'), y1 = val('year-end');
    if (y0 && y1) parts.push(`results posted ${bold(y0 + '\u2013' + y1)}`);

    // Only narrowed dimensions earn a phrase; "all sponsors, all purposes,
    // all conditions, all statuses" is four phrases that say nothing.
    const narrowed = [
        ['sponsor', 'sponsor'], ['purpose', 'purpose'],
        ['condition-primary', 'condition'], ['condition-secondary', 'subcategory'],
        ['fda-status', 'FDA status']
    ].filter(([id]) => !isAll(val(id)))
     .map(([id, noun]) => `${noun} ${bold(val(id))}`);

    if (narrowed.length) parts.push(...narrowed);
    else parts.push('all sponsors, purposes and conditions');

    el.innerHTML = parts.join(' \u00b7 ');
}

function initFilterSummary() {
    const btn = document.getElementById('filter-summary-toggle');
    const panel = document.getElementById('filters');
    if (!btn || !panel) return;
    if (dashboardSummary) { btn.hidden = true; return; }   // no panel to open
    btn.addEventListener('click', () => {
        const open = panel.hidden;
        panel.hidden = !open;
        btn.setAttribute('aria-expanded', String(open));
    });
}

function renderDashboard() {
    if (!data && !dashboardSummary) return;

    showDashboardSpinner();

    // ── Mobile summary path: use pre-computed aggregates ──
    if (dashboardSummary) {
        const s = dashboardSummary;
        const t = s.totalStudies;
        document.getElementById('total-studies').textContent = t.toLocaleString();
        document.getElementById('race-reporting').textContent =
            t > 0 ? `${((s.cards.raceCount / t) * 100).toFixed(1)}%` : '0%';
        document.getElementById('ethnicity-reporting').textContent =
            t > 0 ? `${((s.cards.ethCount / t) * 100).toFixed(1)}%` : '0%';
        document.getElementById('both-reporting').textContent =
            t > 0 ? `${((s.cards.bothCount / t) * 100).toFixed(1)}%` : '0%';
        renderOverviewFinding(t, s.cards.raceCount, s.cards.ethCount, s.cards.bothCount);
        renderOverviewTileContext(t, s.cards.raceCount, s.cards.ethCount, s.cards.bothCount);
        renderFilterSummary(t, true);

        // All chart functions check dashboardSummary internally
        const stub = [];
        renderReportingTrends(stub);
        renderRaceDistribution(stub);
        renderRaceTrends(stub);
        renderRaceSubcategories('asian');
        renderRaceReportedParticipants(stub);
        renderRaceFullDistribution(stub);
        renderEthnicityDistribution(stub);
        renderEthnicityTrends(stub);
        renderEthnicitySubcategories(stub);
        renderEthnicityReportedParticipants(stub);
        renderEthnicityFullDistribution(stub);
        renderSexReportedParticipants(stub);
        renderSexFullDistribution(stub);
        renderSexDistribution(stub);
        renderSexTrends(stub);
        renderGenderReportedParticipants(stub);
        renderGenderFullDistribution(stub);
        renderGenderDistribution(stub);
        renderGenderTrends(stub);

        requestAnimationFrame(() => hideDashboardSpinner());
        return;
    }

    // ── Desktop path: full per-study aggregation ──
    const filtered = getFilteredData();

    // Update stats
    document.getElementById('total-studies').textContent = filtered.length.toLocaleString();

    const raceCount = filtered.filter(s => s.race?.reported).length;
    const ethCount = filtered.filter(s => s.ethnicity?.reported).length;
    const bothCount = filtered.filter(s => s.race?.reported && s.ethnicity?.reported).length;

    document.getElementById('race-reporting').textContent =
        filtered.length > 0 ? `${((raceCount / filtered.length) * 100).toFixed(1)}%` : '0%';
    document.getElementById('ethnicity-reporting').textContent =
        filtered.length > 0 ? `${((ethCount / filtered.length) * 100).toFixed(1)}%` : '0%';
    document.getElementById('both-reporting').textContent =
        filtered.length > 0 ? `${((bothCount / filtered.length) * 100).toFixed(1)}%` : '0%';
    renderOverviewFinding(filtered.length, raceCount, ethCount, bothCount);
    renderOverviewTileContext(filtered.length, raceCount, ethCount, bothCount);
    renderFilterSummary(filtered.length);

    // Render only the Overview tab chart immediately (the visible tab).
    // All other tab charts are rendered on-demand when their tab is clicked
    // (the tab-click handler already calls the appropriate render functions).
    renderReportingTrends(filtered);

    // Determine which tab is currently active and render its charts
    const activeTab = document.querySelector('.tab.active')?.dataset.tab;
    if (activeTab === 'race') {
        renderRaceDistribution(filtered);
        renderRaceTrends(filtered);
        renderRaceSubcategories('asian');
        renderRaceReportedParticipants(filtered);
        renderRaceFullDistribution(filtered);
    } else if (activeTab === 'ethnicity') {
        renderEthnicityDistribution(filtered);
        renderEthnicityTrends(filtered);
        renderEthnicitySubcategories(filtered);
        renderEthnicityReportedParticipants(filtered);
        renderEthnicityFullDistribution(filtered);
    } else if (activeTab === 'sex') {
        renderSexReportedParticipants(filtered);
        renderSexFullDistribution(filtered);
        renderSexDistribution(filtered);
        renderSexTrends(filtered);
    } else if (activeTab === 'gender') {
        renderGenderReportedParticipants(filtered);
        renderGenderFullDistribution(filtered);
        renderGenderDistribution(filtered);
        renderGenderTrends(filtered);
    } else if (activeTab === 'geography') {
        renderGeographyDashboard();
    } else if (activeTab === 'fda-oversight') {
        renderFdaOversight(filtered);
    }

    // Update table if visible
    const studiesTab = document.querySelector('.tab[data-tab="studies"]');
    if (studiesTab?.classList.contains('active')) {
        currentPage = 0;
        renderStudiesTable();
    }

    // Use requestAnimationFrame to hide spinner after paint
    requestAnimationFrame(() => hideDashboardSpinner());
}

/**
 * Calculate days between two dates
 * Handles partial dates (YYYY-MM or YYYY) by normalizing to first day
 */
function calculateDaysBetween(startDate, endDate) {
    if (!startDate || !endDate) return null;

    try {
        // Normalize partial dates
        function normalizeDate(dateStr) {
            const parts = dateStr.split('-');
            if (parts.length === 1) {
                // YYYY only
                return `${parts[0]}-01-01`;
            } else if (parts.length === 2) {
                // YYYY-MM
                return `${parts[0]}-${parts[1]}-01`;
            }
            // YYYY-MM-DD already
            return dateStr;
        }

        const start = new Date(normalizeDate(startDate));
        const end = new Date(normalizeDate(endDate));

        if (isNaN(start.getTime()) || isNaN(end.getTime())) {
            return null;
        }

        const diffTime = end - start;
        const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

        return diffDays;
    } catch (e) {
        return null;
    }
}

/**
 * Get time to report for a study
 * Tries completion_to_report_days field first, then calculates from dates
 */
function getTimeToReport(study) {
    // First try the pre-calculated field
    if (study.completion_to_report_days !== null && study.completion_to_report_days !== undefined) {
        return study.completion_to_report_days;
    }

    // Fall back to calculating from dates
    const completionDate = study.primary_completion_date || study.completion_date;
    const resultsDate = study.results_date;

    return calculateDaysBetween(completionDate, resultsDate);
}

/**
 * Render sparkline for time-to-report metric
 * Tufte principle: Small multiples allow micro/macro reading
 */
function renderSparkline(days) {
    if (days === null || days === undefined) {
        return '<span class="text-muted">N/A</span>';
    }

    const maxDays = 730;

    if (days === 0) {
        // Zero: neutral dot at center
        return `
            <div class="sparkline-cell sparkline-bidirectional">
                <div class="sparkline-left"></div>
                <div class="sparkline-center"></div>
                <div class="sparkline-right"></div>
                <span class="sparkline-value">0d</span>
            </div>
        `;
    }

    if (days < 0) {
        // Early reporting: blue bar growing left from center
        const absDays = Math.abs(days);
        const widthPercent = Math.min((absDays / maxDays) * 100, 100);
        return `
            <div class="sparkline-cell sparkline-bidirectional">
                <div class="sparkline-left">
                    <div class="sparkline-bar early" style="width: ${widthPercent}px" title="${days} days (early)"></div>
                </div>
                <div class="sparkline-center"></div>
                <div class="sparkline-right"></div>
                <span class="sparkline-value">${days}d</span>
            </div>
        `;
    }

    // Late reporting: bar growing right from center
    const widthPercent = Math.min((days / maxDays) * 100, 100);
    let colorClass = 'fast';
    if (days > 365) {
        colorClass = 'slow';
    } else if (days > 180) {
        colorClass = 'medium';
    }

    return `
        <div class="sparkline-cell sparkline-bidirectional">
            <div class="sparkline-left"></div>
            <div class="sparkline-center"></div>
            <div class="sparkline-right">
                <div class="sparkline-bar ${colorClass}" style="width: ${widthPercent}px" title="${days} days"></div>
            </div>
            <span class="sparkline-value">${days}d</span>
        </div>
    `;
}

/**
 * Build the display label for a single publication reference.
 * Priority: "(Journal) Title" → citation → "Publication N"
 */
function pubLabel(ref, index) {
    if (ref.title && ref.journal) {
        return `(${ref.journal}) ${ref.title}`;
    }
    if (ref.title) {
        return ref.title;
    }
    if (ref.citation) {
        return ref.citation;
    }
    return `Publication ${index + 1}`;
}

/**
 * Render an inline vertical list of publication links for a table cell.
 */
function renderPublications(study) {
    const refs = study.references || [];
    if (refs.length === 0) {
        // Mobile-slim data: show count badge if available
        if (study.reference_count > 0) {
            return `<span class="text-muted" title="${study.reference_count} publication(s) — open full view for details">${study.reference_count} pub${study.reference_count > 1 ? 's' : ''}</span>`;
        }
        return '<span class="text-muted">-</span>';
    }

    const items = refs.map((ref, i) => {
        const url = ref.pmid ? `https://pubmed.ncbi.nlm.nih.gov/${ref.pmid}/` : '#';
        return `<a href="${url}" target="_blank" class="pub-list-link">${escapeHtml(pubLabel(ref, i))}</a>`;
    });

    const showAll = refs.length > 3
        ? `<a href="#" class="pub-list-more" onclick="showPublications('${study.nct_id}'); return false;">${refs.length} total &rarr;</a>`
        : '';

    return `<div class="pub-list">${items.join('')}</div>${showAll}`;
}

/**
 * Show full publications modal (used when the cell list is truncated
 * and the user clicks "show all").
 */
function showPublications(nctId) {
    const study = data.find(s => s.nct_id === nctId);
    if (!study || !study.references || study.references.length === 0) return;

    let html = `<div class="breakdown-modal">
        <h4>Publications \u2014 ${nctId}</h4>
        <p class="modal-subtitle">Click outside to close</p>
        <div style="max-height: 400px; overflow-y: auto;">`;

    study.references.forEach((ref, idx) => {
        const url = ref.pmid ? `https://pubmed.ncbi.nlm.nih.gov/${ref.pmid}/` : '#';
        const source = ref.source === 'pubmed' ? 'PubMed' : 'ClinicalTrials.gov';

        html += `
            <div style="margin-bottom: 1rem; padding: 0.75rem; background: #f9fafb; border-radius: 0.25rem;">
                <div style="font-weight: 600; margin-bottom: 0.25rem;">
                    <a href="${url}" target="_blank" style="color: var(--primary-color);">
                        ${escapeHtml(pubLabel(ref, idx))}
                    </a>
                    <span style="font-size: 0.75rem; color: #6b7280; margin-left: 0.5rem;">(${source}${ref.pmid ? ' \u2022 PMID ' + ref.pmid : ''})</span>
                </div>
            </div>
        `;
    });

    html += `</div>
        <button class="modal-close-btn" onclick="closeBreakdown()">Close</button>
    </div>`;

    const overlay = document.getElementById('breakdown-overlay');
    overlay.innerHTML = html;
    overlay.style.display = 'flex';
}

let studiesTabReady = false;

async function prepareStudiesTab() {
    const loadingScreen = document.getElementById('studies-loading-screen');
    const readyContent = document.getElementById('studies-ready-content');

    initColumnPicker();

    if (studiesTabReady) {
        // Already loaded — just re-render
        currentPage = 0;
        renderStudiesTable();
        return;
    }

    // Show loading screen, hide content
    if (loadingScreen) loadingScreen.style.display = '';
    if (readyContent) readyContent.style.display = 'none';

    // Preload detail data so expand clicks are instant
    await loadDetailData();

    studiesTabReady = true;

    // Hide loading screen, show content
    if (loadingScreen) loadingScreen.style.display = 'none';
    if (readyContent) readyContent.style.display = '';

    currentPage = 0;
    renderStudiesTable();
}

function renderStudiesTable() {
    const tbody = document.getElementById('studies-table-body');
    const countSpan = document.getElementById('study-count');
    if (!tbody) return;

    let filtered = getFilteredData();

    // Apply table-specific search
    const tableSearch = document.getElementById('study-table-search')?.value?.toLowerCase().trim();
    if (tableSearch) {
        filtered = filtered.filter(s => {
            return (s.nct_id?.toLowerCase().includes(tableSearch)) ||
                   (s.brief_title?.toLowerCase().includes(tableSearch));
        });
    }

    // Apply sorting
    if (currentSort.field) {
        filtered.sort((a, b) => {
            let aVal = a[currentSort.field];
            let bVal = b[currentSort.field];

            // Handle numeric fields
            if (currentSort.field === 'enrollment' ||
                currentSort.field === 'completion_to_report_days' ||
                currentSort.field === 'start_to_report_days') {
                // Treat null/undefined as very large numbers for sorting (put at end)
                aVal = (aVal === null || aVal === undefined) ? 999999 : parseInt(aVal) || 0;
                bVal = (bVal === null || bVal === undefined) ? 999999 : parseInt(bVal) || 0;
            }

            // Handle string comparison
            if (typeof aVal === 'string') aVal = aVal.toLowerCase();
            if (typeof bVal === 'string') bVal = bVal.toLowerCase();

            if (aVal < bVal) return currentSort.direction === 'asc' ? -1 : 1;
            if (aVal > bVal) return currentSort.direction === 'asc' ? 1 : -1;
            return 0;
        });
    }

    // Update sort indicators
    document.querySelectorAll('.studies-table th.sortable').forEach(th => {
        th.classList.remove('sorted-asc', 'sorted-desc');
        if (th.dataset.sort === currentSort.field) {
            th.classList.add(`sorted-${currentSort.direction}`);
        }
    });

    // Paginate
    const totalCount = filtered.length;
    const totalPages = Math.max(1, Math.ceil(totalCount / studiesPageSize));
    currentPage = Math.max(0, Math.min(currentPage, totalPages - 1));
    const pageStart = currentPage * studiesPageSize;
    const pageData = filtered.slice(pageStart, pageStart + studiesPageSize);

    // Render rows for current page only
    tbody.innerHTML = pageData.map(study => {
        // Format age range
        const minAge = study.min_age || 'N/A';
        const maxAge = study.max_age || 'N/A';
        const ageRange = minAge === 'N/A' && maxAge === 'N/A' ? 'N/A' : `${minAge} - ${maxAge}`;

        // Format enrollment with type indicator
        const enrollmentText = `${(study.enrollment || 0).toLocaleString()}`;
        const enrollmentBadge = study.enrollment_type === 'ANTICIPATED' ?
            `<span class="enrollment-badge" title="Anticipated enrollment">${enrollmentText}*</span>` : enrollmentText;

        // Format status with tooltip for stopped studies
        const statusText = study.status || 'N/A';
        const statusWithReason = study.why_stopped ?
            `<span title="Reason: ${escapeHtml(study.why_stopped)}" class="status-stopped">${statusText}</span>` : statusText;

        const startDate = study.start_date ? study.start_date : '<span class="text-muted">\u2014</span>';
        const endDate = (study.primary_completion_date || study.completion_date) ? (study.primary_completion_date || study.completion_date) : '<span class="text-muted">\u2014</span>';
        const resultsDate = study.results_date ? study.results_date : '<span class="text-muted">\u2014</span>';

        return `
        <tr>
            <td class="col-nct">
                <a href="https://clinicaltrials.gov/study/${study.nct_id}"
                   target="_blank"
                   class="nct-link">${study.nct_id}</a>
            </td>
            <td class="col-title">${escapeHtml(study.brief_title || 'Untitled')}</td>
            <td class="col-results-date">${resultsDate}</td>
            <td class="text-center col-reported">${renderReportedCell(study)}</td>
            <td class="col-time-to-report">${renderSparkline(getTimeToReport(study))}</td>
            <td class="text-center col-details">
                <button class="details-btn" onclick="showStudyDetails('${study.nct_id}')" title="View full study details">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M8 4.5a.5.5 0 0 1 .5.5v3h3a.5.5 0 0 1 0 1h-3v3a.5.5 0 0 1-1 0v-3h-3a.5.5 0 0 1 0-1h3v-3A.5.5 0 0 1 8 4.5z"/>
                    </svg>
                </button>
            </td>
            <td class="text-center col-race">${renderDemographicCell(study, 'race')}</td>
            <td class="text-center col-ethnicity">${renderDemographicCell(study, 'ethnicity')}</td>
            <td class="text-center col-sex">${renderDemographicCell(study, 'sex')}</td>
            <td class="text-center col-gender">${renderDemographicCell(study, 'gender')}</td>
            <td class="text-center col-geography">${renderGeographyCell(study)}</td>
            <td class="text-right col-enrollment">${enrollmentBadge}</td>
            <td class="col-start">${startDate}</td>
            <td class="col-end">${endDate}</td>
            <td class="col-phase"><span class="phase-badge">${study.phase || '\u2014'}</span></td>
            <td class="text-center col-fda-drug">${renderFdaCell(study.is_fda_regulated_drug, 'Yes: FDA Regulated Drug')}</td>
            <td class="text-center col-fda-device">${renderFdaCell(study.is_fda_regulated_device, 'Yes: FDA Regulated Device')}</td>
            <td class="text-center col-unapproved">${renderFdaCell(study.is_unapproved_device, 'Yes: Unapproved Device')}</td>
            <td class="col-publications">${renderPublications(study)}</td>
        </tr>
        `;
    }).join('');

    // Update count
    if (countSpan) {
        if (totalCount === 0) {
            countSpan.textContent = 'No studies found';
        } else {
            const end = Math.min(pageStart + studiesPageSize, totalCount);
            countSpan.textContent = `Showing ${(pageStart + 1).toLocaleString()}\u2013${end.toLocaleString()} of ${totalCount.toLocaleString()} studies`;
        }
    }

    renderPagination(totalCount);

    // Force horizontal scroll on the table wrapper
    fixTableScroll();
}

/**
 * Set up table horizontal scrolling:
 * - Left/right arrow buttons that scroll on click (and hold)
 * - Drag-to-scroll (click and drag the table horizontally)
 * - Arrow visibility updates based on scroll position
 */
function initTableScroll() {
    const wrapper = document.getElementById('studies-table-wrapper');
    const btnLeft = document.getElementById('table-scroll-left');
    const btnRight = document.getElementById('table-scroll-right');
    if (!wrapper || !btnLeft || !btnRight) return;

    const SCROLL_AMOUNT = 300; // pixels per click

    // -- Update arrow visibility based on scroll position --
    // With the curated column set the table usually fits, so the whole scroll
    // apparatus — arrows and the drag bar — hides itself when there is
    // nothing to scroll. An affordance for an action you cannot take is worse
    // than no affordance.
    function updateArrows() {
        const maxScroll = wrapper.scrollWidth - wrapper.clientWidth;
        const scrollable = maxScroll > 1;
        const dragBar = document.getElementById('table-drag-bar');
        if (dragBar) dragBar.hidden = !scrollable;
        btnLeft.classList.toggle('hidden', !scrollable || wrapper.scrollLeft <= 0);
        btnRight.classList.toggle('hidden', !scrollable || wrapper.scrollLeft >= maxScroll - 1);
    }
    // The column picker changes the table's width, so re-check after it does.
    document.addEventListener('civicsample:columnschanged', updateArrows);

    wrapper.addEventListener('scroll', updateArrows);
    // Also update on resize
    window.addEventListener('resize', updateArrows);

    // -- Click to scroll --
    btnLeft.addEventListener('click', function () {
        wrapper.scrollBy({ left: -SCROLL_AMOUNT, behavior: 'smooth' });
    });
    btnRight.addEventListener('click', function () {
        wrapper.scrollBy({ left: SCROLL_AMOUNT, behavior: 'smooth' });
    });

    // -- Hold-to-scroll (continuous scroll while button is held) --
    let holdInterval = null;
    function startHold(direction) {
        holdInterval = setInterval(function () {
            wrapper.scrollBy({ left: direction * 4 });
        }, 16);
    }
    function stopHold() {
        if (holdInterval) { clearInterval(holdInterval); holdInterval = null; }
    }

    btnLeft.addEventListener('mousedown', function () { startHold(-1); });
    btnRight.addEventListener('mousedown', function () { startHold(1); });
    document.addEventListener('mouseup', stopHold);

    // -- Drag to scroll on the drag bar only --
    const dragBar = document.getElementById('table-drag-bar');
    if (dragBar) {
        let isDragging = false;
        let startX = 0;
        let scrollStart = 0;

        dragBar.addEventListener('mousedown', function (e) {
            isDragging = true;
            startX = e.pageX;
            scrollStart = wrapper.scrollLeft;
            dragBar.style.cursor = 'grabbing';
            e.preventDefault();
        });

        document.addEventListener('mousemove', function (e) {
            if (!isDragging) return;
            const dx = e.pageX - startX;
            wrapper.scrollLeft = scrollStart - dx;
        });

        document.addEventListener('mouseup', function () {
            if (isDragging) {
                isDragging = false;
                dragBar.style.cursor = 'grab';
            }
        });
    }

    // Initial arrow state. Measured once now and again after the browser has
    // laid the table out: on the first render the wrapper is measured before
    // the table picks up its --studies-min-width, so the first reading says
    // "scrollable" for a table that then fits, and nothing re-measured until
    // the next scroll or column change.
    _updateTableArrows = updateArrows;
    updateArrows();
    requestAnimationFrame(() => requestAnimationFrame(updateArrows));
}

// Backward compat — old call sites invoke fixTableScroll()
let _tableScrollInitialized = false;
// Set by initTableScroll so the re-render path runs the same function rather
// than a second copy of the logic. The copy that used to live below had not
// learned to hide the drag bar, so on the first render of the Studies tab the
// bar appeared over a table that does not scroll.
let _updateTableArrows = null;
function fixTableScroll() {
    if (!_tableScrollInitialized) {
        _tableScrollInitialized = true;
        initTableScroll();
    } else if (_updateTableArrows) {
        _updateTableArrows();
    }
}

function renderPagination(total) {
    const container = document.getElementById('pagination');
    if (!container) return;

    const totalPages = Math.max(1, Math.ceil(total / studiesPageSize));
    if (totalPages <= 1) {
        container.innerHTML = '';
        return;
    }

    let html = '<div class="pagination-controls">';
    html += `<button class="page-btn" ${currentPage === 0 ? 'disabled' : ''} onclick="goToPage(${currentPage - 1})">Prev</button>`;

    // Show page numbers with ellipsis for large ranges
    const pages = [];
    for (let i = 0; i < totalPages; i++) {
        if (i === 0 || i === totalPages - 1 || Math.abs(i - currentPage) <= 2) {
            pages.push(i);
        }
    }

    let lastPage = -1;
    for (const p of pages) {
        if (lastPage !== -1 && p - lastPage > 1) {
            html += '<span class="page-ellipsis">...</span>';
        }
        html += `<button class="page-btn ${p === currentPage ? 'active' : ''}" onclick="goToPage(${p})">${p + 1}</button>`;
        lastPage = p;
    }

    html += `<button class="page-btn" ${currentPage === totalPages - 1 ? 'disabled' : ''} onclick="goToPage(${currentPage + 1})">Next</button>`;
    html += '</div>';
    container.innerHTML = html;
}

function goToPage(page) {
    currentPage = page;
    renderStudiesTable();
    document.getElementById('studies-table')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

window.goToPage = goToPage;



function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function truncateText(text, maxLength) {
    if (!text || text === 'N/A') return text;
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength - 3) + '...';
}

function renderFdaCell(value, tooltipText) {
    if (value === true) {
        return `<span title="${tooltipText || 'Yes'}"><svg width="16" height="16" viewBox="0 0 16 16" fill="#10b981"><path d="M13.485 3.929a.75.75 0 0 1 .086 1.056l-6 7a.75.75 0 0 1-1.1.043l-3-3a.75.75 0 1 1 1.06-1.06l2.419 2.418 5.48-6.371a.75.75 0 0 1 1.055-.086z"/></svg></span>`;
    }
    if (value === false) {
        return '<span class="text-muted" title="Sponsor reported No">No</span>';
    }
    return '<span class="text-muted" title="Oversight status not reported">\u2014</span>';
}

// ── The Studies table's optional columns ─────────────────────────────────
// The table carried 18 columns, five of them near-identical yes/no icons for
// race, ethnicity, sex, gender and geography. Those five collapse into one
// "Reported" cell of five pips; the rest of the detail moves behind a picker.
// Every column stays in the DOM and is hidden by class, so sorting, the
// data-sort bindings and every existing cell renderer are untouched.
const STUDY_COLUMNS = [
    // `w` is the width this column needs; the table's min-width is the sum of
    // the visible ones, so the default view fits and a wide selection scrolls.
    { key: 'reported', label: 'Reported', on: true, fixed: true, w: 120 },
    { key: 'nct', label: 'NCT ID', on: true, fixed: true, w: 130 },
    { key: 'title', label: 'Title', on: true, fixed: true, w: 400 },
    { key: 'results-date', label: 'Results reported', on: true, w: 140 },
    { key: 'details', label: 'Details', on: true, w: 80 },
    { key: 'enrollment', label: 'Participants', on: true, w: 120 },
    { key: 'phase', label: 'Phase', on: true, w: 100 },
    { key: 'race', label: 'Race', on: false, w: 90 },
    { key: 'ethnicity', label: 'Ethnicity', on: false, w: 100 },
    { key: 'sex', label: 'Sex', on: false, w: 80 },
    { key: 'gender', label: 'Gender', on: false, w: 90 },
    { key: 'geography', label: 'Geography', on: false, w: 110 },
    { key: 'time-to-report', label: 'Time to report', on: false, w: 140 },
    { key: 'start', label: 'Study start date', on: false, w: 140 },
    { key: 'end', label: 'Study end date', on: false, w: 140 },
    { key: 'fda-drug', label: 'FDA drug', on: false, w: 110 },
    { key: 'fda-device', label: 'FDA device', on: false, w: 120 },
    { key: 'unapproved', label: 'Unapproved device', on: false, w: 160 },
    { key: 'publications', label: 'Publications', on: false, w: 160 }
];
const STUDY_COLUMNS_KEY = 'civicsample.studyColumns';

// The five dimensions, in a fixed order, as pips. A filled pip is reported;
// a hollow one is not. The same five columns are still available singly.
const REPORTED_DIMENSIONS = [
    { field: 'race', label: 'Race' },
    { field: 'ethnicity', label: 'Ethnicity' },
    { field: 'sex', label: 'Sex' },
    { field: 'gender', label: 'Gender' },
    { field: 'geography', label: 'Geography' }
];

// The Geography column counts a study as having geography when EITHER source
// is present (renderGeographyCell), so the pip has to use the same test or the
// summary cell and the detail column could contradict each other. In today's
// data every record with sites also has countries, so this is a latent
// disagreement rather than a visible one — which is exactly when it is
// cheapest to remove.
function studyHasGeography(study) {
    return (study.study_sites || []).length > 0 || (study.countries || []).length > 0;
}

function studyReportsDimension(study, field) {
    if (field === 'geography') return studyHasGeography(study);
    return !!study[field]?.reported;
}

function renderReportedCell(study) {
    const flags = REPORTED_DIMENSIONS.map(d => ({ ...d, on: studyReportsDimension(study, d.field) }));
    const n = flags.filter(f => f.on).length;
    const pips = flags.map(f =>
        `<span class="pip ${f.on ? 'pip-on' : 'pip-off'}" aria-hidden="true"></span>`).join('');
    const title = flags.map(f => `${f.label}: ${f.on ? 'reported' : 'not reported'}`).join(', ');
    return `<span class="reported-cell" title="${escapeHtml(title)}">` +
        `<span class="pips">${pips}</span>` +
        `<span class="pip-count">${n} of 5</span>` +
        `<span class="sr-only">${escapeHtml(title)}</span></span>`;
}

function loadStudyColumns() {
    const on = new Set(STUDY_COLUMNS.filter(c => c.on).map(c => c.key));
    try {
        const saved = JSON.parse(localStorage.getItem(STUDY_COLUMNS_KEY) || 'null');
        if (Array.isArray(saved)) {
            const valid = new Set(STUDY_COLUMNS.map(c => c.key));
            const restored = saved.filter(k => valid.has(k));
            if (restored.length) {
                on.clear();
                restored.forEach(k => on.add(k));
                STUDY_COLUMNS.filter(c => c.fixed).forEach(c => on.add(c.key));
            }
        }
    } catch (e) { /* a blocked or corrupt store just means the defaults */ }
    return on;
}

function applyStudyColumns(on) {
    const table = document.getElementById('studies-table');
    if (!table) return;
    STUDY_COLUMNS.forEach(c => table.classList.toggle('hide-' + c.key, !on.has(c.key)));
    const width = STUDY_COLUMNS.filter(c => on.has(c.key)).reduce((a, c) => a + (c.w || 100), 0);
    table.style.setProperty('--studies-min-width', width + 'px');
    document.dispatchEvent(new CustomEvent('civicsample:columnschanged'));
    try {
        localStorage.setItem(STUDY_COLUMNS_KEY, JSON.stringify([...on]));
    } catch (e) { /* the choice just does not persist */ }
}

function initColumnPicker() {
    const menu = document.getElementById('column-picker-menu');
    if (!menu || menu.dataset.wired) return;
    menu.dataset.wired = '1';
    const on = loadStudyColumns();
    menu.innerHTML = STUDY_COLUMNS.filter(c => !c.fixed).map(c =>
        `<label class="column-option"><input type="checkbox" value="${c.key}"` +
        `${on.has(c.key) ? ' checked' : ''}> ${escapeHtml(c.label)}</label>`).join('');
    menu.addEventListener('change', () => {
        const chosen = new Set([...menu.querySelectorAll('input:checked')].map(i => i.value));
        STUDY_COLUMNS.filter(c => c.fixed).forEach(c => chosen.add(c.key));
        applyStudyColumns(chosen);
    });
    document.addEventListener('click', (e) => {
        const picker = document.getElementById('column-picker');
        if (picker && picker.open && !e.target.closest('#column-picker')) picker.open = false;
    });
    applyStudyColumns(on);
}

function renderDemographicCell(study, field) {
    const fieldData = study[field];
    if (!fieldData?.reported) {
        return '<span class="demo-disabled" title="No data reported">✗</span>';
    }

    // Get raw categories for tooltip
    const rawCategories = fieldData.raw_categories || [];
    let tooltipText = 'Click to view demographic breakdown';

    if (rawCategories.length > 0) {
        const summaries = rawCategories.slice(0, 3).map(rc => {
            const confidence = rc.confidence === 'high' ? '✓' :
                             rc.confidence === 'medium' ? '≈' : '⚠';
            return `${confidence} "${rc.original}"`;
        }).join('; ');

        const moreCount = rawCategories.length > 3 ? ` +${rawCategories.length - 3} more` : '';
        tooltipText = `Raw data: ${summaries}${moreCount}. Click to view breakdown.`;
    }

    return `<button class="demo-badge"
                    onclick="showBreakdown('${study.nct_id}', '${field}')"
                    title="${escapeHtml(tooltipText)}">
                <span class="demo-badge-check">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M20 6L9 17L4 12" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                </span>
            </button>`;
}

function renderGeographyCell(study) {
    const sites = study.study_sites || [];
    const countries = study.countries || [];

    if (!studyHasGeography(study)) {
        return '<span class="demo-disabled" title="No geography data">✗</span>';
    }

    const countryCount = sites.length > 0
        ? [...new Set(sites.map(s => s.country).filter(Boolean))].length
        : countries.length;
    const siteCount = sites.length || countries.length;
    const tooltipText = `${siteCount} site${siteCount !== 1 ? 's' : ''} in ${countryCount} countr${countryCount !== 1 ? 'ies' : 'y'}. Click to view details.`;

    return `<button class="demo-badge"
                    onclick="showGeographyBreakdown('${study.nct_id}')"
                    title="${escapeHtml(tooltipText)}">
                <span class="demo-badge-check">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M20 6L9 17L4 12" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                </span>
            </button>`;
}

async function showGeographyBreakdown(nctId) {
    const study = data.find(s => s.nct_id === nctId);
    if (!study) return;

    // Lazy-load detail data for full site info
    await loadDetailData();
    const detail = detailCache[nctId] || {};
    const fullStudy = Object.assign({}, study, detail);

    const sitesHtml = renderStudySites(fullStudy);

    const html = `<div class="breakdown-modal">
        <h4>Study Sites \u2014 ${nctId}</h4>
        <p class="modal-subtitle">${escapeHtml(fullStudy.brief_title || '')}</p>
        <p class="modal-subtitle">Click outside to close</p>
        <div style="max-height: 500px; overflow-y: auto;">
            ${sitesHtml}
        </div>
        <button class="modal-close-btn" onclick="closeBreakdown()">Close</button>
    </div>`;

    const overlay = document.getElementById('breakdown-overlay');
    overlay.innerHTML = html;
    overlay.style.display = 'flex';
}

function showBreakdown(nctId, categoryName) {
    const study = data.find(s => s.nct_id === nctId);
    if (!study) return;

    const fieldData = study[categoryName];
    if (!fieldData?.reported) return;

    const categoryDisplay = categoryName.charAt(0).toUpperCase() + categoryName.slice(1);

    // Build breakdown HTML
    let html = `<div class="breakdown-modal">
        <h4>${categoryDisplay} Distribution - ${nctId}</h4>
        <p class="modal-subtitle">Click outside to close</p>
        <table class="breakdown-table">
            <thead><tr><th>NIH/OMB Category</th><th>Original Label</th><th>Match Quality</th><th>Count</th><th>Percent</th></tr></thead>
            <tbody>`;

    if (categoryName === 'race') {
        // Race: show every standard NIH/OMB category; mark unreported ones with ✗
        const ombCategories = [
            { key: 'american_indian_alaska_native',    display: 'American Indian or Alaska Native' },
            { key: 'asian',                            display: 'Asian' },
            { key: 'black_african_american',           display: 'Black or African American' },
            { key: 'native_hawaiian_pacific_islander', display: 'Native Hawaiian or Pacific Islander' },
            { key: 'white',                            display: 'White' },
            { key: 'more_than_one_race',               display: 'More than one race' },
            { key: 'unknown_not_reported',             display: 'Unknown or Not Reported' }
        ];

        const ombTotals     = study.race?.omb_totals    || {};
        const rawCategories = study.race?.raw_categories || [];

        // Which OMB categories actually appear in this study's baseline data
        // In mobile-slim mode, raw_categories is missing; fall back to non-zero omb_totals
        const reportedSet = rawCategories.length > 0
            ? new Set(rawCategories.map(rc => rc.omb_category))
            : new Set(Object.entries(ombTotals).filter(([, v]) => v > 0).map(([k]) => k));

        // Denominator includes all standard categories + any "other" unmapped counts
        const grandTotal = ombCategories.reduce((s, c) => s + (ombTotals[c.key] || 0), 0)
                         + (ombTotals.other || 0);

        for (const cat of ombCategories) {
            if (!reportedSet.has(cat.key)) {
                // Category not part of this study's reporting structure
                html += `<tr class="not-reported-row">
                    <td>${escapeHtml(cat.display)}</td>
                    <td class="original-label">Not reported</td>
                    <td class="text-center"><span class="match-low">✗</span></td>
                    <td>—</td>
                    <td>—</td>
                </tr>`;
                continue;
            }

            const count   = ombTotals[cat.key] || 0;
            const percent = grandTotal > 0 ? ((count / grandTotal) * 100).toFixed(1) : '0.0';

            // Aggregate original labels and best match quality from raw_categories
            const matching       = rawCategories.filter(rc => rc.omb_category === cat.key);
            const originalLabels = matching.length > 0
                ? [...new Set(matching.map(rc => rc.original))].join(', ')
                : cat.display;  // Fallback for mobile-slim
            const bestConfidence = matching.length > 0
                ? (matching.some(rc => rc.confidence === 'high')   ? 'high'   :
                   matching.some(rc => rc.confidence === 'medium') ? 'medium' : 'low')
                : null;
            const hasFuzzy       = matching.some(rc => rc.flags?.some(f => f.includes('fuzzy_match')));
            const hasUnmapped    = matching.some(rc => rc.flags?.includes('unmapped'));

            let matchQuality = '';
            if (bestConfidence === null) {
                matchQuality = '<span class="match-na">-</span>';
            } else if (bestConfidence === 'high') {
                matchQuality = '<span class="match-high" title="Exact or case-insensitive match">✓ Exact</span>';
            } else if (bestConfidence === 'medium' || hasFuzzy) {
                matchQuality = '<span class="match-medium" title="Fuzzy string matching used">≈ Fuzzy</span>';
            } else if (hasUnmapped) {
                matchQuality = '<span class="match-low" title="Could not map to NIH/OMB category">⚠ Unmapped</span>';
            } else {
                matchQuality = '<span class="match-na">-</span>';
            }

            html += `<tr>
                <td>${escapeHtml(cat.display)}</td>
                <td class="original-label">${escapeHtml(originalLabels)}</td>
                <td class="text-center">${matchQuality}</td>
                <td>${count.toLocaleString()}</td>
                <td style="--percent: ${percent}">${percent}%</td>
            </tr>`;
        }

        // "Other" row only when unmapped labels contributed counts
        if (ombTotals.other > 0) {
            const otherRaw    = rawCategories.filter(rc => rc.omb_category === 'other');
            const otherLabels = otherRaw.length > 0
                ? [...new Set(otherRaw.map(rc => rc.original))].join(', ')
                : 'Other';
            const otherPct    = grandTotal > 0 ? ((ombTotals.other / grandTotal) * 100).toFixed(1) : '0.0';
            html += `<tr>
                <td>Other</td>
                <td class="original-label">${escapeHtml(otherLabels)}</td>
                <td class="text-center"><span class="match-low" title="Could not map to NIH/OMB category">⚠ Unmapped</span></td>
                <td>${ombTotals.other.toLocaleString()}</td>
                <td style="--percent: ${otherPct}">${otherPct}%</td>
            </tr>`;
        }
    } else {
        // Generic path for ethnicity / sex — build from omb_totals + raw_categories
        const rawCategories = fieldData.raw_categories || [];
        const totals = fieldData.omb_totals || fieldData.totals || {};
        const grandTotal = Object.values(totals).reduce((s, v) => s + (v || 0), 0);

        // Sort by count descending
        const entries = Object.entries(totals)
            .filter(([, count]) => count > 0)
            .sort((a, b) => b[1] - a[1]);

        for (const [key, count] of entries) {
            const displayName = formatOmbCategory(key);
            const percent = grandTotal > 0 ? ((count / grandTotal) * 100).toFixed(1) : '0.0';

            // Find matching raw category for original label and confidence
            const matching = rawCategories.filter(rc =>
                rc.omb_category === key || rc.category === key
            );
            const originalLabels = matching.length > 0
                ? [...new Set(matching.map(rc => rc.original))].join(', ')
                : displayName;  // Fallback for mobile-slim
            const bestConfidence = matching.length > 0
                ? (matching.some(rc => rc.confidence === 'high') ? 'high' :
                   matching.some(rc => rc.confidence === 'medium') ? 'medium' : 'low')
                : null;
            const hasFuzzy = matching.some(rc => rc.flags?.some(f => f.includes('fuzzy_match')));
            const hasUnmapped = matching.some(rc => rc.flags?.includes('unmapped'));

            let matchQuality = '';
            if (bestConfidence === null) {
                matchQuality = '<span class="match-na">-</span>';
            } else if (bestConfidence === 'high') {
                matchQuality = '<span class="match-high" title="Exact or case-insensitive match">✓ Exact</span>';
            } else if (bestConfidence === 'medium' || hasFuzzy) {
                matchQuality = '<span class="match-medium" title="Fuzzy string matching used">≈ Fuzzy</span>';
            } else if (hasUnmapped) {
                matchQuality = '<span class="match-low" title="Could not map to NIH/OMB category">⚠ Unmapped</span>';
            } else {
                matchQuality = '<span class="match-na">-</span>';
            }

            html += `<tr>
                <td>${escapeHtml(displayName)}</td>
                <td class="original-label">${escapeHtml(originalLabels)}</td>
                <td class="text-center">${matchQuality}</td>
                <td>${count.toLocaleString()}</td>
                <td style="--percent: ${percent}">${percent}%</td>
            </tr>`;
        }
    }

    html += `</tbody></table>`;

    // Quarantined labels section — show anomalous labels that were excluded
    // from demographic totals because they don't match any plausible
    // demographic term (e.g. birth control methods in a Race table)
    const quarantined = study[categoryName]?.quarantined_labels || [];
    if (quarantined.length > 0) {
        html += `<div class="quarantine-section">
            <h5 class="quarantine-header">Quarantined Labels (Manual Review Needed)</h5>
            <p class="quarantine-note">These labels were found in a demographic table but do not match any known demographic category. Their counts have been <strong>excluded</strong> from the totals above to prevent data pollution.</p>
            <table class="breakdown-table quarantine-table">
                <thead><tr><th>Original Label</th><th>Count</th><th>Reason</th></tr></thead>
                <tbody>`;
        for (const q of quarantined) {
            const reason = (q.reason || 'unmapped').replace(/_/g, ' ');
            html += `<tr>
                <td>${escapeHtml(q.original)}</td>
                <td>${(q.count || 0).toLocaleString()}</td>
                <td><span class="match-low">${escapeHtml(reason)}</span></td>
            </tr>`;
        }
        html += `</tbody></table></div>`;
    }

    // If any category came from a Customized or combined measure, add an
    // explanatory note so the user understands why some labels differ from
    // standard NIH/OMB categories
    const allRaw = study[categoryName]?.raw_categories || [];
    if (allRaw.some(rc => rc.flags?.includes('customized_table'))) {
        html += `<p class="modal-note modal-note-custom"><strong>Note:</strong> This study used a customized measure for ${categoryDisplay.toLowerCase()} that does not follow standard NIH/OMB categories. Labels are mapped to the closest standard category where possible; categories that could not be mapped are shown as "Other / Unmapped" with their original label preserved.</p>`;
    }

    html += `
        <p class="modal-note"><strong>About Match Quality:</strong> "Exact" means the label matched our NIH/OMB mappings directly. "Fuzzy" means approximate string matching was used. "Unmapped" means the original label couldn't be classified into standard categories.</p>
        <button class="modal-close-btn" onclick="closeBreakdown()">Close</button>
    </div>`;

    // Display modal
    const overlay = document.getElementById('breakdown-overlay');
    overlay.innerHTML = html;
    overlay.style.display = 'flex';
}

function formatOmbCategory(ombCat) {
    // Convert snake_case to Title Case with spaces
    return ombCat.split('_').map(word =>
        word.charAt(0).toUpperCase() + word.slice(1)
    ).join(' ');
}

function closeBreakdown() {
    document.getElementById('breakdown-overlay').style.display = 'none';
}

// Make functions available globally
window.showBreakdown = showBreakdown;
window.closeBreakdown = closeBreakdown;
window.showGeographyBreakdown = showGeographyBreakdown;

/**
 * Derive the top-level funding category from the lead sponsor class
 * and the collaborators list.
 *
 * Hierarchy (first match wins):
 *   Industry  – lead is INDUSTRY
 *   NIH       – lead is NIH, OR lead is OTHER/NETWORK and any collaborator is NIH
 *   Other Fed – lead is FED,  OR lead is OTHER/NETWORK and any collaborator is FED
 *   Other     – everything else
 */
function deriveFundingSource(study) {
    const lead = (study.sponsor_class || '').toUpperCase();
    if (lead === 'INDUSTRY') return 'Industry';
    if (lead === 'NIH')      return 'NIH';
    if (lead === 'FED')      return 'Other U.S. Federal';

    // Lead is OTHER or NETWORK — check collaborators for NIH / FED
    const collabs = (study.collaborators || []).map(c => (c.class || '').toUpperCase());
    if (collabs.includes('NIH')) return 'NIH';
    if (collabs.includes('FED')) return 'Other U.S. Federal';

    return 'Other';
}

// Format gender data for display - handles various data structures
function formatGenderDisplay(study) {
    // Check if gender data exists and is properly structured
    if (!study.gender) return 'Not Reported';

    // Handle if gender is not an object (could be a string or other primitive)
    if (typeof study.gender !== 'object') return 'Not Reported';

    // Check if reported flag exists and is false
    if (study.gender.reported === false) return 'Not Reported';

    // Check if totals exists and is an object
    if (!study.gender.totals || typeof study.gender.totals !== 'object') return 'Not Reported';

    // Format the totals
    const entries = Object.entries(study.gender.totals)
        .filter(([key, value]) => value > 0 && key !== 'unknown')
        .map(([key, value]) => {
            // Capitalize first letter
            const label = key.charAt(0).toUpperCase() + key.slice(1);
            return `${label}: ${value.toLocaleString()}`;
        });

    // Add unknown at the end if it exists
    if (study.gender.totals.unknown > 0) {
        entries.push(`Unknown: ${study.gender.totals.unknown.toLocaleString()}`);
    }

    return entries.length > 0 ? entries.join(', ') : 'Not Reported';
}

function renderPublicationsDetail(study) {
    const refs = study.references || [];
    if (refs.length === 0) {
        return `<div class="detail-section">
            <h5>Publications</h5>
            <p class="note">No publications linked to this study.</p>
        </div>`;
    }

    let pubsHtml = refs.map(ref => {
        const url = ref.pmid ? `https://pubmed.ncbi.nlm.nih.gov/${ref.pmid}/` : '#';
        const source = ref.source === 'pubmed' ? 'PubMed' : 'ClinicalTrials.gov';
        const citation = ref.citation || ref.title || `Publication ${ref.pmid || ''}`;
        return `<li>
            <a href="${url}" target="_blank">${escapeHtml(citation)}</a>
            <span class="badge">${source}</span>
        </li>`;
    }).join('');

    return `<div class="detail-section">
        <h5>Publications (${refs.length})</h5>
        <ul class="publications-list">${pubsHtml}</ul>
    </div>`;
}

async function showStudyDetails(nctId) {
    const study = data.find(s => s.nct_id === nctId);
    if (!study) return;

    const overlay = document.getElementById('study-details-overlay');

    // Lazy-load detail data and merge into study for this modal render
    await loadDetailData();
    const detail = detailCache[nctId] || {};
    const fullStudy = Object.assign({}, study, detail);

    // Format masking details
    let maskingDetails = '';
    if (fullStudy.masking && fullStudy.masking !== 'NONE') {
        const masked = [];
        if (fullStudy.subject_masked) masked.push('Participants');
        if (fullStudy.caregiver_masked) masked.push('Care Providers');
        if (fullStudy.investigator_masked) masked.push('Investigators');
        if (fullStudy.outcomes_assessor_masked) masked.push('Outcomes Assessors');
        maskingDetails = masked.length > 0 ? `<br><small>Masked: ${masked.join(', ')}</small>` : '';
    }

    // Format collaborators
    let collaboratorsHtml = '';
    if (fullStudy.collaborators && fullStudy.collaborators.length > 0) {
        collaboratorsHtml = `
            <div class="detail-section">
                <h5>Collaborators</h5>
                <ul class="collaborators-list">
                    ${fullStudy.collaborators.map(c => `<li>${escapeHtml(c.name)} <span class="badge">${c.class}</span></li>`).join('')}
                </ul>
            </div>`;
    }

    // Format secondary outcomes
    let secondaryOutcomesHtml = '';
    if (fullStudy.secondary_outcomes && fullStudy.secondary_outcomes.length > 0) {
        secondaryOutcomesHtml = `
            <div class="detail-section">
                <h5>Secondary Outcomes (${fullStudy.secondary_outcomes.length})</h5>
                <ul class="outcomes-list">
                    ${fullStudy.secondary_outcomes.slice(0, 5).map(o => `
                        <li>
                            <strong>${escapeHtml(o.measure)}</strong>
                            ${o.time_frame ? `<br><small>Time Frame: ${escapeHtml(o.time_frame)}</small>` : ''}
                        </li>
                    `).join('')}
                    ${fullStudy.secondary_outcomes.length > 5 ? `<li><em>... and ${fullStudy.secondary_outcomes.length - 5} more</em></li>` : ''}
                </ul>
            </div>`;
    }

    const html = `
        <div class="study-details-modal">
            <div class="modal-header">
                <h3>${escapeHtml(fullStudy.brief_title)}</h3>
                <button class="close-btn" onclick="closeStudyDetails()">✕</button>
            </div>
            <div class="modal-body">
                <div class="detail-row">
                    <strong>NCT ID:</strong>
                    <a href="https://clinicaltrials.gov/study/${fullStudy.nct_id}" target="_blank" class="nct-link">${fullStudy.nct_id}</a>
                </div>

                <div class="detail-section">
                    <h5>Study Design</h5>
                    <div class="detail-grid">
                        <div><strong>Type:</strong> ${fullStudy.study_type || 'N/A'}</div>
                        <div><strong>Phase:</strong> ${fullStudy.phase || 'N/A'}</div>
                        <div><strong>Allocation:</strong> ${fullStudy.allocation || 'N/A'}</div>
                        <div><strong>Model:</strong> ${fullStudy.intervention_model || fullStudy.observational_model || 'N/A'}</div>
                        <div><strong>Masking:</strong> ${fullStudy.masking || 'N/A'}${maskingDetails}</div>
                        <div><strong>Purpose:</strong> ${fullStudy.primary_purpose || 'N/A'}</div>
                    </div>
                    ${fullStudy.intervention_model_description ? `<p class="description"><strong>Design Description:</strong> ${escapeHtml(fullStudy.intervention_model_description)}</p>` : ''}
                </div>

                <div class="detail-section">
                    <h5>Primary Outcome</h5>
                    <p><strong>${escapeHtml(fullStudy.primary_endpoint || 'N/A')}</strong></p>
                    ${fullStudy.primary_outcome_time_frame ? `<p><small>Time Frame: ${escapeHtml(fullStudy.primary_outcome_time_frame)}</small></p>` : ''}
                    ${fullStudy.primary_outcome_description ? `<p class="description">${escapeHtml(fullStudy.primary_outcome_description)}</p>` : ''}
                </div>

                ${secondaryOutcomesHtml}

                <div class="detail-section">
                    <h5>Enrollment & Eligibility</h5>
                    <div class="detail-grid">
                        <div><strong>Enrollment:</strong> ${(fullStudy.enrollment || 0).toLocaleString()} ${fullStudy.enrollment_type === 'ANTICIPATED' ? '(Anticipated)' : '(Actual)'}</div>
                        <div><strong>Age Range:</strong> ${fullStudy.min_age || 'N/A'} to ${fullStudy.max_age || 'N/A'}</div>
                        <div><strong>Population:</strong> ${getStudyPediatricStatus(fullStudy)}</div>
                        <div><strong>Gender:</strong> ${formatGenderDisplay(fullStudy)}</div>
                        <div><strong>Healthy Volunteers:</strong> ${fullStudy.healthy_volunteers ? 'Yes' : 'No'}</div>
                    </div>
                </div>

                <div class="detail-section">
                    <h5>Sponsor & Collaborators</h5>
                    <p><strong>Lead Sponsor:</strong> ${escapeHtml(fullStudy.lead_sponsor_name || 'Unknown')} <span class="badge">${fullStudy.sponsor_class || 'N/A'}</span></p>
                    <p><strong>Funding Source:</strong> <span class="badge">${deriveFundingSource(fullStudy)}</span></p>
                    ${collaboratorsHtml}
                </div>

                <div class="detail-section">
                    <h5>Study Status</h5>
                    <div class="detail-grid">
                        <div><strong>Status:</strong> ${fullStudy.status || 'N/A'}</div>
                        <div><strong>Start Date:</strong> ${fullStudy.start_date || 'N/A'}</div>
                        <div><strong>Completion Date:</strong> ${fullStudy.completion_date || fullStudy.primary_completion_date || 'N/A'}</div>
                        <div><strong>Results Posted:</strong> ${fullStudy.results_date || 'N/A'}</div>
                        <div><strong>Last Update:</strong> ${fullStudy.last_update || 'N/A'}</div>
                    </div>
                    ${fullStudy.why_stopped ? `<p class="alert"><strong>Why Stopped:</strong> ${escapeHtml(fullStudy.why_stopped)}</p>` : ''}
                </div>

                ${renderPublicationsDetail(fullStudy)}

                ${renderStudySites(fullStudy)}
            </div>
        </div>
    `;

    overlay.innerHTML = html;
    overlay.style.display = 'flex';
}

/**
 * Render study sites section for the detail modal
 */
function renderStudySites(study) {
    // Prefer study_sites (new format) over countries (old format)
    const sites = study.study_sites || [];
    const countries = study.countries || [];

    if (sites.length === 0 && countries.length === 0) {
        return `
            <div class="detail-section">
                <h5>Study Sites</h5>
                <p class="note">Location data not available for this study.</p>
                <p><strong>Geo Identification:</strong> <span class="badge badge-gray">Not Reported</span></p>
            </div>`;
    }

    // If we have detailed sites, show them
    if (sites.length > 0) {
        const geoMethod = study.geo_identification_method || 'Unknown';
        const geoMethodClass = geoMethod.includes('High') ? 'badge-green' :
                               geoMethod.includes('Medium') ? 'badge-yellow' :
                               geoMethod.includes('Low') ? 'badge-orange' : 'badge-gray';

        // Group sites by country
        const sitesByCountry = {};
        sites.forEach(site => {
            const country = site.country || 'Unknown';
            if (!sitesByCountry[country]) {
                sitesByCountry[country] = [];
            }
            sitesByCountry[country].push(site);
        });

        let sitesHtml = '';
        for (const [country, countrySites] of Object.entries(sitesByCountry)) {
            sitesHtml += `<div class="country-sites">
                <strong>${escapeHtml(country)}</strong> (${countrySites.length} site${countrySites.length > 1 ? 's' : ''})
                <ul class="sites-list">`;

            // Show up to 5 sites per country
            const displaySites = countrySites.slice(0, 5);
            displaySites.forEach(site => {
                const locationParts = [site.city, site.state, site.zip].filter(Boolean);
                const locationStr = locationParts.length > 0 ? locationParts.join(', ') : 'Location details not available';
                const facilityStr = site.facility ? escapeHtml(site.facility) : 'Facility not specified';

                sitesHtml += `<li>
                    <span class="facility-name">${facilityStr}</span>
                    <span class="location-details">${escapeHtml(locationStr)}</span>
                    <span class="badge ${site.geo_identification_method?.includes('High') ? 'badge-green' : site.geo_identification_method?.includes('Medium') ? 'badge-yellow' : 'badge-orange'}">${site.geo_identification_method || 'Unknown'}</span>
                </li>`;
            });

            if (countrySites.length > 5) {
                sitesHtml += `<li class="more-sites"><em>... and ${countrySites.length - 5} more sites</em></li>`;
            }

            sitesHtml += `</ul></div>`;
        }

        return `
            <div class="detail-section">
                <h5>Study Sites (${sites.length} total)</h5>
                <p><strong>Overall Geo Identification:</strong> <span class="badge ${geoMethodClass}">${geoMethod}</span></p>
                <div class="sites-container">
                    ${sitesHtml}
                </div>
            </div>`;
    }

    // Fallback: just show countries (old format)
    const countryList = countries.map(c => c.country).join(', ');
    return `
        <div class="detail-section">
            <h5>Study Locations</h5>
            <p><strong>Countries:</strong> ${escapeHtml(countryList) || 'Not specified'}</p>
            <p><strong>Geo Identification:</strong> <span class="badge badge-orange">Low Precision (Country)</span></p>
            <p class="note">Detailed site information not available for this study.</p>
        </div>`;
}

function closeStudyDetails() {
    document.getElementById('study-details-overlay').style.display = 'none';
}

window.showStudyDetails = showStudyDetails;
window.closeStudyDetails = closeStudyDetails;

function formatCountries(countries) {
    if (!countries || !Array.isArray(countries) || countries.length === 0) {
        return 'N/A';
    }

    // Extract country names from objects (each item is {country: "Country Name"})
    const countryNames = countries.map(c => {
        // If it's an object with a 'country' property, extract it
        if (typeof c === 'object' && c !== null && c.country) {
            return c.country;
        }
        // If it's already a string, use it
        if (typeof c === 'string') {
            return c;
        }
        // Otherwise, skip it
        return null;
    }).filter(name => name && typeof name === 'string');

    // Remove duplicates
    const uniqueCountries = [...new Set(countryNames)];

    if (uniqueCountries.length === 0) {
        return 'N/A';
    }

    // If more than 3 countries, show first 2 and "+X more"
    if (uniqueCountries.length > 3) {
        return uniqueCountries.slice(0, 2).join(', ') + ` +${uniqueCountries.length - 2} more`;
    }
    return uniqueCountries.join(', ');
}

// Chart rendering functions (keeping existing logic)
function renderReportingTrends(filtered) {
    const ctx = document.getElementById('reporting-trends-chart');
    if (!ctx) return;

    let byYear;
    if (dashboardSummary) {
        byYear = {};
        for (const [yr, v] of Object.entries(dashboardSummary.byYear)) {
            byYear[yr] = { total: v.total, race: v.race_reported, ethnicity: v.eth_reported, both: v.both_reported };
        }
    } else {
        byYear = {};
        filtered.forEach(study => {
            const year = study.results_date?.substring(0, 4);
            if (!year) return;
            if (!byYear[year]) byYear[year] = { total: 0, race: 0, ethnicity: 0, both: 0 };
            byYear[year].total++;
            if (study.race?.reported) byYear[year].race++;
            if (study.ethnicity?.reported) byYear[year].ethnicity++;
            if (study.race?.reported && study.ethnicity?.reported) byYear[year].both++;
        });
    }

    const years = Object.keys(byYear).sort();

    if (charts.reportingTrends) charts.reportingTrends.destroy();

    charts.reportingTrends = new Chart(ctx, {
        type: 'line',
        data: {
            labels: years,
            datasets: [
                {
                    label: 'Race',
                    data: years.map(y => (byYear[y].race / byYear[y].total) * 100),
                    borderColor: COLORS.reporting.race,
                    backgroundColor: COLORS.reporting.race + '1a',
                    tension: 0.3
                },
                {
                    label: 'Ethnicity',
                    data: years.map(y => (byYear[y].ethnicity / byYear[y].total) * 100),
                    borderColor: COLORS.reporting.ethnicity,
                    backgroundColor: COLORS.reporting.ethnicity + '1a',
                    tension: 0.3
                },
                {
                    label: 'Both',
                    data: years.map(y => (byYear[y].both / byYear[y].total) * 100),
                    borderColor: COLORS.reporting.both,
                    backgroundColor: COLORS.reporting.both + '1a',
                    tension: 0.3
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            aspectRatio: CHART_ASPECT_RATIO,
            scales: {
                y: {
                    beginAtZero: true,
                    max: 100,
                    title: { display: true, text: '% of Studies' }
                }
            },
            plugins: {
                legend: { position: 'top' }
            }
        }
    });
}

function renderRaceDistribution(filtered) {
    const ctx = document.getElementById('race-distribution-chart');
    if (!ctx) return;

    let totals;
    if (dashboardSummary) {
        const d = dashboardSummary.raceDistribution;
        totals = {
            'American Indian/Alaska Native': d.american_indian_alaska_native || 0,
            'Asian': d.asian || 0, 'Black/African American': d.black_african_american || 0,
            'Native Hawaiian/Pacific Islander': d.native_hawaiian_pacific_islander || 0,
            'White': d.white || 0, 'More than one race': d.more_than_one_race || 0,
            'Unknown': d.unknown_not_reported || 0, 'Other': d.other || 0
        };
    } else {
        totals = {
            'American Indian/Alaska Native': 0, 'Asian': 0, 'Black/African American': 0,
            'Native Hawaiian/Pacific Islander': 0, 'White': 0, 'More than one race': 0,
            'Unknown': 0, 'Other': 0
        };
        filtered.forEach(study => {
            if (!study.race?.reported) return;
            const omb = study.race.omb_totals;
            totals['American Indian/Alaska Native'] += omb.american_indian_alaska_native || 0;
            totals['Asian'] += omb.asian || 0;
            totals['Black/African American'] += omb.black_african_american || 0;
            totals['Native Hawaiian/Pacific Islander'] += omb.native_hawaiian_pacific_islander || 0;
            totals['White'] += omb.white || 0;
            totals['More than one race'] += omb.more_than_one_race || 0;
            totals['Unknown'] += omb.unknown_not_reported || 0;
            totals['Other'] += omb.other || 0;
        });
    }

    if (charts.raceDistribution) charts.raceDistribution.destroy();

    charts.raceDistribution = new Chart(ctx, donutConfig(totals, null, 'participants'));
}

function renderRaceTrends(filtered) {
    const ctx = document.getElementById('race-trends-chart');
    if (!ctx) return;

    let byYear;
    if (dashboardSummary) {
        byYear = {};
        for (const [yr, v] of Object.entries(dashboardSummary.byYear)) {
            byYear[yr] = { total: v.rn_count, white: v.rn_wh, black: v.rn_bl, asian: v.rn_as };
        }
    } else {
        byYear = {};
        filtered.forEach(study => {
            const year = study.results_date?.substring(0, 4);
            if (!year || !study.race?.reported) return;
            if (!byYear[year]) byYear[year] = { total: 0, white: 0, black: 0, asian: 0, other: 0 };
            const omb = study.race.omb_totals;
            const studyTotal = Object.values(omb).reduce((a, b) => a + b, 0);
            if (studyTotal > 0) {
                byYear[year].total++;
                byYear[year].white += (omb.white || 0) / studyTotal;
                byYear[year].black += (omb.black_african_american || 0) / studyTotal;
                byYear[year].asian += (omb.asian || 0) / studyTotal;
            }
        });
    }

    const years = Object.keys(byYear).sort();

    if (charts.raceTrends) charts.raceTrends.destroy();

    charts.raceTrends = new Chart(ctx, {
        type: 'line',
        data: {
            labels: years,
            datasets: [
                {
                    label: 'White',
                    data: years.map(y => byYear[y].total > 0 ? (byYear[y].white / byYear[y].total) * 100 : 0),
                    borderColor: COLORS.raceTrend.white,
                    backgroundColor: COLORS.raceTrend.white + '20',
                    tension: 0.3
                },
                {
                    label: 'Black/African American',
                    data: years.map(y => byYear[y].total > 0 ? (byYear[y].black / byYear[y].total) * 100 : 0),
                    borderColor: COLORS.raceTrend.black_african_american,
                    backgroundColor: COLORS.raceTrend.black_african_american + '20',
                    tension: 0.3
                },
                {
                    label: 'Asian',
                    data: years.map(y => byYear[y].total > 0 ? (byYear[y].asian / byYear[y].total) * 100 : 0),
                    borderColor: COLORS.raceTrend.asian,
                    backgroundColor: COLORS.raceTrend.asian + '20',
                    tension: 0.3
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            aspectRatio: CHART_ASPECT_RATIO,
            scales: {
                y: {
                    beginAtZero: true,
                    max: 100,
                    title: { display: true, text: 'Average % per Study' }
                }
            },
            plugins: {
                legend: { position: 'top' }
            }
        }
    });
}

function renderRaceSubcategories(category) {
    const ctx = document.getElementById('race-subcategory-chart');
    const container = document.getElementById('race-subcategory-container');
    if (!ctx || !container) return;

    let subcategories = {};
    if (dashboardSummary) {
        const all = dashboardSummary.raceSubcategories || {};
        for (const [key, count] of Object.entries(all)) {
            if (category === 'asian' && key.startsWith('asian_')) subcategories[key] = count;
            else if (category === 'black' && key.startsWith('black_')) subcategories[key] = count;
            else if (category === 'white' && key.startsWith('white_')) subcategories[key] = count;
        }
    } else {
        const filtered = getFilteredData();
        filtered.forEach(study => {
            if (!study.race?.reported) return;
            Object.entries(study.race.subcategory_totals || {}).forEach(([key, count]) => {
                if (category === 'asian' && key.startsWith('asian_')) subcategories[key] = (subcategories[key] || 0) + count;
                else if (category === 'black' && key.startsWith('black_')) subcategories[key] = (subcategories[key] || 0) + count;
                else if (category === 'white' && key.startsWith('white_')) subcategories[key] = (subcategories[key] || 0) + count;
            });
        });
    }

    const labels = Object.keys(subcategories).map(k =>
        k.replace(/_/g, ' ').replace(/^(asian|black|white) /, '').replace(/\b\w/g, l => l.toUpperCase())
    );

    // Check if there's any subcategory data across all studies
    const hasAnySubcategoryData = labels.length > 0;

    if (!hasAnySubcategoryData) {
        // Hide the entire subcategory section if no data is available
        container.style.display = 'none';
        return;
    } else {
        container.style.display = 'block';
    }

    if (charts.raceSubcategory) charts.raceSubcategory.destroy();

    charts.raceSubcategory = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Count',
                data: Object.values(subcategories),
                backgroundColor: RACE_RAMP[1]
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            aspectRatio: CHART_ASPECT_RATIO,
            scales: {
                y: {
                    beginAtZero: true
                }
            },
            plugins: {
                legend: { display: false }
            }
        }
    });
}

function renderEthnicityDistribution(filtered) {
    const ctx = document.getElementById('ethnicity-distribution-chart');
    if (!ctx) return;

    let totals;
    if (dashboardSummary) {
        const d = dashboardSummary.ethnicityDistribution;
        totals = { 'Hispanic/Latino': d.hispanic_latino || 0, 'Not Hispanic/Latino': d.not_hispanic_latino || 0, 'Unknown': d.unknown_not_reported || 0 };
    } else {
        totals = { 'Hispanic/Latino': 0, 'Not Hispanic/Latino': 0, 'Unknown': 0 };
        filtered.forEach(study => {
            if (!study.ethnicity?.reported) return;
            const omb = study.ethnicity.omb_totals;
            totals['Hispanic/Latino'] += omb.hispanic_latino || 0;
            totals['Not Hispanic/Latino'] += omb.not_hispanic_latino || 0;
            totals['Unknown'] += omb.unknown_not_reported || 0;
        });
    }

    if (charts.ethnicityDistribution) charts.ethnicityDistribution.destroy();

    charts.ethnicityDistribution = new Chart(ctx, donutConfig(totals, DONUT_COLORS.ethnicity, 'participants'));
}

function renderEthnicityTrends(filtered) {
    const ctx = document.getElementById('ethnicity-trends-chart');
    if (!ctx) return;

    let byYear;
    if (dashboardSummary) {
        byYear = {};
        for (const [yr, v] of Object.entries(dashboardSummary.byYear)) {
            byYear[yr] = { total: v.en_count, hispanic: v.en_hi };
        }
    } else {
        byYear = {};
        filtered.forEach(study => {
            const year = study.results_date?.substring(0, 4);
            if (!year || !study.ethnicity?.reported) return;
            if (!byYear[year]) byYear[year] = { total: 0, hispanic: 0 };
            const omb = study.ethnicity.omb_totals;
            const studyTotal = Object.values(omb).reduce((a, b) => a + b, 0);
            if (studyTotal > 0) { byYear[year].total++; byYear[year].hispanic += (omb.hispanic_latino || 0) / studyTotal; }
        });
    }

    const years = Object.keys(byYear).sort();

    if (charts.ethnicityTrends) charts.ethnicityTrends.destroy();

    charts.ethnicityTrends = new Chart(ctx, {
        type: 'line',
        data: {
            labels: years,
            datasets: [{
                label: 'Hispanic/Latino',
                data: years.map(y => byYear[y].total > 0 ? (byYear[y].hispanic / byYear[y].total) * 100 : 0),
                borderColor: COLORS.ethnicity.hispanic_latino,
                backgroundColor: COLORS.ethnicity.hispanic_latino + '20',
                tension: 0.3
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            aspectRatio: CHART_ASPECT_RATIO,
            scales: {
                y: {
                    beginAtZero: true,
                    max: 100,
                    title: { display: true, text: 'Average % per Study' }
                }
            },
            plugins: {
                legend: { position: 'top' }
            }
        }
    });
}

function renderEthnicitySubcategories(filtered) {
    const ctx = document.getElementById('ethnicity-subcategory-chart');
    const container = document.getElementById('ethnicity-subcategory-container');
    if (!ctx || !container) return;

    let subcategories;
    if (dashboardSummary) {
        subcategories = dashboardSummary.ethnicitySubcategories || {};
    } else {
        subcategories = {};
        filtered.forEach(study => {
            if (!study.ethnicity?.reported) return;
            Object.entries(study.ethnicity.subcategory_totals || {}).forEach(([key, count]) => {
                subcategories[key] = (subcategories[key] || 0) + count;
            });
        });
    }

    const labels = Object.keys(subcategories).map(k =>
        k.replace(/_/g, ' ').replace(/^hispanic latino /, '').replace(/\b\w/g, l => l.toUpperCase())
    );

    // Check if there's any subcategory data
    const hasAnySubcategoryData = labels.length > 0;

    if (!hasAnySubcategoryData) {
        // Hide the entire subcategory section if no data is available
        container.style.display = 'none';
        return;
    } else {
        container.style.display = 'block';
    }

    if (charts.ethnicitySubcategory) charts.ethnicitySubcategory.destroy();

    charts.ethnicitySubcategory = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Count',
                data: Object.values(subcategories),
                backgroundColor: COLORS.ethnicity.hispanic_latino
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            aspectRatio: CHART_ASPECT_RATIO,
            scales: {
                y: {
                    beginAtZero: true
                }
            },
            plugins: {
                legend: { display: false }
            }
        }
    });
}

/**
 * Graph B for Race: Total Participants with Reported Race Data
 * Shows total count of participants with explicitly reported race data per year
 * Excludes "Unknown" and studies without race data
 */
function renderRaceReportedParticipants(filtered) {
    const ctx = document.getElementById('race-reported-participants-chart');
    if (!ctx) return;

    let byYear;
    if (dashboardSummary) {
        byYear = {};
        for (const [yr, v] of Object.entries(dashboardSummary.byYear)) {
            byYear[yr] = v.r_ai + v.r_as + v.r_bl + v.r_nh + v.r_wh + v.r_mu + v.r_ot;
        }
    } else {
        byYear = {};
        filtered.forEach(study => {
            const year = study.results_date?.substring(0, 4);
            if (!year || !study.race?.reported) return;
            if (!byYear[year]) byYear[year] = 0;
            const omb = study.race.omb_totals;
            byYear[year] += (omb.american_indian_alaska_native || 0) + (omb.asian || 0) +
                (omb.black_african_american || 0) + (omb.native_hawaiian_pacific_islander || 0) +
                (omb.white || 0) + (omb.more_than_one_race || 0) + (omb.other || 0);
        });
    }

    const years = Object.keys(byYear).sort();
    const participantData = years.map(y => byYear[y]);

    if (charts.raceReportedParticipants) charts.raceReportedParticipants.destroy();

    charts.raceReportedParticipants = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: years,
            datasets: [{
                label: 'Participants with Known Race',
                data: participantData,
                backgroundColor: RACE_RAMP[1] + '80',
                borderColor: RACE_RAMP[1],
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            aspectRatio: CHART_ASPECT_RATIO,
            scales: {
                y: {
                    beginAtZero: true,
                    title: { display: true, text: 'Total Participants' }
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return ` ${context.parsed.y.toLocaleString()} participants`;
                        }
                    }
                }
            }
        }
    });
}

/**
 * Graph C for Race: Full Distribution with Data Quality Layers
 * 100% stacked area chart distinguishing between:
 * - Known Categories (White, Black, Asian, Other) - bottom layers
 * - Explicit Unknown (NIH category) - middle layer, solid grey
 * - Not Reported/Missing (implicit) - top layer, light translucent grey
 *
 * This visualization shows the "Great Reveal" as the light grey fog lifts over time.
 */
function renderRaceFullDistribution(filtered) {
    const ctx = document.getElementById('race-full-distribution-chart');
    if (!ctx) return;

    let byYear;
    if (dashboardSummary) {
        byYear = {};
        for (const [yr, v] of Object.entries(dashboardSummary.byYear)) {
            byYear[yr] = {
                white: v.r_wh, black: v.r_bl, asian: v.r_as,
                otherRaces: v.r_ai + v.r_nh + v.r_mu + v.r_ot,
                explicitUnknown: v.r_un, totalEnrollment: v.fd_enrollment
            };
        }
    } else {
        byYear = {};
        filtered.forEach(study => {
            const year = study.results_date?.substring(0, 4);
            if (!year) return;
            if (!byYear[year]) byYear[year] = { white: 0, black: 0, asian: 0, otherRaces: 0, explicitUnknown: 0, totalEnrollment: 0 };
            byYear[year].totalEnrollment += study.enrollment || 0;
            if (study.race?.reported) {
                const omb = study.race.omb_totals;
                byYear[year].white += omb.white || 0;
                byYear[year].black += omb.black_african_american || 0;
                byYear[year].asian += omb.asian || 0;
                byYear[year].otherRaces += (omb.american_indian_alaska_native || 0) +
                    (omb.native_hawaiian_pacific_islander || 0) + (omb.more_than_one_race || 0) + (omb.other || 0);
                byYear[year].explicitUnknown += omb.unknown_not_reported || 0;
            }
        });
    }

    const years = Object.keys(byYear).sort();

    // Calculate percentages for 100% stacked chart
    const whiteData = [];
    const blackData = [];
    const asianData = [];
    const otherRacesData = [];
    const explicitUnknownData = [];
    const notReportedData = [];

    years.forEach(y => {
        const data = byYear[y];

        // Sum of all reported data (known + explicit unknown)
        const knownSum = data.white + data.black + data.asian + data.otherRaces;
        const allReported = knownSum + data.explicitUnknown;

        // Fix 2023 spike: Use max of (enrollment, allReported) as denominator
        const effectiveTotal = Math.max(data.totalEnrollment, allReported);

        if (effectiveTotal === 0) {
            whiteData.push(0);
            blackData.push(0);
            asianData.push(0);
            otherRacesData.push(0);
            explicitUnknownData.push(0);
            notReportedData.push(0);
            return;
        }

        // Calculate Not Reported (implicit missing) - clamped to 0
        const notReported = Math.max(0, effectiveTotal - allReported);

        // Convert to percentages of effective total
        whiteData.push((data.white / effectiveTotal) * 100);
        blackData.push((data.black / effectiveTotal) * 100);
        asianData.push((data.asian / effectiveTotal) * 100);
        otherRacesData.push((data.otherRaces / effectiveTotal) * 100);
        explicitUnknownData.push((data.explicitUnknown / effectiveTotal) * 100);
        notReportedData.push((notReported / effectiveTotal) * 100);
    });

    if (charts.raceFullDistribution) charts.raceFullDistribution.destroy();

    charts.raceFullDistribution = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: years,
            datasets: [
                // Order: smallest to largest categories (bottom to top)
                // 1. Asian (bottom)
                {
                    label: 'Asian',
                    data: asianData,
                    backgroundColor: COLORS.race.asian,
                    borderColor: COLORS.race.asian,
                    borderWidth: 1
                },
                // 2. Other Races
                {
                    label: 'Other Races',
                    data: otherRacesData,
                    backgroundColor: COLORS.race.other,
                    borderColor: COLORS.race.other,
                    borderWidth: 1
                },
                // 3. Explicitly Unknown (solid grey)
                {
                    label: 'Explicitly Unknown',
                    data: explicitUnknownData,
                    backgroundColor: '#9ca3af',
                    borderColor: '#6b7280',
                    borderWidth: 1
                },
                // 4. Black/African American
                {
                    label: 'Black/African American',
                    data: blackData,
                    backgroundColor: COLORS.race.black_african_american,
                    borderColor: COLORS.race.black_african_american,
                    borderWidth: 1
                },
                // 5. White
                {
                    label: 'White',
                    data: whiteData,
                    backgroundColor: COLORS.race.white,
                    borderColor: COLORS.race.white,
                    borderWidth: 1
                },
                // 6. Not Reported/Missing (top layer - light translucent grey)
                {
                    label: 'Not Reported (Missing)',
                    data: notReportedData,
                    backgroundColor: 'rgba(229, 231, 235, 0.7)',
                    borderColor: 'rgba(209, 213, 219, 0.8)',
                    borderWidth: 1
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            aspectRatio: CHART_ASPECT_RATIO,
            scales: {
                y: {
                    stacked: true,
                    min: 0,
                    max: 100,
                    title: { display: true, text: ENROLLMENT_AXIS_TITLE }
                },
                x: {
                    stacked: true,
                    title: { display: true, text: 'Year' }
                }
            },
            plugins: {
                legend: {
                    position: CHART_LEGEND_POSITION,
                    labels: {
                        usePointStyle: true,
                        padding: 12
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const pct = context.parsed.y.toFixed(1);
                            return ` ${context.dataset.label}: ${pct}%`;
                        }
                    }
                }
            },
            interaction: {
                mode: 'index',
                intersect: false
            }
        }
    });
}

/**
 * Graph B for Ethnicity: Total Participants with Reported Ethnicity Data
 * Shows total count of participants with explicitly reported ethnicity data per year
 * Excludes "Unknown" and studies without ethnicity data
 */
function renderEthnicityReportedParticipants(filtered) {
    const ctx = document.getElementById('ethnicity-reported-participants-chart');
    if (!ctx) return;

    let byYear;
    if (dashboardSummary) {
        byYear = {};
        for (const [yr, v] of Object.entries(dashboardSummary.byYear)) {
            byYear[yr] = v.e_hi + v.e_nh;
        }
    } else {
        byYear = {};
        filtered.forEach(study => {
            const year = study.results_date?.substring(0, 4);
            if (!year || !study.ethnicity?.reported) return;
            if (!byYear[year]) byYear[year] = 0;
            const omb = study.ethnicity.omb_totals;
            byYear[year] += (omb.hispanic_latino || 0) + (omb.not_hispanic_latino || 0);
        });
    }

    const years = Object.keys(byYear).sort();
    const participantData = years.map(y => byYear[y]);

    if (charts.ethnicityReportedParticipants) charts.ethnicityReportedParticipants.destroy();

    charts.ethnicityReportedParticipants = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: years,
            datasets: [{
                label: 'Participants with Known Ethnicity',
                data: participantData,
                backgroundColor: COLORS.ethnicity.hispanic_latino + '80',
                borderColor: COLORS.ethnicity.hispanic_latino,
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            aspectRatio: CHART_ASPECT_RATIO,
            scales: {
                y: {
                    beginAtZero: true,
                    title: { display: true, text: 'Total Participants' }
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return ` ${context.parsed.y.toLocaleString()} participants`;
                        }
                    }
                }
            }
        }
    });
}

/**
 * Graph C for Ethnicity: Full Distribution with Data Quality Layers
 * 100% stacked area chart distinguishing between:
 * - Known Categories (Hispanic/Latino, Not Hispanic/Latino) - bottom layers
 * - Explicit Unknown (NIH category) - middle layer, solid grey
 * - Not Reported/Missing (implicit) - top layer, light translucent grey
 *
 * This visualization shows the "Great Reveal" as the light grey fog lifts over time.
 */
function renderEthnicityFullDistribution(filtered) {
    const ctx = document.getElementById('ethnicity-full-distribution-chart');
    if (!ctx) return;

    let byYear;
    if (dashboardSummary) {
        byYear = {};
        for (const [yr, v] of Object.entries(dashboardSummary.byYear)) {
            byYear[yr] = { hispanic: v.e_hi, notHispanic: v.e_nh, explicitUnknown: v.e_un, totalEnrollment: v.fd_enrollment };
        }
    } else {
        byYear = {};
        filtered.forEach(study => {
            const year = study.results_date?.substring(0, 4);
            if (!year) return;
            if (!byYear[year]) byYear[year] = { hispanic: 0, notHispanic: 0, explicitUnknown: 0, totalEnrollment: 0 };
            byYear[year].totalEnrollment += study.enrollment || 0;
            if (study.ethnicity?.reported) {
                const omb = study.ethnicity.omb_totals;
                byYear[year].hispanic += omb.hispanic_latino || 0;
                byYear[year].notHispanic += omb.not_hispanic_latino || 0;
                byYear[year].explicitUnknown += omb.unknown_not_reported || 0;
            }
        });
    }

    const years = Object.keys(byYear).sort();

    // Calculate percentages for 100% stacked chart
    const hispanicData = [];
    const notHispanicData = [];
    const explicitUnknownData = [];
    const notReportedData = [];

    years.forEach(y => {
        const data = byYear[y];

        // Sum of all reported data (known + explicit unknown)
        const knownSum = data.hispanic + data.notHispanic;
        const allReported = knownSum + data.explicitUnknown;

        // Fix 2023 spike: Use max of (enrollment, allReported) as denominator
        const effectiveTotal = Math.max(data.totalEnrollment, allReported);

        if (effectiveTotal === 0) {
            hispanicData.push(0);
            notHispanicData.push(0);
            explicitUnknownData.push(0);
            notReportedData.push(0);
            return;
        }

        // Calculate Not Reported (implicit missing) - clamped to 0
        const notReported = Math.max(0, effectiveTotal - allReported);

        // Convert to percentages of effective total
        hispanicData.push((data.hispanic / effectiveTotal) * 100);
        notHispanicData.push((data.notHispanic / effectiveTotal) * 100);
        explicitUnknownData.push((data.explicitUnknown / effectiveTotal) * 100);
        notReportedData.push((notReported / effectiveTotal) * 100);
    });

    if (charts.ethnicityFullDistribution) charts.ethnicityFullDistribution.destroy();

    charts.ethnicityFullDistribution = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: years,
            datasets: [
                // Order: smallest to largest categories (bottom to top)
                // 1. Explicitly Unknown (bottom - solid grey)
                {
                    label: 'Explicitly Unknown',
                    data: explicitUnknownData,
                    backgroundColor: '#9ca3af',
                    borderColor: '#6b7280',
                    borderWidth: 1
                },
                // 2. Hispanic/Latino
                {
                    label: 'Hispanic/Latino',
                    data: hispanicData,
                    backgroundColor: COLORS.ethnicity.hispanic_latino,
                    borderColor: COLORS.ethnicity.hispanic_latino,
                    borderWidth: 1
                },
                // 3. Not Hispanic/Latino
                {
                    label: 'Not Hispanic/Latino',
                    data: notHispanicData,
                    backgroundColor: COLORS.ethnicity.not_hispanic_latino,
                    borderColor: COLORS.ethnicity.not_hispanic_latino,
                    borderWidth: 1
                },
                // 4. Not Reported/Missing (top layer - light translucent grey)
                {
                    label: 'Not Reported (Missing)',
                    data: notReportedData,
                    backgroundColor: 'rgba(229, 231, 235, 0.7)',
                    borderColor: 'rgba(209, 213, 219, 0.8)',
                    borderWidth: 1
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            aspectRatio: CHART_ASPECT_RATIO,
            scales: {
                y: {
                    stacked: true,
                    min: 0,
                    max: 100,
                    title: { display: true, text: ENROLLMENT_AXIS_TITLE }
                },
                x: {
                    stacked: true,
                    title: { display: true, text: 'Year' }
                }
            },
            plugins: {
                legend: {
                    position: CHART_LEGEND_POSITION,
                    labels: {
                        usePointStyle: true,
                        padding: 12
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const pct = context.parsed.y.toFixed(1);
                            return ` ${context.dataset.label}: ${pct}%`;
                        }
                    }
                }
            },
            interaction: {
                mode: 'index',
                intersect: false
            }
        }
    });
}

function renderSexDistribution(filtered) {
    const ctx = document.getElementById('sex-distribution-chart');
    if (!ctx) return;

    let totals;
    if (dashboardSummary) {
        const d = dashboardSummary.sexDistribution;
        totals = { Female: d.female || 0, Male: d.male || 0, Unknown: d.unknown || 0 };
    } else {
        totals = { Female: 0, Male: 0, Unknown: 0 };
        filtered.forEach(study => {
            if (!study.sex?.reported) return;
            totals.Female += study.sex.totals.female || 0;
            totals.Male += study.sex.totals.male || 0;
            totals.Unknown += study.sex.totals.unknown || 0;
        });
    }

    if (charts.sexDistribution) charts.sexDistribution.destroy();

    charts.sexDistribution = new Chart(ctx, donutConfig(totals, DONUT_COLORS.sex, 'participants'));
}

function renderSexTrends(filtered) {
    const ctx = document.getElementById('sex-trends-chart');
    if (!ctx) return;

    let byYear;
    if (dashboardSummary) {
        byYear = {};
        for (const [yr, v] of Object.entries(dashboardSummary.byYear)) {
            byYear[yr] = { total: v.sn_count, female: v.sn_f };
        }
    } else {
        byYear = {};
        filtered.forEach(study => {
            const year = study.results_date?.substring(0, 4);
            if (!year || !study.sex?.reported) return;
            if (!byYear[year]) byYear[year] = { total: 0, female: 0 };
            const totals = study.sex.totals;
            const studyTotal = Object.values(totals).reduce((a, b) => a + b, 0);
            if (studyTotal > 0) { byYear[year].total++; byYear[year].female += (totals.female || 0) / studyTotal; }
        });
    }

    const years = Object.keys(byYear).sort();

    if (charts.sexTrends) charts.sexTrends.destroy();

    charts.sexTrends = new Chart(ctx, {
        type: 'line',
        data: {
            labels: years,
            datasets: [{
                label: 'Female',
                data: years.map(y => byYear[y].total > 0 ? (byYear[y].female / byYear[y].total) * 100 : 0),
                borderColor: COLORS.sex.female,
                backgroundColor: COLORS.sex.female + '20',
                tension: 0.3
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            aspectRatio: CHART_ASPECT_RATIO,
            scales: {
                y: {
                    beginAtZero: true,
                    max: 100,
                    title: { display: true, text: 'Average % Female per Study' }
                }
            },
            plugins: {
                legend: { position: 'top' }
            }
        }
    });
}

function renderGenderDistribution(filtered) {
    const ctx = document.getElementById('gender-distribution-chart');
    if (!ctx) return;

    let totals;
    if (dashboardSummary) {
        const d = dashboardSummary.genderDistribution;
        totals = { Woman: d.woman || 0, Man: d.man || 0, 'Non-binary': d.nonbinary || 0,
            Transgender: d.transgender || 0, Other: d.other || 0, 'Unknown or Not Reported': d.unknown || 0 };
    } else {
        totals = { Woman: 0, Man: 0, 'Non-binary': 0, Transgender: 0, Other: 0, 'Unknown or Not Reported': 0 };
        filtered.forEach(study => {
            if (!study.gender?.reported) return;
            totals.Woman += study.gender.totals.woman || 0;
            totals.Man += study.gender.totals.man || 0;
            totals['Non-binary'] += study.gender.totals.nonbinary || 0;
            totals.Transgender += study.gender.totals.transgender || 0;
            totals.Other += study.gender.totals.other || 0;
            totals['Unknown or Not Reported'] += study.gender.totals.unknown || 0;
        });
    }

    if (charts.genderDistribution) charts.genderDistribution.destroy();

    charts.genderDistribution = new Chart(ctx, donutConfig(totals, DONUT_COLORS.gender, 'participants'));
}

/**
 * Sex: Total Participants with Reported Sex Data per year
 */
function renderSexReportedParticipants(filtered) {
    const ctx = document.getElementById('sex-reported-participants-chart');
    if (!ctx) return;

    let byYear;
    if (dashboardSummary) {
        byYear = {};
        for (const [yr, v] of Object.entries(dashboardSummary.byYear)) {
            byYear[yr] = v.s_f + v.s_m;
        }
    } else {
        byYear = {};
        filtered.forEach(study => {
            const year = study.results_date?.substring(0, 4);
            if (!year || !study.sex?.reported) return;
            if (!byYear[year]) byYear[year] = 0;
            byYear[year] += (study.sex.totals.female || 0) + (study.sex.totals.male || 0);
        });
    }

    const years = Object.keys(byYear).sort();

    if (charts.sexReportedParticipants) charts.sexReportedParticipants.destroy();

    charts.sexReportedParticipants = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: years,
            datasets: [{
                label: 'Participants with Known Sex',
                data: years.map(y => byYear[y]),
                backgroundColor: COLORS.sex.female + '80',
                borderColor: COLORS.sex.female,
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            aspectRatio: CHART_ASPECT_RATIO,
            scales: {
                y: {
                    beginAtZero: true,
                    title: { display: true, text: 'Total Participants' }
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return ` ${context.parsed.y.toLocaleString()} participants`;
                        }
                    }
                }
            }
        }
    });
}

/**
 * Sex: Full Distribution with Data Quality (stacked bar)
 */
function renderSexFullDistribution(filtered) {
    const ctx = document.getElementById('sex-full-distribution-chart');
    if (!ctx) return;

    let byYear;
    if (dashboardSummary) {
        byYear = {};
        for (const [yr, v] of Object.entries(dashboardSummary.byYear)) {
            byYear[yr] = { female: v.s_f, male: v.s_m, explicitUnknown: v.s_u, totalEnrollment: v.fd_enrollment };
        }
    } else {
        byYear = {};
        filtered.forEach(study => {
            const year = study.results_date?.substring(0, 4);
            if (!year) return;
            if (!byYear[year]) byYear[year] = { female: 0, male: 0, explicitUnknown: 0, totalEnrollment: 0 };
            byYear[year].totalEnrollment += study.enrollment || 0;
            if (study.sex?.reported) {
                byYear[year].female += study.sex.totals.female || 0;
                byYear[year].male += study.sex.totals.male || 0;
                byYear[year].explicitUnknown += study.sex.totals.unknown || 0;
            }
        });
    }

    const years = Object.keys(byYear).sort();
    const femaleData = [], maleData = [], unknownData = [], notReportedData = [];

    years.forEach(y => {
        const d = byYear[y];
        const allReported = d.female + d.male + d.explicitUnknown;
        const effectiveTotal = Math.max(d.totalEnrollment, allReported);

        if (effectiveTotal === 0) {
            femaleData.push(0); maleData.push(0); unknownData.push(0); notReportedData.push(0);
            return;
        }

        const notReported = Math.max(0, effectiveTotal - allReported);
        femaleData.push((d.female / effectiveTotal) * 100);
        maleData.push((d.male / effectiveTotal) * 100);
        unknownData.push((d.explicitUnknown / effectiveTotal) * 100);
        notReportedData.push((notReported / effectiveTotal) * 100);
    });

    if (charts.sexFullDistribution) charts.sexFullDistribution.destroy();

    charts.sexFullDistribution = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: years,
            datasets: [
                { label: 'Female', data: femaleData, backgroundColor: COLORS.sex.female, borderColor: COLORS.sex.female, borderWidth: 1 },
                { label: 'Male', data: maleData, backgroundColor: COLORS.sex.male, borderColor: COLORS.sex.male, borderWidth: 1 },
                { label: 'Explicitly Unknown', data: unknownData, backgroundColor: '#9ca3af', borderColor: '#6b7280', borderWidth: 1 },
                { label: 'Not Reported (Missing)', data: notReportedData, backgroundColor: 'rgba(229, 231, 235, 0.7)', borderColor: 'rgba(209, 213, 219, 0.8)', borderWidth: 1 }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            aspectRatio: CHART_ASPECT_RATIO,
            scales: {
                y: { stacked: true, min: 0, max: 100, title: { display: true, text: ENROLLMENT_AXIS_TITLE } },
                x: { stacked: true, title: { display: true, text: 'Year' } }
            },
            plugins: {
                legend: { position: CHART_LEGEND_POSITION, labels: { usePointStyle: true, padding: 12 } },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return ` ${context.dataset.label}: ${context.parsed.y.toFixed(1)}%`;
                        }
                    }
                }
            },
            interaction: { mode: 'index', intersect: false }
        }
    });
}

/**
 * Gender: Total Participants with Reported Gender Data per year
 */
function renderGenderReportedParticipants(filtered) {
    const ctx = document.getElementById('gender-reported-participants-chart');
    if (!ctx) return;

    let byYear;
    if (dashboardSummary) {
        byYear = {};
        for (const [yr, v] of Object.entries(dashboardSummary.byYear)) {
            byYear[yr] = v.g_w + v.g_m + v.g_nb + v.g_tg + v.g_ot;
        }
    } else {
        byYear = {};
        filtered.forEach(study => {
            const year = study.results_date?.substring(0, 4);
            if (!year || !study.gender?.reported) return;
            if (!byYear[year]) byYear[year] = 0;
            const totals = study.gender.totals;
            byYear[year] += (totals.woman || 0) + (totals.man || 0) + (totals.nonbinary || 0) + (totals.transgender || 0) + (totals.other || 0);
        });
    }

    const years = Object.keys(byYear).sort();

    if (charts.genderReportedParticipants) charts.genderReportedParticipants.destroy();

    charts.genderReportedParticipants = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: years,
            datasets: [{
                label: 'Participants with Known Gender',
                data: years.map(y => byYear[y]),
                backgroundColor: COLORS.gender.nonbinary + '80',
                borderColor: COLORS.gender.nonbinary,
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            aspectRatio: CHART_ASPECT_RATIO,
            scales: {
                y: {
                    beginAtZero: true,
                    title: { display: true, text: 'Total Participants' }
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return ` ${context.parsed.y.toLocaleString()} participants`;
                        }
                    }
                }
            }
        }
    });
}

/**
 * Gender: Full Distribution with Data Quality (stacked bar)
 */
function renderGenderFullDistribution(filtered) {
    const ctx = document.getElementById('gender-full-distribution-chart');
    if (!ctx) return;

    let byYear;
    if (dashboardSummary) {
        byYear = {};
        for (const [yr, v] of Object.entries(dashboardSummary.byYear)) {
            byYear[yr] = { woman: v.g_w, man: v.g_m, nonbinary: v.g_nb, transgender: v.g_tg, other: v.g_ot, explicitUnknown: v.g_u, totalEnrollment: v.fd_enrollment };
        }
    } else {
        byYear = {};
        filtered.forEach(study => {
            const year = study.results_date?.substring(0, 4);
            if (!year) return;
            if (!byYear[year]) byYear[year] = { woman: 0, man: 0, nonbinary: 0, transgender: 0, other: 0, explicitUnknown: 0, totalEnrollment: 0 };
            byYear[year].totalEnrollment += study.enrollment || 0;
            if (study.gender?.reported) {
                const totals = study.gender.totals;
                byYear[year].woman += totals.woman || 0; byYear[year].man += totals.man || 0;
                byYear[year].nonbinary += totals.nonbinary || 0; byYear[year].transgender += totals.transgender || 0;
                byYear[year].other += totals.other || 0; byYear[year].explicitUnknown += totals.unknown || 0;
            }
        });
    }

    const years = Object.keys(byYear).sort();
    const womanData = [], manData = [], nbData = [], transData = [], otherData = [], unknownData = [], notReportedData = [];

    years.forEach(y => {
        const d = byYear[y];
        const allReported = d.woman + d.man + d.nonbinary + d.transgender + d.other + d.explicitUnknown;
        const effectiveTotal = Math.max(d.totalEnrollment, allReported);

        if (effectiveTotal === 0) {
            womanData.push(0); manData.push(0); nbData.push(0); transData.push(0); otherData.push(0); unknownData.push(0); notReportedData.push(0);
            return;
        }

        const notReported = Math.max(0, effectiveTotal - allReported);
        womanData.push((d.woman / effectiveTotal) * 100);
        manData.push((d.man / effectiveTotal) * 100);
        nbData.push((d.nonbinary / effectiveTotal) * 100);
        transData.push((d.transgender / effectiveTotal) * 100);
        otherData.push((d.other / effectiveTotal) * 100);
        unknownData.push((d.explicitUnknown / effectiveTotal) * 100);
        notReportedData.push((notReported / effectiveTotal) * 100);
    });

    if (charts.genderFullDistribution) charts.genderFullDistribution.destroy();

    charts.genderFullDistribution = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: years,
            datasets: [
                { label: 'Woman', data: womanData, backgroundColor: COLORS.gender.woman, borderColor: COLORS.gender.woman, borderWidth: 1 },
                { label: 'Man', data: manData, backgroundColor: COLORS.gender.man, borderColor: COLORS.gender.man, borderWidth: 1 },
                { label: 'Non-binary', data: nbData, backgroundColor: COLORS.gender.nonbinary, borderColor: COLORS.gender.nonbinary, borderWidth: 1 },
                { label: 'Transgender', data: transData, backgroundColor: COLORS.gender.transgender, borderColor: COLORS.gender.transgender, borderWidth: 1 },
                { label: 'Other', data: otherData, backgroundColor: COLORS.gender.other, borderColor: COLORS.gender.other, borderWidth: 1 },
                { label: 'Unknown or Not Reported', data: unknownData, backgroundColor: '#9ca3af', borderColor: '#6b7280', borderWidth: 1 },
                { label: 'Not Reported (Missing)', data: notReportedData, backgroundColor: 'rgba(229, 231, 235, 0.7)', borderColor: 'rgba(209, 213, 219, 0.8)', borderWidth: 1 }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            aspectRatio: CHART_ASPECT_RATIO,
            scales: {
                y: { stacked: true, min: 0, max: 100, title: { display: true, text: ENROLLMENT_AXIS_TITLE } },
                x: { stacked: true, title: { display: true, text: 'Year' } }
            },
            plugins: {
                legend: { position: CHART_LEGEND_POSITION, labels: { usePointStyle: true, padding: 12 } },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return ` ${context.dataset.label}: ${context.parsed.y.toFixed(1)}%`;
                        }
                    }
                }
            },
            interaction: { mode: 'index', intersect: false }
        }
    });
}

/**
 * Gender: Proportion of reported gender identities over time (line chart)
 */
function renderGenderTrends(filtered) {
    const ctx = document.getElementById('gender-trends-chart');
    if (!ctx) return;

    let byYear;
    if (dashboardSummary) {
        byYear = {};
        for (const [yr, v] of Object.entries(dashboardSummary.byYear)) {
            byYear[yr] = { count: v.gn_count, woman: v.gn_w, man: v.gn_m, nonbinary: v.gn_nb, transgender: v.gn_tg };
        }
    } else {
        byYear = {};
        filtered.forEach(study => {
            const year = study.results_date?.substring(0, 4);
            if (!year || !study.gender?.reported) return;
            if (!byYear[year]) byYear[year] = { count: 0, woman: 0, man: 0, nonbinary: 0, transgender: 0 };
            const totals = study.gender.totals;
            const studyTotal = (totals.woman || 0) + (totals.man || 0) + (totals.nonbinary || 0) + (totals.transgender || 0) + (totals.other || 0);
            if (studyTotal > 0) {
                byYear[year].count++;
                byYear[year].woman += (totals.woman || 0) / studyTotal;
                byYear[year].man += (totals.man || 0) / studyTotal;
                byYear[year].nonbinary += (totals.nonbinary || 0) / studyTotal;
                byYear[year].transgender += (totals.transgender || 0) / studyTotal;
            }
        });
    }

    const years = Object.keys(byYear).sort();

    if (charts.genderTrends) charts.genderTrends.destroy();

    charts.genderTrends = new Chart(ctx, {
        type: 'line',
        data: {
            labels: years,
            datasets: [
                {
                    label: 'Woman',
                    data: years.map(y => byYear[y].count > 0 ? (byYear[y].woman / byYear[y].count) * 100 : 0),
                    borderColor: COLORS.gender.woman,
                    backgroundColor: COLORS.gender.woman + '20',
                    tension: 0.3
                },
                {
                    label: 'Man',
                    data: years.map(y => byYear[y].count > 0 ? (byYear[y].man / byYear[y].count) * 100 : 0),
                    borderColor: COLORS.gender.man,
                    backgroundColor: COLORS.gender.man + '20',
                    tension: 0.3
                },
                {
                    label: 'Non-binary',
                    data: years.map(y => byYear[y].count > 0 ? (byYear[y].nonbinary / byYear[y].count) * 100 : 0),
                    borderColor: COLORS.gender.nonbinary,
                    backgroundColor: COLORS.gender.nonbinary + '20',
                    tension: 0.3
                },
                {
                    label: 'Transgender',
                    data: years.map(y => byYear[y].count > 0 ? (byYear[y].transgender / byYear[y].count) * 100 : 0),
                    borderColor: COLORS.gender.transgender,
                    backgroundColor: COLORS.gender.transgender + '20',
                    tension: 0.3
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            aspectRatio: CHART_ASPECT_RATIO,
            scales: {
                y: {
                    beginAtZero: true,
                    max: 100,
                    title: { display: true, text: 'Average % per Study' }
                }
            },
            plugins: {
                legend: { position: 'top' }
            }
        }
    });
}

// ===== Geography tab =====
// The old client-side geography aggregation (per-site state/city/country
// counts, reporting layers, regional/site/trend charts) was removed when the
// tab moved to the frozen geography contract in data/geo/. See geo/geo_ui.js.

// ── Lazy-load D3 + topojson (only when Geography tab is first opened) ──
let _d3Ready = null;
function ensureD3() {
    if (typeof d3 !== 'undefined' && typeof topojson !== 'undefined') return Promise.resolve();
    if (_d3Ready) return _d3Ready;
    _d3Ready = new Promise((resolve, reject) => {
        const d3Script = document.createElement('script');
        d3Script.src = 'https://d3js.org/d3.v7.min.js';
        d3Script.onload = () => {
            const topoScript = document.createElement('script');
            topoScript.src = 'https://cdn.jsdelivr.net/npm/topojson-client@3';
            topoScript.onload = resolve;
            topoScript.onerror = () => reject(new Error('Failed to load topojson'));
            document.head.appendChild(topoScript);
        };
        d3Script.onerror = () => reject(new Error('Failed to load D3'));
        document.head.appendChild(d3Script);
    });
    return _d3Ready;
}


// ── FDA Oversight Tab ──
// Regulatory classes are mutually exclusive: a trial studies an FDA-regulated
// drug, an FDA-regulated device, both, neither (the sponsor's explicit "No"),
// or never reported its oversight status. The unapproved-device flag is the
// pre-market layer within that: a device trial whose device has not yet been
// approved or cleared. Extractions before mid-2026 coerced unreported
// oversight to "No", so the unreported class fills in with fresh data.
const FDA_CLASS_ORDER = ['drug', 'device', 'both', 'none', 'unreported'];
const FDA_CLASS_LABELS = {
    drug: 'Drug (FDA-regulated)',
    device: 'Device (FDA-regulated)',
    both: 'Drug & Device',
    none: 'No FDA-regulated product',
    unreported: 'Oversight not reported'
};

function fdaClassOf(s) {
    const dr = s.is_fda_regulated_drug, dv = s.is_fda_regulated_device;
    if (dr === true && dv === true) return 'both';
    if (dr === true) return 'drug';
    if (dv === true) return 'device';
    if (dr == null && dv == null) return 'unreported';
    return 'none';
}

function renderFdaOversight(filtered) {
    // Mobile/summary path: the compact recentStudies list is only ~500 trials,
    // so computing FDA aggregates from `filtered` would be wildly
    // unrepresentative. Use the pre-aggregated counts in dashboard-summary.json
    // instead; archived snapshot summaries may predate the class schema and
    // fall back to the legacy four-category block.
    const f = dashboardSummary && dashboardSummary.fda;
    const hasClasses = !!(f && f.classes);
    const legacy = !!(f && !f.classes);

    let counts = null, reporting = null, orderRef = FDA_CLASS_ORDER, unapproved = 0, total = 0, both = 0;
    if (hasClasses) {
        counts = f.classes.counts;
        reporting = f.classes.reporting;
        orderRef = f.classes.order || FDA_CLASS_ORDER;
        unapproved = f.classes.unapproved || 0;
        both = counts.both || 0;
        total = dashboardSummary.totalStudies || 0;
    } else if (!legacy) {
        const byClass = { drug: [], device: [], both: [], none: [], unreported: [] };
        filtered.forEach(s => byClass[fdaClassOf(s)].push(s));
        counts = {};
        FDA_CLASS_ORDER.forEach(k => { counts[k] = byClass[k].length; });
        both = counts.both;
        unapproved = filtered.filter(s => s.is_unapproved_device === true).length;
        total = filtered.length;
        const pct = (subset, field) => subset.length
            ? parseFloat(((subset.filter(s => s[field]?.reported).length / subset.length) * 100).toFixed(1))
            : 0;
        reporting = {};
        ['sex', 'race', 'ethnicity'].forEach(field => {
            reporting[field] = FDA_CLASS_ORDER.map(k => pct(byClass[k], field));
        });
    } else {
        unapproved = f.counts.unapproved;
        total = dashboardSummary.totalStudies || 0;
    }

    // Stat cards. Drug/device cards include the both-flagged trials (with the
    // overlap called out); the headline card is deduplicated.
    const setTxt = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    if (legacy) {
        const regulated = Math.max(0, total - f.counts.nonRegulated);
        setTxt('fda-regulated-count', regulated.toLocaleString());
        setTxt('fda-drug-count', f.counts.drug.toLocaleString());
        setTxt('fda-device-count', f.counts.device.toLocaleString());
        setTxt('fda-nonregulated-count', f.counts.nonRegulated.toLocaleString());
        setTxt('fda-regulated-sub', total ? `${(regulated / total * 100).toFixed(1)}% of ${total.toLocaleString()} trials` : '');
        setTxt('fda-drug-sub', 'archived snapshot — overlap detail unavailable');
        setTxt('fda-device-sub', `${unapproved.toLocaleString()} study a device not yet approved or cleared`);
        setTxt('fda-nonregulated-sub', 'no FDA-regulated drug or device flag');
    } else {
        const regulated = counts.drug + counts.device + counts.both;
        setTxt('fda-regulated-count', regulated.toLocaleString());
        setTxt('fda-drug-count', (counts.drug + counts.both).toLocaleString());
        setTxt('fda-device-count', (counts.device + counts.both).toLocaleString());
        setTxt('fda-nonregulated-count', (counts.none + counts.unreported).toLocaleString());
        setTxt('fda-regulated-sub', total ? `${(regulated / total * 100).toFixed(1)}% of ${total.toLocaleString()} trials` : '');
        setTxt('fda-drug-sub', both > 0
            ? `${both.toLocaleString()} of these also study a regulated device`
            : 'product on the FDA drug pathway (IND)');
        setTxt('fda-device-sub', `${unapproved.toLocaleString()} study a device not yet approved or cleared`);
        setTxt('fda-nonregulated-sub', counts.unreported > 0
            ? `${counts.none.toLocaleString()} explicit “No” · ${counts.unreported.toLocaleString()} never reported oversight status`
            : 'sponsor answered “No”, or oversight was left unreported in older extractions');
    }

    // One grouped chart: % of trials reporting each demographic, per class.
    const ctx = document.getElementById('fda-reporting-chart');
    if (!ctx) return;
    if (charts.fdaReporting) charts.fdaReporting.destroy();

    const demoColors = { sex: COLORS.reporting.both, race: COLORS.reporting.race,
        ethnicity: COLORS.reporting.ethnicity };
    let labels, keyCounts, datasets;
    if (legacy) {
        keyCounts = [f.counts.drug, f.counts.device, f.counts.unapproved, f.counts.nonRegulated];
        labels = ['Regulated Drug', 'Regulated Device', 'Unapproved Device', 'Non-Regulated']
            .map((l, i) => `${l} (n=${keyCounts[i].toLocaleString()})`);
        datasets = ['sex', 'race', 'ethnicity'].map(field => ({
            label: field.charAt(0).toUpperCase() + field.slice(1),
            data: f.reporting[field],
            backgroundColor: demoColors[field]
        }));
    } else {
        const keys = FDA_CLASS_ORDER.filter(k => counts[k] > 0);
        keyCounts = keys.map(k => counts[k]);
        labels = keys.map(k => `${FDA_CLASS_LABELS[k]} (n=${counts[k].toLocaleString()})`);
        datasets = ['sex', 'race', 'ethnicity'].map(field => ({
            label: field.charAt(0).toUpperCase() + field.slice(1),
            data: keys.map(k => reporting[field][orderRef.indexOf(k)]),
            backgroundColor: demoColors[field]
        }));
    }

    // A dot plot, not grouped bars. The finding here is that sex is reported
    // almost universally in every class (96-99%) while race and ethnicity
    // fall away — and where oversight is never reported they collapse. Three
    // dots on a shared row show that spread directly; fifteen bars made you
    // hunt for it, in 643px of canvas with a y-axis running to 100 when
    // nothing falls below 24.
    const FIELDS = ['sex', 'race', 'ethnicity'];
    const rows = labels.map((label, i) => ({
        label,
        n: keyCounts[i],
        values: Object.fromEntries(FIELDS.map(f => [f, datasets[FIELDS.indexOf(f)].data[i]]))
    }));
    // Ordered by race reporting, so the axis reads as a gradient rather than
    // an arbitrary sequence. Every row is named, so the order carries no
    // meaning the labels do not already give.
    rows.sort((a, b) => b.values.race - a.values.race);
    // The "(n=…)" suffix is useful on a wide axis and simply truncates on a
    // phone, so it drops there and lives in the tooltip instead.
    const rowLabels = rows.map(r => isMobileDevice
        ? r.label.replace(/\s*\(n=[^)]*\)\s*$/, '')
        : r.label);
    rows.forEach((r, i) => { r.axisLabel = rowLabels[i]; });

    const allValues = rows.flatMap(r => FIELDS.map(f => r.values[f])).filter(v => Number.isFinite(v));
    // Start the axis a little below the lowest value instead of at zero: no
    // class reports below ~24%, and 0-24 is empty space that squeezes the
    // range that actually exists.
    const axMin = Math.max(0, Math.floor((Math.min(...allValues) - 8) / 5) * 5);

    charts.fdaReporting = new Chart(ctx, {
        type: 'scatter',
        data: {
            datasets: FIELDS.map(field => ({
                label: field.charAt(0).toUpperCase() + field.slice(1),
                data: rows.map(r => ({ x: r.values[field], y: r.axisLabel })),
                backgroundColor: demoColors[field],
                borderColor: '#ffffff',
                borderWidth: 1.5,
                pointRadius: 6,
                pointHoverRadius: 8
            }))
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            // Short and wide: five rows need far less height than the bars did.
            aspectRatio: isMobileDevice ? 1 : 2.6,
            layout: { padding: { top: 18, right: 34, bottom: 6, left: 4 } },
            scales: {
                x: {
                    min: axMin,
                    max: 100,
                    title: { display: true, text: '% of Trials Reporting' },
                    ticks: { callback: v => v + '%' }
                },
                y: {
                    type: 'category',
                    labels: rowLabels,
                    offset: true,
                    grid: { display: false },
                    ticks: {
                        autoSkip: false,
                        crossAlign: 'far',
                        // Returning an array renders one line per element, so a
                        // long class name wraps instead of being clipped on a
                        // narrow axis.
                        callback(value) {
                            const text = this.getLabelForValue(value);
                            if (!isMobileDevice || text.length <= 20) return text;
                            const out = [];
                            let line = '';
                            for (const word of String(text).split(' ')) {
                                if ((line + ' ' + word).trim().length > 20) { out.push(line.trim()); line = word; }
                                else line += ' ' + word;
                            }
                            if (line.trim()) out.push(line.trim());
                            return out;
                        }
                    }
                }
            },
            plugins: {
                legend: {
                    position: 'top',
                    align: 'start',
                    labels: { usePointStyle: true, boxWidth: 8, boxHeight: 8, padding: 16 }
                },
                tooltip: {
                    callbacks: {
                        title: c => (c.length ? rows[c[0].dataIndex].label : ''),
                        label: c => ` ${c.dataset.label}: ${c.parsed.x}% of ` +
                            `${(rows[c.dataIndex].n || 0).toLocaleString()} trials`
                    }
                },
                // Every dot carries its value, including the middle one.
                // On a wide plot all three sit above their dot, so each
                // number is unambiguously its row's. A phone has ~36px
                // between the race and sex dots — not enough for two labels
                // side by side — so there race drops below its own marker
                // rather than a value being dropped altogether.
                datalabels: {
                    display: true,
                    anchor: 'center',
                    align: (c) => (isMobileDevice && c.datasetIndex === 1 ? 'bottom' : 'top'),
                    offset: 7,
                    clamp: true,
                    color: '#212529',
                    font: { size: isMobileDevice ? 10 : 11, weight: '600' },
                    formatter: v => (typeof v.x === 'number' ? v.x.toFixed(1) : '')
                }
            }
        },
        plugins: [ChartDataLabels, fdaRowConnectorPlugin]
    });
}

/**
 * Main render function for Geography dashboard
 */
// The geography tab renders from the frozen contract pinned in
// data/geo/active_run.json (see geo/geo_ui.js). It deliberately ignores the
// dashboard's year/type/sponsor filters: the contract is one audited table,
// not a filterable dataset, and every number shown already exists in it.
function renderGeographyDashboard() {
    if (window.GeoUI) GeoUI.render();
}

/**
 * Initialize Geography tab event listeners
 */
function initGeographyTab() {
    // All geography-tab listeners are wired by GeoUI on its first render.
}

// ---------------------------------------------------------------------------
// AI/ML-Enabled Medical Devices Tab
// ---------------------------------------------------------------------------
let aiDevicesData = null;
let aiDevicesLoaded = false;

async function loadAIDevicesTab() {
    if (aiDevicesLoaded) return;

    // Prefer the enriched CSV (with pdf_url / local_pdf_path columns produced
    // by the civicsample-engine pipeline). Fall back to the raw FDA CSV
    // so the tab still renders if the fetch script hasn't been run yet.
    const sources = [
        'data/ai-ml-enabled-devices-enriched.csv',
        'data/ai-ml-enabled-devices-csv_20260305.csv',
    ];

    for (const src of sources) {
        try {
            const resp = await fetch(src);
            if (!resp.ok) continue;
            const csvText = await resp.text();
            aiDevicesData = parseCSV(csvText);
            aiDevicesLoaded = true;
            renderAIDevicesTab();
            return;
        } catch (e) {
            console.warn(`Could not load ${src}:`, e.message);
        }
    }

    const tbody = document.getElementById('ai-devices-tbody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="8">Could not load AI devices data.</td></tr>';
}

function parseCSV(text) {
    const rows = [];
    const headers = [];
    let current = '';
    let inQuotes = false;
    let fields = [];

    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (ch === '"') {
            inQuotes = !inQuotes;
        } else if (ch === ',' && !inQuotes) {
            fields.push(current.trim());
            current = '';
        } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
            if (ch === '\r' && text[i + 1] === '\n') i++; // skip \r\n
            fields.push(current.trim());
            current = '';
            if (fields.length > 1 || fields[0] !== '') {
                if (headers.length === 0) {
                    headers.push(...fields);
                } else if (fields.length === headers.length) {
                    const row = {};
                    headers.forEach((h, idx) => row[h] = fields[idx]);
                    rows.push(row);
                }
            }
            fields = [];
        } else {
            current += ch;
        }
    }
    // Handle last row if no trailing newline
    if (current || fields.length) {
        fields.push(current.trim());
        if (headers.length && fields.length === headers.length) {
            const row = {};
            headers.forEach((h, idx) => row[h] = fields[idx]);
            rows.push(row);
        }
    }
    return rows;
}

function renderAIDevicesTab() {
    if (!aiDevicesData) return;

    // Stats: the marketing-authorization pathways are the headline. 510(k)
    // clearance rides substantial equivalence to a predicate; De Novo and PMA
    // are where novel evidence gets reviewed — a split that frames how much
    // clinical scrutiny this young category actually receives.
    const statsEl = document.getElementById('ai-devices-stats');
    const panelCounts = {};
    const yearCounts = {};
    const pathwayCounts = { '510(k)': 0, 'De Novo': 0, 'PMA': 0, 'Other': 0 };
    aiDevicesData.forEach(d => {
        const panel = d['Panel (Lead)'] || 'Unknown';
        panelCounts[panel] = (panelCounts[panel] || 0) + 1;
        pathwayCounts[aiPathwayOf(d['Submission Number'])] += 1;

        const date = d['Date of Final Decision'];
        if (date) {
            let year = date.split('/')[2];
            if (year && year.length === 2) {
                year = (parseInt(year) >= 90 ? '19' : '20') + year;
            }
            if (year) yearCounts[year] = (yearCounts[year] || 0) + 1;
        }
    });

    const total = aiDevicesData.length;
    const pctOf = n => total ? `${(n / total * 100).toFixed(1)}%` : '—';
    statsEl.innerHTML = `
        <div class="stats-grid" style="margin-bottom: 1.5rem;">
            <div class="stat-card">
                <h3>Authorized AI/ML Devices</h3>
                <p class="stat-value">${total.toLocaleString()}</p>
                <p class="stat-sub">FDA marketing authorization — products, not trials</p>
            </div>
            <div class="stat-card">
                <h3>510(k) Clearances</h3>
                <p class="stat-value">${pathwayCounts['510(k)'].toLocaleString()}</p>
                <p class="stat-sub">${pctOf(pathwayCounts['510(k)'])} — substantial equivalence to a predicate device</p>
            </div>
            <div class="stat-card">
                <h3>De Novo Grants</h3>
                <p class="stat-value">${pathwayCounts['De Novo'].toLocaleString()}</p>
                <p class="stat-sub">novel devices with no predicate</p>
            </div>
            <div class="stat-card">
                <h3>PMA Approvals</h3>
                <p class="stat-value">${pathwayCounts['PMA'].toLocaleString()}</p>
                <p class="stat-sub">full premarket approval on clinical evidence</p>
            </div>
        </div>
    `;

    // Panel bar chart
    renderAIPanelChart(panelCounts);

    // Timeline chart, stacked by authorization pathway, plus the De Novo/PMA
    // detail chart (invisible slivers at the main chart's 510(k) scale).
    renderAITimelineChart();
    renderAINonKChart();

    // Initialize table with pagination
    aiDevicesFiltered = aiDevicesData;
    aiDevicesPage = 0;
    applyAIDevicesView();

    // Search + pathway filter compose; both funnel through one recompute.
    const searchEl = document.getElementById('ai-device-search');
    if (searchEl) {
        searchEl.addEventListener('input', applyAIDevicesFilters);
    }
    const pathwayBox = document.getElementById('ai-pathway-filter');
    if (pathwayBox && !pathwayBox.dataset.wired) {
        pathwayBox.dataset.wired = '1';
        pathwayBox.querySelectorAll('.view-btn').forEach(btn => btn.addEventListener('click', () => {
            pathwayBox.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            aiDevicesPathway = btn.dataset.pathway;
            applyAIDevicesFilters();
        }));
    }

    wireRowsControl('ai-devices-rows', n => {
        aiDevicesPageSize = n;
        aiDevicesPage = 0;
        applyAIDevicesView();
    });

    // Delegated more/less toggle for truncated device names (rows re-render
    // on every page/filter change, so the listener lives on the tbody).
    const devTbody = document.getElementById('ai-devices-tbody');
    if (devTbody && !devTbody.dataset.moreWired) {
        devTbody.dataset.moreWired = '1';
        devTbody.addEventListener('click', e => {
            const btn = e.target.closest('.device-more');
            if (!btn) return;
            const cell = btn.closest('td');
            const shortEl = cell.querySelector('.device-short');
            const fullEl = cell.querySelector('.device-full');
            const expanded = fullEl.style.display !== 'none';
            fullEl.style.display = expanded ? 'none' : '';
            shortEl.style.display = expanded ? '' : 'none';
            btn.textContent = expanded ? 'more' : 'less';
            btn.setAttribute('aria-expanded', String(!expanded));
        });
    }

    // Date sort toggle
    const dateHeader = document.getElementById('ai-date-header');
    if (dateHeader) {
        dateHeader.addEventListener('click', () => {
            if (aiDevicesSortDir === null) aiDevicesSortDir = 'desc';
            else if (aiDevicesSortDir === 'desc') aiDevicesSortDir = 'asc';
            else aiDevicesSortDir = null;
            aiDevicesPage = 0;
            applyAIDevicesView();
        });
    }
}

// Long marketed-device names (some list every model variant) collapse to
// their first words with a more/less toggle so the column stays narrow.
function deviceNameCell(name) {
    const words = name.split(/\s+/);
    if (words.length <= 6 && name.length <= 60) return escapeHtml(name);
    let short = words.slice(0, 6).join(' ');
    if (short.length > 60) short = short.slice(0, 57).replace(/\s+\S*$/, '');
    return `<span class="device-short">${escapeHtml(short)}&hellip;</span>`
        + `<span class="device-full" style="display:none">${escapeHtml(name)}</span> `
        + `<button type="button" class="device-more" aria-expanded="false">more</button>`;
}

// Premarket pathway from the submission-number prefix: K = 510(k) clearance,
// DEN = De Novo grant, P = PMA approval.
const AI_PATHWAY_COLORS = { '510(k)': '#4A7BA6', 'De Novo': '#52b788', 'PMA': '#C26C8E', 'Other': '#9aa5a0' };

function aiPathwayOf(submissionNumber) {
    const sn = (submissionNumber || '').trim().toUpperCase();
    if (sn.startsWith('DEN')) return 'De Novo';
    if (sn.startsWith('P')) return 'PMA';
    if (sn.startsWith('K')) return '510(k)';
    return 'Other';
}

function getFDAUrl(submissionNumber) {
    if (!submissionNumber) return null;
    const sn = submissionNumber.trim().toUpperCase();
    if (sn.startsWith('DEN')) {
        return `https://www.accessdata.fda.gov/scripts/cdrh/cfdocs/cfpmn/denovo.cfm?id=${encodeURIComponent(submissionNumber)}`;
    }
    if (sn.startsWith('P')) {
        return `https://www.accessdata.fda.gov/scripts/cdrh/cfdocs/cfpma/pma.cfm?id=${encodeURIComponent(submissionNumber)}`;
    }
    if (sn.startsWith('K')) {
        return `https://www.accessdata.fda.gov/scripts/cdrh/cfdocs/cfPMN/pmn.cfm?ID=${encodeURIComponent(submissionNumber)}`;
    }
    // Unknown prefix — no valid link
    return null;
}

// AI Devices table state
let aiDevicesFiltered = [];
let aiDevicesPage = 0;
let aiDevicesSortDir = null; // null, 'asc', 'desc'
let aiDevicesPathway = 'all'; // 'all' | '510(k)' | 'De Novo' | 'PMA'

// Recompute the table's working set from the search box + pathway filter.
function applyAIDevicesFilters() {
    if (!aiDevicesData) return;
    const q = (document.getElementById('ai-device-search')?.value || '').toLowerCase();
    aiDevicesFiltered = aiDevicesData.filter(d =>
        (aiDevicesPathway === 'all' || aiPathwayOf(d['Submission Number']) === aiDevicesPathway) &&
        (!q || Object.values(d).some(v => v.toLowerCase().includes(q))));
    aiDevicesPage = 0;
    applyAIDevicesView();
}
let aiDevicesPageSize = 15;  // rows per page (15 default, selectable 25/50)

function applyAIDevicesView() {
    const tbody = document.getElementById('ai-devices-tbody');
    const countSpan = document.getElementById('ai-device-count');
    const paginationEl = document.getElementById('ai-devices-pagination');
    if (!tbody) return;

    let viewData = [...aiDevicesFiltered];

    // Sort by date if active
    if (aiDevicesSortDir) {
        viewData.sort((a, b) => {
            const da = parseAIDate(a['Date of Final Decision']);
            const db = parseAIDate(b['Date of Final Decision']);
            return aiDevicesSortDir === 'asc' ? da - db : db - da;
        });
    }

    const totalCount = viewData.length;
    const totalPages = Math.max(1, Math.ceil(totalCount / aiDevicesPageSize));
    aiDevicesPage = Math.max(0, Math.min(aiDevicesPage, totalPages - 1));
    const start = aiDevicesPage * aiDevicesPageSize;
    const pageData = viewData.slice(start, start + aiDevicesPageSize);

    if (countSpan) {
        countSpan.textContent = `Showing ${start + 1}–${Math.min(start + aiDevicesPageSize, totalCount)} of ${totalCount}`;
    }

    tbody.innerHTML = pageData.map(d => {
        const subNum = d['Submission Number'] || '';
        const fdaUrl = getFDAUrl(subNum);
        const subCell = fdaUrl
            ? `<a href="${fdaUrl}" target="_blank" rel="noopener" class="fda-link" title="View the FDA premarket record">${escapeHtml(subNum)}</a>`
            : escapeHtml(subNum);
        const pathway = aiPathwayOf(subNum);
        const pathwayCell = `<span class="ai-pathway" style="color:${AI_PATHWAY_COLORS[pathway]}">${escapeHtml(pathway)}</span>`;

        // Summary Document badge. "PDF Available" requires a cached local copy
        // (local_pdf_path !== "Not Found"); the badge then links out to the
        // upstream pdf_url for one-click access. Falls back to "Unavailable"
        // when either the enriched CSV is not present or the PDF wasn't found.
        const pdfUrl = d['pdf_url'];
        const localPath = d['local_pdf_path'];
        const hasLocalPdf = localPath && localPath !== 'Not Found';
        const hasPdfUrl = pdfUrl && pdfUrl !== 'Not Found';
        let pdfCell;
        if (hasLocalPdf && hasPdfUrl) {
            pdfCell = `<a href="${escapeHtml(pdfUrl)}" target="_blank" rel="noopener" class="pdf-badge pdf-badge-available" title="Open FDA summary PDF">PDF Available</a>`;
        } else {
            pdfCell = `<span class="pdf-badge pdf-badge-unavailable" title="Summary PDF has not been cached locally">Unavailable</span>`;
        }

        return `<tr>
            <td>${escapeHtml(d['Date of Final Decision'] || '')}</td>
            <td>${subCell}</td>
            <td>${pathwayCell}</td>
            <td class="device-cell">${deviceNameCell(d['Device'] || '')}</td>
            <td>${escapeHtml(d['Company'] || '')}</td>
            <td>${escapeHtml(d['Panel (Lead)'] || '')}</td>
            <td>${escapeHtml(d['Primary Product Code'] || d['Product Code'] || '')}</td>
            <td>${pdfCell}</td>
        </tr>`;
    }).join('');

    // Render pagination
    if (paginationEl) {
        if (totalPages <= 1) {
            paginationEl.innerHTML = '';
        } else {
            let phtml = `<button class="page-btn" ${aiDevicesPage === 0 ? 'disabled' : ''} onclick="aiDevicesGoPage(${aiDevicesPage - 1})">&#8592; Previous</button>`;
            // Show up to 7 page numbers
            const maxButtons = 7;
            let startPage = Math.max(0, aiDevicesPage - Math.floor(maxButtons / 2));
            let endPage = Math.min(totalPages, startPage + maxButtons);
            if (endPage - startPage < maxButtons) startPage = Math.max(0, endPage - maxButtons);
            for (let i = startPage; i < endPage; i++) {
                phtml += `<button class="page-btn ${i === aiDevicesPage ? 'active' : ''}" onclick="aiDevicesGoPage(${i})">${i + 1}</button>`;
            }
            phtml += `<button class="page-btn" ${aiDevicesPage >= totalPages - 1 ? 'disabled' : ''} onclick="aiDevicesGoPage(${aiDevicesPage + 1})">Next &#8594;</button>`;
            paginationEl.innerHTML = phtml;
        }
    }

    // Update sort arrow
    const header = document.getElementById('ai-date-header');
    if (header) {
        const arrow = header.querySelector('.sort-arrow');
        if (arrow) arrow.textContent = aiDevicesSortDir === 'asc' ? ' ▲' : aiDevicesSortDir === 'desc' ? ' ▼' : '';
    }
}

function parseAIDate(dateStr) {
    if (!dateStr) return 0;
    const parts = dateStr.split('/');
    if (parts.length === 3) {
        let year = parts[2];
        if (year.length === 2) year = (parseInt(year) >= 90 ? '19' : '20') + year;
        return new Date(year, parseInt(parts[0]) - 1, parseInt(parts[1])).getTime();
    }
    return 0;
}

function aiDevicesGoPage(page) {
    aiDevicesPage = page;
    applyAIDevicesView();
}
window.aiDevicesGoPage = aiDevicesGoPage;

function renderAIPanelChart(panelCounts) {
    const ctx = document.getElementById('ai-panel-chart');
    if (!ctx) return;

    const sorted = Object.entries(panelCounts).sort((a, b) => b[1] - a[1]);

    // Radiology holds 1,104 devices and the smallest panels hold one. Against
    // a linear axis scaled to 1,104 everything below ten is a hairline, so the
    // tail is combined into a single labelled row rather than a stack of bars
    // nobody can see, and every bar carries its own count — which is what
    // makes a one-pixel bar still readable.
    const TAIL_BELOW = 10;
    const head = sorted.filter(([, v]) => v >= TAIL_BELOW);
    const tail = sorted.filter(([, v]) => v < TAIL_BELOW);
    const tailTotal = tail.reduce((a, [, v]) => a + v, 0);

    const labels = head.map(e => e[0]);
    const values = head.map(e => e[1]);
    const colors = head.map(() => RACE_RAMP[1]);
    if (tail.length) {
        labels.push(`${tail.length} panels under ${TAIL_BELOW}`);
        values.push(tailTotal);
        colors.push(RACE_RAMP[4]);
    }
    const tailNames = tail.map(([k, v]) => `${k} (${v})`).join(', ');

    if (charts.aiPanel) charts.aiPanel.destroy();
    charts.aiPanel = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: 'Devices',
                data: values,
                backgroundColor: colors,
                borderRadius: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            aspectRatio: CHART_ASPECT_RATIO,
            indexAxis: 'y',
            // Room at the right for the value that sits past the bar end.
            layout: { padding: { right: 40 } },
            scales: {
                x: { beginAtZero: true, title: { display: true, text: 'Number of Devices' } }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: c => c.dataIndex === labels.length - 1 && tail.length
                            ? ` ${c.parsed.x} devices across ${tailNames}`
                            : ` ${c.parsed.x.toLocaleString()} devices`
                    }
                },
                datalabels: {
                    display: true,
                    anchor: 'end',
                    align: 'end',
                    offset: 4,
                    clamp: true,
                    color: '#495057',
                    font: { size: 11, weight: '500' },
                    formatter: v => v.toLocaleString()
                }
            }
        },
        plugins: [ChartDataLabels]
    });
}

function renderAITimelineChart() {
    const ctx = document.getElementById('ai-timeline-chart');
    if (!ctx || !aiDevicesData) return;

    // Stacked by premarket pathway on a continuous year axis (empty years
    // render as gaps rather than being skipped, so the pre-2016 quiet and the
    // recent surge read at true scale).
    const byYearPathway = {};
    let minYear = Infinity, maxYear = -Infinity;
    aiDevicesData.forEach(d => {
        const t = parseAIDate(d['Date of Final Decision']);
        if (!t) return;
        const y = new Date(t).getFullYear();
        minYear = Math.min(minYear, y); maxYear = Math.max(maxYear, y);
        const bucket = byYearPathway[y] = byYearPathway[y] || {};
        const p = aiPathwayOf(d['Submission Number']);
        bucket[p] = (bucket[p] || 0) + 1;
    });
    if (!isFinite(minYear)) return;
    const years = [];
    for (let y = minYear; y <= maxYear; y++) years.push(String(y));

    const pathways = ['510(k)', 'De Novo', 'PMA'];
    const datasets = pathways.map(p => ({
        label: p,
        data: years.map(y => (byYearPathway[y] && byYearPathway[y][p]) || 0),
        backgroundColor: AI_PATHWAY_COLORS[p]
    }));

    if (charts.aiTimeline) charts.aiTimeline.destroy();
    charts.aiTimeline = new Chart(ctx, {
        type: 'bar',
        data: { labels: years, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            aspectRatio: CHART_ASPECT_RATIO,
            scales: {
                y: { stacked: true, beginAtZero: true, title: { display: true, text: 'Number of Authorizations' } },
                x: { stacked: true, title: { display: true, text: 'Year of Final Decision' } }
            },
            plugins: {
                legend: { position: CHART_LEGEND_POSITION, labels: { usePointStyle: true, boxWidth: 8, boxHeight: 8 } },
                tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${c.parsed.y}` } },
                datalabels: { display: false }
            }
        }
    });
}

// The De Novo + PMA detail: at the main timeline's 510(k) scale these two
// pathways are invisible slivers, so they get their own chart at their own
// scale — the slice that carried novel-device or full clinical review.
function renderAINonKChart() {
    const ctx = document.getElementById('ai-nonk-chart');
    if (!ctx || !aiDevicesData) return;

    const byYear = {};
    let minYear = Infinity, maxYear = -Infinity;
    aiDevicesData.forEach(d => {
        const p = aiPathwayOf(d['Submission Number']);
        if (p !== 'De Novo' && p !== 'PMA') return;
        const t = parseAIDate(d['Date of Final Decision']);
        if (!t) return;
        const y = new Date(t).getFullYear();
        minYear = Math.min(minYear, y); maxYear = Math.max(maxYear, y);
        const bucket = byYear[y] = byYear[y] || {};
        bucket[p] = (bucket[p] || 0) + 1;
    });
    if (!isFinite(minYear)) return;
    const years = [];
    for (let y = minYear; y <= maxYear; y++) years.push(String(y));

    const datasets = ['De Novo', 'PMA'].map(p => ({
        label: p,
        data: years.map(y => (byYear[y] && byYear[y][p]) || 0),
        backgroundColor: AI_PATHWAY_COLORS[p]
    }));

    if (charts.aiNonK) charts.aiNonK.destroy();
    charts.aiNonK = new Chart(ctx, {
        type: 'bar',
        data: { labels: years, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            aspectRatio: CHART_ASPECT_RATIO,
            scales: {
                y: { stacked: true, beginAtZero: true, ticks: { precision: 0 }, title: { display: true, text: 'Number of Authorizations' } },
                x: { stacked: true, title: { display: true, text: 'Year of Final Decision' } }
            },
            plugins: {
                legend: { position: CHART_LEGEND_POSITION, labels: { usePointStyle: true, boxWidth: 8, boxHeight: 8 } },
                tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${c.parsed.y}` } },
                datalabels: { display: false }
            }
        }
    });
}

// ---------------------------------------------------------------------------
// Beta / Curator password gate
// ---------------------------------------------------------------------------
// The two Beta tabs display raw LLM output that has not been reviewed. We
// gate them behind a shared password so internal reviewers can see the work
// in progress without exposing unverified numbers to the public dashboard.
// Curator actions (Confirm / Deny on discrepancy rows) use a separate list
// of per-curator passwords so the eventual audit trail records who did what.
const BETA_PASSWORD = '@Builderg8';
const CURATOR_PASSWORDS = ['maryam', 'michael'];
const BETA_UNLOCKED_KEY = 'betaExtractionUnlocked';
const LIT_CURATION_STATE_KEY = 'litCurationState';

function isBetaUnlocked() {
    try { return sessionStorage.getItem(BETA_UNLOCKED_KEY) === '1'; }
    catch (_) { return false; }
}

function unlockBeta() {
    try { sessionStorage.setItem(BETA_UNLOCKED_KEY, '1'); }
    catch (_) { /* sessionStorage unavailable — fall through */ }
}

/**
 * Modal password prompt. Returns a Promise that resolves to the matched
 * password string on success, or `null` if the user cancels. The caller
 * provides a `validator` which inspects the entered value and returns the
 * matched identity string (or a truthy value) on success.
 */
function showPasswordGate({ title, message, validator, errorMessage }) {
    return new Promise((resolve) => {
        const overlay = document.getElementById('password-gate-overlay');
        if (!overlay) { resolve(null); return; }

        overlay.innerHTML = `
            <div class="password-gate-modal" role="dialog" aria-modal="true">
                <div class="modal-header">
                    <span>${escapeHtml(title)}</span>
                    <button class="close-btn" type="button" aria-label="Cancel">&times;</button>
                </div>
                <div class="modal-body">
                    <p>${escapeHtml(message)}</p>
                    <input type="password" id="password-gate-input" autocomplete="off" autofocus>
                    <div class="password-gate-error" id="password-gate-error">${escapeHtml(errorMessage || 'Incorrect password.')}</div>
                    <div class="password-gate-actions">
                        <button type="button" class="btn-cancel">Cancel</button>
                        <button type="button" class="btn-submit">Unlock</button>
                    </div>
                </div>
            </div>`;
        overlay.style.display = 'flex';

        const input = overlay.querySelector('#password-gate-input');
        const errorEl = overlay.querySelector('#password-gate-error');
        const submitBtn = overlay.querySelector('.btn-submit');
        const cancelBtn = overlay.querySelector('.btn-cancel');
        const closeBtn = overlay.querySelector('.close-btn');

        const cleanup = () => {
            overlay.style.display = 'none';
            overlay.innerHTML = '';
            overlay.onclick = null;
            document.removeEventListener('keydown', onKey);
        };

        const finishSuccess = (match) => { cleanup(); resolve(match); };
        const finishCancel = () => { cleanup(); resolve(null); };

        const tryUnlock = () => {
            const pw = input.value || '';
            const match = validator(pw);
            if (match) { finishSuccess(typeof match === 'string' ? match : pw); return; }
            errorEl.classList.add('visible');
            input.select();
        };

        const onKey = (e) => {
            if (e.key === 'Escape') finishCancel();
            if (e.key === 'Enter') tryUnlock();
        };

        submitBtn.addEventListener('click', tryUnlock);
        cancelBtn.addEventListener('click', finishCancel);
        closeBtn.addEventListener('click', finishCancel);
        overlay.onclick = (e) => { if (e.target === overlay) finishCancel(); };
        document.addEventListener('keydown', onKey);

        setTimeout(() => input.focus(), 30);
    });
}

async function promptForBetaAccess() {
    if (isBetaUnlocked()) return true;
    const match = await showPasswordGate({
        title: 'Beta Extraction — Reviewers Only',
        message: 'These tabs display raw LLM output awaiting curator review. Enter the shared Beta password to continue.',
        validator: (pw) => pw === BETA_PASSWORD,
        errorMessage: 'Incorrect password — access denied.'
    });
    if (match) { unlockBeta(); return true; }
    return false;
}

async function promptForCuratorAccess() {
    const match = await showPasswordGate({
        title: 'Curator Action',
        message: 'Curator password required to persist this resolution.',
        validator: (pw) => CURATOR_PASSWORDS.includes((pw || '').toLowerCase()) ? (pw || '').toLowerCase() : null,
        errorMessage: 'Not a recognized curator password.'
    });
    return match; // returns lowercase curator name or null
}

function closeExtractionDetails() {
    const overlay = document.getElementById('extraction-details-overlay');
    if (overlay) { overlay.style.display = 'none'; overlay.innerHTML = ''; }
}
window.closeExtractionDetails = closeExtractionDetails;

// ---------------------------------------------------------------------------
// (Beta) Approval Queue — React + Tailwind triage island (lazy-loaded)
// ---------------------------------------------------------------------------
// The triage inbox lives in beta/approval-queue.jsx as a self-contained React
// app. This host page is a no-build static site, so we follow the existing
// lazy-load pattern (cf. D3 for Geography) and only pull React + Babel +
// Tailwind from the CDN the first time the tab is opened. Tailwind's preflight
// reset is disabled *before* its first build and its utilities are scoped to
// #approval-queue-root via `important`, so the Play CDN can never bleed into or
// clobber the surrounding vanilla-CSS dashboard.
let approvalQueueLoaded = false;
let approvalQueueRoot = null;

function _loadScriptOnce(src, key) {
    return new Promise((resolve, reject) => {
        if (document.querySelector(`script[data-aq="${key}"]`)) { resolve(); return; }
        const s = document.createElement('script');
        s.src = src;
        s.async = false; // preserve execution order across chained loads
        s.dataset.aq = key;
        s.onload = () => resolve();
        s.onerror = () => reject(new Error('Failed to load ' + src));
        document.head.appendChild(s);
    });
}

async function loadApprovalQueueTab() {
    const root = document.getElementById('approval-queue-root');
    if (!root || approvalQueueLoaded) return;
    approvalQueueLoaded = true;
    root.innerHTML = '<p class="note" style="padding:1.5rem;">Loading triage workspace…</p>';
    try {
        // 1) Tailwind Play CDN first; disable preflight + scope utilities to the
        //    island in the onload microtask, which runs before the CDN's first
        //    (rAF-scheduled) build — so no global CSS reset is ever emitted.
        if (!window.tailwind) {
            await _loadScriptOnce('https://cdn.tailwindcss.com', 'tw');
        }
        if (window.tailwind) {
            window.tailwind.config = {
                important: '#approval-queue-root',
                corePlugins: { preflight: false },
            };
        }
        // 2) React + ReactDOM (UMD) then Babel-standalone, all from jsDelivr to
        //    match the dashboard's existing CDN.
        await _loadScriptOnce('https://cdn.jsdelivr.net/npm/react@18/umd/react.production.min.js', 'react');
        await _loadScriptOnce('https://cdn.jsdelivr.net/npm/react-dom@18/umd/react-dom.production.min.js', 'react-dom');
        await _loadScriptOnce('https://cdn.jsdelivr.net/npm/@babel/standalone/babel.min.js', 'babel');

        // 3) Fetch, compile (JSX -> JS), and execute the component module.
        const src = await fetch('beta/approval-queue.jsx?v=20260701').then(r => {
            if (!r.ok) throw new Error('approval-queue.jsx → HTTP ' + r.status);
            return r.text();
        });
        const compiled = window.Babel.transform(src, {
            presets: ['react'],
            filename: 'approval-queue.jsx',
        }).code;
        (0, eval)(compiled); // indirect eval → global scope; defines window.CivicApprovalQueue

        // 4) Mount the React root into the tab container.
        root.innerHTML = '';
        approvalQueueRoot = window.CivicApprovalQueue.mount(root, {
            fdaUrl: 'data/fda_extracted_latest.csv',
            litUrl: 'data/lit_extracted_latest.csv',
            reviewers: ['Michael', 'Maryam', 'Agent_v1'],
        });
    } catch (err) {
        console.error('[ApprovalQueue] load failed', err);
        approvalQueueLoaded = false; // allow a retry on next tab open
        root.innerHTML = '<div class="note" style="padding:1.5rem;color:#b91c1c;">'
            + 'Could not load the Approval Queue workspace (' + escapeHtml(err && err.message ? err.message : 'unknown error') + '). '
            + 'Check your connection and reopen the tab to retry.</div>';
    }
}
window.loadApprovalQueueTab = loadApprovalQueueTab;

// ---------------------------------------------------------------------------
// Beta extraction — value formatting helpers (shared by FDA + Literature)
// ---------------------------------------------------------------------------
// The extraction schema intentionally uses the sentinel string "Not Reported"
// so downstream UI can visually distinguish "the source didn't mention it"
// from "the source reported zero". These helpers preserve that distinction.
const NOT_REPORTED = 'Not Reported';

// Evidence-wrapped leaves are objects of the form
// `{ value, exact_quote, page_number }` emitted by the tool-use extractors.
// `evValue()` unwraps them back to a plain value so existing formatters keep
// working unchanged against both the new schema and any legacy flat payloads
// still sitting on disk.
function isEvidenceWrapped(v) {
    return v !== null
        && typeof v === 'object'
        && !Array.isArray(v)
        && 'value' in v
        && 'exact_quote' in v;
}

function evValue(v) {
    return isEvidenceWrapped(v) ? v.value : v;
}

// Styled blockquote for an evidence-wrapped value. Returns empty string for
// flat / Not-Reported / quote-less payloads so callers can safely concatenate.
function evidenceBlock(v) {
    if (!isEvidenceWrapped(v)) return '';
    const quote = (v.exact_quote || '').trim();
    if (!quote) return '';
    const pageLabel = v.page_number ? `Page ${v.page_number}` : 'Page —';
    return `<blockquote class="evidence-quote"><span class="evidence-quote-text">&ldquo;${escapeHtml(quote)}&rdquo;</span><cite class="evidence-quote-cite">(${escapeHtml(pageLabel)})</cite></blockquote>`;
}

// `-1` is the integer sentinel emitted by the new evidence-first extraction
// schemas (`record_fda_demographics`, `record_ses_and_race`) to signal that
// a numeric field is missing from the PDF. We treat it as Not Reported for
// breakdown filtering / status checks; `fmtVal` then surfaces a distinct
// "Missing in PDF" badge so reviewers can tell the model-said-missing case
// apart from a string sentinel like "Not Reported".
function isMissingInt(v) {
    v = evValue(v);
    if (typeof v === 'number') return v === -1;
    // Gemini's tool-schema flattening can coerce integer fields to strings
    // when union types are present, so the sentinel can arrive here as the
    // string "-1". Match only the exact integer representation (with
    // optional surrounding whitespace) to avoid false positives on values
    // like "−1.5" or "abc".
    if (typeof v === 'string') {
        const trimmed = v.trim();
        if (/^-?\d+$/.test(trimmed)) return Number(trimmed) === -1;
    }
    return false;
}

function isNR(v) {
    v = evValue(v);
    if (v === undefined || v === null || v === '' || v === NOT_REPORTED) return true;
    // Delegate to isMissingInt so both the numeric -1 (Anthropic / coerced
    // Vertex output) and the stringified "-1" (un-coerced Vertex output)
    // are filtered out of breakdowns and treated as Not Reported.
    if (isMissingInt(v)) return true;
    return false;
}

// Detect a scalar value that the researchers explicitly labeled "Unknown"
// / "Not Stated" (as opposed to simply not mentioning the field).
// The distinction matters for reviewers: "unknown for 12 participants" is
// data, "field never mentioned" is a reporting gap.
const EXPLICIT_UNKNOWN_STRINGS = new Set([
    'unknown', 'not stated', 'not known', 'unknown or not reported',
]);
function isExplicitUnknown(v) {
    if (v == null) return false;
    if (typeof v !== 'string') return false;
    return EXPLICIT_UNKNOWN_STRINGS.has(v.trim().toLowerCase());
}

function fmtVal(v) {
    v = evValue(v);
    // Differentiate the new -1 integer sentinel ("model says the field is
    // not in the PDF") from generic Not Reported strings — the badge label
    // is more specific so reviewers can audit faster.
    if (isMissingInt(v)) return '<span class="missing-pdf-badge">Missing in PDF</span>';
    if (isNR(v)) return '<span class="not-reported-badge">Not Reported</span>';
    if (isExplicitUnknown(v)) return '<span class="explicit-unknown-badge">Unknown</span>';
    if (typeof v === 'number') return v.toLocaleString();
    return escapeHtml(String(v));
}

function fmtList(v) {
    v = evValue(v);
    if (isNR(v)) return '<span class="not-reported-badge">Not Reported</span>';
    if (Array.isArray(v)) {
        if (v.length === 0) return '<span class="not-reported-badge">Not Reported</span>';
        return v.map(x => escapeHtml(String(x))).join(', ');
    }
    return escapeHtml(String(v));
}

/**
 * Render a breakdown object (e.g. race_nih_omb, sex, ethnicity) as a compact
 * stacked list. Fields that are "Not Reported" for every subcategory collapse
 * to a single Not Reported badge; otherwise each reported subcategory is shown
 * on its own line.
 */
function fmtBreakdown(obj, labelMap) {
    if (!obj || typeof obj !== 'object' || isNR(obj)) {
        return '<span class="not-reported-badge">Not Reported</span>';
    }
    const reported = Object.entries(obj).filter(([_, v]) => !isNR(v));
    if (reported.length === 0) return '<span class="not-reported-badge">Not Reported</span>';
    // If the only reported subcategory is `unknown`, surface this as an
    // Explicit Unknown badge — otherwise the cell collapses visually to the
    // same "Reported" state as a fully-disclosed breakdown.
    const nonUnknownReported = reported.filter(([k, _]) => k !== 'unknown');
    if (nonUnknownReported.length === 0) {
        const [, uv] = reported[0];
        const uvRaw = evValue(uv);
        const val = typeof uvRaw === 'number' ? uvRaw.toLocaleString() : escapeHtml(String(uvRaw));
        return `<span class="explicit-unknown-badge">Unknown: ${val}</span>`;
    }
    return `<div class="extraction-stacked-values">${reported.map(([k, v]) => {
        const label = (labelMap && labelMap[k]) || k.replace(/_/g, ' ');
        const raw = evValue(v);
        const val = typeof raw === 'number' ? raw.toLocaleString() : escapeHtml(String(raw));
        const cls = k === 'unknown' ? 'kv-label kv-label-unknown' : 'kv-label';
        return `<div><span class="${cls}">${escapeHtml(label)}:</span> ${val}${evidenceBlock(v)}</div>`;
    }).join('')}</div>`;
}

// Classify a breakdown object (race/sex/ethnicity/gender) by reporting state.
// Returns 'not_reported' | 'explicit_unknown' | 'reported'.
function breakdownStatus(obj) {
    if (!obj || typeof obj !== 'object') return 'not_reported';
    const reported = Object.entries(obj).filter(([_, v]) => !isNR(v));
    if (reported.length === 0) return 'not_reported';
    if (reported.every(([k, _]) => k === 'unknown')) return 'explicit_unknown';
    return 'reported';
}

// Scalar equivalent of breakdownStatus() for plain string/integer fields.
function scalarStatus(v) {
    if (isNR(v)) return 'not_reported';
    if (isExplicitUnknown(v)) return 'explicit_unknown';
    return 'reported';
}

// Badge for a Not Reported / Explicit Unknown state. Returns '' for reported
// so the caller can inline the actual value alongside.
function statusBadge(status) {
    if (status === 'not_reported') return '<span class="not-reported-badge">Not Reported</span>';
    if (status === 'explicit_unknown') return '<span class="explicit-unknown-badge">Explicit Unknown</span>';
    return '';
}

const RACE_OMB_LABELS = {
    american_indian_or_alaska_native: 'AI/AN',
    asian: 'Asian',
    black_or_african_american: 'Black / African American',
    native_hawaiian_or_other_pacific_islander: 'NH/PI',
    white: 'White',
    more_than_one_race: 'More than one race',
    unknown: 'Unknown',
};
const SEX_LABELS = { female: 'Female', male: 'Male', unknown: 'Unknown' };
const GENDER_LABELS = {
    woman: 'Woman', man: 'Man', non_binary: 'Non-binary',
    transgender: 'Transgender', other: 'Other', unknown: 'Unknown',
};
const ETHNICITY_LABELS = {
    hispanic_or_latino: 'Hispanic or Latino',
    not_hispanic_or_latino: 'Not Hispanic or Latino',
    unknown: 'Unknown',
};
const SES_LABELS = {
    education: 'Education', income: 'Income', wealth: 'Wealth',
    family_size: 'Family size', adi_area_deprivation_index: 'ADI',
};

function fmtGeography(geo) {
    if (!geo || typeof geo !== 'object') return '<span class="not-reported-badge">Not Reported</span>';
    const parts = [];
    const states = evValue(geo.us_states);
    if (!isNR(states)) {
        const flat = Array.isArray(states) ? states.join(', ') : states;
        parts.push(`<div><span class="kv-label">US states:</span> ${escapeHtml(String(flat))}${evidenceBlock(geo.us_states)}</div>`);
    }
    const countries = evValue(geo.countries);
    if (!isNR(countries)) {
        const flat = Array.isArray(countries) ? countries.join(', ') : countries;
        parts.push(`<div><span class="kv-label">Countries:</span> ${escapeHtml(String(flat))}${evidenceBlock(geo.countries)}</div>`);
    }
    const totalSites = evValue(geo.total_sites);
    if (!isNR(totalSites)) {
        parts.push(`<div><span class="kv-label">Total sites:</span> ${escapeHtml(String(totalSites))}${evidenceBlock(geo.total_sites)}</div>`);
    }
    if (parts.length === 0) return '<span class="not-reported-badge">Not Reported</span>';
    return `<div class="extraction-stacked-values">${parts.join('')}</div>`;
}

function fmtSESShort(ses) {
    if (!ses || typeof ses !== 'object') return '<span class="not-reported-badge">Not Reported</span>';
    const keys = ['income', 'education', 'wealth'];
    const reported = keys.filter(k => !isNR(ses[k]));
    if (reported.length === 0) return '<span class="not-reported-badge">Not Reported</span>';
    return `<div class="extraction-stacked-values">${reported.map(k =>
        `<div><span class="kv-label">${escapeHtml(SES_LABELS[k])}:</span> ${escapeHtml(String(evValue(ses[k])))}</div>`
    ).join('')}</div>`;
}

// ---------------------------------------------------------------------------
// (Beta) AI Demographic Extraction Tab — 3-Way Model Comparison
// ---------------------------------------------------------------------------
let fdaExtractionLoaded = false;
let _fdaExtractedData = [];
let _fdaLitData = [];           // AI/ML manuscript extractions (for side-by-side join)
let _fdaLitIndex = {};          // submission_number -> manuscript record
let _fdaDecisionDateIndex = {}; // submission_number -> Date of Final Decision (from enriched CSV)
let _fdaSelectedModel = 'sonnet_4_6'; // default view (overridden per-load when this key is absent)

// Extraction-table pagination (15 default / 25 / 50 rows per page).
let fdaExtPage = 0, fdaExtPageSize = 15;
let litExtPage = 0, litExtPageSize = 15;
function fdaExtGoPage(p) { fdaExtPage = p; renderFDAExtractionTable(_fdaExtractedData, _fdaSelectedModel); }
function litExtGoPage(p) { litExtPage = p; renderLitExtractionTable(_litExtractedData, _litSelectedModel); }
window.fdaExtGoPage = fdaExtGoPage;
window.litExtGoPage = litExtGoPage;


// Pick the model key the dashboard should default to for a given run.
// `sonnet_4_6` is the historical Anthropic default; for a Gemini-only
// run that key won't exist in the metrics payload and the selector
// would render empty — falling back to the first available key keeps
// the dashboard rendering *something* without crashing. Accepts an
// already-extracted models map (e.g. `metrics.per_model` or a doc's
// `models` dict).
function pickDefaultModelKey(modelsMap, preferred) {
    preferred = preferred || 'sonnet_4_6';
    if (!modelsMap || typeof modelsMap !== 'object') return preferred;
    if (modelsMap[preferred]) return preferred;
    const keys = Object.keys(modelsMap);
    return keys.length ? keys[0] : preferred;
}

// Model display order and labels. `id` is the JSON key emitted by the
// extraction scripts (opus_4_7 / sonnet_4_6 / haiku_4_5); `modelId` is the
// Anthropic API identifier for display only.
const MODEL_ORDER = [
    { id: 'haiku_4_5',  modelId: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5',  tier: 'Fast / Low Cost' },
    { id: 'sonnet_4_6', modelId: 'claude-sonnet-4-6',         label: 'Sonnet 4.6', tier: 'Balanced Baseline' },
    { id: 'opus_4_7',   modelId: 'claude-opus-4-7',           label: 'Opus 4.7',   tier: 'Highest Quality' },
];

/**
 * Render a model comparison card for the cost banner.
 * Works for both FDA and Literature tabs.
 */
function renderModelComparisonCards(containerId, perModel, totalDocs, pilotSize) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (!perModel || pilotSize === 0) {
        container.innerHTML = MODEL_ORDER.map(m => `
            <div class="model-card">
                <div class="model-card-header">
                    <span class="model-card-label">${m.label}</span>
                    <span class="model-card-tier">${m.tier}</span>
                </div>
                <div class="model-card-body">
                    <div class="model-metric"><span class="model-metric-value">—</span><span class="model-metric-label">Avg input tokens/doc</span></div>
                    <div class="model-metric"><span class="model-metric-value">—</span><span class="model-metric-label">Avg output tokens/doc</span></div>
                    <div class="model-metric model-metric-highlight"><span class="model-metric-value">Awaiting pilot</span><span class="model-metric-label">Projected scaling cost</span></div>
                </div>
            </div>
        `).join('');
        return;
    }

    container.innerHTML = MODEL_ORDER.map(m => {
        const pm = perModel[m.id];
        if (!pm) return '';
        const remaining = totalDocs - pilotSize;
        const scaledInput = pm.avg_input_per_doc * remaining;
        const scaledOutput = pm.avg_output_per_doc * remaining;
        const costInput = (scaledInput / 1_000_000) * pm.input_cost_per_m;
        const costOutput = (scaledOutput / 1_000_000) * pm.output_cost_per_m;
        const totalCost = costInput + costOutput;
        const totalTokens = Math.round(scaledInput + scaledOutput);

        return `<div class="model-card">
            <div class="model-card-header">
                <span class="model-card-label">${pm.label}</span>
                <span class="model-card-tier">${m.tier}</span>
            </div>
            <div class="model-card-body">
                <div class="model-metric">
                    <span class="model-metric-value">${Math.round(pm.avg_input_per_doc).toLocaleString()}</span>
                    <span class="model-metric-label">Avg input tokens/doc</span>
                </div>
                <div class="model-metric">
                    <span class="model-metric-value">${Math.round(pm.avg_output_per_doc).toLocaleString()}</span>
                    <span class="model-metric-label">Avg output tokens/doc</span>
                </div>
                <div class="model-metric model-metric-highlight">
                    <span class="model-metric-value">$${totalCost.toFixed(2)}</span>
                    <span class="model-metric-label">Projected cost (${remaining.toLocaleString()} docs)</span>
                </div>
                <div class="model-metric">
                    <span class="model-metric-value">${totalTokens.toLocaleString()}</span>
                    <span class="model-metric-label">Est. total tokens</span>
                </div>
                <div class="model-metric">
                    <span class="model-metric-value">$${pm.input_cost_per_m}/$${pm.output_cost_per_m}</span>
                    <span class="model-metric-label">Per 1M (in/out)</span>
                </div>
            </div>
        </div>`;
    }).join('');
}

/**
 * Render a pill-style toggle-button group for model selection. Each click
 * flips `aria-pressed` on every button, then invokes onChange(modelId) so
 * the caller can re-render its table off the new selection.
 */
function renderModelSelector(containerId, selectedModel, onChange) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const buttons = MODEL_ORDER.map(m => {
        const isActive = m.id === selectedModel;
        return `<button type="button"
            class="model-toggle-btn${isActive ? ' is-active' : ''}"
            data-model="${m.id}"
            aria-pressed="${isActive}">
            ${m.label}
        </button>`;
    }).join('');

    container.innerHTML = `<span class="model-selector-label">View model:</span> ${buttons}`;
    container.querySelectorAll('.model-toggle-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const modelId = btn.dataset.model;
            container.querySelectorAll('.model-toggle-btn').forEach(b => {
                const active = b.dataset.model === modelId;
                b.classList.toggle('is-active', active);
                b.setAttribute('aria-pressed', String(active));
            });
            onChange(modelId);
        });
    });
}

/**
 * Deep JSON-equality check across all models for a given dotted field path.
 * Returns null if we can't compare (< 2 models), true if every model returned
 * the same serialization, false otherwise.
 */
function checkFDAFieldAgreement(doc, fieldPath) {
    const models = doc.models || {};
    const modelIds = Object.keys(models);
    if (modelIds.length < 2) return null;
    const getByPath = (obj, path) => path.split('.').reduce((acc, k) => (acc == null ? acc : acc[k]), obj);
    const values = modelIds.map(mid => JSON.stringify(getByPath(models[mid]?.data || {}, fieldPath)));
    return values.every(v => v === values[0]);
}

/**
 * Check overall agreement across key schema fields for an FDA document. The
 * field list tracks the new extraction schema (race/sex/ethnicity/geography
 * as nested objects).
 */
function checkFDAOverallAgreement(doc) {
    const fields = [
        'total_participants',
        'sex', 'race_nih_omb', 'ethnicity', 'gender',
        'geography.total_sites', 'socioeconomic_status',
    ];
    return fields.every(f => checkFDAFieldAgreement(doc, f));
}

async function loadFDAExtractionTab() {
    if (fdaExtractionLoaded) return;
    try {
        // Fetch FDA metrics + extraction data alongside the AI/ML manuscript
        // extraction (for side-by-side rendering) and the enriched device CSV
        // (which carries the authoritative "Date of Final Decision"). The
        // manuscript file and CSV are best-effort: missing sidecars degrade
        // gracefully to "—" in the affected columns.
        const cacheBust = '?v=' + Date.now();
        const [metricsResp, dataResp, litResp, enrichedResp] = await Promise.all([
            fetch('data/fda_token_metrics.json' + cacheBust),
            fetch('data/fda_demographics_extracted.json' + cacheBust),
            fetch('data/lit_ses_extracted.json' + cacheBust).catch(() => null),
            fetch('data/ai-ml-enabled-devices-enriched.csv' + cacheBust).catch(() => null),
        ]);
        if (!metricsResp.ok || !dataResp.ok) throw new Error('Failed to load FDA extraction data');
        const metrics = await metricsResp.json();
        _fdaExtractedData = await dataResp.json();
        _fdaLitData = (litResp && litResp.ok) ? await litResp.json() : [];
        _fdaLitIndex = buildFDALitIndex(_fdaLitData);
        _fdaDecisionDateIndex = (enrichedResp && enrichedResp.ok)
            ? buildFDADecisionDateIndex(await enrichedResp.text())
            : {};

        const totalDocs = metrics.total_fda_tools || 0;
        // Prefer the explicit dynamic tally (emitted by the extraction script
        // even when a mid-run failure cuts the loop short); fall back to the
        // legacy `pilot_size` field for older metrics files.
        const successfulDocs = metrics.successful_docs_count
            ?? metrics.pilot_size
            ?? 0;
        const totalPages = metrics.total_pages_processed ?? 0;
        document.getElementById('fda-pilot-size').textContent = successfulDocs.toLocaleString();
        document.getElementById('fda-pages-processed').textContent = totalPages.toLocaleString();
        document.getElementById('fda-remaining').textContent = (totalDocs - successfulDocs).toLocaleString();
        const fdaSummary = document.getElementById('fda-pilot-summary');
        if (fdaSummary) {
            const crashNote = metrics.interrupted_by
                ? ` Run was interrupted (${metrics.interrupted_by}); partial results shown.`
                : '';
            fdaSummary.textContent = `Processed ${successfulDocs.toLocaleString()} documents totaling ${totalPages.toLocaleString()} pages.${crashNote}`;
        }

        // Re-pick the default selected model based on what the run
        // actually produced. A Gemini-only run won't have `sonnet_4_6`
        // in metrics.per_model; falling back to the first available
        // key (e.g. `gemini_25_pro`) keeps the selector + table from
        // rendering empty.
        _fdaSelectedModel = pickDefaultModelKey(metrics.per_model, _fdaSelectedModel);

        renderModelComparisonCards('fda-model-cards', metrics.per_model, totalDocs, successfulDocs);
        renderFDAReportingFreq(_fdaExtractedData);
        renderModelSelector('fda-model-selector', _fdaSelectedModel, (modelId) => {
            _fdaSelectedModel = modelId;
            renderFDAExtractionTable(_fdaExtractedData, modelId);
        });
        renderFDAExtractionTable(_fdaExtractedData, _fdaSelectedModel);
        fdaExtractionLoaded = true;
    } catch (e) {
        console.warn('Could not load FDA extraction data:', e.message);
        const tbody = document.getElementById('fda-extraction-tbody');
        if (tbody) tbody.innerHTML =
            '<tr><td colspan="15">Could not load extraction data. Run the extraction pipeline first.</td></tr>';
    }
}

/**
 * Resolve an outbound link for a manuscript record so titles/DOIs can be
 * rendered as proper attributions. Preference order:
 *   1. Extracted DOI (`extracted.doi` or `extracted.manuscript_doi`)
 *   2. `doc.doi_slug` (with `_` → `/` reconstructed back to a DOI)
 *   3. Any explicit URL the extraction schema carried (`source_url`,
 *      `manuscript_url`, `url`)
 *   4. `doc.local_pdf_path` — served from the same origin as the dashboard
 * Returns null when nothing usable is available so callers can render a
 * non-linked title.
 */
function manuscriptLinkUrl(doc, extracted) {
    extracted = extracted || {};
    const rawDoi = extracted.doi || extracted.manuscript_doi;
    if (rawDoi && typeof rawDoi === 'string' && rawDoi !== 'Not Reported') {
        const clean = rawDoi.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, '');
        if (clean) return `https://doi.org/${clean}`;
    }
    if (doc?.doi_slug) {
        return `https://doi.org/${String(doc.doi_slug).replace(/_/g, '/')}`;
    }
    const explicit = extracted.source_url || extracted.manuscript_url || extracted.url
        || doc?.source_url || doc?.manuscript_url;
    if (explicit && typeof explicit === 'string' && explicit !== 'Not Reported') {
        return explicit.trim();
    }
    if (doc?.local_pdf_path) {
        return String(doc.local_pdf_path).trim();
    }
    return null;
}

/**
 * Strip the `YYYY-MM-DD_` date prefix (and any `.pdf` suffix) off an FDA
 * submission string. The extraction pipeline carries the raw PDF stem as
 * the submission_number (e.g. `2026-04-16_DEN140025`), but the enriched
 * devices CSV keys rows on the clean FDA identifier (`DEN140025`). This
 * helper normalises both sides so the date-lookup join actually hits.
 */
function cleanSubmissionNumber(raw) {
    if (!raw) return '';
    return String(raw)
        .trim()
        .replace(/^\d{4}[-_]\d{2}[-_]\d{2}[-_]/, '')
        .replace(/\.pdf$/i, '')
        .trim()
        .toUpperCase();
}

/**
 * Build a submission# → "Date of Final Decision" map from the enriched
 * AI/ML devices CSV. That CSV is the authoritative source for decision
 * dates (the FDA extraction JSON doesn't carry them).
 */
function buildFDADecisionDateIndex(csvText) {
    const index = {};
    if (!csvText) return index;
    let rows;
    try { rows = parseCSV(csvText); } catch (_) { return index; }
    for (const row of rows) {
        const sub = row['Submission Number'] || row['submission_number'] || row['Submission #'];
        const date = row['Date of Final Decision'] || row['decision_date'];
        if (!sub || !date) continue;
        const key = cleanSubmissionNumber(sub);
        if (key && !index[key]) index[key] = String(date).trim();
    }
    return index;
}

/**
 * Build a submission# → manuscript record map so each FDA row can display
 * the matched manuscript's demographic extraction side by side. Submission
 * numbers are normalised to upper-case / whitespace-trimmed since they
 * come from two different CSVs.
 */
function buildFDALitIndex(litData) {
    const index = {};
    if (!Array.isArray(litData)) return index;
    for (const lit of litData) {
        if (lit.extraction_status !== 'success') continue;
        // Metadata lives at the top level of each manuscript record and
        // carries the fuzzy-matched FDA submission number.
        const meta = lit.metadata || {};
        const sub = meta.fda_submission_number;
        if (!sub || sub === 'Not Reported') continue;
        const key = cleanSubmissionNumber(sub);
        if (key && !index[key]) index[key] = lit;
    }
    return index;
}

function renderFDAReportingFreq(data) {
    const container = document.getElementById('fda-reporting-freq');
    if (!container) return;

    // Sonnet is the historical reference model for the reporting-
    // frequency strip; for a Gemini-only run that key won't exist on
    // any doc's models map, so fall back to whichever model key the
    // run actually populated. We probe the first doc that has a
    // non-empty models dict (skipping pdf_failed rows where models is
    // {}) so the helper sees the real per-row schema.
    const sampleModels = data.find(d => d.models && Object.keys(d.models).length)?.models;
    const refModel = pickDefaultModelKey(sampleModels, 'sonnet_4_6');
    const successDocs = data.filter(d => d.extraction_status === 'success' && d.models && d.models[refModel]);
    const total = successDocs.length;
    if (total === 0) {
        container.innerHTML = '<p style="color: var(--secondary-text); text-align: center; padding: 1rem;">No extraction data available yet.</p>';
        return;
    }

    // A breakdown object counts as "reported" when at least one subcategory
    // has a concrete value (i.e. not the "Not Reported" sentinel).
    const anyReported = (obj) => obj && typeof obj === 'object'
        && Object.values(obj).some(v => !isNR(v));

    const raceReported = successDocs.filter(d => anyReported(d.models[refModel]?.data?.race_nih_omb)).length;
    const ethReported = successDocs.filter(d => anyReported(d.models[refModel]?.data?.ethnicity)).length;
    const sexReported = successDocs.filter(d => anyReported(d.models[refModel]?.data?.sex)).length;
    const sesReported = successDocs.filter(d => anyReported(d.models[refModel]?.data?.socioeconomic_status)).length;

    const items = [
        { label: '% Reporting Race', count: raceReported, color: '#1b4332' },
        { label: '% Reporting Ethnicity', count: ethReported, color: '#40694f' },
        { label: '% Reporting Sex', count: sexReported, color: '#52b788' },
        { label: '% Reporting SES', count: sesReported, color: '#9dbfae' },
    ];

    container.innerHTML = items.map(item => {
        const pct = Math.round((item.count / total) * 100);
        return `<div class="reporting-freq-card">
            <div class="reporting-freq-ring" style="--pct: ${pct}; --ring-color: ${item.color}">
                <span class="reporting-freq-pct">${pct}%</span>
            </div>
            <span class="reporting-freq-label">${item.label}</span>
            <span class="reporting-freq-detail">${item.count} of ${total} devices</span>
        </div>`;
    }).join('');
}

function renderFDAExtractionTable(data, modelId) {
    const tbody = document.getElementById('fda-extraction-tbody');
    if (!tbody) return;
    modelId = modelId || _fdaSelectedModel;

    if (!data || data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="15" class="text-center" style="padding: 2rem; color: var(--secondary-text);">
            No extracted data yet. Trigger the extraction pipeline via
            <code>GitHub Actions &rarr; Run Extraction Pipelines</code>
            or run the FDA extraction in the civicsample-engine pipeline.
        </td></tr>`;
        return;
    }

    // Side-by-side cell: top row is the FDA summary value, bottom row is
    // the matched-manuscript value (or "—" if no manuscript was matched).
    // `renderer` stringifies each side's input with the same formatter so
    // the visual comparison is apples-to-apples.
    const sbsCell = (fdaVal, litVal, renderer, hasMatch) => {
        const litRendered = hasMatch
            ? renderer(litVal)
            : '<span class="sbs-nomatch">No matched manuscript</span>';
        return `<div class="side-by-side-cell">
            <div class="sbs-row sbs-fda"><span class="sbs-label">FDA</span>${renderer(fdaVal)}</div>
            <div class="sbs-row sbs-manuscript"><span class="sbs-label">Manuscript</span>${litRendered}</div>
        </div>`;
    };

    // Paginate (15/25/50 per page); idx stays the index into the full array
    // because the detail modals reference documents by it.
    fdaExtPage = Math.max(0, Math.min(fdaExtPage, Math.ceil(data.length / fdaExtPageSize) - 1));
    const fdaExtStart = fdaExtPage * fdaExtPageSize;
    renderSimplePager('fda-ext-pagination', data.length, fdaExtPage, fdaExtPageSize, 'fdaExtGoPage');
    wireRowsControl('fda-ext-rows', n => {
        fdaExtPageSize = n;
        fdaExtPage = 0;
        renderFDAExtractionTable(_fdaExtractedData, _fdaSelectedModel);
    });

    tbody.innerHTML = data.slice(fdaExtStart, fdaExtStart + fdaExtPageSize).map((doc, _pi) => {
        const idx = fdaExtStart + _pi;
        // `subKey` is the normalised FDA identifier (date prefix + .pdf
        // stripped) — used for both display and index lookups against the
        // enriched-devices CSV and the AI/ML manuscript index.
        const subKey = cleanSubmissionNumber(doc.submission_number);
        const subRaw = subKey || (doc.submission_number || '');
        // Link straight to the FDA De Novo database listing for this
        // submission so curators can cross-reference the original record.
        const subCell = subKey
            ? `<a href="https://www.accessdata.fda.gov/scripts/cdrh/cfdocs/cfpmn/denovo.cfm?id=${encodeURIComponent(subKey)}" target="_blank" rel="noopener noreferrer" class="fda-link">${escapeHtml(subKey)}</a>`
            : escapeHtml(subRaw);
        const decisionDate = _fdaDecisionDateIndex[subKey];
        const dateCell = decisionDate
            ? escapeHtml(decisionDate)
            : '<span class="not-reported-badge">—</span>';

        if (doc.extraction_status !== 'success') {
            return `<tr>
                <td>${subCell}</td>
                <td>${dateCell}</td>
                <td>${escapeHtml(doc.device_name || '')}</td>
                <td><button class="row-details-btn" type="button" onclick="showFDAExtractionDetails(${idx})">View</button></td>
                <td>${escapeHtml(doc.panel || '')}</td>
                <td colspan="11" class="text-center" style="color: var(--secondary-text);">${escapeHtml(doc.extraction_status || 'failed')}</td>
            </tr>`;
        }

        const d = doc.models?.[modelId]?.data || {};
        const household = d.socioeconomic_status?.family_size;

        // Lookup the matched manuscript by submission number. The lit
        // extraction wraps its payload as { metadata, extracted_data }.
        const litDoc = _fdaLitIndex[subKey] || null;
        const litWrapped = litDoc?.models?.[modelId]?.data || {};
        const litExtracted = litWrapped.extracted_data || {};
        const litMeta = litDoc?.metadata || litWrapped.metadata || {};
        const litHousehold = litExtracted.socioeconomic_status?.family_size;

        const hasMatch = !!litDoc;
        const matchedUrl = hasMatch ? manuscriptLinkUrl(litDoc, litExtracted) : null;
        const matchedLabel = litDoc?.doi_slug
            ? String(litDoc.doi_slug).replace(/_/g, '/')
            : (litDoc?.identifier || 'Manuscript');
        const manuscriptCell = hasMatch
            ? `<div class="study-details-cell">
                ${matchedUrl
                    ? `<a href="${escapeHtml(matchedUrl)}" target="_blank" rel="noopener noreferrer" class="fda-link"><strong>${escapeHtml(matchedLabel)}</strong></a>`
                    : `<strong>${escapeHtml(matchedLabel)}</strong>`}
                ${litMeta.publication_year ? `<span class="study-details-meta">${escapeHtml(litMeta.publication_year)}</span>` : ''}
                ${litMeta.cc_license && litMeta.cc_license !== 'Not Reported' ? `<span class="study-details-meta">${escapeHtml(litMeta.cc_license)}</span>` : ''}
              </div>`
            : '<span class="not-reported-badge">No match</span>';

        return `<tr>
            <td>${subCell}</td>
            <td>${dateCell}</td>
            <td>${escapeHtml(doc.device_name || '')}</td>
            <td><button class="row-details-btn" type="button" onclick="showFDAExtractionDetails(${idx})">View</button></td>
            <td>${escapeHtml(doc.panel || '')}</td>
            <td>${manuscriptCell}</td>
            <td>${sbsCell(d.total_participants, litExtracted.total_participants, fmtVal, hasMatch)}</td>
            <td>${sbsCell(d.age, litExtracted.age, fmtVal, hasMatch)}</td>
            <td>${sbsCell(d.sex, litExtracted.sex, v => fmtBreakdown(v, SEX_LABELS), hasMatch)}</td>
            <td>${sbsCell(d.gender, litExtracted.gender, v => fmtBreakdown(v, GENDER_LABELS), hasMatch)}</td>
            <td>${sbsCell(d.race_nih_omb, litExtracted.race_nih_omb, v => fmtBreakdown(v, RACE_OMB_LABELS), hasMatch)}</td>
            <td>${sbsCell(d.ethnicity, litExtracted.ethnicity, v => fmtBreakdown(v, ETHNICITY_LABELS), hasMatch)}</td>
            <td>${sbsCell(d.geography, litExtracted.geography, fmtGeography, hasMatch)}</td>
            <td>${sbsCell(d.socioeconomic_status, litExtracted.socioeconomic_status, fmtSESShort, hasMatch)}</td>
            <td>${sbsCell(d.disability_and_functional_limitations, litExtracted.disability_and_functional_limitations, fmtVal, hasMatch)}</td>
            <td>${sbsCell(household, litHousehold, fmtVal, hasMatch)}</td>
        </tr>`;
    }).join('');
}

/**
 * Detail modal for a single FDA device row. Mirrors the Studies tab modal
 * so the visual language stays consistent across the dashboard.
 */
function showFDAExtractionDetails(idx) {
    const doc = _fdaExtractedData[idx];
    if (!doc) return;
    const overlay = document.getElementById('extraction-details-overlay');
    if (!overlay) return;

    const d = doc.models?.[_fdaSelectedModel]?.data || {};
    const cited = d.cited_clinical_studies || {};

    // Attribution links. `subKey` feeds both the decision-date lookup and the
    // matched-manuscript lookup so the modal's "Source" section can link
    // straight to the FDA summary and to the manuscript that was joined on
    // the same Submission #.
    const subKey = cleanSubmissionNumber(doc.submission_number);
    const litDoc = _fdaLitIndex[subKey] || null;
    const litExtractedForLinks = litDoc?.models?.[_fdaSelectedModel]?.data?.extracted_data || {};
    const matchedManuscriptUrl = litDoc ? manuscriptLinkUrl(litDoc, litExtractedForLinks) : null;
    const matchedManuscriptLabel = litDoc?.doi_slug
        ? String(litDoc.doi_slug).replace(/_/g, '/')
        : (litDoc?.identifier || 'Matched manuscript');

    const citedBlock = (() => {
        const ncts = !isNR(cited.nct_ids) && Array.isArray(cited.nct_ids) ? cited.nct_ids : [];
        const dois = !isNR(cited.dois) && Array.isArray(cited.dois) ? cited.dois : [];
        const pubs = !isNR(cited.publication_titles) && Array.isArray(cited.publication_titles) ? cited.publication_titles : [];
        if (ncts.length + dois.length + pubs.length === 0) {
            return `<p class="note">None cited in the FDA summary.</p>`;
        }
        const nctHtml = ncts.map(n => `<li><a href="https://clinicaltrials.gov/study/${escapeHtml(n)}" target="_blank" rel="noopener noreferrer" class="fda-link">${escapeHtml(n)}</a></li>`).join('');
        const doiHtml = dois.map(x => `<li><a href="https://doi.org/${escapeHtml(x)}" target="_blank" rel="noopener noreferrer" class="fda-link">${escapeHtml(x)}</a></li>`).join('');
        const pubHtml = pubs.map(x => `<li>${escapeHtml(x)}</li>`).join('');
        return `<ul class="publications-list">${nctHtml}${doiHtml}${pubHtml}</ul>`;
    })();

    const sesBlock = (() => {
        const ses = d.socioeconomic_status;
        if (!ses || typeof ses !== 'object') return '<p class="note">Not reported.</p>';
        const rows = Object.entries(SES_LABELS).map(([k, label]) =>
            `<li><span class="kv-label">${escapeHtml(label)}</span><span class="kv-value">${fmtVal(ses[k])}${evidenceBlock(ses[k])}</span></li>`
        ).join('');
        return `<ul class="extraction-kv-list">${rows}</ul>`;
    })();

    const html = `
        <div class="study-details-modal">
            <div class="modal-header">
                <h3>${escapeHtml(doc.device_name || 'FDA Device')}</h3>
                <button class="close-btn" onclick="closeExtractionDetails()">&times;</button>
            </div>
            <div class="modal-body">
                <div class="extraction-meta-grid">
                    <div><strong>Submission #</strong>${subKey
                        ? `<a href="https://www.accessdata.fda.gov/scripts/cdrh/cfdocs/cfpmn/denovo.cfm?id=${encodeURIComponent(subKey)}" target="_blank" rel="noopener noreferrer" class="fda-link">${escapeHtml(subKey)}</a>`
                        : escapeHtml(doc.submission_number || '—')}</div>
                    <div><strong>Panel</strong>${escapeHtml(doc.panel || '—')}</div>
                    <div><strong>Total Participants</strong>${fmtVal(d.total_participants)}${evidenceBlock(d.total_participants)}</div>
                    <div><strong>Model</strong>${escapeHtml(doc.models?.[_fdaSelectedModel]?.label || _fdaSelectedModel)}</div>
                </div>

                <div class="detail-section">
                    <h5>Clinical Context</h5>
                    <ul class="extraction-kv-list">
                        <li><span class="kv-label">Company / Sponsor</span><span class="kv-value">${fmtVal(d.company_sponsor_name)}${evidenceBlock(d.company_sponsor_name)}</span></li>
                        <li><span class="kv-label">Device / Tool Title</span><span class="kv-value">${fmtVal(d.device_tool_title)}${evidenceBlock(d.device_tool_title)}</span></li>
                        <li><span class="kv-label">Target Patient Age Range</span><span class="kv-value">${fmtVal(d.target_patient_age_range)}${evidenceBlock(d.target_patient_age_range)}</span></li>
                        <li><span class="kv-label">Clinical Study Design</span><span class="kv-value">${fmtVal(d.clinical_study_design)}${evidenceBlock(d.clinical_study_design)}</span></li>
                    </ul>
                </div>

                <div class="detail-section">
                    <h5>Race (NIH / OMB)</h5>
                    ${fmtBreakdown(d.race_nih_omb, RACE_OMB_LABELS)}
                </div>
                <div class="detail-section">
                    <h5>Ethnicity</h5>
                    ${fmtBreakdown(d.ethnicity, ETHNICITY_LABELS)}
                </div>
                <div class="detail-section">
                    <h5>Sex</h5>
                    ${fmtBreakdown(d.sex, SEX_LABELS)}
                </div>
                <div class="detail-section">
                    <h5>Gender</h5>
                    ${fmtBreakdown(d.gender, GENDER_LABELS)}
                </div>
                <div class="detail-section">
                    <h5>Geography</h5>
                    ${fmtGeography(d.geography)}
                </div>
                <div class="detail-section">
                    <h5>Socioeconomic Status</h5>
                    ${sesBlock}
                </div>
                <div class="detail-section">
                    <h5>Cited Clinical Studies</h5>
                    ${citedBlock}
                </div>
                <div class="detail-section">
                    <h5>Source Attribution</h5>
                    <ul class="extraction-kv-list">
                        <li>
                            <span class="kv-label">FDA Summary</span>
                            <span class="kv-value">${doc.source_url
                                ? `<a href="${escapeHtml(doc.source_url)}" target="_blank" rel="noopener noreferrer" class="fda-link">View FDA Summary</a>`
                                : '<span class="note">No FDA summary URL recorded.</span>'}</span>
                        </li>
                        <li>
                            <span class="kv-label">Matched Manuscript</span>
                            <span class="kv-value">${matchedManuscriptUrl
                                ? `<a href="${escapeHtml(matchedManuscriptUrl)}" target="_blank" rel="noopener noreferrer" class="fda-link">View Manuscript</a>
                                   <span class="study-details-meta">${escapeHtml(matchedManuscriptLabel)}</span>`
                                : '<span class="note">No matched manuscript.</span>'}</span>
                        </li>
                    </ul>
                </div>
            </div>
        </div>`;

    overlay.innerHTML = html;
    overlay.style.display = 'flex';
}
window.showFDAExtractionDetails = showFDAExtractionDetails;

// ---------------------------------------------------------------------------
// (Beta) Paper Data Extraction Tab — Discrepancy Engine
// ---------------------------------------------------------------------------
let litExtractionLoaded = false;
let _litExtractedData = [];
let _litSelectedModel = 'sonnet_4_6';

// Curator resolutions keyed by `${doi_slug}::${field_path}`. Persisted to
// sessionStorage so resolutions survive tab switches within the session but
// never leave the user's browser (intentional — curation output lives in
// source-controlled CSVs, not sessionStorage).
let _litCurationState = (() => {
    try { return JSON.parse(sessionStorage.getItem(LIT_CURATION_STATE_KEY) || '{}'); }
    catch (_) { return {}; }
})();

function persistCurationState() {
    try { sessionStorage.setItem(LIT_CURATION_STATE_KEY, JSON.stringify(_litCurationState)); }
    catch (_) { /* storage disabled — keep in-memory copy */ }
}

// --- ClinicalTrials.gov comparison helpers ------------------------------

// Maps between the two competing taxonomies. The FDA/paper extraction schema
// uses the NIH/OMB long-form names; the CT.gov baseline (demographics.part*
// parsed records) uses short underscore keys. Both refer to the same OMB
// categories — we normalise on the NIH/OMB side because that's what the
// curators will review. The right-hand values MUST line up with the keys
// emitted by the parse pipeline (demographics.json), or the discrepancy
// engine will mis-classify every field as an Addition.
const CTGOV_RACE_MAP = {
    american_indian_or_alaska_native: 'american_indian_alaska_native',
    asian: 'asian',
    black_or_african_american: 'black_african_american',
    native_hawaiian_or_other_pacific_islander: 'native_hawaiian_pacific_islander',
    white: 'white',
    more_than_one_race: 'more_than_one_race',
    unknown: 'unknown_not_reported',
};
const CTGOV_ETHNICITY_MAP = {
    hispanic_or_latino: 'hispanic_latino',
    not_hispanic_or_latino: 'not_hispanic_latino',
    unknown: 'unknown_not_reported',
};
// Sex is a raw `totals` object on the CT.gov baseline (the parse pipeline
// doesn't emit `omb_totals` for sex), with the categorical keys already
// matching the extraction schema 1:1.
const CTGOV_SEX_MAP = {
    female: 'female',
    male: 'male',
    unknown: 'unknown',
};

/**
 * Look up a study record in the main app's CT.gov baseline (populated from
 * demographics.part*.json.gz). This is the source of truth the discrepancy
 * engine compares the LLM extraction against.
 */
function findCTGovStudy(nctId) {
    if (!nctId || !Array.isArray(data)) return null;
    return data.find(s => s.nct_id === nctId) || null;
}

function valuesEqual(a, b) {
    if (a == null && b == null) return true;
    if (typeof a === 'number' && typeof b === 'number') return a === b;
    if (Array.isArray(a) && Array.isArray(b)) {
        const sa = a.map(x => String(x).toLowerCase().trim()).sort();
        const sb = b.map(x => String(x).toLowerCase().trim()).sort();
        return sa.length === sb.length && sa.every((v, i) => v === sb[i]);
    }
    return String(a).toLowerCase().trim() === String(b).toLowerCase().trim();
}

/**
 * Classify a single field's API ↔ PDF comparison.
 *   Match       – both sides reported AND strictly equal (numeric identity
 *                 for integers; no type-coerced equality).
 *   Addition    – API missing / not reported, PDF provides a value
 *   Missing_pdf – API reported, PDF silent (PDF extraction gap — distinct
 *                 from a Match; a reviewer should confirm whether the PDF
 *                 truly omits the value or whether the extractor missed it).
 *   Conflict    – both reported and different (including Unknown ↔ 0, Unknown ↔ any value)
 *   NA          – neither side has data
 *
 * "Unknown" (as reported by researchers) is a distinct reported value — it is
 * NOT treated as missing and it is NOT equal to 0 or to any integer count.
 */
function classifyDiscrepancy(apiVal, pdfVal) {
    const apiRaw = evValue(apiVal);
    const pdfRaw = evValue(pdfVal);
    const apiMissing = isNR(apiRaw) || (Array.isArray(apiRaw) && apiRaw.length === 0);
    const pdfMissing = isNR(pdfRaw) || (Array.isArray(pdfRaw) && pdfRaw.length === 0);
    if (apiMissing && pdfMissing) return 'na';
    if (apiMissing && !pdfMissing) return 'addition';
    if (!apiMissing && pdfMissing) return 'missing_pdf';
    // Both sides reported something. Unknown is a distinct reported state.
    const apiUnknown = isExplicitUnknown(apiRaw);
    const pdfUnknown = isExplicitUnknown(pdfRaw);
    if (apiUnknown !== pdfUnknown) return 'conflict';
    if (apiUnknown && pdfUnknown) return 'match';
    // Numeric fields: require strict integer identity. Coerce via Number so
    // the "12" string from a quote-wrapped payload matches the 12 integer
    // pulled out of CT.gov, but never treat NaN / partially numeric values
    // as equal.
    const apiNum = Number(apiRaw);
    const pdfNum = Number(pdfRaw);
    const apiIsNumeric = typeof apiRaw === 'number' || (typeof apiRaw === 'string' && apiRaw.trim() !== '' && Number.isFinite(apiNum));
    const pdfIsNumeric = typeof pdfRaw === 'number' || (typeof pdfRaw === 'string' && pdfRaw.trim() !== '' && Number.isFinite(pdfNum));
    if (apiIsNumeric && pdfIsNumeric) {
        return apiNum === pdfNum ? 'match' : 'conflict';
    }
    if (apiIsNumeric !== pdfIsNumeric) return 'conflict';
    return valuesEqual(apiRaw, pdfRaw) ? 'match' : 'conflict';
}

function discBadge(status) {
    const map = {
        match:       '<span class="disc-badge disc-match">Match</span>',
        addition:    '<span class="disc-badge disc-addition">Addition</span>',
        conflict:    '<span class="disc-badge disc-conflict">Conflict</span>',
        missing_pdf: '<span class="disc-badge disc-missing-pdf">Missing in PDF</span>',
        na:          '<span class="disc-badge disc-na">—</span>',
    };
    return map[status] || map.na;
}

function resolutionBadge(resolution) {
    if (!resolution) return '';
    if (resolution.status === 'confirmed') {
        return `<span class="disc-resolution disc-resolution-confirmed">Confirmed by ${escapeHtml(resolution.curator)}</span>`;
    }
    return `<span class="disc-resolution disc-resolution-denied">Denied by ${escapeHtml(resolution.curator)}</span>`;
}

/**
 * Pull every comparable field from a manuscript record and the linked CT.gov
 * study into a flat list. Used by both the table cells (summarising worst
 * status per group) and the detail modal (showing every cell).
 */
function buildDiscrepancyRows(extractedData, ctgov) {
    const rows = [];
    // `pdfRaw` preserves the full evidence-wrapped payload (if any) so the
    // detail modal can render the exact_quote / page_number cite next to
    // each row. Classification runs against the unwrapped value.
    const addRow = (group, label, path, apiVal, pdfVal) => {
        const pdfRaw = pdfVal;
        const pdfValue = evValue(pdfVal);
        rows.push({
            group, label, path, apiVal,
            pdfVal: pdfValue,
            pdfRaw,
            status: classifyDiscrepancy(apiVal, pdfValue),
        });
    };

    // Totals
    addRow('totals', 'Total Participants', 'total_participants',
        ctgov?.enrollment, extractedData.total_participants);

    // Sex breakdown — baseline uses `sex.totals`, not `omb_totals`.
    const ctSex = ctgov?.sex?.totals || {};
    const pdfSex = extractedData.sex || {};
    Object.entries(CTGOV_SEX_MAP).forEach(([pdfKey, apiKey]) => {
        addRow('sex', `Sex — ${SEX_LABELS[pdfKey]}`, `sex.${pdfKey}`,
            ctSex[apiKey], pdfSex[pdfKey]);
    });

    // Gender breakdown — CT.gov doesn't carry a gender-identity field, so
    // every reported value will surface as an Addition.
    const pdfGender = extractedData.gender || {};
    ['woman', 'man', 'non_binary', 'transgender', 'other', 'unknown'].forEach(k => {
        addRow('gender', `Gender — ${GENDER_LABELS[k]}`, `gender.${k}`, null, pdfGender[k]);
    });

    // Race breakdown (NIH/OMB)
    const ctRace = ctgov?.race?.omb_totals || {};
    const pdfRace = extractedData.race_nih_omb || {};
    Object.entries(CTGOV_RACE_MAP).forEach(([pdfKey, apiKey]) => {
        addRow('race', `Race — ${RACE_OMB_LABELS[pdfKey]}`, `race_nih_omb.${pdfKey}`,
            ctRace[apiKey], pdfRace[pdfKey]);
    });

    // Ethnicity
    const ctEth = ctgov?.ethnicity?.omb_totals || {};
    const pdfEth = extractedData.ethnicity || {};
    Object.entries(CTGOV_ETHNICITY_MAP).forEach(([pdfKey, apiKey]) => {
        addRow('ethnicity', `Ethnicity — ${ETHNICITY_LABELS[pdfKey]}`, `ethnicity.${pdfKey}`,
            ctEth[apiKey], pdfEth[pdfKey]);
    });

    // Geography — countries list and total site count
    const ctCountries = Array.isArray(ctgov?.countries)
        ? ctgov.countries.map(c => typeof c === 'object' ? c.country : c).filter(Boolean)
        : null;
    addRow('geography', 'Countries', 'geography.countries',
        ctCountries, extractedData.geography?.countries);

    const ctSiteCount = Array.isArray(ctgov?.study_sites) ? ctgov.study_sites.length : null;
    addRow('geography', 'Total Sites', 'geography.total_sites',
        ctSiteCount, extractedData.geography?.total_sites);

    // Fields the API doesn't carry — PDF-only. These manifest as Addition when
    // the PDF reports anything and NA otherwise. Household (family_size) is
    // split out so it has its own column in the discrepancy table.
    const ses = extractedData.socioeconomic_status || {};
    Object.entries(SES_LABELS).forEach(([k, label]) => {
        const group = k === 'family_size' ? 'household' : 'ses';
        addRow(group, `${group === 'household' ? 'Household' : 'SES'} — ${label}`,
            `socioeconomic_status.${k}`, null, ses[k]);
    });
    addRow('age', 'Age', 'age', null, extractedData.age);
    addRow('disability', 'Disability / Functional Limitations',
        'disability_and_functional_limitations', null,
        extractedData.disability_and_functional_limitations);
    addRow('religion', 'Religion', 'religion', null, extractedData.religion);

    return rows;
}

/**
 * Pick the most severe status for a group so the table cell can show a single
 * summary badge (Conflict > Addition > Missing_pdf > Match > NA).
 */
function worstStatus(rows) {
    const rank = { conflict: 4, addition: 3, missing_pdf: 2, match: 1, na: 0 };
    return rows.reduce((worst, r) => (rank[r.status] || 0) > (rank[worst] || 0) ? r.status : worst, 'na');
}

function formatValueForDisc(v) {
    if (isNR(v)) return '<em>Not Reported</em>';
    if (Array.isArray(v)) return escapeHtml(v.join(', '));
    if (typeof v === 'number') return v.toLocaleString();
    return escapeHtml(String(v));
}

function resolutionKey(slug, path) {
    return `${slug}::${path}`;
}

async function confirmDiscrepancy(slug, path) {
    const curator = await promptForCuratorAccess();
    if (!curator) return;
    _litCurationState[resolutionKey(slug, path)] = {
        status: 'confirmed', curator, timestamp: new Date().toISOString(),
    };
    persistCurationState();
    renderLitExtractionTable(_litExtractedData, _litSelectedModel);
    // If detail modal is open, re-render it too
    const openIdx = document.getElementById('extraction-details-overlay')?.dataset?.litIdx;
    if (openIdx != null) showLitExtractionDetails(Number(openIdx));
}
window.confirmDiscrepancy = confirmDiscrepancy;

async function denyDiscrepancy(slug, path) {
    const curator = await promptForCuratorAccess();
    if (!curator) return;
    _litCurationState[resolutionKey(slug, path)] = {
        status: 'denied', curator, timestamp: new Date().toISOString(),
    };
    persistCurationState();
    renderLitExtractionTable(_litExtractedData, _litSelectedModel);
    const openIdx = document.getElementById('extraction-details-overlay')?.dataset?.litIdx;
    if (openIdx != null) showLitExtractionDetails(Number(openIdx));
}
window.denyDiscrepancy = denyDiscrepancy;

async function loadLitExtractionTab() {
    if (litExtractionLoaded) return;
    try {
        const cacheBust = `?v=${Date.now()}`;
        // The "(Beta) Paper Data Extraction" tab is strictly for Clinical
        // Trials manuscripts. Data comes from `trials_lit_extracted.json`
        // (produced by the civicsample-engine extraction pipeline).
        const [metricsResp, dataResp] = await Promise.all([
            fetch('data/trials_lit_token_metrics.json' + cacheBust),
            fetch('data/trials_lit_extracted.json' + cacheBust)
        ]);
        if (!metricsResp.ok || !dataResp.ok) throw new Error('Failed to load clinical trials manuscript extraction data');
        const metrics = await metricsResp.json();
        _litExtractedData = await dataResp.json();

        const totalDocs = metrics.total_studies || 0;
        // Prefer the explicit dynamic tally (emitted by the extraction script
        // even when a mid-run failure cuts the loop short); fall back to the
        // legacy `pilot_size` field for older metrics files.
        const successfulDocs = metrics.successful_docs_count
            ?? metrics.pilot_size
            ?? 0;
        const totalPages = metrics.total_pages_processed ?? 0;
        document.getElementById('lit-pilot-size').textContent = successfulDocs.toLocaleString();
        document.getElementById('lit-pages-processed').textContent = totalPages.toLocaleString();
        document.getElementById('lit-remaining').textContent = (totalDocs - successfulDocs).toLocaleString();
        const litSummary = document.getElementById('lit-pilot-summary');
        if (litSummary) {
            const crashNote = metrics.interrupted_by
                ? ` Run was interrupted (${metrics.interrupted_by}); partial results shown.`
                : '';
            litSummary.textContent = `Processed ${successfulDocs.toLocaleString()} documents totaling ${totalPages.toLocaleString()} pages.${crashNote}`;
        }

        // Re-pick the default selected model based on what the run
        // actually produced — same Gemini-only safety net as the FDA
        // tab; without this, a Gemini run renders an empty selector +
        // table because the historical `sonnet_4_6` key isn't there.
        _litSelectedModel = pickDefaultModelKey(metrics.per_model, _litSelectedModel);

        renderModelComparisonCards('lit-model-cards', metrics.per_model, totalDocs, successfulDocs);
        renderModelSelector('lit-model-selector', _litSelectedModel, (modelId) => {
            _litSelectedModel = modelId;
            renderLitExtractionTable(_litExtractedData, modelId);
        });
        renderLitExtractionTable(_litExtractedData, _litSelectedModel);
        litExtractionLoaded = true;
    } catch (e) {
        console.warn('Could not load clinical trials manuscript extraction data:', e.message);
        const tbody = document.getElementById('lit-extraction-tbody');
        if (tbody) tbody.innerHTML =
            '<tr><td colspan="14">Could not load extraction data. Run the trials extraction in the civicsample-engine pipeline first.</td></tr>';
    }
}

function renderLitExtractionTable(extractedList, modelId) {
    const tbody = document.getElementById('lit-extraction-tbody');
    if (!tbody) return;
    modelId = modelId || _litSelectedModel;

    if (!extractedList || extractedList.length === 0) {
        tbody.innerHTML = `<tr><td colspan="15" class="text-center" style="padding: 2rem; color: var(--secondary-text);">
            No extracted data yet. Run the trials extraction in the civicsample-engine pipeline.
        </td></tr>`;
        return;
    }

    // Paginate (15/25/50 per page); idx stays the index into the full list —
    // curation state and detail modals reference records by it.
    litExtPage = Math.max(0, Math.min(litExtPage, Math.ceil(extractedList.length / litExtPageSize) - 1));
    const litExtStart = litExtPage * litExtPageSize;
    renderSimplePager('lit-ext-pagination', extractedList.length, litExtPage, litExtPageSize, 'litExtGoPage');
    wireRowsControl('lit-ext-rows', n => {
        litExtPageSize = n;
        litExtPage = 0;
        renderLitExtractionTable(_litExtractedData, _litSelectedModel);
    });

    tbody.innerHTML = extractedList.slice(litExtStart, litExtStart + litExtPageSize).map((doc, _pi) => {
        const idx = litExtStart + _pi;
        const wrapped = doc.models?.[modelId]?.data || {};
        const extracted = wrapped.extracted_data || {};
        const meta = doc.metadata || wrapped.metadata || {};

        // Prefer the NCT parsed from the filename (authoritative for the
        // trial-manuscripts pipeline); fall back to anything the LLM pulled
        // out of the manuscript text.
        const ncts = !isNR(extracted.associated_nct_ids) && Array.isArray(extracted.associated_nct_ids)
            ? extracted.associated_nct_ids : [];
        const filenameNct = (doc.nct_id && doc.nct_id !== 'Not Reported') ? doc.nct_id : null;
        const primaryNct = filenameNct || ncts[0] || null;
        const ctgov = findCTGovStudy(primaryNct);
        // Date Results Reported is pulled from the main app's loaded CT.gov
        // baseline (demographics.part*.json.gz) so the Paper Data Extraction
        // view stays aligned with whatever date the dashboard is showing.
        const resultsDate = ctgov?.results_date || null;
        const nctCell = primaryNct
            ? `<a href="https://clinicaltrials.gov/study/${escapeHtml(primaryNct)}" target="_blank" rel="noopener noreferrer" class="fda-link">${escapeHtml(primaryNct)}</a>`
            : '<span class="not-reported-badge">Not Reported</span>';
        const dateCell = resultsDate
            ? escapeHtml(resultsDate)
            : '<span class="not-reported-badge">—</span>';

        if (doc.extraction_status !== 'success') {
            const statusLabel = doc.extraction_status === 'closed_access' ? 'Closed Access' : 'Failed';
            const filename = (doc.local_pdf_path || '').split('/').pop() || doc.identifier || 'Manuscript';
            return `<tr>
                <td>${nctCell}</td>
                <td>${dateCell}</td>
                <td>—</td>
                <td><button class="row-details-btn" type="button" onclick="showLitExtractionDetails(${idx})">View</button></td>
                <td class="study-details-cell"><strong>${escapeHtml(filename)}</strong></td>
                <td colspan="10" class="text-center" style="color: var(--secondary-text);">${statusLabel}</td>
            </tr>`;
        }

        const rows = buildDiscrepancyRows(extracted, ctgov);
        const slugKey = filenameNct || doc.identifier || (doc.local_pdf_path || '');
        rows.forEach(r => { r.resolution = _litCurationState[resolutionKey(slugKey, r.path)] || null; });

        // Per-group cell: discrepancy badge + reporting-status hint so
        // reviewers can tell Not Reported apart from Explicit Unknown at a
        // glance. `status` is API↔PDF classification; `reporting` is whether
        // the PDF actually said anything.
        const groupCell = (group, pdfValue) => {
            const groupRows = rows.filter(r => r.group === group);
            const status = worstStatus(groupRows);
            const reporting = typeof pdfValue === 'object' && pdfValue !== null
                ? breakdownStatus(pdfValue)
                : scalarStatus(pdfValue);
            const badge = reporting !== 'reported' ? statusBadge(reporting) : '';
            if (status === 'na') {
                return badge || '<span class="disc-badge disc-na">—</span>';
            }
            const nAction = groupRows.filter(r => (r.status === 'addition' || r.status === 'conflict') && !r.resolution).length;
            const actionNote = nAction > 0
                ? `<div style="font-size:0.75rem;color:#6b7280;margin-top:2px;">${nAction} unresolved</div>`
                : '';
            const reportingLine = badge ? `<div style="margin-top:4px;">${badge}</div>` : '';
            return `${discBadge(status)}${reportingLine}${actionNote}`;
        };

        const tierBadge = (doc.tier && doc.tier !== 'Not Reported')
            ? `<span class="tier-badge" title="Manuscript quality tier">${escapeHtml(doc.tier)}</span>`
            : '';

        // Manuscript-title cell. The extraction schema may include a DOI or
        // direct URL; prefer those for attribution. Fall back to the source
        // PDF path (served statically from the same origin) so the title is
        // still clickable even without a DOI.
        const pdfFilename = (doc.local_pdf_path || '').split('/').pop() || '';
        const displayTitle = pdfFilename.replace(/\.pdf$/i, '').replace(/^[0-9-]+_?/, '')
            || (doc.identifier || 'Manuscript');
        const manuscriptUrl = manuscriptLinkUrl(doc, extracted);
        const titleInner = manuscriptUrl
            ? `<a href="${escapeHtml(manuscriptUrl)}" target="_blank" rel="noopener noreferrer" class="fda-link"><strong>${escapeHtml(displayTitle)}</strong></a>`
            : `<strong>${escapeHtml(displayTitle)}</strong>`;
        const manuscriptCell = `<div class="study-details-cell">
            ${titleInner}
            ${pdfFilename ? `<span class="study-details-meta">${escapeHtml(pdfFilename)}</span>` : ''}
            ${tierBadge}
        </div>`;

        // Trial Name — prefer the CT.gov `brief_title` (the canonical public
        // trial title); fall back to `official_title` and finally the
        // condition/intervention from the metadata CSV.
        const trialTitle = ctgov?.brief_title || ctgov?.official_title || '';
        const conditionTxt = meta.condition && meta.condition !== 'Not Reported' ? meta.condition : '';
        const interventionTxt = meta.intervention && meta.intervention !== 'Not Reported' ? meta.intervention : '';
        const trialNameCell = trialTitle
            ? `<div class="study-details-cell">
                <strong>${escapeHtml(trialTitle)}</strong>
                ${conditionTxt ? `<span class="study-details-meta">${escapeHtml(conditionTxt)}</span>` : ''}
              </div>`
            : (conditionTxt || interventionTxt)
                ? `<div class="study-details-cell">
                    ${conditionTxt ? `<strong>${escapeHtml(conditionTxt)}</strong>` : ''}
                    ${interventionTxt ? `<span class="study-details-meta">${escapeHtml(interventionTxt)}</span>` : ''}
                  </div>`
                : '<span class="not-reported-badge">Not Reported</span>';

        const ses = extracted.socioeconomic_status || {};
        const sesOnly = {
            income: ses.income, education: ses.education,
            wealth: ses.wealth, adi_area_deprivation_index: ses.adi_area_deprivation_index,
        };

        return `<tr>
            <td>${nctCell}</td>
            <td>${dateCell}</td>
            <td>${trialNameCell}</td>
            <td><button class="row-details-btn" type="button" onclick="showLitExtractionDetails(${idx})">View</button></td>
            <td>${manuscriptCell}</td>
            <td>${groupCell('totals', extracted.total_participants)}</td>
            <td>${groupCell('age', extracted.age)}</td>
            <td>${groupCell('sex', extracted.sex)}</td>
            <td>${groupCell('gender', extracted.gender)}</td>
            <td>${groupCell('race', extracted.race_nih_omb)}</td>
            <td>${groupCell('ethnicity', extracted.ethnicity)}</td>
            <td>${groupCell('geography', extracted.geography)}</td>
            <td>${groupCell('ses', sesOnly)}</td>
            <td>${groupCell('disability', extracted.disability_and_functional_limitations)}</td>
            <td>${groupCell('household', ses.family_size)}</td>
        </tr>`;
    }).join('');
}

/**
 * Detail modal for a manuscript. Shows every API-vs-PDF comparison row with
 * Confirm / Deny buttons for any unresolved Addition or Conflict.
 */
function showLitExtractionDetails(idx) {
    const doc = _litExtractedData[idx];
    if (!doc) return;
    const overlay = document.getElementById('extraction-details-overlay');
    if (!overlay) return;
    overlay.dataset.litIdx = String(idx);

    const wrapped = doc.models?.[_litSelectedModel]?.data || {};
    const extracted = wrapped.extracted_data || {};
    const meta = doc.metadata || wrapped.metadata || {};
    const ncts = !isNR(extracted.associated_nct_ids) && Array.isArray(extracted.associated_nct_ids)
        ? extracted.associated_nct_ids : [];
    const filenameNct = (doc.nct_id && doc.nct_id !== 'Not Reported') ? doc.nct_id : null;
    const primaryNct = filenameNct || ncts[0] || null;
    const ctgov = findCTGovStudy(primaryNct);

    const rows = buildDiscrepancyRows(extracted, ctgov);
    const slugKey = filenameNct || doc.identifier || (doc.local_pdf_path || '');
    rows.forEach(r => { r.resolution = _litCurationState[resolutionKey(slugKey, r.path)] || null; });

    const groups = [
        { key: 'totals', title: 'Totals' },
        { key: 'age', title: 'Age' },
        { key: 'sex', title: 'Sex' },
        { key: 'gender', title: 'Gender' },
        { key: 'race', title: 'Race (NIH / OMB)' },
        { key: 'ethnicity', title: 'Ethnicity' },
        { key: 'geography', title: 'Geography' },
        { key: 'ses', title: 'Socioeconomic Status' },
        { key: 'disability', title: 'Disability / Functional Limitations' },
        { key: 'household', title: 'Household' },
        { key: 'religion', title: 'Religion' },
    ];

    const renderActions = (row) => {
        if (row.resolution) return resolutionBadge(row.resolution);
        if (row.status !== 'addition' && row.status !== 'conflict') return '';
        return `<div class="disc-actions">
            <button type="button" class="btn-confirm" onclick="confirmDiscrepancy('${escapeHtml(slugKey)}','${escapeHtml(row.path)}')">Confirm</button>
            <button type="button" class="btn-deny" onclick="denyDiscrepancy('${escapeHtml(slugKey)}','${escapeHtml(row.path)}')">Deny</button>
        </div>`;
    };

    const sectionsHtml = groups.map(g => {
        const gRows = rows.filter(r => r.group === g.key);
        if (gRows.length === 0) return '';
        const body = gRows.map(r => `
            <div style="padding:0.6rem 0;border-bottom:1px solid #f1f5f9;">
                <div style="display:flex;justify-content:space-between;align-items:center;gap:0.75rem;">
                    <strong style="font-size:0.9rem;color:#1f2937;">${escapeHtml(r.label)}</strong>
                    ${discBadge(r.status)}
                </div>
                <div class="disc-cell" style="margin-top:4px;">
                    <div class="disc-values"><span class="disc-source">CT.gov API:</span> ${formatValueForDisc(r.apiVal)}</div>
                    <div class="disc-values"><span class="disc-source">PDF extraction:</span> ${formatValueForDisc(r.pdfVal)}</div>
                    ${evidenceBlock(r.pdfRaw)}
                    ${renderActions(r)}
                </div>
            </div>`).join('');
        return `<div class="detail-section">
            <h5>${escapeHtml(g.title)}</h5>
            ${body}
        </div>`;
    }).join('');

    const pdfFilename = (doc.local_pdf_path || '').split('/').pop() || '';
    const modalTitle = pdfFilename.replace(/\.pdf$/i, '') || meta.condition || 'Manuscript Discrepancy Report';
    const manuscriptUrl = manuscriptLinkUrl(doc, extracted);
    const ctgovUrl = primaryNct ? `https://clinicaltrials.gov/study/${primaryNct}` : null;

    const html = `
        <div class="study-details-modal">
            <div class="modal-header">
                <h3>${escapeHtml(modalTitle)}</h3>
                <button class="close-btn" onclick="closeExtractionDetails()">&times;</button>
            </div>
            <div class="modal-body">
                <div class="extraction-meta-grid">
                    <div><strong>Linked NCT</strong>${primaryNct
                        ? `<a href="https://clinicaltrials.gov/study/${escapeHtml(primaryNct)}" target="_blank" rel="noopener noreferrer" class="fda-link">${escapeHtml(primaryNct)}</a>`
                        : '<span class="not-reported-badge">Not Reported</span>'}</div>
                    ${meta.condition && meta.condition !== 'Not Reported' ? `<div><strong>Condition</strong>${escapeHtml(meta.condition)}</div>` : ''}
                    ${meta.intervention && meta.intervention !== 'Not Reported' ? `<div><strong>Intervention</strong>${escapeHtml(meta.intervention)}</div>` : ''}
                    ${pdfFilename ? `<div><strong>Source PDF</strong>${escapeHtml(pdfFilename)}</div>` : ''}
                    ${(doc.tier && doc.tier !== 'Not Reported') ? `<div><strong>Manuscript Tier</strong><span class="tier-badge">${escapeHtml(doc.tier)}</span></div>` : ''}
                    <div><strong>Model</strong>${escapeHtml(doc.models?.[_litSelectedModel]?.label || _litSelectedModel)}</div>
                </div>
                <div class="detail-section">
                    <h5>Clinical Context</h5>
                    <ul class="extraction-kv-list">
                        <li><span class="kv-label">Trial Name</span><span class="kv-value">${fmtVal(ctgov?.brief_title || ctgov?.official_title || meta.condition)}</span></li>
                        <li><span class="kv-label">Target Patient Age Range</span><span class="kv-value">${fmtVal(extracted.target_patient_age_range)}${evidenceBlock(extracted.target_patient_age_range)}</span></li>
                        <li><span class="kv-label">Study Design / Methodology</span><span class="kv-value">${fmtVal(extracted.study_design)}${evidenceBlock(extracted.study_design)}</span></li>
                    </ul>
                </div>
                <div class="detail-section">
                    <h5>Source Attribution</h5>
                    <ul class="extraction-kv-list">
                        <li>
                            <span class="kv-label">ClinicalTrials.gov</span>
                            <span class="kv-value">${ctgovUrl
                                ? `<a href="${escapeHtml(ctgovUrl)}" target="_blank" rel="noopener noreferrer" class="fda-link">View CT.gov Record</a>
                                   <span class="study-details-meta">${escapeHtml(primaryNct)}</span>`
                                : '<span class="note">No NCT linked.</span>'}</span>
                        </li>
                        <li>
                            <span class="kv-label">Matched Manuscript</span>
                            <span class="kv-value">${manuscriptUrl
                                ? `<a href="${escapeHtml(manuscriptUrl)}" target="_blank" rel="noopener noreferrer" class="fda-link">View Manuscript</a>
                                   ${pdfFilename ? `<span class="study-details-meta">${escapeHtml(pdfFilename)}</span>` : ''}`
                                : '<span class="note">No manuscript URL recorded.</span>'}</span>
                        </li>
                    </ul>
                </div>
                ${ctgov ? '' : `<p class="note" style="color:#856404;background:#fff3cd;padding:0.5rem 0.75rem;border-radius:4px;">No ClinicalTrials.gov record found for the linked NCT — all PDF values are shown as Additions.</p>`}
                ${sectionsHtml}
            </div>
        </div>`;

    overlay.innerHTML = html;
    overlay.style.display = 'flex';
}
window.showLitExtractionDetails = showLitExtractionDetails;

// ═══════════════════════════════════════════════════════════════════════════
// (Gated) Industry Sponsor Representation — Tools › Industry Sponsors, and the
// /#industry route
//
// Rebuilds the standalone sponsor analysis (condition-baseline deviations,
// female share over time, adjusted contrasts vs Other Industry) on top of
// data/industry_sponsors.json, which the civicsample-engine weekly
// pipeline derives from the extraction. The tab button is gated through
// BETA_GATED_TABS in initTabs(); the hash route is gated in openIndustryView().
// Neither path initializes the view until the shared Beta password has
// validated for the session.
// ═══════════════════════════════════════════════════════════════════════════

const INDUSTRY_PINK = '#C26C8E';   // above baseline / more women (sex tier)
const INDUSTRY_BLUE = '#4A7BA6';   // below baseline / fewer women (sex tier)
const INDUSTRY_MID  = '#EBEBEB';   // zero deviation
const INDUSTRY_GREY = '#6b7280';   // underrepresentation on race/ethnicity tiers
const INDUSTRY_TREND_MIN_N = 5;    // suppress sponsor-year medians under this n

let industryData = null;           // parsed industry_sponsors.json
let industrySelected = null;       // Set of selected sponsor names
let industryView = 'heatmap';
let industryRole = 'any';      // 'any' = lead & collaborator | 'lead' = lead-sponsored trials only
let industryScope = 'top10';   // 'top10' | 'all' = adds the pooled Other Industry layer
let industryCellMin = null;    // heatmap trials-per-cell floor override (null = dataset default)
let industryCellMax = null;    // heatmap trials-per-cell cap (null = no cap)

// Demographic tier: which characteristic the panel reports on, plus the
// category layer inside the Race and Ethnicity tiers. Heatmap and trend show
// the category's plain share of reported participants; the Adjusted
// Differences view models the category's balance vs White (Hispanic vs Not
// Hispanic for ethnicity), the analogue of female vs male.
let industryDemo = 'sex';
const INDUSTRY_CAT_LABELS = {
    white: 'White', black_african_american: 'Black/African American', asian: 'Asian',
    american_indian_alaska_native: 'American Indian/Alaska Native',
    native_hawaiian_pacific_islander: 'Native Hawaiian/Pacific Islander',
    more_than_one_race: 'More than one race', other: 'Other',
    hispanic_latino: 'Hispanic or Latino', not_hispanic_latino: 'Not Hispanic or Latino'
};
let industryCat = { race: 'black_african_american', ethnicity: 'hispanic_latino' };
let industryBenchmark = 'cohort';      // 'cohort' | 'parity' (sex) | 'census' (race/eth)
let industrySexSpecific = false;       // Sex tier: include sex-specific condition categories

// Condition axis for the current tier: every named category with at least
// one metric-reporting trial in the current filter, ordered by descending
// trial count (the same convention as the sponsor list). Race/Ethnicity
// always include the sex-specific categories; the Sex tier excludes them
// unless toggled on. Uninformative buckets stay off the axis.
function industryConditions(rows) {
    const d = industryData;
    const skip = new Set(['Uncategorized', 'Other', '']);
    const sexSpecific = new Set(d.sex_specific_conditions ||
        ['Breast Cancer', 'Prostate Cancer', 'Infertility', 'Pregnancy Complications', 'Menopause and Hormonal']);
    const counts = new Map();
    rows.forEach(t => {
        if (industryTrialValue(t) === null) return;
        const c = d.secondaries[t[5]];
        if (!c || skip.has(c)) return;
        if (industryDemo === 'sex' && !industrySexSpecific && sexSpecific.has(c)) return;
        counts.set(c, (counts.get(c) || 0) + 1);
    });
    return [...counts.keys()].sort((a, b) => counts.get(b) - counts.get(a) || a.localeCompare(b));
}

// The deviation benchmark for a condition: the cohort's own pooled median,
// 50% parity (sex), or the category's 2020 Census population share.
// Disease-prevalence benchmarks are pending (prevalence_benchmarks in the
// dataset) and stay disabled in the toggle until populated.
function industryBenchmarkFor(cohortBase) {
    if (industryBenchmark === 'parity') return 50;
    if (industryBenchmark === 'census') {
        const c = industryData.census;
        const v = c && c[industryDemo] ? c[industryDemo][industryCat[industryDemo]] : null;
        return typeof v === 'number' ? v : cohortBase;
    }
    return cohortBase;
}

function industryBenchmarkLabel(cohortBase) {
    if (industryBenchmark === 'parity') return 'parity 50%';
    if (industryBenchmark === 'census') return 'census ' + industryBenchmarkFor(null) + '%';
    return cohortBase === null ? 'no trials' : 'base ' + cohortBase.toFixed(0) + '%';
}

function renderIndustryBenchmarkToggle() {
    const box = document.getElementById('industry-benchmark-toggle');
    if (!box) return;
    const alt = industryDemo === 'sex'
        ? { key: 'parity', label: '50% Parity' }
        : { key: 'census', label: 'Census Share' };
    if (industryBenchmark !== 'cohort' && industryBenchmark !== alt.key) industryBenchmark = 'cohort';
    box.innerHTML = `
        <button type="button" class="view-btn ${industryBenchmark === 'cohort' ? 'active' : ''}" data-ibench="cohort">Cohort Baseline</button>
        <button type="button" class="view-btn ${industryBenchmark === alt.key ? 'active' : ''}" data-ibench="${alt.key}">${alt.label}</button>
        <button type="button" class="view-btn" disabled title="Disease-prevalence benchmarks are pending integration">Disease Prevalence</button>`;
    box.querySelectorAll('.view-btn[data-ibench]').forEach(btn => {
        btn.addEventListener('click', () => {
            industryBenchmark = btn.dataset.ibench;
            renderIndustryBenchmarkToggle();
            renderIndustry();
        });
    });
}
const INDUSTRY_SUBTITLES = {
    sex: 'Female enrollment share across the top-10 industry sponsors, over the mixed-sex, sex-reporting interventional cohort (primary completion 2009 or later, not terminated).',
    race: 'Racial composition of enrollment across the top-10 industry sponsors \u2014 each category\u2019s share of explicitly reported participants, over the race-reporting trials of the industry cohort (primary completion 2009 or later, not terminated).',
    ethnicity: 'Ethnic composition of enrollment across the top-10 industry sponsors \u2014 each category\u2019s share of explicitly reported participants, over the ethnicity-reporting trials of the industry cohort (primary completion 2009 or later, not terminated).'
};

function industryCatIndex() {
    const d = industryData;
    if (industryDemo === 'race') return (d.race_categories || []).indexOf(industryCat.race);
    if (industryDemo === 'ethnicity') return (d.eth_categories || []).indexOf(industryCat.ethnicity);
    return -1;
}

// Metric label for the current tier ("female", "Black/African American", ...).
function industryMetricLabel() {
    if (industryDemo === 'sex') return 'female';
    return INDUSTRY_CAT_LABELS[industryCat[industryDemo]] || '';
}

// The per-trial metric: % female, or the selected category's share of the
// trial's explicitly reported race/ethnicity categories. null = trial does
// not report this demographic (row drops out of the views).
function industryTrialValue(t) {
    if (industryDemo === 'sex') return t[1];
    const i = industryCatIndex();
    const arr = industryDemo === 'race' ? t[8] : t[9];
    return (arr && i >= 0 && typeof arr[i] === 'number') ? arr[i] : null;
}
let industryChart = null;

function industryActive() {
    const sec = document.getElementById('industry');
    return !!(sec && sec.classList.contains('active'));
}

// Muted editorial line palette for the trend view (pink/blue stay reserved
// for the deviation encodings, matching the source figures).
const INDUSTRY_LINE_COLORS = [
    '#1b4332', '#52b788', '#C26C8E', '#4A7BA6', '#8a6d3b',
    '#5f5aa2', '#b56576', '#457b9d', '#6b705c', '#9d4edd'
];

function industryHexLerp(a, b, t) {
    const ah = a.match(/\w\w/g).map(h => parseInt(h, 16));
    const bh = b.match(/\w\w/g).map(h => parseInt(h, 16));
    return '#' + ah.map((v, i) => Math.round(v + (bh[i] - v) * t)
        .toString(16).padStart(2, '0')).join('');
}

// The selected category's color from the site-wide palette (COLORS.race /
// COLORS.ethnicity), so the industry tiers stay in step with the main Race
// and Ethnicity tabs. null on the Sex tier (pink/blue stays its encoding).
function industryCatColor() {
    if (industryDemo === 'sex') return null;
    return (COLORS[industryDemo] || {})[industryCat[industryDemo]] || null;
}

// Diverging fill for a deviation in percentage points, clamped to ±15pp
// (the analysis figure's scale limits). Sex: pink above / blue below. Race
// and Ethnicity: the category's palette color grows richer the further the
// sponsor sits above the benchmark and fades to grey below it.
function industryDevColor(dev) {
    const t = Math.max(-1, Math.min(1, dev / 15));
    const cat = industryCatColor();
    if (cat) {
        return t >= 0 ? industryHexLerp(INDUSTRY_MID, cat, t)
                      : industryHexLerp(INDUSTRY_MID, INDUSTRY_GREY, -t);
    }
    return t >= 0 ? industryHexLerp(INDUSTRY_MID, INDUSTRY_PINK, t)
                  : industryHexLerp(INDUSTRY_MID, INDUSTRY_BLUE, -t);
}

// Effective trials-per-cell window for the heatmap: only cells whose trial
// count falls inside it get a computed, colored deviation — the rest show
// their n in grey. The floor defaults to the dataset's min_cell but both
// bounds are user-adjustable, so small-trial cells can be examined on demand.
function industryCellRange() {
    const floor = industryCellMin !== null ? industryCellMin
        : ((industryData && industryData.min_cell) || 10);
    const min = Math.max(1, floor);
    const max = industryCellMax !== null ? Math.max(industryCellMax, min) : Infinity;
    return { min, max };
}

// White cell text once the fill is dark enough that black would strain.
function industryDarkText(hex) {
    const [r, g, b] = hex.match(/\w\w/g).map(h => parseInt(h, 16));
    return (0.299 * r + 0.587 * g + 0.114 * b) < 150;
}

function industryMedian(values) {
    if (!values.length) return null;
    const v = [...values].sort((a, b) => a - b);
    const mid = Math.floor(v.length / 2);
    return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

// Trial rows surviving the global Year Range (results posted) and Condition
// filters. Row layout: [bucket, pf, results_year, pcd_year, primary,
// secondary, has_explicit_unknown] (see trial_fields in the JSON).
function industryFilteredRows() {
    const d = industryData;
    const yearStart = parseInt(document.getElementById('year-start')?.value || 2009);
    const yearEnd   = parseInt(document.getElementById('year-end')?.value || 2100);
    const priSel = document.getElementById('condition-primary')?.value || 'all';
    const secSel = document.getElementById('condition-secondary')?.value || 'all';
    return d.trials.filter(t => {
        const ry = t[2];
        if (ry && (ry < yearStart || ry > yearEnd)) return false;
        // Role toggle: keep only lead-sponsored trials (t[7] via_lead; the
        // explicit-0 check tolerates a cached pre-toggle dataset).
        if (industryRole === 'lead' && t[7] === 0) return false;
        if (priSel !== 'all' && d.primaries[t[4]] !== priSel) return false;
        if (secSel !== 'all' && d.secondaries[t[5]] !== secSel) return false;
        if (industryDemo !== 'sex' && industryTrialValue(t) === null) return false;
        return true;
    });
}

// The named-sponsor set the adjusted models use: the top volume-ranked
// companies. company_n marks the current full-list JSON format; the older
// cached format carried exactly top-10 + "Other Industry", where slice(0, 10)
// still lands on the same named set.
function industryTop10() {
    const d = industryData;
    return d.companies.slice(0, d.top_n || 10);
}

// The sponsor list the dropdown offers under the current Scope: the named
// top-10, or every industry sponsor in volume order.
function industryMenuCompanies() {
    const d = industryData;
    if (industryScope === 'all' && Array.isArray(d.company_n)) return d.companies;
    return industryTop10();
}

function renderIndustrySponsorMenu() {
    const box = document.getElementById('industry-sponsor-options');
    const summary = document.getElementById('industry-sponsor-summary');
    if (!box) return;
    const d = industryData;
    const listed = industryMenuCompanies();
    const nFor = i => (Array.isArray(d.company_n) && d.company_n[i] != null)
        ? `<span class="industry-sponsor-n">n=${d.company_n[i].toLocaleString()}</span>` : '';
    // The companies list is already volume-ranked descending, so index order
    // is display order. The type-to-filter box matters on the All scope,
    // where the list runs to thousands of sponsors.
    box.innerHTML = `<input type="text" class="industry-sponsor-search" id="industry-sponsor-search" placeholder="Filter sponsors…" autocomplete="off">
        <div class="industry-sponsor-list">` + listed.map((sp, i) => `
        <label class="industry-sponsor-option">
            <input type="checkbox" value="${escapeHtml(sp)}" ${industrySelected.has(sp) ? 'checked' : ''}>
            <span class="industry-sponsor-name">${escapeHtml(sp)}</span>${nFor(i)}
        </label>`).join('') + `</div>
        <div class="industry-sponsor-menu-actions">
            <button type="button" id="industry-sp-all">All</button>
            <button type="button" id="industry-sp-none">None</button>
        </div>`;
    box.querySelector('#industry-sponsor-search').addEventListener('input', e => {
        const q = e.target.value.toLowerCase();
        box.querySelectorAll('.industry-sponsor-option').forEach(row => {
            row.style.display = !q || row.textContent.toLowerCase().includes(q) ? '' : 'none';
        });
    });
    box.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        cb.addEventListener('change', () => {
            if (cb.checked) industrySelected.add(cb.value); else industrySelected.delete(cb.value);
            updateIndustrySummaryLabel(summary);
            renderIndustry();
        });
    });
    box.querySelector('#industry-sp-all').addEventListener('click', () => {
        industrySelected = new Set(industryMenuCompanies()); renderIndustrySponsorMenu(); renderIndustry();
    });
    box.querySelector('#industry-sp-none').addEventListener('click', () => {
        industrySelected = new Set(); renderIndustrySponsorMenu(); renderIndustry();
    });
    updateIndustrySummaryLabel(summary);
}

function updateIndustrySummaryLabel(summary) {
    if (!summary) summary = document.getElementById('industry-sponsor-summary');
    const n = industrySelected.size, total = industryMenuCompanies().length;
    summary.textContent = (industryScope !== 'all' && n === total) ? 'Sponsors: All top 10'
        : n === 0 ? 'Sponsors: none selected'
        : n === 1 ? 'Sponsor: ' + [...industrySelected][0]
        : `Sponsors: ${n.toLocaleString()} of ${total.toLocaleString()}`;
}

// Selected sponsors in volume order, paginated: the heatmap and trend show
// one page of sponsors at a time (15 default, up to 50 per page) so a bulk
// "All" over hundreds of sponsors stays readable and browsable.
let industryRowsPerPage = 15;
let industrySponsorPage = 0;
function industrySelectedOrdered() {
    const all = industryMenuCompanies().filter(sp => industrySelected.has(sp));
    const per = industryRowsPerPage;
    const totalPages = Math.max(1, Math.ceil(all.length / per));
    industrySponsorPage = Math.max(0, Math.min(industrySponsorPage, totalPages - 1));
    const start = industrySponsorPage * per;
    return { list: all.slice(start, start + per), total: all.length, start, page: industrySponsorPage, totalPages };
}

// Sponsors-per-page selector + Prev/Next pager under the meta line. Hidden
// while everything already fits on one 15-row page, and on the forest view
// (adjusted models only exist for the named top sponsors).
function renderIndustryPager() {
    const box = document.getElementById('industry-pager');
    if (!box) return;
    const ord = industrySelectedOrdered();
    if (industryView === 'forest' || ord.total <= 15) { box.innerHTML = ''; return; }
    let html = `<div class="rows-per-page"><span class="rows-label">Sponsors / page</span>`;
    [15, 25, 50].forEach(n => {
        html += `<button type="button" class="rows-btn ${industryRowsPerPage === n ? 'active' : ''}" data-rows="${n}">${n}</button>`;
    });
    html += '</div>';
    if (ord.totalPages > 1) {
        html += `<div class="pagination-controls industry-pager-nav">
            <button class="page-btn" ${ord.page === 0 ? 'disabled' : ''} data-ipage="${ord.page - 1}">&#8592; Prev</button>
            <span class="pager-range">${ord.start + 1}&ndash;${ord.start + ord.list.length} of ${ord.total.toLocaleString()}</span>
            <button class="page-btn" ${ord.page >= ord.totalPages - 1 ? 'disabled' : ''} data-ipage="${ord.page + 1}">Next &#8594;</button>
        </div>`;
    }
    box.innerHTML = html;
    box.querySelectorAll('.rows-btn').forEach(btn => btn.addEventListener('click', () => {
        industryRowsPerPage = parseInt(btn.dataset.rows, 10);
        industrySponsorPage = 0;
        renderIndustry();
    }));
    box.querySelectorAll('.page-btn[data-ipage]').forEach(btn => btn.addEventListener('click', () => {
        industrySponsorPage = parseInt(btn.dataset.ipage, 10);
        renderIndustry();
    }));
}

function renderIndustryHeatmap(rows) {
    const d = industryData;
    const host = document.getElementById('industry-view-heatmap');
    const conditions = industryConditions(rows);
    const topN = d.top_n || 10;
    const sponsors = industrySelectedOrdered().list;
    if (industryScope === 'all') sponsors.push('Other Industry');

    // Pooled per-condition baselines over ALL industry rows in the filter,
    // then sponsor-by-condition medians. Deviations in percentage points.
    // "Other Industry" stays defined as every trial outside the named top
    // sponsors (company index >= topN), matching the adjusted models'
    // reference bucket regardless of the dropdown selection.
    const byCond = {};
    conditions.forEach(c => { byCond[c] = { all: [], bySponsor: {} }; });
    const secName = i => d.secondaries[i];
    rows.forEach(t => {
        const v = industryTrialValue(t);
        if (v === null) return;
        const c = secName(t[5]);
        if (!(c in byCond)) return;
        byCond[c].all.push(v);
        const sp = d.companies[t[0]];
        (byCond[c].bySponsor[sp] = byCond[c].bySponsor[sp] || []).push(v);
        if (t[0] >= topN && sp !== 'Other Industry') {
            (byCond[c].bySponsor['Other Industry'] = byCond[c].bySponsor['Other Industry'] || []).push(v);
        }
    });

    let html = '<div class="industry-heatmap-wrap"><table class="industry-heatmap"><thead><tr><th></th>';
    conditions.forEach(c => {
        const base = industryMedian(byCond[c].all);
        html += `<th title="${byCond[c].all.length.toLocaleString()} reporting trials in the current filter">${escapeHtml(c)}<span class="industry-heatmap-base">${escapeHtml(industryBenchmarkLabel(base))}</span></th>`;
    });
    html += '</tr></thead><tbody>';
    const { min: cellMin, max: cellMax } = industryCellRange();
    sponsors.forEach(sp => {
        html += `<tr><th>${escapeHtml(sp)}</th>`;
        conditions.forEach(c => {
            const vals = byCond[c].bySponsor[sp] || [];
            const base = industryMedian(byCond[c].all);
            const bench = industryBenchmarkFor(base);
            if (vals.length >= cellMin && vals.length <= cellMax && bench !== null) {
                const dev = industryMedian(vals) - bench;
                const bg = industryDevColor(dev);
                html += `<td style="background:${bg}" title="${escapeHtml(sp)} — ${escapeHtml(c)}: median ${industryMedian(vals).toFixed(1)}% vs ${bench.toFixed(1)}% benchmark (n=${vals.length})"><span class="${industryDarkText(bg) ? 'industry-cell-dark' : ''}">${dev >= 0 ? '+' : ''}${dev.toFixed(0)}</span></td>`;
            } else if (vals.length > 0) {
                html += `<td class="industry-cell-thin" title="${vals.length < cellMin ? 'Below' : 'Above'} the trials-per-cell window (n=${vals.length})">(${vals.length})</td>`;
            } else {
                html += '<td class="industry-cell-empty"></td>';
            }
        });
        html += '</tr>';
    });
    html += '</tbody></table></div>';
    const metric = industryMetricLabel();
    const benchDesc = industryBenchmark === 'parity' ? 'a 50% parity benchmark'
        : industryBenchmark === 'census' ? `the category's 2020 U.S. Census population share (${industryBenchmarkFor(null)}%)`
        : "the condition's pooled median across all industry trials in the current filter";
    const prevNote = industryDemo === 'sex' ? ''
        : ` Population disease-prevalence benchmarks by ${industryDemo} are held as placeholders pending integration.`;
    const condNote = industryDemo === 'sex' && !industrySexSpecific
        ? "Columns are every named condition category with reporting trials in the current filter, ordered by trial count (sex-specific categories excluded; toggle above to include them)."
        : "Columns are every named condition category with reporting trials in the current filter, ordered by trial count, including sex-specific ones.";
    const catColor = industryCatColor();
    const encNote = catColor
        ? `cells use the category's color from the site-wide ${industryDemo} palette, <span style="color:${catColor}">richer</span> above the benchmark and fading to <span style="color:${INDUSTRY_GREY}">grey</span> below it`
        : `<span style="color:${INDUSTRY_PINK}">pink</span> above the benchmark, <span style="color:${INDUSTRY_BLUE}">blue</span> below`;
    const rangeDesc = cellMax === Infinity
        ? `fewer than ${cellMin} trials`
        : `a trial count outside ${cellMin}&ndash;${cellMax}`;
    const smallNote = cellMin < (d.min_cell || 10)
        ? ` (medians over so few trials are volatile &mdash; the default floor is ${d.min_cell})` : '';
    html += `<p class="industry-footnote">Each colored cell is the sponsor's median within-trial percent ${escapeHtml(metric)} minus ${benchDesc}, in percentage points &mdash; ${encNote}, clamped at &plusmn;15. Cells with ${rangeDesc} show their n in grey${smallNote}. ${condNote}${prevNote} Descriptive; the Adjusted Differences view is the inferential version.</p>`;
    host.innerHTML = html;
}

function renderIndustryTrend(rows) {
    const d = industryData;
    const canvas = document.getElementById('industry-trend-canvas');
    if (!canvas || typeof Chart === 'undefined') return;
    const topN = d.top_n || 10;
    const sponsors = industrySelectedOrdered().list;
    if (industryScope === 'all') sponsors.push('Other Industry');

    const years = [...new Set(rows.map(t => t[3]))].sort();
    const perSponsor = {};
    sponsors.forEach(sp => { perSponsor[sp] = {}; });
    const pooled = {};
    rows.forEach(t => {
        const v = industryTrialValue(t);
        if (v === null) return;
        (pooled[t[3]] = pooled[t[3]] || []).push(v);
        const sp = d.companies[t[0]];
        if (sp in perSponsor) (perSponsor[sp][t[3]] = perSponsor[sp][t[3]] || []).push(v);
        if (t[0] >= topN && sp !== 'Other Industry' && ('Other Industry' in perSponsor)) {
            (perSponsor['Other Industry'][t[3]] = perSponsor['Other Industry'][t[3]] || []).push(v);
        }
    });

    const datasets = sponsors.map((sp, i) => {
        const color = sp === 'Other Industry' ? '#8d99ae'
            : INDUSTRY_LINE_COLORS[i % INDUSTRY_LINE_COLORS.length];
        return {
            label: sp,
            data: years.map(y => {
                const v = perSponsor[sp][y] || [];
                return v.length >= INDUSTRY_TREND_MIN_N ? +industryMedian(v).toFixed(1) : null;
            }),
            borderColor: color, backgroundColor: color,
            spanGaps: false, tension: 0.25, pointRadius: 2, borderWidth: 2
        };
    });
    datasets.push({
        label: 'All industry (pooled)',
        data: years.map(y => {
            const v = pooled[y] || [];
            return v.length >= INDUSTRY_TREND_MIN_N ? +industryMedian(v).toFixed(1) : null;
        }),
        borderColor: '#9aa5a0', backgroundColor: '#9aa5a0',
        borderDash: [6, 4], pointRadius: 0, borderWidth: 1.5, tension: 0.25, spanGaps: false
    });
    if (industryBenchmark === 'census') {
        const cv = industryBenchmarkFor(null);
        const censusColor = industryCatColor() || '#b9a56b';
        if (typeof cv === 'number') datasets.push({
            label: `Census share (${cv}%)`,
            data: years.map(() => cv),
            borderColor: censusColor, backgroundColor: censusColor,
            borderDash: [2, 4], pointRadius: 0, borderWidth: 1.2, order: 98
        });
    }
    if (industryDemo === 'sex') {
        datasets.push({
            label: '50% parity',
            data: years.map(() => 50),
            borderColor: '#c9c9c9', backgroundColor: '#c9c9c9',
            borderDash: [2, 4], pointRadius: 0, borderWidth: 1, order: 99
        });
    }

    const trendNote = document.getElementById('industry-trend-footnote');
    if (trendNote) {
        const refBit = industryBenchmark === 'census'
            ? ` and the dotted line in the category's palette color marks the category's 2020 Census share (${industryBenchmarkFor(null)}%)`
            : industryDemo === 'sex' ? ' and the dotted line marks 50% parity' : '';
        trendNote.textContent = `Annual median within-trial percent ${industryMetricLabel()} by primary completion year, per selected sponsor. Years with fewer than ${INDUSTRY_TREND_MIN_N} trials for a sponsor are left blank; the dashed grey line is the pooled industry median${refBit}. Respects the global Year Range (results posted) and Condition filters.`;
    }

    if (industryChart) industryChart.destroy();
    industryChart = new Chart(canvas, {
        type: 'line',
        data: { labels: years, datasets },
        options: {
            responsive: true, maintainAspectRatio: true,
            aspectRatio: CHART_ASPECT_RATIO || 2,
            plugins: {
                legend: { position: CHART_LEGEND_POSITION, labels: { usePointStyle: true, boxWidth: 8, boxHeight: 8, padding: 10, filter: it => it.text !== '50% parity' } },
                tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y}%` } },
                datalabels: { display: false }
            },
            scales: {
                y: industryDemo === 'sex'
                    ? { min: 20, max: 80, title: { display: true, text: isMobileDevice ? '% female' : 'Median % female per trial' } }
                    : { min: 0, title: { display: true, text: (isMobileDevice ? '% ' : 'Median % ') + industryMetricLabel() + (isMobileDevice ? '' : ' per trial') } },
                x: { title: { display: true, text: isMobileDevice ? 'Completion year' : 'Primary completion year' } }
            }
        }
    });
}

function renderIndustryForest() {
    const d = industryData;
    const host = document.getElementById('industry-view-forest');
    // Role-matched model set (falls back to the default set on a cached
    // pre-toggle dataset without the lead-only fits).
    const leadMode = industryRole === 'lead' && Array.isArray(d.contrasts_lead);
    let contrastSet, pooled = null;
    if (industryDemo === 'sex') {
        contrastSet = leadMode ? d.contrasts_lead : d.contrasts;
        pooled = leadMode ? d.pooled_lead : d.pooled;
    } else {
        const cat = industryCat[industryDemo];
        contrastSet = (d.contrasts_demo && d.contrasts_demo[industryDemo] &&
                       d.contrasts_demo[industryDemo][cat] &&
                       d.contrasts_demo[industryDemo][cat][leadMode ? 'lead' : 'any']) || [];
        if (!contrastSet.length) {
            host.innerHTML = '<p class="note">Adjusted models are not available for this category (insufficient reporting trials, or the dataset predates this tier).</p>';
            return;
        }
    }
    const contrasts = [...contrastSet]
        .filter(c => industrySelected.has(c.sponsor))
        .sort((a, b) => b.beta - a.beta);
    if (!contrasts.length) { host.innerHTML = '<p class="note">No sponsors selected.</p>'; return; }

    const lo = Math.min(...contrasts.map(c => c.lo), 0);
    const hi = Math.max(...contrasts.map(c => c.hi), 0);
    const span = (hi - lo) || 1;
    const px = v => ((v - lo) / span * 100).toFixed(2) + '%';

    let html = '<div class="industry-forest">';
    html += `<div class="industry-forest-head"><span></span><span class="industry-forest-axis"><span class="industry-forest-zerolabel" style="left:${px(0)}">0</span></span><span>pp [95% CI]</span></div>`;
    const fCatColor = industryCatColor();
    const fPos = fCatColor || INDUSTRY_PINK;
    const fNeg = fCatColor ? INDUSTRY_GREY : INDUSTRY_BLUE;
    contrasts.forEach(c => {
        const color = c.beta >= 0 ? fPos : fNeg;
        html += `
        <div class="industry-forest-row">
            <span class="industry-forest-name">${escapeHtml(c.sponsor)}</span>
            <span class="industry-forest-plot">
                <span class="industry-forest-zero" style="left:${px(0)}"></span>
                <span class="industry-forest-ci" style="left:${px(c.lo)}; width:calc(${px(c.hi)} - ${px(c.lo)}); background:${color}"></span>
                <span class="industry-forest-dot" style="left:${px(c.beta)}; background:${color}"></span>
            </span>
            <span class="industry-forest-stats"><strong>${c.beta >= 0 ? '+' : ''}${c.beta.toFixed(1)}</strong> [${c.lo.toFixed(1)}, ${c.hi.toFixed(1)}] &middot; n=${c.n.toLocaleString()}</span>
        </div>`;
    });
    html += '</div>';
    let outcomeDesc, groupNoun;
    if (industryDemo === 'sex') {
        outcomeDesc = 'within-trial percent female'; groupNoun = 'women';
    } else if (industryDemo === 'ethnicity') {
        const lb = industryMetricLabel();
        outcomeDesc = `the within-trial share of ${lb} participants among Hispanic + Not Hispanic participants`;
        groupNoun = `${lb} participants`;
    } else if (industryCat.race === 'white') {
        outcomeDesc = 'the within-trial share of White participants among all explicitly reported participants';
        groupNoun = 'White participants';
    } else {
        const lb = industryMetricLabel();
        outcomeDesc = `the within-trial share of ${lb} participants among ${lb} + White participants (the balance vs White)`;
        groupNoun = `${lb} participants`;
    }
    const pooledNote = pooled ? ` (n=${pooled.n.toLocaleString()}; pooled R&sup2;=${pooled.r2})` : '';
    const fEncNote = fCatColor
        ? `Bars in the <span style="color:${fCatColor}">category's palette color</span> mark sponsors enrolling more ${groupNoun} than Other Industry at the same trial mix; <span style="color:${INDUSTRY_GREY}">grey</span> bars fewer.`
        : `<span style="color:${INDUSTRY_PINK}">Pink</span> enrolls more ${groupNoun} than Other Industry at the same trial mix; <span style="color:${INDUSTRY_BLUE}">blue</span> fewer.`;
    html += `<p class="industry-footnote">Each row is a sponsor's adjusted difference in ${outcomeDesc} vs the Other Industry bucket, in percentage points, from a two-group model holding phase, log enrollment, completion year, country count, and therapeutic area fixed (95% CIs; a bar crossing zero is not distinguishable from zero). ${fEncNote} Model estimates are computed on the ${leadMode ? 'lead-sponsored cohort' : 'full cohort'}${pooledNote} and respond to the Role toggle but not to the year/condition filters.</p>`;
    host.innerHTML = html;
}

function renderIndustry() {
    if (!industryData) return;
    const rows = industryFilteredRows();
    const meta = document.getElementById('industry-meta');
    if (meta) {
        const ord = industrySelectedOrdered();
        const trunc = ord.total > ord.list.length
            ? ` · sponsors ${ord.start + 1}–${ord.start + ord.list.length} of ${ord.total.toLocaleString()} (by volume)` : '';
        const demoBit = industryDemo === 'sex' ? 'sex' : `${industryDemo}: ${industryMetricLabel()}`;
        meta.textContent = `${rows.length.toLocaleString()} of ${industryData.cohort_n.toLocaleString()} cohort trials in the current filter · ${demoBit} · ${industryRole === 'lead' ? 'lead sponsor only' : 'lead & collaborator'} · ${industryScope === 'all' ? 'all industry sponsors' : 'top 10 sponsors'}${trunc} · extraction ${industryData.source_extracted_at ? industryData.source_extracted_at.slice(0, 10) : '—'}`;
    }
    renderIndustryPager();
    updateIndustryShareUrl();
    ['heatmap', 'trend', 'forest'].forEach(v => {
        const el = document.getElementById('industry-view-' + v);
        if (el) el.style.display = v === industryView ? '' : 'none';
    });
    // The trials-per-cell window only shapes the heatmap.
    const cellRangeBox = document.getElementById('industry-cellrange');
    if (cellRangeBox) cellRangeBox.style.display = industryView === 'heatmap' ? '' : 'none';
    if (industryView === 'heatmap') renderIndustryHeatmap(rows);
    else if (industryView === 'trend') renderIndustryTrend(rows);
    else renderIndustryForest();
}

// Serialize the industry view's state into #industry?… so the exact tier,
// benchmark, role, scope, and view are shareable. Only non-defaults appear.
function updateIndustryShareUrl() {
    if (!industryActive()) return;
    const p = new URLSearchParams();
    if (industryDemo !== 'sex') { p.set('demo', industryDemo); p.set('cat', industryCat[industryDemo]); }
    if (industryBenchmark !== 'cohort') p.set('bench', industryBenchmark);
    if (industryRole !== 'any') p.set('role', industryRole);
    if (industryScope !== 'top10') p.set('scope', industryScope);
    if (industryView !== 'heatmap') p.set('view', industryView);
    if (industrySexSpecific) p.set('ss', '1');
    const q = p.toString();
    history.replaceState(null, '', '#industry' + (q ? '?' + q : ''));
}

// Restore a shared #industry?… state once, before the first render.
let industryRouteApplied = false;
function applyIndustryShareParams() {
    if (industryRouteApplied) return;
    industryRouteApplied = true;
    const m = location.hash.match(/^#industry\?(.+)$/);
    if (!m) return;
    const p = new URLSearchParams(m[1]);
    const demo = p.get('demo');
    if (demo === 'race' || demo === 'ethnicity') {
        industryDemo = demo;
        const cat = p.get('cat');
        if (cat && INDUSTRY_CAT_LABELS[cat]) industryCat[demo] = cat;
    }
    if (['parity', 'census'].indexOf(p.get('bench')) >= 0) industryBenchmark = p.get('bench');
    if (p.get('role') === 'lead') industryRole = 'lead';
    if (p.get('scope') === 'all') industryScope = 'all';
    if (['trend', 'forest'].indexOf(p.get('view')) >= 0) industryView = p.get('view');
    industrySexSpecific = p.get('ss') === '1';
    const setActive = (sel, attr, val) => document.querySelectorAll(sel).forEach(b =>
        b.classList.toggle('active', b.dataset[attr] === val));
    setActive('.industry-demo-tab[data-idemo]', 'idemo', industryDemo);
    setActive('#industry-role-toggle .view-btn', 'irole', industryRole);
    setActive('#industry-scope-toggle .view-btn', 'iscope', industryScope);
    setActive('#industry-view-toggle .view-btn', 'iview', industryView);
    const sub = document.getElementById('industry-subtitle');
    if (sub && INDUSTRY_SUBTITLES[industryDemo]) sub.textContent = INDUSTRY_SUBTITLES[industryDemo];
    renderIndustryCatRow();
}

// Category layer inside the Race / Ethnicity tiers.
function renderIndustryCatRow() {
    const row = document.getElementById('industry-cat-row');
    if (!row) return;
    renderIndustryBenchmarkToggle();
    if (!industryData) { row.style.display = 'none'; return; }
    if (industryDemo === 'sex') {
        row.style.display = '';
        row.innerHTML = `<button type="button" class="industry-cat-chip ${industrySexSpecific ? 'active' : ''}" id="industry-sexspec-chip" title="Breast Cancer, Prostate Cancer, Infertility, Pregnancy Complications, Menopause and Hormonal">${industrySexSpecific ? 'Sex-specific conditions: shown' : 'Sex-specific conditions: hidden'}</button>`;
        row.querySelector('#industry-sexspec-chip').addEventListener('click', () => {
            industrySexSpecific = !industrySexSpecific;
            renderIndustryCatRow();
            renderIndustry();
        });
        return;
    }
    const cats = industryDemo === 'race'
        ? (industryData.race_categories || [])
        : (industryData.eth_categories || []);
    if (!cats.length) { row.style.display = 'none'; return; }
    row.style.display = '';
    row.innerHTML = cats.map(c => `
        <button type="button" class="industry-cat-chip ${industryCat[industryDemo] === c ? 'active' : ''}" data-icat="${escapeHtml(c)}"><span class="industry-cat-dot" style="background:${(COLORS[industryDemo] || {})[c] || '#9ca3af'}"></span>${escapeHtml(INDUSTRY_CAT_LABELS[c] || c)}</button>`).join('');
    row.querySelectorAll('.industry-cat-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            industryCat[industryDemo] = chip.dataset.icat;
            renderIndustryCatRow();
            renderIndustry();
        });
    });
}

// Hash-route entry (/#industry, including the industry/ redirect stub). The
// Tools tab button takes the other entry: initTabs() gates it through
// BETA_GATED_TABS, activates the section, and calls loadIndustryView().
async function openIndustryView() {
    // Session-scoped gate: nothing renders until the shared Beta password has
    // validated (betaExtractionUnlocked in sessionStorage).
    const granted = await promptForBetaAccess();
    if (!granted) {
        history.replaceState(null, '', location.pathname + location.search);
        return;
    }

    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    const navBtn = document.querySelector('.tab[data-tab="industry"]');
    if (navBtn) navBtn.classList.add('active');   // lights the Tools group via :has(.tab.active)
    document.getElementById('industry').classList.add('active');
    const filtersSection = document.getElementById('filters');
    if (filtersSection && !dashboardSummary) filtersSection.style.display = '';

    await loadIndustryView();
}

// Shared by both entries. Assumes the gate has passed and #industry is the
// active section; fetches the dataset once, then renders.
async function loadIndustryView() {
    updateIndustryShareUrl();   // #industry in the bar even if the fetch below fails
    if (!industryData) {
        try {
            const resp = await fetch(`data/industry_sponsors.json?v=${DATA_CACHE_VERSION}`);
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            industryData = await resp.json();
            industrySelected = new Set(industryTop10());
            renderIndustrySponsorMenu();
            renderIndustryCatRow();
            const cellMinInput = document.getElementById('industry-cellmin');
            if (cellMinInput && !cellMinInput.value) cellMinInput.value = industryData.min_cell || 10;
            applyIndustryShareParams();
        } catch (e) {
            document.getElementById('industry-view-heatmap').innerHTML =
                `<p class="note">Could not load the industry sponsor dataset (${escapeHtml(e.message)}). It is generated by the civicsample-engine pipeline during the weekly extraction.</p>`;
            return;
        }
    }
    renderIndustry();
}

function industryRoute() {
    if (location.hash === '#industry' || location.hash.indexOf('#industry?') === 0) openIndustryView();
}

document.addEventListener('DOMContentLoaded', () => {
    // View switcher.
    document.querySelectorAll('#industry-view-toggle .view-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#industry-view-toggle .view-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            industryView = btn.dataset.iview;
            renderIndustry();
        });
    });
    // Demographic tier tabs (Sex / Race / Ethnicity).
    document.querySelectorAll('.industry-demo-tab[data-idemo]').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.industry-demo-tab').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            industryDemo = btn.dataset.idemo;
            const sub = document.getElementById('industry-subtitle');
            if (sub) sub.textContent = INDUSTRY_SUBTITLES[industryDemo];
            renderIndustryCatRow();
            renderIndustry();
        });
    });
    // Role toggle: lead & collaborator vs lead sponsor only.
    document.querySelectorAll('#industry-role-toggle .view-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#industry-role-toggle .view-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            industryRole = btn.dataset.irole;
            renderIndustry();
        });
    });
    // Scope toggle: top-10 named sponsors vs all industry (adds Other Industry).
    document.querySelectorAll('#industry-scope-toggle .view-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#industry-scope-toggle .view-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            industryScope = btn.dataset.iscope;
            if (industryScope !== 'all') {
                const top = new Set(industryTop10());
                industrySelected = new Set([...industrySelected].filter(sp => top.has(sp)));
            }
            renderIndustrySponsorMenu();
            renderIndustry();
        });
    });
    // Trials-per-cell window: which heatmap cells get a computed deviation.
    // Clearing the floor restores the dataset default; clearing the cap
    // removes it (the placeholder reads as "no cap").
    [['industry-cellmin', v => { industryCellMin = v; }],
     ['industry-cellmax', v => { industryCellMax = v; }]].forEach(([id, set]) => {
        document.getElementById(id)?.addEventListener('change', e => {
            const v = parseInt(e.target.value, 10);
            const valid = Number.isFinite(v) && v >= 1;
            set(valid ? v : null);
            if (!valid) e.target.value = id === 'industry-cellmin'
                ? ((industryData && industryData.min_cell) || 10) : '';
            if (industryActive()) renderIndustry();
        });
    });
    // Re-render under the global filters this view honors.
    ['year-start', 'year-end', 'condition-primary', 'condition-secondary'].forEach(id => {
        document.getElementById(id)?.addEventListener('change', () => {
            if (industryActive()) renderIndustry();
        });
    });
    // Leaving via the nav clears the hash so a refresh doesn't re-gate into
    // the hidden view unexpectedly.
    document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => {
        if (location.hash === '#industry') history.replaceState(null, '', location.pathname + location.search);
    }));
    window.addEventListener('hashchange', industryRoute);
    industryRoute();
});

// ClinicalTrials.gov Demographics Dashboard - Enhanced Version

let data = null;
let detailCache = {};  // Lazy-loaded study detail data keyed by nct_id
let detailsLoaded = false;  // Whether detail files have been fetched
let charts = {};
let currentSort = { field: null, direction: 'asc' };
let currentPage = 0;
const PAGE_SIZE = 100;

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
const COLORS = {
    race: {
        american_indian_alaska_native: '#ef4444',
        asian: '#f59e0b',
        black_african_american: '#10b981',
        native_hawaiian_pacific_islander: '#3b82f6',
        white: '#8b5cf6',
        more_than_one_race: '#ec4899',
        unknown_not_reported: '#6b7280',
        other: '#1d1d1d'
    },
    ethnicity: {
        hispanic_latino: '#f59e0b',
        not_hispanic_latino: '#3b82f6',
        unknown_not_reported: '#6b7280'
    },
    sex: {
        female: '#ec4899',
        male: '#3b82f6',
        unknown: '#6b7280'
    },
    gender: {
        woman: '#ec4899',
        man: '#3b82f6',
        nonbinary: '#8b5cf6',
        transgender: '#f97316',
        other: '#f59e0b',
        unknown: '#6b7280'
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

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    try {
        updateLoadingProgress(5, 'Loading condition ontology...');
        await loadConditionOntology();
        updateLoadingProgress(10, 'Fetching clinical trial data...');
        await loadData();
        updateLoadingProgress(80, 'Initializing dashboard...');
        initTabs();
        initFilters();
        initSubcategoryButtons();
        initTable();
        initGeographyTab();
        populatePrimaryConditionDropdown();
        updateLoadingProgress(90, 'Rendering charts...');
        renderDashboard();

        // Hide loading overlay after everything is initialized and rendered
        hideLoadingOverlay();

        initHistorySelector();   // populate archive dropdown (non-blocking; runs after first render)
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

// Decompress a single .json.gz response body and return parsed JSON.
async function fetchAndDecompress(url) {
    console.log(`Fetching: ${url}`);
    const cacheBust = new Date().getTime();
    const response = await fetch(`${url}?v=${cacheBust}`);
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
function getUrlStrategies(date) {
    const parts8 = partFiles(8);

    // Latest data: local relative paths
    if (!date || date === 'latest') {
        return [
            { name: 'Local', urls: parts8.map(f => `data/${f}`) }
        ];
    }

    // Historical data: served from snapshots/ directory on GitHub Pages (same origin)
    return [
        {
            name: 'Snapshot',
            urls: parts8.map(f => `snapshots/${date}/${f}`)
        },
        // Fall back to latest local data
        {
            name: 'Local (fallback)',
            urls: parts8.map(f => `data/${f}`)
        }
    ];
}

async function loadData(date) {
    const cacheKey = date || 'latest';

    // ── Check snapshot cache first ──
    if (snapshotCache.has(cacheKey)) {
        const cached = snapshotCache.get(cacheKey);
        console.log(`⚡ Snapshot "${cacheKey}" loaded from cache (${cached.data.length} studies)`);
        data = cached.data;
        detailCache = {};
        detailsLoaded = false;
        studiesTabReady = false;
        document.getElementById('last-updated').textContent = cached.dateLabel;
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

            // Fetch all parts in parallel
            const promises = strategy.urls.map((url, i) => {
                updateLoadingProgress(
                    15 + Math.round((i / numParts) * 50),
                    `Downloading dataset part ${i + 1} of ${numParts}...`
                );
                return fetchAndDecompress(url);
            });

            const parts = await Promise.all(promises);

            updateLoadingProgress(70, 'Processing studies...');
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

            // ── Cache this snapshot for instant re-access ──
            snapshotCache.set(cacheKey, { data: data, dateLabel: fullDateLabel });
            console.log(`💾 Cached snapshot "${cacheKey}" (${data.length} studies)`);

            return; // Success!

        } catch (error) {
            console.warn(`✗ ${strategy.name} failed:`, error.message);
            lastError = error;
        }
    }

    // All strategies failed
    console.error('All fetch strategies failed:', lastError);
    document.getElementById('last-updated').textContent = 'Error loading data';

    document.querySelector('main').innerHTML = `
        <div class="chart-container">
            <h3>No Data Available</h3>
            <p class="note">Could not load data for ${date || 'latest'}.</p>
            <p class="note">Error: ${lastError?.message || 'Unknown error'}</p>
            <p class="note" style="font-size: 0.9em; color: #666;">
                Tried the following sources:<br>
                ${strategies.map(s => `- ${s.name}: ${s.urls[0]}`).join('<br>')}
            </p>
            ${date && date !== 'latest' ? `
            <p class="note">
                <button onclick="loadDataAndRender('latest')" style="padding: 0.5rem 1rem; cursor: pointer; background: var(--primary-color); color: white; border: none; border-radius: 4px;">
                    Load Latest Data Instead
                </button>
            </p>` : ''}
        </div>
    `;
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
            if (isCached) {
                showToast(`Loaded ${chosen === 'latest' ? 'latest' : chosen} snapshot from cache`, 'info', 2000);
            }
        } catch (err) {
            console.error('Snapshot switch failed:', err);
            showToast(`Snapshot data unavailable for ${chosen}. Reverting to previous view.`, 'error');
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

function initTabs() {
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

            tab.classList.add('active');
            document.getElementById(tab.dataset.tab).classList.add('active');

            // Hide filters on FAQ, About, and AI Devices tabs
            const filtersSection = document.getElementById('filters');
            const noFilterTabs = ['faq', 'about', 'ai-devices', 'fda-extraction', 'lit-extraction'];
            if (noFilterTabs.includes(tab.dataset.tab)) {
                filtersSection.style.display = 'none';
            } else {
                filtersSection.style.display = '';
            }

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
        });
    });
}

function initFilters() {
    // Populate condition and country dropdowns
    populateConditionsDropdown();
    populateCountriesDropdown();

    const filterIds = [
        'year-start', 'year-end', 'study-type', 'phase', 'sponsor-class',
        'intervention-model', 'masking', 'primary-purpose',
        'enrollment-type', 'healthy-volunteers', 'population-age', 'condition', 'condition-primary', 'condition-secondary', 'country'
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

function initTable() {
    // Table search
    const tableSearch = document.getElementById('study-table-search');
    if (tableSearch) {
        tableSearch.addEventListener('input', () => {
            currentPage = 0;
            renderStudiesTable();
        });
    }

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

function renderDashboard() {
    if (!data) return;

    showDashboardSpinner();
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

    // Render charts
    renderReportingTrends(filtered);
    renderRaceDistribution(filtered);
    renderRaceTrends(filtered);
    renderRaceSubcategories('asian');
    renderRaceReportedParticipants(filtered);
    renderRaceFullDistribution(filtered);
    renderEthnicityDistribution(filtered);
    renderEthnicityTrends(filtered);
    renderEthnicitySubcategories(filtered);
    renderEthnicityReportedParticipants(filtered);
    renderEthnicityFullDistribution(filtered);
    renderSexReportedParticipants(filtered);
    renderSexFullDistribution(filtered);
    renderSexDistribution(filtered);
    renderSexTrends(filtered);
    renderGenderReportedParticipants(filtered);
    renderGenderFullDistribution(filtered);
    renderGenderDistribution(filtered);
    renderGenderTrends(filtered);

    // Render Geography dashboard
    renderGeographyDashboard();

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

        return diffDays >= 0 ? diffDays : null;
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
    if (days === null || days === undefined || days < 0) {
        return '<span class="text-muted">N/A</span>';
    }

    // Calculate bar width (0-100px range, max at 730 days = 2 years)
    const maxDays = 730;
    const widthPercent = Math.min((days / maxDays) * 100, 100);

    // Determine color class based on thresholds
    let colorClass = 'fast';
    if (days > 365) {
        colorClass = 'slow'; // > 1 year: red
    } else if (days > 180) {
        colorClass = 'medium'; // 6 months - 1 year: orange
    } // < 6 months: green

    return `
        <div class="sparkline-cell">
            <div class="sparkline-bar ${colorClass}" style="width: ${widthPercent}px" title="${days} days"></div>
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
    const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
    currentPage = Math.max(0, Math.min(currentPage, totalPages - 1));
    const pageStart = currentPage * PAGE_SIZE;
    const pageData = filtered.slice(pageStart, pageStart + PAGE_SIZE);

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
            <td>
                <a href="https://clinicaltrials.gov/study/${study.nct_id}"
                   target="_blank"
                   class="nct-link">${study.nct_id}</a>
            </td>
            <td class="col-title">${escapeHtml(study.brief_title || 'Untitled')}</td>
            <td>${resultsDate}</td>
            <td class="text-center">
                <button class="details-btn" onclick="showStudyDetails('${study.nct_id}')" title="View full study details">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M8 4.5a.5.5 0 0 1 .5.5v3h3a.5.5 0 0 1 0 1h-3v3a.5.5 0 0 1-1 0v-3h-3a.5.5 0 0 1 0-1h3v-3A.5.5 0 0 1 8 4.5z"/>
                    </svg>
                </button>
            </td>
            <td class="text-center">${renderDemographicCell(study, 'race')}</td>
            <td class="text-center">${renderDemographicCell(study, 'ethnicity')}</td>
            <td class="text-center">${renderDemographicCell(study, 'sex')}</td>
            <td class="text-center">${renderDemographicCell(study, 'gender')}</td>
            <td class="text-center">${renderGeographyCell(study)}</td>
            <td class="text-right">${enrollmentBadge}</td>
            <td>${startDate}</td>
            <td>${endDate}</td>
            <td><span class="phase-badge">${study.phase || '\u2014'}</span></td>
            <td class="col-publications">${renderPublications(study)}</td>
        </tr>
        `;
    }).join('');

    // Update count
    if (countSpan) {
        if (totalCount === 0) {
            countSpan.textContent = 'No studies found';
        } else {
            const end = Math.min(pageStart + PAGE_SIZE, totalCount);
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
    function updateArrows() {
        const maxScroll = wrapper.scrollWidth - wrapper.clientWidth;
        btnLeft.classList.toggle('hidden', wrapper.scrollLeft <= 0);
        btnRight.classList.toggle('hidden', wrapper.scrollLeft >= maxScroll - 1);
    }

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

    // Initial arrow state
    updateArrows();
}

// Backward compat — old call sites invoke fixTableScroll()
let _tableScrollInitialized = false;
function fixTableScroll() {
    if (!_tableScrollInitialized) {
        _tableScrollInitialized = true;
        initTableScroll();
    } else {
        // Just update arrows on re-render
        const wrapper = document.getElementById('studies-table-wrapper');
        const btnLeft = document.getElementById('table-scroll-left');
        const btnRight = document.getElementById('table-scroll-right');
        if (wrapper && btnLeft && btnRight) {
            const maxScroll = wrapper.scrollWidth - wrapper.clientWidth;
            btnLeft.classList.toggle('hidden', wrapper.scrollLeft <= 0);
            btnRight.classList.toggle('hidden', wrapper.scrollLeft >= maxScroll - 1);
        }
    }
}

function renderPagination(total) {
    const container = document.getElementById('pagination');
    if (!container) return;

    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
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
    const hasGeo = sites.length > 0 || countries.length > 0;

    if (!hasGeo) {
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
        const reportedSet = new Set(rawCategories.map(rc => rc.omb_category));

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
            const originalLabels = [...new Set(matching.map(rc => rc.original))].join(', ');
            const bestConfidence = matching.some(rc => rc.confidence === 'high')   ? 'high'   :
                                   matching.some(rc => rc.confidence === 'medium') ? 'medium' : 'low';
            const hasFuzzy       = matching.some(rc => rc.flags?.some(f => f.includes('fuzzy_match')));
            const hasUnmapped    = matching.some(rc => rc.flags?.includes('unmapped'));

            let matchQuality = '';
            if (bestConfidence === 'high') {
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
            const otherLabels = [...new Set(otherRaw.map(rc => rc.original))].join(', ');
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
                : displayName;
            const bestConfidence = matching.some(rc => rc.confidence === 'high') ? 'high' :
                                   matching.some(rc => rc.confidence === 'medium') ? 'medium' : 'low';
            const hasFuzzy = matching.some(rc => rc.flags?.some(f => f.includes('fuzzy_match')));
            const hasUnmapped = matching.some(rc => rc.flags?.includes('unmapped'));

            let matchQuality = '';
            if (bestConfidence === 'high') {
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

    const byYear = {};
    filtered.forEach(study => {
        const year = study.results_date?.substring(0, 4);
        if (!year) return;

        if (!byYear[year]) {
            byYear[year] = { total: 0, race: 0, ethnicity: 0, both: 0 };
        }
        byYear[year].total++;
        if (study.race?.reported) byYear[year].race++;
        if (study.ethnicity?.reported) byYear[year].ethnicity++;
        if (study.race?.reported && study.ethnicity?.reported) byYear[year].both++;
    });

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
                    borderColor: '#10b981',
                    backgroundColor: 'rgba(16, 185, 129, 0.1)',
                    tension: 0.3
                },
                {
                    label: 'Ethnicity',
                    data: years.map(y => (byYear[y].ethnicity / byYear[y].total) * 100),
                    borderColor: '#f59e0b',
                    backgroundColor: 'rgba(245, 158, 11, 0.1)',
                    tension: 0.3
                },
                {
                    label: 'Both',
                    data: years.map(y => (byYear[y].both / byYear[y].total) * 100),
                    borderColor: '#3b82f6',
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    tension: 0.3
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
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

    const totals = {
        'American Indian/Alaska Native': 0,
        'Asian': 0,
        'Black/African American': 0,
        'Native Hawaiian/Pacific Islander': 0,
        'White': 0,
        'More than one race': 0,
        'Unknown': 0,
        'Other': 0
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

    if (charts.raceDistribution) charts.raceDistribution.destroy();

    charts.raceDistribution = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: Object.keys(totals),
            datasets: [{
                data: Object.values(totals),
                backgroundColor: Object.values(COLORS.race)
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: { position: 'right' },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const total = context.dataset.data.reduce((a, b) => a + b, 0);
                            const pct = total > 0 ? ((context.parsed / total) * 100).toFixed(1) : '0.0';
                            return ` ${context.parsed.toLocaleString()} participants (${pct}%)`;
                        }
                    }
                }
            }
        }
    });
}

function renderRaceTrends(filtered) {
    const ctx = document.getElementById('race-trends-chart');
    if (!ctx) return;

    const byYear = {};
    filtered.forEach(study => {
        const year = study.results_date?.substring(0, 4);
        if (!year || !study.race?.reported) return;

        if (!byYear[year]) {
            byYear[year] = { total: 0, white: 0, black: 0, asian: 0, other: 0 };
        }

        const omb = study.race.omb_totals;
        const studyTotal = Object.values(omb).reduce((a, b) => a + b, 0);

        if (studyTotal > 0) {
            byYear[year].total++;
            byYear[year].white += (omb.white || 0) / studyTotal;
            byYear[year].black += (omb.black_african_american || 0) / studyTotal;
            byYear[year].asian += (omb.asian || 0) / studyTotal;
        }
    });

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
                    borderColor: COLORS.race.white,
                    backgroundColor: COLORS.race.white + '20',
                    tension: 0.3
                },
                {
                    label: 'Black/African American',
                    data: years.map(y => byYear[y].total > 0 ? (byYear[y].black / byYear[y].total) * 100 : 0),
                    borderColor: COLORS.race.black_african_american,
                    backgroundColor: COLORS.race.black_african_american + '20',
                    tension: 0.3
                },
                {
                    label: 'Asian',
                    data: years.map(y => byYear[y].total > 0 ? (byYear[y].asian / byYear[y].total) * 100 : 0),
                    borderColor: COLORS.race.asian,
                    backgroundColor: COLORS.race.asian + '20',
                    tension: 0.3
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            scales: {
                y: {
                    beginAtZero: true,
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

    const filtered = getFilteredData();
    const subcategories = {};

    filtered.forEach(study => {
        if (!study.race?.reported) return;

        Object.entries(study.race.subcategory_totals || {}).forEach(([key, count]) => {
            if (category === 'asian' && key.startsWith('asian_')) {
                subcategories[key] = (subcategories[key] || 0) + count;
            } else if (category === 'black' && key.startsWith('black_')) {
                subcategories[key] = (subcategories[key] || 0) + count;
            } else if (category === 'white' && key.startsWith('white_')) {
                subcategories[key] = (subcategories[key] || 0) + count;
            }
        });
    });

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
                backgroundColor: '#3b82f6'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
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

    const totals = {
        'Hispanic/Latino': 0,
        'Not Hispanic/Latino': 0,
        'Unknown': 0
    };

    filtered.forEach(study => {
        if (!study.ethnicity?.reported) return;
        const omb = study.ethnicity.omb_totals;
        totals['Hispanic/Latino'] += omb.hispanic_latino || 0;
        totals['Not Hispanic/Latino'] += omb.not_hispanic_latino || 0;
        totals['Unknown'] += omb.unknown_not_reported || 0;
    });

    if (charts.ethnicityDistribution) charts.ethnicityDistribution.destroy();

    charts.ethnicityDistribution = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: Object.keys(totals),
            datasets: [{
                data: Object.values(totals),
                backgroundColor: Object.values(COLORS.ethnicity)
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: { position: 'right' },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const total = context.dataset.data.reduce((a, b) => a + b, 0);
                            const pct = total > 0 ? ((context.parsed / total) * 100).toFixed(1) : '0.0';
                            return ` ${context.parsed.toLocaleString()} participants (${pct}%)`;
                        }
                    }
                }
            }
        }
    });
}

function renderEthnicityTrends(filtered) {
    const ctx = document.getElementById('ethnicity-trends-chart');
    if (!ctx) return;

    const byYear = {};
    filtered.forEach(study => {
        const year = study.results_date?.substring(0, 4);
        if (!year || !study.ethnicity?.reported) return;

        if (!byYear[year]) {
            byYear[year] = { total: 0, hispanic: 0 };
        }

        const omb = study.ethnicity.omb_totals;
        const studyTotal = Object.values(omb).reduce((a, b) => a + b, 0);

        if (studyTotal > 0) {
            byYear[year].total++;
            byYear[year].hispanic += (omb.hispanic_latino || 0) / studyTotal;
        }
    });

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
            scales: {
                y: {
                    beginAtZero: true,
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

    const subcategories = {};

    filtered.forEach(study => {
        if (!study.ethnicity?.reported) return;

        Object.entries(study.ethnicity.subcategory_totals || {}).forEach(([key, count]) => {
            subcategories[key] = (subcategories[key] || 0) + count;
        });
    });

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
                backgroundColor: '#f59e0b'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
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

    const byYear = {};
    filtered.forEach(study => {
        const year = study.results_date?.substring(0, 4);
        if (!year || !study.race?.reported) return;

        if (!byYear[year]) {
            byYear[year] = 0;
        }

        const omb = study.race.omb_totals;
        // Sum all known categories (excluding unknown_not_reported)
        const knownTotal = (omb.american_indian_alaska_native || 0) +
                          (omb.asian || 0) +
                          (omb.black_african_american || 0) +
                          (omb.native_hawaiian_pacific_islander || 0) +
                          (omb.white || 0) +
                          (omb.more_than_one_race || 0) +
                          (omb.other || 0);

        byYear[year] += knownTotal;
    });

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
                backgroundColor: COLORS.race.asian + '80',
                borderColor: COLORS.race.asian,
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
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

    const byYear = {};
    filtered.forEach(study => {
        const year = study.results_date?.substring(0, 4);
        if (!year) return;

        if (!byYear[year]) {
            byYear[year] = {
                white: 0,
                black: 0,
                asian: 0,
                otherRaces: 0,           // Other known races (NOT including unknown)
                explicitUnknown: 0,       // Explicitly marked as "Unknown" in source
                totalEnrollment: 0
            };
        }

        const enrollment = study.enrollment || 0;
        byYear[year].totalEnrollment += enrollment;

        if (study.race?.reported) {
            const omb = study.race.omb_totals;
            byYear[year].white += omb.white || 0;
            byYear[year].black += omb.black_african_american || 0;
            byYear[year].asian += omb.asian || 0;
            // Other known races (excluding unknown_not_reported)
            byYear[year].otherRaces += (omb.american_indian_alaska_native || 0) +
                                       (omb.native_hawaiian_pacific_islander || 0) +
                                       (omb.more_than_one_race || 0) +
                                       (omb.other || 0);
            // Explicit Unknown - the NIH category
            byYear[year].explicitUnknown += omb.unknown_not_reported || 0;
        }
    });

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
            scales: {
                y: {
                    stacked: true,
                    min: 0,
                    max: 100,
                    title: { display: true, text: '% of Total Enrollment' }
                },
                x: {
                    stacked: true,
                    title: { display: true, text: 'Year' }
                }
            },
            plugins: {
                legend: {
                    position: 'right',
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

    const byYear = {};
    filtered.forEach(study => {
        const year = study.results_date?.substring(0, 4);
        if (!year || !study.ethnicity?.reported) return;

        if (!byYear[year]) {
            byYear[year] = 0;
        }

        const omb = study.ethnicity.omb_totals;
        // Sum known categories (excluding unknown_not_reported)
        const knownTotal = (omb.hispanic_latino || 0) + (omb.not_hispanic_latino || 0);

        byYear[year] += knownTotal;
    });

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

    const byYear = {};
    filtered.forEach(study => {
        const year = study.results_date?.substring(0, 4);
        if (!year) return;

        if (!byYear[year]) {
            byYear[year] = {
                hispanic: 0,
                notHispanic: 0,
                explicitUnknown: 0,       // Explicitly marked as "Unknown" in source
                totalEnrollment: 0
            };
        }

        const enrollment = study.enrollment || 0;
        byYear[year].totalEnrollment += enrollment;

        if (study.ethnicity?.reported) {
            const omb = study.ethnicity.omb_totals;
            byYear[year].hispanic += omb.hispanic_latino || 0;
            byYear[year].notHispanic += omb.not_hispanic_latino || 0;
            // Explicit Unknown - the NIH category
            byYear[year].explicitUnknown += omb.unknown_not_reported || 0;
        }
    });

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
            scales: {
                y: {
                    stacked: true,
                    min: 0,
                    max: 100,
                    title: { display: true, text: '% of Total Enrollment' }
                },
                x: {
                    stacked: true,
                    title: { display: true, text: 'Year' }
                }
            },
            plugins: {
                legend: {
                    position: 'right',
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

    const totals = { Female: 0, Male: 0, Unknown: 0 };

    filtered.forEach(study => {
        if (!study.sex?.reported) return;
        totals.Female += study.sex.totals.female || 0;
        totals.Male += study.sex.totals.male || 0;
        totals.Unknown += study.sex.totals.unknown || 0;
    });

    if (charts.sexDistribution) charts.sexDistribution.destroy();

    charts.sexDistribution = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: Object.keys(totals),
            datasets: [{
                data: Object.values(totals),
                backgroundColor: Object.values(COLORS.sex)
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: { position: 'right' },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const total = context.dataset.data.reduce((a, b) => a + b, 0);
                            const pct = total > 0 ? ((context.parsed / total) * 100).toFixed(1) : '0.0';
                            return ` ${context.parsed.toLocaleString()} participants (${pct}%)`;
                        }
                    }
                }
            }
        }
    });
}

function renderSexTrends(filtered) {
    const ctx = document.getElementById('sex-trends-chart');
    if (!ctx) return;

    const byYear = {};
    filtered.forEach(study => {
        const year = study.results_date?.substring(0, 4);
        if (!year || !study.sex?.reported) return;

        if (!byYear[year]) {
            byYear[year] = { total: 0, female: 0 };
        }

        const totals = study.sex.totals;
        const studyTotal = Object.values(totals).reduce((a, b) => a + b, 0);

        if (studyTotal > 0) {
            byYear[year].total++;
            byYear[year].female += (totals.female || 0) / studyTotal;
        }
    });

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

    const totals = { Woman: 0, Man: 0, 'Non-binary': 0, Transgender: 0, Other: 0, 'Unknown or Not Reported': 0 };

    filtered.forEach(study => {
        if (!study.gender?.reported) return;
        totals.Woman += study.gender.totals.woman || 0;
        totals.Man += study.gender.totals.man || 0;
        totals['Non-binary'] += study.gender.totals.nonbinary || 0;
        totals.Transgender += study.gender.totals.transgender || 0;
        totals.Other += study.gender.totals.other || 0;
        totals['Unknown or Not Reported'] += study.gender.totals.unknown || 0;
    });

    const genderColors = [COLORS.gender.woman, COLORS.gender.man, COLORS.gender.nonbinary, COLORS.gender.transgender, COLORS.gender.other, COLORS.gender.unknown];

    if (charts.genderDistribution) charts.genderDistribution.destroy();

    charts.genderDistribution = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: Object.keys(totals),
            datasets: [{
                data: Object.values(totals),
                backgroundColor: genderColors
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: { position: 'right' },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const total = context.dataset.data.reduce((a, b) => a + b, 0);
                            const pct = total > 0 ? ((context.parsed / total) * 100).toFixed(1) : '0.0';
                            return ` ${context.parsed.toLocaleString()} participants (${pct}%)`;
                        }
                    }
                }
            }
        }
    });
}

/**
 * Sex: Total Participants with Reported Sex Data per year
 */
function renderSexReportedParticipants(filtered) {
    const ctx = document.getElementById('sex-reported-participants-chart');
    if (!ctx) return;

    const byYear = {};
    filtered.forEach(study => {
        const year = study.results_date?.substring(0, 4);
        if (!year || !study.sex?.reported) return;

        if (!byYear[year]) byYear[year] = 0;

        const totals = study.sex.totals;
        const knownTotal = (totals.female || 0) + (totals.male || 0);
        byYear[year] += knownTotal;
    });

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

    const byYear = {};
    filtered.forEach(study => {
        const year = study.results_date?.substring(0, 4);
        if (!year) return;

        if (!byYear[year]) {
            byYear[year] = { female: 0, male: 0, explicitUnknown: 0, totalEnrollment: 0 };
        }

        const enrollment = study.enrollment || 0;
        byYear[year].totalEnrollment += enrollment;

        if (study.sex?.reported) {
            const totals = study.sex.totals;
            byYear[year].female += totals.female || 0;
            byYear[year].male += totals.male || 0;
            byYear[year].explicitUnknown += totals.unknown || 0;
        }
    });

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
            scales: {
                y: { stacked: true, min: 0, max: 100, title: { display: true, text: '% of Total Enrollment' } },
                x: { stacked: true, title: { display: true, text: 'Year' } }
            },
            plugins: {
                legend: { position: 'right', labels: { usePointStyle: true, padding: 12 } },
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

    const byYear = {};
    filtered.forEach(study => {
        const year = study.results_date?.substring(0, 4);
        if (!year || !study.gender?.reported) return;

        if (!byYear[year]) byYear[year] = 0;

        const totals = study.gender.totals;
        const knownTotal = (totals.woman || 0) + (totals.man || 0) + (totals.nonbinary || 0) + (totals.transgender || 0) + (totals.other || 0);
        byYear[year] += knownTotal;
    });

    const years = Object.keys(byYear).sort();

    if (charts.genderReportedParticipants) charts.genderReportedParticipants.destroy();

    charts.genderReportedParticipants = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: years,
            datasets: [{
                label: 'Participants with Known Gender',
                data: years.map(y => byYear[y]),
                backgroundColor: '#8b5cf680',
                borderColor: '#8b5cf6',
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
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

    const byYear = {};
    filtered.forEach(study => {
        const year = study.results_date?.substring(0, 4);
        if (!year) return;

        if (!byYear[year]) {
            byYear[year] = { woman: 0, man: 0, nonbinary: 0, transgender: 0, other: 0, explicitUnknown: 0, totalEnrollment: 0 };
        }

        const enrollment = study.enrollment || 0;
        byYear[year].totalEnrollment += enrollment;

        if (study.gender?.reported) {
            const totals = study.gender.totals;
            byYear[year].woman += totals.woman || 0;
            byYear[year].man += totals.man || 0;
            byYear[year].nonbinary += totals.nonbinary || 0;
            byYear[year].transgender += totals.transgender || 0;
            byYear[year].other += totals.other || 0;
            byYear[year].explicitUnknown += totals.unknown || 0;
        }
    });

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
            scales: {
                y: { stacked: true, min: 0, max: 100, title: { display: true, text: '% of Total Enrollment' } },
                x: { stacked: true, title: { display: true, text: 'Year' } }
            },
            plugins: {
                legend: { position: 'right', labels: { usePointStyle: true, padding: 12 } },
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

    const byYear = {};
    filtered.forEach(study => {
        const year = study.results_date?.substring(0, 4);
        if (!year || !study.gender?.reported) return;

        if (!byYear[year]) {
            byYear[year] = { count: 0, woman: 0, man: 0, nonbinary: 0, transgender: 0 };
        }

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

// ===== Geography Dashboard Functions =====

let geographyView = 'us'; // 'us' or 'international'
let geographySponsorFilter = 'all';
let sponsorCounts = {};

/**
 * Extract and count all sponsors from data
 * Counts organizations as either Lead Sponsor or Collaborator
 */
function getSponsorsFromData() {
    if (!data) return {};

    const counts = {};

    data.forEach(study => {
        // Count lead sponsor
        if (study.lead_sponsor) {
            const name = study.lead_sponsor;
            counts[name] = (counts[name] || 0) + 1;
        }

        // Count collaborators
        if (study.collaborators && Array.isArray(study.collaborators)) {
            study.collaborators.forEach(collab => {
                if (collab) {
                    counts[collab] = (counts[collab] || 0) + 1;
                }
            });
        }
    });

    return counts;
}

/**
 * Populate the geography sponsor dropdown with top 50 sponsors
 */
function populateGeographySponsorDropdown() {
    const dropdown = document.getElementById('geography-sponsor');
    if (!dropdown) return;

    sponsorCounts = getSponsorsFromData();

    // Sort by count and take top 50
    const sortedSponsors = Object.entries(sponsorCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 50);

    // Clear existing options except "All Sponsors"
    dropdown.innerHTML = '<option value="all">All Sponsors</option>';

    sortedSponsors.forEach(([name, count]) => {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = `${name} (${count.toLocaleString()} trials)`;
        dropdown.appendChild(option);
    });
}

/**
 * Filter trials by selected sponsor
 */
function filterByGeographySponsor(studies) {
    if (geographySponsorFilter === 'all') return studies;

    return studies.filter(study => {
        // Check if lead sponsor matches
        if (study.lead_sponsor === geographySponsorFilter) return true;

        // Check if any collaborator matches
        if (study.collaborators && Array.isArray(study.collaborators)) {
            return study.collaborators.includes(geographySponsorFilter);
        }

        return false;
    });
}

/**
 * Classify trials by site count
 * @returns {Object} { singleSite: [], multiSite: [], notReported: [] }
 */
function classifyTrialsBySiteCount(studies) {
    const result = {
        singleSite: [],
        multiSite: [],
        notReported: []
    };

    studies.forEach(study => {
        const locations = study.countries || [];

        if (!locations || locations.length === 0) {
            result.notReported.push(study);
        } else if (locations.length === 1) {
            result.singleSite.push(study);
        } else {
            result.multiSite.push(study);
        }
    });

    return result;
}

/**
 * Aggregate geography data with city-level details
 * Uses study_sites (new format) if available, falls back to countries (old format)
 * @param {string} view - 'us' or 'international'
 * @returns {Object} For US: { [state]: { count, cities: { [city]: count }, trials: [] } }
 *                   For international: { [country]: count }
 */

// US State abbreviation to name mapping (moved here for use by normalizeStateName)
const stateNameToAbbr = {
    'Alabama': 'AL', 'Alaska': 'AK', 'Arizona': 'AZ', 'Arkansas': 'AR', 'California': 'CA',
    'Colorado': 'CO', 'Connecticut': 'CT', 'Delaware': 'DE', 'Florida': 'FL', 'Georgia': 'GA',
    'Hawaii': 'HI', 'Idaho': 'ID', 'Illinois': 'IL', 'Indiana': 'IN', 'Iowa': 'IA',
    'Kansas': 'KS', 'Kentucky': 'KY', 'Louisiana': 'LA', 'Maine': 'ME', 'Maryland': 'MD',
    'Massachusetts': 'MA', 'Michigan': 'MI', 'Minnesota': 'MN', 'Mississippi': 'MS', 'Missouri': 'MO',
    'Montana': 'MT', 'Nebraska': 'NE', 'Nevada': 'NV', 'New Hampshire': 'NH', 'New Jersey': 'NJ',
    'New Mexico': 'NM', 'New York': 'NY', 'North Carolina': 'NC', 'North Dakota': 'ND', 'Ohio': 'OH',
    'Oklahoma': 'OK', 'Oregon': 'OR', 'Pennsylvania': 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC',
    'South Dakota': 'SD', 'Tennessee': 'TN', 'Texas': 'TX', 'Utah': 'UT', 'Vermont': 'VT',
    'Virginia': 'VA', 'Washington': 'WA', 'West Virginia': 'WV', 'Wisconsin': 'WI', 'Wyoming': 'WY',
    'District of Columbia': 'DC', 'Puerto Rico': 'PR'
};

const abbrToStateName = Object.fromEntries(Object.entries(stateNameToAbbr).map(([k, v]) => [v, k]));

// US Census Regions mapping
const stateToRegion = {
    // Northeast
    'Connecticut': 'Northeast', 'Maine': 'Northeast', 'Massachusetts': 'Northeast',
    'New Hampshire': 'Northeast', 'Rhode Island': 'Northeast', 'Vermont': 'Northeast',
    'New Jersey': 'Northeast', 'New York': 'Northeast', 'Pennsylvania': 'Northeast',
    // Midwest
    'Illinois': 'Midwest', 'Indiana': 'Midwest', 'Michigan': 'Midwest', 'Ohio': 'Midwest',
    'Wisconsin': 'Midwest', 'Iowa': 'Midwest', 'Kansas': 'Midwest', 'Minnesota': 'Midwest',
    'Missouri': 'Midwest', 'Nebraska': 'Midwest', 'North Dakota': 'Midwest', 'South Dakota': 'Midwest',
    // South
    'Delaware': 'South', 'Florida': 'South', 'Georgia': 'South', 'Maryland': 'South',
    'North Carolina': 'South', 'South Carolina': 'South', 'Virginia': 'South',
    'District of Columbia': 'South', 'West Virginia': 'South', 'Alabama': 'South',
    'Kentucky': 'South', 'Mississippi': 'South', 'Tennessee': 'South', 'Arkansas': 'South',
    'Louisiana': 'South', 'Oklahoma': 'South', 'Texas': 'South',
    // West
    'Arizona': 'West', 'Colorado': 'West', 'Idaho': 'West', 'Montana': 'West',
    'Nevada': 'West', 'New Mexico': 'West', 'Utah': 'West', 'Wyoming': 'West',
    'Alaska': 'West', 'California': 'West', 'Hawaii': 'West', 'Oregon': 'West', 'Washington': 'West',
    // Territories
    'Puerto Rico': 'Territories'
};

const regionColors = {
    'Northeast': '#0d9488',  // Teal
    'Midwest': '#6366f1',    // Indigo
    'South': '#f59e0b',      // Amber
    'West': '#ef4444',       // Red
    'Territories': '#8b5cf6' // Violet
};

// FIPS code to state name mapping (used by TopoJSON features)
const fipsToStateName = {
    '01': 'Alabama', '02': 'Alaska', '04': 'Arizona', '05': 'Arkansas', '06': 'California',
    '08': 'Colorado', '09': 'Connecticut', '10': 'Delaware', '11': 'District of Columbia',
    '12': 'Florida', '13': 'Georgia', '15': 'Hawaii', '16': 'Idaho', '17': 'Illinois',
    '18': 'Indiana', '19': 'Iowa', '20': 'Kansas', '21': 'Kentucky', '22': 'Louisiana',
    '23': 'Maine', '24': 'Maryland', '25': 'Massachusetts', '26': 'Michigan', '27': 'Minnesota',
    '28': 'Mississippi', '29': 'Missouri', '30': 'Montana', '31': 'Nebraska', '32': 'Nevada',
    '33': 'New Hampshire', '34': 'New Jersey', '35': 'New Mexico', '36': 'New York',
    '37': 'North Carolina', '38': 'North Dakota', '39': 'Ohio', '40': 'Oklahoma',
    '41': 'Oregon', '42': 'Pennsylvania', '44': 'Rhode Island', '45': 'South Carolina',
    '46': 'South Dakota', '47': 'Tennessee', '48': 'Texas', '49': 'Utah', '50': 'Vermont',
    '51': 'Virginia', '53': 'Washington', '54': 'West Virginia', '55': 'Wisconsin',
    '56': 'Wyoming', '72': 'Puerto Rico'
};

// Stored TopoJSON topology and derived GeoJSON features + path generator
let usTopology = null;
let usGeoFeatures = null;
let geoPathGenerator = null;

/**
 * Normalize state name - handles both abbreviations and full names
 */
function normalizeStateName(stateInput) {
    if (!stateInput) return null;
    const trimmed = stateInput.trim();

    // Check if it's already a full state name
    if (stateNameToAbbr[trimmed]) {
        return trimmed;
    }

    // Check if it's an abbreviation
    const upperAbbr = trimmed.toUpperCase();
    if (abbrToStateName[upperAbbr]) {
        return abbrToStateName[upperAbbr];
    }

    // Try case-insensitive match for full state names
    const lowerInput = trimmed.toLowerCase();
    for (const [fullName, abbr] of Object.entries(stateNameToAbbr)) {
        if (fullName.toLowerCase() === lowerInput) {
            return fullName;
        }
    }

    return null; // Not a recognized US state
}

function aggregateGeography(studies, view) {
    if (view === 'us') {
        const stateData = {};
        const seenStudyStates = new Map(); // Track study-state pairs to avoid duplicates
        const seenStudyCities = new Map(); // Track study-city pairs to avoid duplicates

        studies.forEach(study => {
            // Prefer study_sites (new format) over countries (old format)
            const locations = study.study_sites || study.countries || [];
            const studyId = study.nct_id || study.brief_title || JSON.stringify(study).slice(0, 100);

            locations.forEach(loc => {
                if (!loc || !loc.country) return;

                // Handle both "United States" and "USA" country names
                const isUS = loc.country === 'United States' || loc.country === 'USA' || loc.country === 'US';

                if (isUS && loc.state) {
                    // Normalize state name (handles abbreviations and full names)
                    const stateName = normalizeStateName(loc.state);
                    if (!stateName) return; // Skip unrecognized states

                    const city = loc.city || 'Unknown City';

                    // Create unique key for this study-state combination
                    const studyStateKey = `${studyId}-${stateName}`;

                    if (!stateData[stateName]) {
                        stateData[stateName] = { count: 0, cities: {}, trials: [], facilities: {} };
                    }

                    // Only count each study once per state (avoid duplicate counting from multiple sites)
                    if (!seenStudyStates.has(studyStateKey)) {
                        seenStudyStates.set(studyStateKey, true);
                        stateData[stateName].count++;
                        stateData[stateName].trials.push(study);
                    }

                    // Track cities: deduplicate so each study is counted once per city
                    if (!stateData[stateName].cities[city]) {
                        stateData[stateName].cities[city] = { count: 0, studies: [] };
                    }
                    const studyCityKey = `${studyId}-${stateName}-${city}`;
                    if (!seenStudyCities.has(studyCityKey)) {
                        seenStudyCities.set(studyCityKey, true);
                        stateData[stateName].cities[city].count++;
                        if (study.nct_id) {
                            stateData[stateName].cities[city].studies.push({
                                nctId: study.nct_id,
                                briefTitle: study.brief_title || 'Untitled Study',
                                enrollment: study.enrollment || 0,
                                studyUrl: `https://clinicaltrials.gov/study/${study.nct_id}`
                            });
                        }
                    }

                    // Track facilities if available
                    if (loc.facility) {
                        stateData[stateName].facilities[loc.facility] = (stateData[stateName].facilities[loc.facility] || 0) + 1;
                    }
                }
            });
        });

        return stateData;
    } else {
        const counts = {};

        studies.forEach(study => {
            // Prefer study_sites (new format) over countries (old format)
            const locations = study.study_sites || study.countries || [];

            locations.forEach(loc => {
                if (!loc || !loc.country) return;

                if (loc.country !== 'United States') {
                    counts[loc.country] = (counts[loc.country] || 0) + 1;
                }
            });
        });

        return counts;
    }
}

// Current map layer selection
let currentMapLayer = 'volume';
let currentStateData = {};
let selectedState = null;

/**
 * Check if a trial reports race data
 */
function trialReportsRace(study) {
    return !!study.race?.reported;
}

/**
 * Check if a trial reports ethnicity data
 */
function trialReportsEthnicity(study) {
    return !!study.ethnicity?.reported;
}

/**
 * Check if a trial reports sex data
 */
function trialReportsSex(study) {
    return !!study.sex?.reported;
}

/**
 * Check if a trial reports gender data
 */
function trialReportsGender(study) {
    return !!study.gender?.reported;
}

/**
 * Calculate reporting percentage for a set of trials
 */
function calculateReportingPercentage(trials, reportingFn) {
    if (trials.length === 0) return 0;
    const reporting = trials.filter(reportingFn).length;
    return (reporting / trials.length) * 100;
}

/**
 * Get value for a state based on current layer
 */
function getStateValue(stateInfo) {
    if (!stateInfo || !stateInfo.trials) return 0;

    switch (currentMapLayer) {
        case 'volume':
            return stateInfo.count || 0;
        case 'race':
            return calculateReportingPercentage(stateInfo.trials, trialReportsRace);
        case 'ethnicity':
            return calculateReportingPercentage(stateInfo.trials, trialReportsEthnicity);
        case 'sex':
            return calculateReportingPercentage(stateInfo.trials, trialReportsSex);
        case 'gender':
            return calculateReportingPercentage(stateInfo.trials, trialReportsGender);
        default:
            return stateInfo.count || 0;
    }
}

/**
 * Get color for choropleth based on value and range
 */
function getChoroplethColor(value, minVal, maxVal) {
    if (value === 0) return '#f3f4f6'; // Light gray for no data

    // Normalize value to 0-1 range, clamped to prevent out-of-bounds
    const range = maxVal - minVal;
    const normalized = range > 0 ? Math.max(0, Math.min(1, (value - minVal) / range)) : 0;

    // High-contrast multi-hue gradient: light yellow → green → deep teal
    const colors = [
        { r: 255, g: 255, b: 229 }, // #ffffe5 - pale yellow
        { r: 247, g: 252, b: 185 }, // #f7fcb9 - light yellow-green
        { r: 194, g: 230, b: 153 }, // #c2e699 - yellow-green
        { r: 120, g: 198, b: 121 }, // #78c679 - light green
        { r: 49, g: 163, b: 84 },   // #31a354 - medium green
        { r: 0, g: 109, b: 44 },    // #006d2c - dark green
        { r: 0, g: 68, b: 27 }      // #00441b - deepest green
    ];

    // Find the two colors to interpolate between
    const segment = normalized * (colors.length - 1);
    const index = Math.min(Math.floor(segment), colors.length - 2);
    const t = segment - index;

    const c1 = colors[index];
    const c2 = colors[index + 1];

    const r = Math.round(c1.r + (c2.r - c1.r) * t);
    const g = Math.round(c1.g + (c2.g - c1.g) * t);
    const b = Math.round(c1.b + (c2.b - c1.b) * t);

    return `rgb(${r}, ${g}, ${b})`;
}

// D3 map state variables
let mapSvg = null;
let mapG = null;
let currentZoomTransform = null;
let isZoomedIn = false;
let regionalChart = null;

/**
 * Initialize the US Map with D3 - fetches TopoJSON and sets up SVG
 */
async function initUSMap() {
    const container = document.getElementById('us-map-container');
    if (!container) return;

    // Clear any existing content
    container.innerHTML = '';

    // Use a fixed viewBox so the map scales consistently via CSS (width:100%; height:auto)
    // The aspect ratio ~1.6:1 matches the Albers USA projection bounding box
    const viewW = 975;
    const viewH = 610;

    // Create SVG with D3
    mapSvg = d3.select(container)
        .append('svg')
        .attr('viewBox', `0 0 ${viewW} ${viewH}`)
        .attr('preserveAspectRatio', 'xMidYMid meet')
        .attr('class', 'us-map-svg');

    // Create main group for states (will be transformed on zoom)
    mapG = mapSvg.append('g').attr('class', 'states-group');

    // Fetch TopoJSON if not already loaded
    if (!usTopology) {
        try {
            usTopology = await d3.json('https://cdn.jsdelivr.net/npm/us-atlas@3/states-albers-10m.json');
            const statesGeo = topojson.feature(usTopology, usTopology.objects.states);

            // Attach state name and abbreviation to each feature
            statesGeo.features.forEach(f => {
                const fips = String(f.id).padStart(2, '0');
                f.properties.name = fipsToStateName[fips] || '';
                f.properties.abbr = stateNameToAbbr[f.properties.name] || '';
            });

            usGeoFeatures = statesGeo;
        } catch (err) {
            console.error('Failed to load US TopoJSON:', err);
            return;
        }
    }

    // Pre-projected Albers TopoJSON already has Y in screen space (top-down),
    // so no reflectY needed. fitSize scales coordinates to fill the viewBox.
    const projection = d3.geoIdentity()
        .fitSize([viewW, viewH], usGeoFeatures);
    geoPathGenerator = d3.geoPath(projection);

    // Initial render
    renderUSMap();

    // Setup reset button listener
    const resetBtn = document.getElementById('reset-zoom-btn');
    if (resetBtn) {
        resetBtn.addEventListener('click', resetMapZoom);
    }

    // Setup close detail button
    const closeBtn = document.getElementById('close-state-detail');
    if (closeBtn) {
        closeBtn.addEventListener('click', closeStateDetail);
    }
}

/**
 * Render the US Map with choropleth coloring using D3 + TopoJSON
 */
function renderUSMap() {
    if (!mapG || !usGeoFeatures || !geoPathGenerator) {
        initUSMap();
        return;
    }

    // Calculate min/max values for current layer
    const values = Object.keys(currentStateData).map(state => getStateValue(currentStateData[state]));
    const positiveValues = values.filter(v => v > 0);
    let minVal, maxVal;
    if (currentMapLayer === 'volume') {
        // For volume, use 0 as floor
        minVal = 0;
        maxVal = Math.max(...values, 1);
    } else {
        // For reporting layers (race, ethnicity, sex), always use 0-100%
        // so the full color gradient is visible and differences are clear
        minVal = 0;
        maxVal = 100;
    }

    // Update legend
    updateMapLegend(minVal, maxVal);

    // Build data array from GeoJSON features
    const stateData = usGeoFeatures.features
        .filter(f => f.properties.name) // skip unknown FIPS
        .map(f => ({
            feature: f,
            abbr: f.properties.abbr,
            stateName: f.properties.name,
            stateInfo: currentStateData[f.properties.name]
        }));

    const paths = mapG.selectAll('path.state')
        .data(stateData, d => d.abbr);

    // Enter + Update
    paths.enter()
        .append('path')
        .attr('class', 'state')
        .attr('id', d => `state-${d.abbr}`)
        .attr('d', d => geoPathGenerator(d.feature))
        .attr('data-state', d => d.stateName)
        .attr('data-abbr', d => d.abbr)
        .on('mouseenter', handleStateMouseEnter)
        .on('mousemove', handleStateMouseMove)
        .on('mouseleave', handleStateMouseLeave)
        .on('click', handleStateClick)
        .merge(paths)
        .transition()
        .duration(300)
        .attr('d', d => geoPathGenerator(d.feature))
        .attr('fill', d => {
            const value = d.stateInfo ? getStateValue(d.stateInfo) : 0;
            return getChoroplethColor(value, minVal, maxVal);
        })
        .attr('class', d => `state ${selectedState === d.stateName ? 'selected' : ''}`);

    paths.exit().remove();

    // Render regional diversity chart
    renderRegionalChart();
}

/**
 * Update map legend values
 */
function updateMapLegend(minVal, maxVal) {
    const legendLow = document.getElementById('legend-low');
    const legendHigh = document.getElementById('legend-high');
    if (legendLow && legendHigh) {
        if (currentMapLayer === 'volume') {
            legendLow.textContent = '0';
            legendHigh.textContent = maxVal.toLocaleString();
        } else {
            // Show actual dynamic range for reporting layers
            legendLow.textContent = Math.round(minVal) + '%';
            legendHigh.textContent = Math.round(maxVal) + '%';
        }
    }
}

/**
 * Handle state mouse enter - show tooltip
 */
function handleStateMouseEnter(event, d) {
    const tooltip = document.getElementById('map-tooltip');
    if (!tooltip) return;

    const stateName = d.stateName;
    const stateInfo = d.stateInfo;
    const value = stateInfo ? getStateValue(stateInfo) : 0;
    const trialCount = stateInfo ? stateInfo.count : 0;

    let valueLabel, valueDisplay;
    if (currentMapLayer === 'volume') {
        valueLabel = 'Trials';
        valueDisplay = value.toLocaleString();
    } else {
        const layerNames = {
            'race': 'Race Reporting',
            'ethnicity': 'Ethnicity Reporting',
            'sex': 'Sex Reporting',
            'gender': 'Gender Reporting'
        };
        valueLabel = layerNames[currentMapLayer];
        valueDisplay = `${value.toFixed(1)}%`;
    }

    const cityCount = stateInfo && stateInfo.cities ? Object.keys(stateInfo.cities).length : 0;

    tooltip.innerHTML = `
        <div class="tooltip-title">${stateName}</div>
        <div class="tooltip-value">${valueLabel}: ${valueDisplay}</div>
        ${currentMapLayer !== 'volume' ? `<div>Total Trials: ${trialCount.toLocaleString()}</div>` : ''}
        ${cityCount > 0 ? `<div class="tooltip-hint">Click to zoom & see ${cityCount} cities</div>` : ''}
    `;
    tooltip.classList.add('visible');
}

/**
 * Handle state mouse move - update tooltip position
 */
function handleStateMouseMove(event) {
    const tooltip = document.getElementById('map-tooltip');
    if (!tooltip) return;

    const x = event.clientX + 15;
    const y = event.clientY + 15;

    // Keep tooltip within viewport
    const tooltipRect = tooltip.getBoundingClientRect();
    const maxX = window.innerWidth - tooltipRect.width - 10;
    const maxY = window.innerHeight - tooltipRect.height - 10;

    tooltip.style.left = `${Math.min(x, maxX)}px`;
    tooltip.style.top = `${Math.min(y, maxY)}px`;
}

/**
 * Handle state mouse leave - hide tooltip
 */
function handleStateMouseLeave() {
    const tooltip = document.getElementById('map-tooltip');
    if (tooltip) {
        tooltip.classList.remove('visible');
    }
}

/**
 * Handle state click - zoom to state and show cities
 */
function handleStateClick(event, d) {
    const stateName = d.stateName;
    const stateAbbr = d.abbr;
    const stateInfo = d.stateInfo;

    // If clicking the same state while zoomed, reset
    if (selectedState === stateName && isZoomedIn) {
        resetMapZoom();
        return;
    }

    // Update selected state
    selectedState = stateName;

    // Update state styling
    mapG.selectAll('path.state')
        .classed('selected', p => p.stateName === stateName)
        .classed('dimmed', p => p.stateName !== stateName);

    // Calculate zoom transform to center on the clicked state
    const statePath = document.getElementById(`state-${stateAbbr}`);
    if (statePath) {
        const bbox = statePath.getBBox();
        const svgEl = mapSvg.node();
        const vb = svgEl.viewBox.baseVal;
        const viewBoxWidth = vb.width;
        const viewBoxHeight = vb.height;

        // Calculate scale to fill ~80% of view
        const scale = Math.min(
            (viewBoxWidth * 0.8) / bbox.width,
            (viewBoxHeight * 0.8) / bbox.height,
            4 // Max zoom level
        );

        // Calculate center of state
        const centerX = bbox.x + bbox.width / 2;
        const centerY = bbox.y + bbox.height / 2;

        // Calculate translation to center the state
        const translateX = viewBoxWidth / 2 - centerX * scale;
        const translateY = viewBoxHeight / 2 - centerY * scale;

        // Animate zoom with D3 transition
        const transform = d3.zoomIdentity
            .translate(translateX, translateY)
            .scale(scale);

        currentZoomTransform = transform;
        isZoomedIn = true;

        // Apply zoom transition to states group
        mapG.transition()
            .duration(750)
            .ease(d3.easeCubicInOut)
            .attr('transform', transform.toString());



        // Show reset button
        const resetBtn = document.getElementById('reset-zoom-btn');
        if (resetBtn) {
            resetBtn.style.display = 'inline-flex';
        }
    }

    // Update city breakdown table (without scroll)
    updateCityTable(stateName, stateInfo);
}

/**
 * Reset map zoom to full US view
 */
function resetMapZoom() {
    if (!mapG) return;

    // Reset state selection
    selectedState = null;
    isZoomedIn = false;
    currentZoomTransform = null;

    // Animate back to original view
    mapG.transition()
        .duration(750)
        .ease(d3.easeCubicInOut)
        .attr('transform', '');

    // Reset state styling
    mapG.selectAll('path.state')
        .classed('selected', false)
        .classed('dimmed', false);

    // Hide reset button
    const resetBtn = document.getElementById('reset-zoom-btn');
    if (resetBtn) {
        resetBtn.style.display = 'none';
    }

    // Hide detail table
    closeStateDetail();
}

/**
 * Update city breakdown table (without scrolling)
 */
function updateCityTable(stateName, stateInfo) {
    const detailRow = document.getElementById('state-detail-row');
    const title = document.getElementById('state-detail-title');
    const tbody = document.getElementById('city-table-body');
    const metricHeader = document.getElementById('city-metric-header');

    if (!detailRow || !tbody) return;

    if (!stateInfo || !stateInfo.cities || Object.keys(stateInfo.cities).length === 0) {
        detailRow.style.display = 'none';
        return;
    }

    // Update title
    if (title) {
        title.textContent = `Cities in ${stateName}`;
    }

    // Update metric header based on layer
    if (metricHeader) {
        if (currentMapLayer === 'volume') {
            metricHeader.textContent = 'Number of Trials';
        } else {
            const layerNames = {
                'race': 'Race Reporting %',
                'ethnicity': 'Ethnicity Reporting %',
                'sex': 'Sex Reporting %',
                'gender': 'Gender Reporting %'
            };
            metricHeader.textContent = layerNames[currentMapLayer];
        }
    }

    // Sort cities by count
    const sortedCities = Object.entries(stateInfo.cities)
        .sort((a, b) => b[1].count - a[1].count);

    // Use the deduplicated state trial count as denominator.
    // A trial can appear in multiple cities (multi-site), so city counts may
    // sum to more than the state total — each city's % reflects share of
    // unique state trials that have at least one site in that city.
    const totalInState = stateInfo.count || sortedCities.reduce((sum, [, info]) => sum + info.count, 0);

    tbody.innerHTML = '';

    sortedCities.forEach(([city, cityInfo], index) => {
        const count = cityInfo.count;
        const pct = totalInState > 0 ? ((count / totalInState) * 100).toFixed(1) : '0.0';

        // Master row
        const row = document.createElement('tr');
        row.classList.add('city-master-row');
        row.innerHTML = `
            <td>${index + 1}</td>
            <td>${escapeHtml(city)} <span class="expand-chevron">&#9660;</span></td>
            <td>${count.toLocaleString()}</td>
            <td>${pct}%</td>
        `;
        tbody.appendChild(row);

        // Detail row (hidden by default)
        const detailTr = document.createElement('tr');
        detailTr.classList.add('city-detail-row');
        detailTr.style.display = 'none';

        // Deduplicate and sort studies by enrollment descending, take top 5
        const seen = new Set();
        const topStudies = (cityInfo.studies || [])
            .filter(s => {
                if (seen.has(s.nctId)) return false;
                seen.add(s.nctId);
                return true;
            })
            .sort((a, b) => b.enrollment - a.enrollment)
            .slice(0, 5);

        const studyRows = topStudies.length > 0
            ? topStudies.map(s => `
                <tr>
                    <td><a href="${s.studyUrl}" target="_blank" rel="noopener" class="nct-link">${escapeHtml(s.nctId)}</a></td>
                    <td class="detail-title">${escapeHtml(s.briefTitle)}</td>
                    <td class="text-right">${s.enrollment.toLocaleString()}</td>
                </tr>
            `).join('')
            : '<tr><td colspan="3" style="text-align:center;color:#6b7280;">No study details available</td></tr>';

        detailTr.innerHTML = `
            <td colspan="4" class="detail-cell">
                <table class="detail-table">
                    <thead>
                        <tr>
                            <th>NCT ID</th>
                            <th>Title</th>
                            <th class="text-right">Enrollment</th>
                        </tr>
                    </thead>
                    <tbody>${studyRows}</tbody>
                </table>
            </td>
        `;
        tbody.appendChild(detailTr);

        // Toggle detail on master row click
        row.addEventListener('click', () => {
            const isVisible = detailTr.style.display !== 'none';
            detailTr.style.display = isVisible ? 'none' : 'table-row';
            row.classList.toggle('expanded', !isVisible);
        });
    });

    // Show detail section (no scroll - table updates silently)
    detailRow.style.display = 'block';
}

/**
 * Close state detail section
 */
function closeStateDetail() {
    const detailRow = document.getElementById('state-detail-row');
    if (detailRow) {
        detailRow.style.display = 'none';
    }
}

/**
 * Aggregate data by region for the regional chart
 */
function aggregateByRegion() {
    const regionData = {
        'Northeast': { count: 0, trials: [] },
        'Midwest': { count: 0, trials: [] },
        'South': { count: 0, trials: [] },
        'West': { count: 0, trials: [] }
    };

    for (const [stateName, stateInfo] of Object.entries(currentStateData)) {
        const region = stateToRegion[stateName];
        if (region && regionData[region] && stateInfo) {
            regionData[region].count += stateInfo.count || 0;
            if (stateInfo.trials) {
                regionData[region].trials.push(...stateInfo.trials);
            }
        }
    }

    return regionData;
}

/**
 * Render the Regional Diversity bar chart
 */
function renderRegionalChart() {
    const canvas = document.getElementById('regional-diversity-chart');
    if (!canvas) return;

    const regionData = aggregateByRegion();
    const totalTrials = Object.values(regionData).reduce((sum, r) => sum + r.count, 0);

    const labels = ['Northeast', 'Midwest', 'South', 'West'];
    const data = labels.map(r => regionData[r].count);
    const percentages = labels.map(r => totalTrials > 0 ? ((regionData[r].count / totalTrials) * 100).toFixed(1) : 0);
    const colors = labels.map(r => regionColors[r]);

    // Destroy existing chart if present
    if (regionalChart) {
        regionalChart.destroy();
    }

    // Create new chart
    regionalChart = new Chart(canvas, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Trials',
                data: data,
                backgroundColor: colors,
                borderColor: colors.map(c => c),
                borderWidth: 1,
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            indexAxis: 'y',
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const idx = context.dataIndex;
                            return `${data[idx].toLocaleString()} trials (${percentages[idx]}%)`;
                        }
                    }
                },
                datalabels: {
                    display: true,
                    anchor: 'end',
                    align: 'end',
                    color: '#64748b',
                    font: {
                        size: 11,
                        weight: '500'
                    },
                    formatter: function(value, context) {
                        const idx = context.dataIndex;
                        return `${percentages[idx]}%`;
                    }
                }
            },
            scales: {
                x: {
                    beginAtZero: true,
                    grid: {
                        display: true,
                        color: 'rgba(0,0,0,0.05)'
                    },
                    ticks: {
                        callback: function(value) {
                            return value.toLocaleString();
                        }
                    }
                },
                y: {
                    grid: {
                        display: false
                    }
                }
            }
        },
        plugins: [ChartDataLabels]
    });

    // Update region legend with counts
    const legendContainer = document.getElementById('region-legend');
    if (legendContainer) {
        legendContainer.innerHTML = labels.map(region => `
            <div class="region-legend-item">
                <span class="region-color" style="background: ${regionColors[region]}"></span>
                <span class="region-name">${region}</span>
                <span class="region-count">${regionData[region].count.toLocaleString()}</span>
            </div>
        `).join('');
    }
}

/**
 * Render the international geography table
 */
function renderInternationalTable(geoCounts) {
    const tbody = document.getElementById('geography-table-body');

    if (!tbody) return;

    // Sort by count (for international view, geoCounts is { country: count })
    const sorted = Object.entries(geoCounts)
        .sort((a, b) => b[1] - a[1]);

    // Denominator = sum of all country counts (site-level, not study-level)
    const totalIntlSiteCounts = sorted.reduce((sum, [, count]) => sum + count, 0);

    tbody.innerHTML = '';

    if (sorted.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 2rem;">No international location data available for current filters.</td></tr>';
        return;
    }

    sorted.forEach(([location, count], index) => {
        const pct = totalIntlSiteCounts > 0 ? ((count / totalIntlSiteCounts) * 100).toFixed(1) : '0.0';
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${index + 1}</td>
            <td>${location}</td>
            <td>${count.toLocaleString()}</td>
            <td>${pct}%</td>
        `;
        tbody.appendChild(row);
    });
}

/**
 * Render site distribution chart (pie/doughnut)
 */
function renderSiteDistributionChart(classification) {
    const ctx = document.getElementById('site-distribution-chart');
    if (!ctx) return;

    const chartData = {
        'Single-site': classification.singleSite.length,
        'Multi-site': classification.multiSite.length,
        'Not Reported': classification.notReported.length
    };

    if (charts.siteDistribution) charts.siteDistribution.destroy();

    charts.siteDistribution = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: Object.keys(chartData),
            datasets: [{
                data: Object.values(chartData),
                backgroundColor: ['#10b981', '#3b82f6', '#9ca3af'],
                borderWidth: 2,
                borderColor: '#ffffff'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: { position: 'right' },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const total = context.dataset.data.reduce((a, b) => a + b, 0);
                            const pct = total > 0 ? ((context.parsed / total) * 100).toFixed(1) : '0.0';
                            return ` ${context.label}: ${context.parsed.toLocaleString()} (${pct}%)`;
                        }
                    }
                }
            }
        }
    });
}

/**
 * Render geographic reporting trend over time
 */
function renderGeoReportingTrendChart(studies) {
    const ctx = document.getElementById('geo-reporting-trend-chart');
    if (!ctx) return;

    // Aggregate by year
    const byYear = {};
    studies.forEach(study => {
        const year = study.results_date?.substring(0, 4);
        if (!year) return;

        if (!byYear[year]) {
            byYear[year] = { total: 0, reported: 0 };
        }

        byYear[year].total++;

        const locations = study.countries || [];
        if (locations.length > 0) {
            byYear[year].reported++;
        }
    });

    const years = Object.keys(byYear).sort();
    const reportingPct = years.map(y => {
        const d = byYear[y];
        return d.total > 0 ? (d.reported / d.total) * 100 : 0;
    });

    if (charts.geoReportingTrend) charts.geoReportingTrend.destroy();

    charts.geoReportingTrend = new Chart(ctx, {
        type: 'line',
        data: {
            labels: years,
            datasets: [{
                label: '% Reporting Location',
                data: reportingPct,
                borderColor: '#1b4332',
                backgroundColor: 'rgba(27, 67, 50, 0.1)',
                fill: true,
                tension: 0.3
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            scales: {
                y: {
                    min: 0,
                    max: 100,
                    title: { display: true, text: '% of Trials' }
                },
                x: {
                    title: { display: true, text: 'Year' }
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return ` ${context.parsed.y.toFixed(1)}% reporting location data`;
                        }
                    }
                }
            }
        }
    });
}

/**
 * Main render function for Geography dashboard
 */
function renderGeographyDashboard() {
    if (!data) return;

    // Get filtered data (respects global filters)
    let filtered = getFilteredData();

    // Apply sponsor filter
    filtered = filterByGeographySponsor(filtered);

    // Classify by site count
    const classification = classifyTrialsBySiteCount(filtered);

    // Update stats
    document.getElementById('geo-total-trials').textContent = filtered.length.toLocaleString();
    document.getElementById('geo-single-site').textContent = classification.singleSite.length.toLocaleString();
    document.getElementById('geo-multi-site').textContent = classification.multiSite.length.toLocaleString();
    document.getElementById('geo-not-reported').textContent = classification.notReported.length.toLocaleString();

    // Aggregate geography based on view
    const geoCounts = aggregateGeography(filtered, geographyView);

    // Update chart title and subtitle based on layer
    const title = document.getElementById('geography-chart-title');
    const subtitle = document.getElementById('geography-chart-subtitle');

    if (geographyView === 'us') {
        // Show US map, hide international table
        document.getElementById('us-map-row').style.display = 'flex';
        document.getElementById('international-table-row').style.display = 'none';
        document.getElementById('reporting-layer-controls').classList.remove('hidden');

        // Store state data for map rendering
        currentStateData = geoCounts;

        // Update title based on layer
        const layerTitles = {
            'volume': 'Trials by US State',
            'race': 'Race Reporting by US State',
            'ethnicity': 'Ethnicity Reporting by US State',
            'sex': 'Sex Reporting by US State',
            'gender': 'Gender Reporting by US State'
        };

        const layerSubtitles = {
            'volume': 'Click a state to see city-level breakdown. Darker colors indicate more trials.',
            'race': 'Percentage of trials reporting race data. Click a state for details.',
            'ethnicity': 'Percentage of trials reporting ethnicity data. Click a state for details.',
            'sex': 'Percentage of trials reporting sex data. Click a state for details.',
            'gender': 'Percentage of trials reporting gender data. Click a state for details.'
        };

        if (title) title.textContent = layerTitles[currentMapLayer];
        if (subtitle) subtitle.textContent = layerSubtitles[currentMapLayer];

        // Render the US map
        renderUSMap();

        // Update state detail if a state is selected
        if (selectedState && currentStateData[selectedState]) {
            updateCityTable(selectedState, currentStateData[selectedState]);
        }
    } else {
        // Show international table, hide US map
        document.getElementById('us-map-row').style.display = 'none';
        document.getElementById('international-table-row').style.display = 'block';
        document.getElementById('reporting-layer-controls').classList.add('hidden');
        document.getElementById('state-detail-row').style.display = 'none';

        // Render international table
        renderInternationalTable(geoCounts);
    }

    // Render charts
    renderSiteDistributionChart(classification);
    renderGeoReportingTrendChart(filtered);
}

/**
 * Initialize Geography tab event listeners
 */
function initGeographyTab() {
    // View toggle buttons (US / International)
    const viewBtns = document.querySelectorAll('.view-btn');
    viewBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            viewBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            geographyView = btn.dataset.view;
            selectedState = null; // Reset state selection when switching views
            renderGeographyDashboard();
        });
    });

    // Layer toggle buttons (Volume, Race, Ethnicity, Sex, Gender)
    const layerBtns = document.querySelectorAll('.layer-btn');
    layerBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            layerBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentMapLayer = btn.dataset.layer;
            renderGeographyDashboard();
        });
    });

    // Close state detail button
    const closeBtn = document.getElementById('close-state-detail');
    if (closeBtn) {
        closeBtn.addEventListener('click', closeStateDetail);
    }

    // Sponsor dropdown
    const sponsorDropdown = document.getElementById('geography-sponsor');
    if (sponsorDropdown) {
        sponsorDropdown.addEventListener('change', (e) => {
            geographySponsorFilter = e.target.value;
            selectedState = null; // Reset state selection when changing sponsor
            renderGeographyDashboard();
        });
    }

    // Populate sponsor dropdown
    populateGeographySponsorDropdown();
}

// ---------------------------------------------------------------------------
// AI/ML-Enabled Medical Devices Tab
// ---------------------------------------------------------------------------
let aiDevicesData = null;
let aiDevicesLoaded = false;

async function loadAIDevicesTab() {
    if (aiDevicesLoaded) return;

    try {
        const resp = await fetch('data/ai-ml-enabled-devices-csv_20260305.csv');
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const csvText = await resp.text();
        aiDevicesData = parseCSV(csvText);
        aiDevicesLoaded = true;
        renderAIDevicesTab();
    } catch (e) {
        console.warn('Could not load AI devices CSV:', e.message);
        const tbody = document.getElementById('ai-devices-tbody');
        if (tbody) tbody.innerHTML = '<tr><td colspan="7">Could not load AI devices data.</td></tr>';
    }
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

    // Stats
    const statsEl = document.getElementById('ai-devices-stats');
    const panelCounts = {};
    const yearCounts = {};
    aiDevicesData.forEach(d => {
        const panel = d['Panel (Lead)'] || 'Unknown';
        panelCounts[panel] = (panelCounts[panel] || 0) + 1;

        const date = d['Date of Final Decision'];
        if (date) {
            let year = date.split('/')[2];
            if (year && year.length === 2) {
                year = (parseInt(year) >= 90 ? '19' : '20') + year;
            }
            if (year) yearCounts[year] = (yearCounts[year] || 0) + 1;
        }
    });

    const topPanel = Object.entries(panelCounts).sort((a, b) => b[1] - a[1])[0];
    statsEl.innerHTML = `
        <div class="stats-grid" style="margin-bottom: 1.5rem;">
            <div class="stat-card"><h3>Total Devices</h3><p class="stat-number">${aiDevicesData.length}</p></div>
            <div class="stat-card"><h3>Medical Panels</h3><p class="stat-number">${Object.keys(panelCounts).length}</p></div>
            <div class="stat-card"><h3>Top Panel</h3><p class="stat-number" style="font-size:1.1rem">${topPanel ? topPanel[0] : 'N/A'}</p></div>
        </div>
    `;

    // Panel bar chart
    renderAIPanelChart(panelCounts);

    // Timeline chart
    renderAITimelineChart(yearCounts);

    // Initialize table with pagination
    aiDevicesFiltered = aiDevicesData;
    aiDevicesPage = 0;
    applyAIDevicesView();

    // Search
    const searchEl = document.getElementById('ai-device-search');
    if (searchEl) {
        searchEl.addEventListener('input', () => {
            const q = searchEl.value.toLowerCase();
            aiDevicesFiltered = q
                ? aiDevicesData.filter(d => Object.values(d).some(v => v.toLowerCase().includes(q)))
                : aiDevicesData;
            aiDevicesPage = 0;
            applyAIDevicesView();
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
const AI_DEVICES_PAGE_SIZE = 50;

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
    const totalPages = Math.max(1, Math.ceil(totalCount / AI_DEVICES_PAGE_SIZE));
    aiDevicesPage = Math.max(0, Math.min(aiDevicesPage, totalPages - 1));
    const start = aiDevicesPage * AI_DEVICES_PAGE_SIZE;
    const pageData = viewData.slice(start, start + AI_DEVICES_PAGE_SIZE);

    if (countSpan) {
        countSpan.textContent = `Showing ${start + 1}–${Math.min(start + AI_DEVICES_PAGE_SIZE, totalCount)} of ${totalCount}`;
    }

    tbody.innerHTML = pageData.map(d => {
        const subNum = d['Submission Number'] || '';
        const fdaUrl = getFDAUrl(subNum);
        const linkCell = fdaUrl
            ? `<a href="${fdaUrl}" target="_blank" class="fda-link">View FDA Application</a>`
            : `<span class="fda-no-record">No premarket notification found</span>`;
        return `<tr>
            <td>${escapeHtml(d['Date of Final Decision'] || '')}</td>
            <td>${escapeHtml(subNum)}</td>
            <td>${escapeHtml(d['Device'] || '')}</td>
            <td>${escapeHtml(d['Company'] || '')}</td>
            <td>${escapeHtml(d['Panel (Lead)'] || '')}</td>
            <td>${escapeHtml(d['Primary Product Code'] || d['Product Code'] || '')}</td>
            <td>${linkCell}</td>
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
    const labels = sorted.map(e => e[0]);
    const values = sorted.map(e => e[1]);

    if (charts.aiPanel) charts.aiPanel.destroy();
    charts.aiPanel = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: 'Devices',
                data: values,
                backgroundColor: 'rgba(47, 79, 79, 0.7)',
                borderColor: 'var(--primary-color)',
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            indexAxis: 'y',
            scales: {
                x: { beginAtZero: true, title: { display: true, text: 'Number of Devices' } }
            },
            plugins: { legend: { display: false } }
        }
    });
}

function renderAITimelineChart(yearCounts) {
    const ctx = document.getElementById('ai-timeline-chart');
    if (!ctx) return;

    const years = Object.keys(yearCounts).sort();
    const values = years.map(y => yearCounts[y]);

    if (charts.aiTimeline) charts.aiTimeline.destroy();
    charts.aiTimeline = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: years,
            datasets: [{
                label: 'Authorizations',
                data: values,
                backgroundColor: 'rgba(47, 79, 79, 0.7)',
                borderColor: 'var(--primary-color)',
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            scales: {
                y: { beginAtZero: true, title: { display: true, text: 'Number of Authorizations' } },
                x: { title: { display: true, text: 'Year' } }
            },
            plugins: { legend: { display: false } }
        }
    });
}

// ---------------------------------------------------------------------------
// (Beta) AI Demographic Extraction Tab — 3-Way Model Comparison
// ---------------------------------------------------------------------------
let fdaExtractionLoaded = false;
let _fdaExtractedData = [];
let _fdaSelectedModel = 'claude-sonnet-4-6'; // default view

// Model display order and labels
const MODEL_ORDER = [
    { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5', tier: 'Fast / Low Cost' },
    { id: 'claude-sonnet-4-6',         label: 'Sonnet 4.6', tier: 'Balanced Baseline' },
    { id: 'claude-opus-4-6',           label: 'Opus 4.6',   tier: 'Highest Quality' },
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
 * Build model selector radio buttons for a tab.
 */
function renderModelSelector(containerId, selectedModel, onChange) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const radios = MODEL_ORDER.map(m => {
        const checked = m.id === selectedModel ? 'checked' : '';
        return `<label class="model-radio-label">
            <input type="radio" name="${containerId}-model" value="${m.id}" ${checked}> ${m.label}
        </label>`;
    }).join('');

    // Keep existing <label> and append radios
    container.innerHTML = `<label>View model:</label> ${radios}`;
    container.querySelectorAll('input[type="radio"]').forEach(radio => {
        radio.addEventListener('change', (e) => onChange(e.target.value));
    });
}

/**
 * Check if all 3 models agree on a specific field for an FDA document.
 */
function checkFDAFieldAgreement(doc, field) {
    const models = doc.models || {};
    const modelIds = Object.keys(models);
    if (modelIds.length < 2) return null; // can't compare
    const values = modelIds.map(mid => {
        const d = models[mid]?.data || {};
        return JSON.stringify(d[field]);
    });
    return values.every(v => v === values[0]);
}

/**
 * Check overall agreement across key fields for an FDA document.
 */
function checkFDAOverallAgreement(doc) {
    const fields = ['total_participants', 'sex_male', 'sex_female', 'race_white', 'race_black', 'race_asian', 'age_range'];
    return fields.every(f => checkFDAFieldAgreement(doc, f));
}

async function loadFDAExtractionTab() {
    if (fdaExtractionLoaded) return;
    try {
        const [metricsResp, dataResp] = await Promise.all([
            fetch('data/fda_token_metrics.json?v=' + Date.now()),
            fetch('data/fda_demographics_extracted.json?v=' + Date.now())
        ]);
        if (!metricsResp.ok || !dataResp.ok) throw new Error('Failed to load FDA extraction data');
        const metrics = await metricsResp.json();
        _fdaExtractedData = await dataResp.json();

        // Handle new per_model metrics structure
        const hasPilot = metrics.pilot_size > 0;
        const totalDocs = metrics.total_fda_tools || 0;
        document.getElementById('fda-pilot-size').textContent = metrics.pilot_size || 0;
        document.getElementById('fda-remaining').textContent = (totalDocs - metrics.pilot_size).toLocaleString();

        renderModelComparisonCards('fda-model-cards', metrics.per_model, totalDocs, metrics.pilot_size);
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
            '<tr><td colspan="13">Could not load extraction data. Run the extraction pipeline first.</td></tr>';
    }
}

function renderFDAReportingFreq(data) {
    const container = document.getElementById('fda-reporting-freq');
    if (!container) return;

    // Use Sonnet as the reference model for reporting frequency
    const refModel = 'claude-sonnet-4-6';
    const successDocs = data.filter(d => d.extraction_status === 'success' && d.models && d.models[refModel]);
    const total = successDocs.length;
    if (total === 0) {
        container.innerHTML = '<p style="color: var(--secondary-text); text-align: center; padding: 1rem;">No extraction data available yet.</p>';
        return;
    }

    const raceReported = successDocs.filter(d => d.models[refModel]?.data?.race_white !== 'Not Reported').length;
    const sexReported = successDocs.filter(d => d.models[refModel]?.data?.sex_male !== 'Not Reported').length;
    const ageReported = successDocs.filter(d => d.models[refModel]?.data?.age_range !== 'Not Reported').length;

    const items = [
        { label: '% Reporting Race', count: raceReported, color: '#2f4f4f' },
        { label: '% Reporting Sex', count: sexReported, color: '#4a7c7c' },
        { label: '% Reporting Age', count: ageReported, color: '#6aacac' }
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
        tbody.innerHTML = `<tr><td colspan="13" class="text-center" style="padding: 2rem; color: var(--secondary-text);">
            No extracted data yet. Trigger the extraction pipeline via
            <code>GitHub Actions &rarr; Run Extraction Pipelines</code>
            or run <code>scripts/extraction/extract_fda_demographics.py</code> locally.
        </td></tr>`;
        return;
    }

    tbody.innerHTML = data.map(doc => {
        if (doc.extraction_status !== 'success') {
            return `<tr>
                <td>${escapeHtml(doc.device_name || '')}</td>
                <td>${escapeHtml(doc.panel || '')}</td>
                <td>${escapeHtml(doc.submission_number || '')}</td>
                <td colspan="8" class="text-center" style="color: var(--secondary-text);">${escapeHtml(doc.extraction_status || 'failed')}</td>
                <td>—</td>
                <td>${doc.source_url ? `<a href="${escapeHtml(doc.source_url)}" target="_blank" rel="noopener noreferrer" class="fda-link">PDF</a>` : '—'}</td>
            </tr>`;
        }

        const d = doc.models?.[modelId]?.data || {};
        const fmt = (v) => v === 'Not Reported'
            ? '<span class="not-reported-badge">Not Reported</span>'
            : escapeHtml(String(v));
        const fmtNum = (v) => v === 'Not Reported'
            ? '<span class="not-reported-badge">Not Reported</span>'
            : typeof v === 'number' ? v.toLocaleString() : escapeHtml(String(v));
        const sourceLink = doc.source_url
            ? `<a href="${escapeHtml(doc.source_url)}" target="_blank" rel="noopener noreferrer" class="fda-link">PDF</a>`
            : '—';

        const allAgree = checkFDAOverallAgreement(doc);
        const agreeBadge = allAgree === null ? '—'
            : allAgree ? '<span class="agreement-badge agreement-yes">Agree</span>'
            : '<span class="agreement-badge agreement-no">Differs</span>';

        return `<tr>
            <td>${escapeHtml(doc.device_name || '')}</td>
            <td>${escapeHtml(doc.panel || '')}</td>
            <td>${escapeHtml(doc.submission_number || '')}</td>
            <td class="text-right">${fmtNum(d.total_participants)}</td>
            <td class="text-right">${fmtNum(d.sex_male)}</td>
            <td class="text-right">${fmtNum(d.sex_female)}</td>
            <td class="text-right">${fmtNum(d.race_white)}</td>
            <td class="text-right">${fmtNum(d.race_black)}</td>
            <td class="text-right">${fmtNum(d.race_asian)}</td>
            <td class="text-right">${fmtNum(d.race_other)}</td>
            <td>${fmt(d.age_range)}</td>
            <td>${agreeBadge}</td>
            <td>${sourceLink}</td>
        </tr>`;
    }).join('');
}

// ---------------------------------------------------------------------------
// (Beta) Paper Data Extraction Tab — 3-Way Model Comparison
// ---------------------------------------------------------------------------
let litExtractionLoaded = false;
let _litExtractedData = [];
let _litSelectedModel = 'claude-sonnet-4-6';

/**
 * Check overall agreement across key fields for a literature document.
 */
function checkLitOverallAgreement(doc) {
    const models = doc.models || {};
    const modelIds = Object.keys(models);
    if (modelIds.length < 2) return null;
    const fields = ['income_reported', 'education_reported', 'insurance_status_reported', 'study_name'];
    return fields.every(field => {
        const values = modelIds.map(mid => JSON.stringify(models[mid]?.data?.[field]));
        return values.every(v => v === values[0]);
    });
}

async function loadLitExtractionTab() {
    if (litExtractionLoaded) return;
    try {
        const cacheBust = `?v=${Date.now()}`;
        const [metricsResp, dataResp] = await Promise.all([
            fetch('data/lit_token_metrics.json' + cacheBust),
            fetch('data/lit_ses_extracted.json' + cacheBust)
        ]);
        if (!metricsResp.ok || !dataResp.ok) throw new Error('Failed to load literature extraction data');
        const metrics = await metricsResp.json();
        _litExtractedData = await dataResp.json();

        const totalDocs = metrics.total_studies || 0;
        document.getElementById('lit-pilot-size').textContent = metrics.pilot_size || 0;
        document.getElementById('lit-remaining').textContent = (totalDocs - metrics.pilot_size).toLocaleString();

        renderModelComparisonCards('lit-model-cards', metrics.per_model, totalDocs, metrics.pilot_size);
        renderModelSelector('lit-model-selector', _litSelectedModel, (modelId) => {
            _litSelectedModel = modelId;
            renderLitExtractionTable(_litExtractedData, modelId);
        });
        renderLitExtractionTable(_litExtractedData, _litSelectedModel);
        litExtractionLoaded = true;
    } catch (e) {
        console.warn('Could not load literature extraction data:', e.message);
        const tbody = document.getElementById('lit-extraction-tbody');
        if (tbody) tbody.innerHTML =
            '<tr><td colspan="8">Could not load extraction data. Run the extraction pipeline first.</td></tr>';
    }
}

function renderLitExtractionTable(extractedData, modelId) {
    const tbody = document.getElementById('lit-extraction-tbody');
    if (!tbody) return;
    modelId = modelId || _litSelectedModel;

    if (!extractedData || extractedData.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="text-center" style="padding: 2rem; color: var(--secondary-text);">
            No extracted data yet. Trigger the extraction pipeline via
            <code>GitHub Actions &rarr; Run Extraction Pipelines</code>
            or run <code>scripts/extraction/extract_paper_ses.py</code> locally.
        </td></tr>`;
        return;
    }

    tbody.innerHTML = extractedData.map(doc => {
        const boolBadge = (v) => v
            ? '<span class="bool-yes">Yes</span>'
            : '<span class="bool-no">No</span>';

        if (doc.extraction_status !== 'success') {
            let statusLabel = doc.extraction_status === 'closed_access' ? 'Closed Access' : 'Failed';
            return `<tr>
                <td class="study-details-cell">
                    <strong>${escapeHtml(doc.study_title || 'Title Not Found')}</strong>
                    <span class="study-details-meta">${doc.doi ? `<a href="https://doi.org/${escapeHtml(doc.doi)}" target="_blank" rel="noopener noreferrer" class="fda-link">${escapeHtml(doc.doi)}</a>` : ''}</span>
                </td>
                <td colspan="5" class="text-center" style="color: var(--secondary-text);">${statusLabel}</td>
                <td>—</td>
                <td>${doc.oa_pdf_url ? `<a href="${escapeHtml(doc.oa_pdf_url)}" target="_blank" rel="noopener noreferrer" class="fda-link">View Source</a>` : '<span class="fda-no-record">No PDF</span>'}</td>
            </tr>`;
        }

        const d = doc.models?.[modelId]?.data || {};

        const hasRealPdf = doc.oa_pdf_url && !doc.oa_pdf_url.startsWith('https://doi.org/');
        const pdfLink = hasRealPdf
            ? `<a href="${escapeHtml(doc.oa_pdf_url)}" target="_blank" rel="noopener noreferrer" class="fda-link">View Source</a>`
            : '<span class="fda-no-record">No PDF</span>';

        const sesNotes = (!d.ses_notes || d.ses_notes === 'None')
            ? '<span class="not-reported-badge">None</span>'
            : escapeHtml(d.ses_notes);

        const raceBreak = (!d.detailed_race_breakdown || d.detailed_race_breakdown === 'None' || d.detailed_race_breakdown === 'Not Reported')
            ? '<span class="not-reported-badge">Not Reported</span>'
            : escapeHtml(d.detailed_race_breakdown);

        const title = doc.study_title || 'Title Not Found';
        const studyName = d.study_name || 'Not Reported';
        const doi = doc.doi || '';
        const nctId = d.nct_id || 'Not Reported';
        const nctDisplay = nctId !== 'Not Reported'
            ? `<a href="https://clinicaltrials.gov/study/${escapeHtml(nctId)}" target="_blank" rel="noopener noreferrer" class="fda-link">${escapeHtml(nctId)}</a>`
            : '<span class="not-reported-badge">Not Reported</span>';
        const studyNameDisplay = studyName !== 'Not Reported'
            ? escapeHtml(studyName)
            : '<span class="not-reported-badge">Not Reported</span>';
        const doiDisplay = doi
            ? `<a href="https://doi.org/${escapeHtml(doi)}" target="_blank" rel="noopener noreferrer" class="fda-link">${escapeHtml(doi)}</a>`
            : '';

        const allAgree = checkLitOverallAgreement(doc);
        const agreeBadge = allAgree === null ? '—'
            : allAgree ? '<span class="agreement-badge agreement-yes">Agree</span>'
            : '<span class="agreement-badge agreement-no">Differs</span>';

        return `<tr>
            <td class="study-details-cell">
                <strong>${escapeHtml(title)}</strong>
                <span class="study-details-study-name">${studyNameDisplay}</span>
                <span class="study-details-meta">${doiDisplay}${doi && nctId !== 'Not Reported' ? ' | ' : ''}${nctDisplay}</span>
            </td>
            <td>${boolBadge(d.income_reported)}</td>
            <td>${boolBadge(d.education_reported)}</td>
            <td>${boolBadge(d.insurance_status_reported)}</td>
            <td>${sesNotes}</td>
            <td>${raceBreak}</td>
            <td>${agreeBadge}</td>
            <td>${pdfLink}</td>
        </tr>`;
    }).join('');
}

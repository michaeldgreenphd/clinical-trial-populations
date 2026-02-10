// ClinicalTrials.gov Demographics Dashboard - Enhanced Version

let data = null;
let charts = {};
let currentSort = { field: null, direction: 'asc' };
let currentPage = 0;
const PAGE_SIZE = 100;

// GitHub repository details for fetching historical snapshots
const REPO_OWNER = 'michaeldgreenphd';
const REPO_NAME  = 'clinical-trial-populations';

// Use jsDelivr CDN for historical data - it mirrors GitHub releases with proper CORS headers
// Format: https://cdn.jsdelivr.net/gh/{owner}/{repo}@{tag}/path/to/file
const JSDELIVR_BASE = `https://cdn.jsdelivr.net/gh/${REPO_OWNER}/${REPO_NAME}`;

// Fallback: direct GitHub release URL (may have CORS issues in some browsers)
const RELEASE_BASE = `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/download`;

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
        other: '#94a3b8'
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
    }
};

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

// Condition Category Mapping - maps raw condition strings to simplified categories
const CONDITION_CATEGORY_KEYWORDS = {
    heart_disease: [
        'heart', 'cardiac', 'cardiovascular', 'coronary', 'arrhythmia', 'atrial fibrillation',
        'heart failure', 'myocardial', 'cardiomyopathy', 'angina', 'hypertension', 'blood pressure',
        'aortic', 'ventricular', 'pericardial', 'endocarditis', 'valve', 'congestive'
    ],
    cancer: [
        'cancer', 'carcinoma', 'tumor', 'tumour', 'neoplasm', 'malignant', 'oncology', 'leukemia',
        'lymphoma', 'melanoma', 'sarcoma', 'myeloma', 'metastatic', 'metastasis', 'adenocarcinoma',
        'blastoma', 'glioma', 'mesothelioma', 'chemotherapy', 'oncologic'
    ],
    respiratory: [
        'copd', 'chronic obstructive pulmonary', 'emphysema', 'chronic bronchitis', 'pulmonary fibrosis',
        'interstitial lung', 'asthma', 'bronchiectasis', 'pulmonary hypertension', 'respiratory failure'
    ],
    stroke: [
        'stroke', 'cerebrovascular', 'cerebral infarction', 'brain ischemia', 'intracranial hemorrhage',
        'transient ischemic', 'tia', 'carotid', 'subarachnoid hemorrhage', 'cerebral thrombosis'
    ],
    alzheimers: [
        'alzheimer', 'dementia', 'cognitive decline', 'memory impairment', 'mild cognitive impairment',
        'senile dementia', 'cognitive dysfunction', 'amnestic'
    ],
    diabetes: [
        'diabetes', 'diabetic', 'hyperglycemia', 'hypoglycemia', 'insulin resistance', 'type 1 diabetes',
        'type 2 diabetes', 'glucose intolerance', 'prediabetes', 'hba1c', 'glycemic'
    ],
    influenza_pneumonia: [
        'influenza', 'flu', 'pneumonia', 'respiratory syncytial', 'rsv', 'pneumococcal',
        'viral respiratory infection'
    ],
    kidney: [
        'kidney', 'renal', 'nephropathy', 'nephritis', 'chronic kidney disease', 'ckd', 'dialysis',
        'end-stage renal', 'esrd', 'glomerular', 'polycystic kidney', 'nephrotic'
    ],
    mental_health: [
        'depression', 'anxiety', 'bipolar', 'schizophrenia', 'psychosis', 'psychiatric', 'ptsd',
        'post-traumatic stress', 'obsessive compulsive', 'ocd', 'panic disorder', 'phobia',
        'mood disorder', 'major depressive', 'generalized anxiety', 'mental disorder', 'mental health'
    ],
    substance_use: [
        'substance abuse', 'substance use', 'addiction', 'alcohol', 'alcoholism', 'drug abuse',
        'opioid', 'cocaine', 'cannabis', 'marijuana', 'tobacco', 'smoking', 'nicotine',
        'drug dependence', 'withdrawal'
    ],
    musculoskeletal: [
        'arthritis', 'rheumatoid', 'osteoarthritis', 'osteoporosis', 'bone', 'joint', 'musculoskeletal',
        'fibromyalgia', 'back pain', 'spine', 'spinal', 'gout', 'lupus', 'spondylitis',
        'tendinitis', 'bursitis', 'fracture', 'orthopedic'
    ],
    infectious: [
        'hiv', 'aids', 'hepatitis', 'tuberculosis', 'tb', 'malaria', 'sepsis', 'bacterial infection',
        'viral infection', 'fungal infection', 'parasitic', 'meningitis', 'endocarditis',
        'sexually transmitted', 'sti', 'std', 'covid', 'coronavirus', 'sars-cov', 'ebola', 'zika'
    ],
    neurological: [
        'parkinson', 'epilepsy', 'seizure', 'multiple sclerosis', 'ms', 'neuropathy', 'migraine',
        'headache', 'als', 'amyotrophic lateral', 'huntington', 'dystonia', 'tremor', 'ataxia',
        'guillain-barre', 'myasthenia', 'peripheral neuropathy', 'nerve', 'spinal cord injury'
    ],
    digestive: [
        'crohn', 'colitis', 'inflammatory bowel', 'ibd', 'irritable bowel', 'ibs', 'gastroesophageal',
        'gerd', 'celiac', 'pancreatitis', 'liver', 'hepatic', 'cirrhosis', 'gallbladder',
        'gastrointestinal', 'gastric', 'esophageal', 'intestinal', 'colon', 'colorectal', 'ulcer'
    ],
    skin: [
        'dermatitis', 'eczema', 'psoriasis', 'acne', 'rosacea', 'skin', 'dermatologic', 'cutaneous',
        'wound healing', 'burn', 'vitiligo', 'alopecia', 'urticaria', 'pruritus'
    ]
};

/**
 * Maps a raw condition string to one of the simplified categories.
 * Uses case-insensitive keyword matching.
 * @param {string} condition - The raw condition string from the study
 * @returns {string} - The category key (e.g., 'heart_disease', 'cancer') or 'other' if no match
 */
function mapConditionToCategory(condition) {
    if (!condition) return 'other';

    const lowerCondition = condition.toLowerCase();

    for (const [category, keywords] of Object.entries(CONDITION_CATEGORY_KEYWORDS)) {
        for (const keyword of keywords) {
            if (lowerCondition.includes(keyword.toLowerCase())) {
                return category;
            }
        }
    }

    return 'other';
}

/**
 * Checks if a study matches the selected simplified condition category.
 * A study matches if ANY of its conditions map to the selected category.
 * @param {Object} study - The study object with conditions array
 * @param {string} selectedCategory - The selected category key
 * @returns {boolean} - True if the study matches the category
 */
function studyMatchesSimplifiedCondition(study, selectedCategory) {
    if (selectedCategory === 'all') return true;

    const conditions = study.conditions || [];
    if (conditions.length === 0) {
        // Studies with no conditions only match 'other'
        return selectedCategory === 'other';
    }

    for (const condition of conditions) {
        const category = mapConditionToCategory(condition);
        if (category === selectedCategory) {
            return true;
        }
    }

    return false;
}

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    await loadData();
    initTabs();
    initFilters();
    initSubcategoryButtons();
    initTable();
    initGeographyTab();
    renderDashboard();

    // Hide loading overlay after everything is initialized and rendered
    hideLoadingOverlay();

    initHistorySelector();   // populate archive dropdown (non-blocking; runs after first render)
});

// Decompress a single .json.gz response body and return parsed JSON.
async function fetchAndDecompress(url) {
    console.log(`Fetching: ${url}`);
    const cacheBust = new Date().getTime();
    const response = await fetch(`${url}?v=${cacheBust}`);
    console.log(`Response status for ${url}: ${response.status}`);
    if (!response.ok) {
        throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);
    }
    const decompressedStream = response.body.pipeThrough(new DecompressionStream('gzip'));
    const decompressedResponse = new Response(decompressedStream);
    const json = await decompressedResponse.json();
    console.log(`Successfully loaded ${json.data.length} studies from ${url}`);
    return json;
}

// Fetch with fallback: try jsDelivr first, then direct GitHub release URL
async function fetchWithFallback(primaryUrl, fallbackUrl) {
    try {
        return await fetchAndDecompress(primaryUrl);
    } catch (primaryError) {
        console.warn(`Primary fetch failed for ${primaryUrl}: ${primaryError.message}`);
        if (fallbackUrl) {
            console.log(`Trying fallback URL: ${fallbackUrl}`);
            return await fetchAndDecompress(fallbackUrl);
        }
        throw primaryError;
    }
}

// Return the two .json.gz URLs for a given date.
// "latest" (or no argument) → relative paths served from the repo root.
// A date string (YYYY-MM-DD) → jsDelivr CDN URLs for historical snapshots.
// jsDelivr has proper CORS headers and caches GitHub releases effectively.
function dataURLsForDate(date) {
    if (!date || date === 'latest') {
        return [
            'data/demographics.part1.json.gz',
            'data/demographics.part2.json.gz'
        ];
    }
    // Use jsDelivr CDN which mirrors GitHub tags/releases with proper CORS
    // The @{tag} syntax fetches from the specific release tag
    return [
        `${JSDELIVR_BASE}@${date}/data/demographics.part1.json.gz`,
        `${JSDELIVR_BASE}@${date}/data/demographics.part2.json.gz`
    ];
}

async function loadData(date) {
    const [url1, url2] = dataURLsForDate(date);

    // For historical data, prepare fallback URLs (direct GitHub release)
    let fallback1 = null, fallback2 = null;
    if (date && date !== 'latest') {
        fallback1 = `${RELEASE_BASE}/${date}/demographics.part1.json.gz`;
        fallback2 = `${RELEASE_BASE}/${date}/demographics.part2.json.gz`;
    }

    try {
        console.log('Loading data parts...');
        const [part1, part2] = await Promise.all([
            fallback1 ? fetchWithFallback(url1, fallback1) : fetchAndDecompress(url1),
            fallback2 ? fetchWithFallback(url2, fallback2) : fetchAndDecompress(url2)
        ]);

        data = [...part1.data, ...part2.data];
        console.log(`Total studies loaded: ${data.length}`);

        // Show which snapshot is loaded
        const dateLabel = date && date !== 'latest' ? ` (${date} snapshot)` : '';
        document.getElementById('last-updated').textContent =
            new Date(part1.extracted_at).toLocaleDateString() + dateLabel;
    } catch (error) {
        console.error('Error loading data:', error);
        document.getElementById('last-updated').textContent = 'Error loading data';

        const fallbackInfo = fallback1 ? `
            <p class="note" style="font-size: 0.9em; color: #666;">
                Also tried fallback URLs:<br>
                - ${fallback1}<br>
                - ${fallback2}
            </p>` : '';

        document.querySelector('main').innerHTML = `
            <div class="chart-container">
                <h3>No Data Available</h3>
                <p class="note">Error loading data files. Please check the browser console for details.</p>
                <p class="note">Error: ${error.message}</p>
                <p class="note" style="font-size: 0.9em; color: #666;">
                    Trying to load:<br>
                    - ${url1}<br>
                    - ${url2}
                </p>
                ${fallbackInfo}
            </div>
        `;
    }
}

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
        console.log(`Switching to snapshot: ${chosen}`);
        await loadData(chosen);
        // Re-populate dynamic dropdowns whose options come from the dataset
        populateConditionsDropdown();
        populateCountriesDropdown();
        renderDashboard();
    });
}

function initTabs() {
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

            tab.classList.add('active');
            document.getElementById(tab.dataset.tab).classList.add('active');

            // Render table when Studies tab is selected
            if (tab.dataset.tab === 'studies') {
                currentPage = 0;
                renderStudiesTable();
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
        'enrollment-type', 'healthy-volunteers', 'condition', 'condition-simplified', 'country'
    ];
    filterIds.forEach(id => {
        const element = document.getElementById(id);
        if (element) {
            element.addEventListener('change', () => {
                renderDashboard();
                updateActiveFilters();
            });
        }
    });

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

    // Year range labels
    const yearStartInput = document.getElementById('year-start');
    const yearEndInput = document.getElementById('year-end');

    if (yearStartInput) {
        yearStartInput.addEventListener('input', (e) => {
            document.getElementById('year-start-label').textContent = e.target.value;
        });
    }

    if (yearEndInput) {
        yearEndInput.addEventListener('input', (e) => {
            document.getElementById('year-end-label').textContent = e.target.value;
        });
    }

    // Reset filters button
    const resetBtn = document.getElementById('reset-filters');
    if (resetBtn) {
        resetBtn.addEventListener('click', resetFilters);
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
    document.getElementById('study-type').value = 'all';
    document.getElementById('phase').value = 'all';
    document.getElementById('sponsor-class').value = 'all';
    document.getElementById('intervention-model').value = 'all';
    document.getElementById('masking').value = 'all';
    document.getElementById('primary-purpose').value = 'all';
    document.getElementById('enrollment-type').value = 'all';
    document.getElementById('healthy-volunteers').value = 'all';
    document.getElementById('condition').value = 'all';
    document.getElementById('country').value = 'all';
    document.getElementById('min-participants').value = '';
    document.getElementById('max-participants').value = '';

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
        }});
    }

    const studyType = document.getElementById('study-type').value;
    if (studyType !== 'all') {
        filters.push({ label: `Type: ${studyType}`, reset: () => {
            document.getElementById('study-type').value = 'all';
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
    const conditionFilter = document.getElementById('condition')?.value || 'all';
    const conditionSimplifiedFilter = document.getElementById('condition-simplified')?.value || 'all';
    const countryFilter = document.getElementById('country')?.value || 'all';

    return data.filter(study => {
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
        if (conditionFilter !== 'all') {
            const conditions = study.conditions || [];
            if (!conditions.includes(conditionFilter)) return false;
        }
        // Simplified condition category filter
        if (conditionSimplifiedFilter !== 'all') {
            if (!studyMatchesSimplifiedCondition(study, conditionSimplifiedFilter)) return false;
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

function renderDashboard() {
    if (!data) return;

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
    renderSexDistribution(filtered);
    renderSexTrends(filtered);
    renderGenderDistribution(filtered);

    // Render Geography dashboard
    renderGeographyDashboard();

    // Update table if visible
    const studiesTab = document.querySelector('.tab[data-tab="studies"]');
    if (studiesTab?.classList.contains('active')) {
        currentPage = 0;
        renderStudiesTable();
    }
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

        return `
        <tr>
            <td>
                <a href="https://clinicaltrials.gov/study/${study.nct_id}"
                   target="_blank"
                   class="nct-link">${study.nct_id}</a>
            </td>
            <td class="text-center">
                <button class="details-btn" onclick="showStudyDetails('${study.nct_id}')" title="View full study details">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M8 4.5a.5.5 0 0 1 .5.5v3h3a.5.5 0 0 1 0 1h-3v3a.5.5 0 0 1-1 0v-3h-3a.5.5 0 0 1 0-1h3v-3A.5.5 0 0 1 8 4.5z"/>
                    </svg>
                </button>
            </td>
            <td>${study.start_date || 'N/A'}</td>
            <td>${study.primary_completion_date || study.completion_date || 'N/A'}</td>
            <td>${renderSparkline(getTimeToReport(study))}</td>
            <td>${statusWithReason}</td>
            <td>${study.results_date || 'N/A'}</td>
            <td>${study.last_update || 'N/A'}</td>
            <td class="text-center">${renderDemographicCell(study, 'race')}</td>
            <td class="text-center">${renderDemographicCell(study, 'ethnicity')}</td>
            <td class="text-center">${renderDemographicCell(study, 'sex')}</td>
            <td>${escapeHtml(study.brief_title || 'N/A')}</td>
            <td><span class="phase-badge">${study.phase || 'N/A'}</span></td>
            <td>${study.study_type || 'N/A'}</td>
            <td>${study.intervention_model || study.observational_model || 'N/A'}</td>
            <td title="${escapeHtml(study.primary_endpoint || 'N/A')}">${truncateText(study.primary_endpoint || 'N/A', 40)}</td>
            <td title="${escapeHtml(study.lead_sponsor_name || 'Unknown')}">${truncateText(study.lead_sponsor_name || 'Unknown', 30)}</td>
            <td class="text-right">${enrollmentBadge}</td>
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
    const breakdownKey = `${field}Breakdown`;
    const reported = study[field]?.reported;

    if (!reported || !study[breakdownKey]) {
        return '<span class="x-mark">✗</span>';
    }

    // Get raw categories for tooltip
    const rawCategories = study[field]?.raw_categories || [];
    let tooltipText = '';

    if (rawCategories.length > 0) {
        // Build tooltip showing raw labels and match quality
        const summaries = rawCategories.slice(0, 3).map(rc => {
            const confidence = rc.confidence === 'high' ? '✓' :
                             rc.confidence === 'medium' ? '≈' : '⚠';
            return `${confidence} "${rc.original}"`;
        }).join('; ');

        const moreCount = rawCategories.length > 3 ? ` +${rawCategories.length - 3} more` : '';
        tooltipText = `Raw data: ${summaries}${moreCount}. Click for details.`;
    } else {
        tooltipText = 'Click to view breakdown';
    }

    return `<button class="demo-check"
                    onclick="showBreakdown('${study.nct_id}', '${breakdownKey}')"
                    title="${escapeHtml(tooltipText)}">
            </button>`;
}

function showBreakdown(nctId, breakdownType) {
    const study = data.find(s => s.nct_id === nctId);
    if (!study) return;

    const breakdown = study[breakdownType];
    if (!breakdown) return;

    // Determine the category name
    const categoryName = breakdownType.replace('Breakdown', '');
    const categoryDisplay = categoryName.charAt(0).toUpperCase() + categoryName.slice(1);

    // Build breakdown HTML
    let html = `<div class="breakdown-modal">
        <h4>${categoryDisplay} Distribution - ${nctId}</h4>
        <p class="modal-subtitle">Click outside to close</p>
        <table class="breakdown-table">
            <thead><tr><th>NIH/OMB Category</th><th>Original Label</th><th>Match Quality</th><th>Count</th><th>Percent</th></tr></thead>
            <tbody>`;

    if (breakdownType === 'raceBreakdown') {
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
        // Generic path for ethnicity / sex — show only categories that were reported
        const rawCategories = study[categoryName]?.raw_categories || [];
        const entries = Object.entries(breakdown).sort((a, b) => b[1].count - a[1].count);

        for (const [category, catData] of entries) {
            const rawCat = rawCategories.find(rc =>
                (rc.original === category ||
                 (rc.omb_category && formatOmbCategory(rc.omb_category) === category))
            );

            const originalLabel = rawCat?.original || category;
            const confidence    = rawCat?.confidence || 'n/a';
            const isFuzzy       = rawCat?.flags?.some(f => f.includes('fuzzy_match')) || false;
            const isUnmapped    = rawCat?.flags?.includes('unmapped') || false;

            let matchQuality = '';
            if (confidence === 'high') {
                matchQuality = '<span class="match-high" title="Exact or case-insensitive match">✓ Exact</span>';
            } else if (confidence === 'medium' || isFuzzy) {
                matchQuality = '<span class="match-medium" title="Fuzzy string matching used">≈ Fuzzy</span>';
            } else if (isUnmapped) {
                matchQuality = '<span class="match-low" title="Could not map to NIH/OMB category">⚠ Unmapped</span>';
            } else {
                matchQuality = '<span class="match-na">-</span>';
            }

            html += `<tr>
                <td>${escapeHtml(category)}</td>
                <td class="original-label">${escapeHtml(originalLabel)}</td>
                <td class="text-center">${matchQuality}</td>
                <td>${catData.count.toLocaleString()}</td>
                <td style="--percent: ${catData.percent}">${catData.percent.toFixed(1)}%</td>
            </tr>`;
        }
    }

    html += `</tbody></table>`;

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

function showStudyDetails(nctId) {
    const study = data.find(s => s.nct_id === nctId);
    if (!study) return;

    const overlay = document.getElementById('study-details-overlay');

    // Format masking details
    let maskingDetails = '';
    if (study.masking && study.masking !== 'NONE') {
        const masked = [];
        if (study.subject_masked) masked.push('Participants');
        if (study.caregiver_masked) masked.push('Care Providers');
        if (study.investigator_masked) masked.push('Investigators');
        if (study.outcomes_assessor_masked) masked.push('Outcomes Assessors');
        maskingDetails = masked.length > 0 ? `<br><small>Masked: ${masked.join(', ')}</small>` : '';
    }

    // Format collaborators
    let collaboratorsHtml = '';
    if (study.collaborators && study.collaborators.length > 0) {
        collaboratorsHtml = `
            <div class="detail-section">
                <h5>Collaborators</h5>
                <ul class="collaborators-list">
                    ${study.collaborators.map(c => `<li>${escapeHtml(c.name)} <span class="badge">${c.class}</span></li>`).join('')}
                </ul>
            </div>`;
    }

    // Format secondary outcomes
    let secondaryOutcomesHtml = '';
    if (study.secondary_outcomes && study.secondary_outcomes.length > 0) {
        secondaryOutcomesHtml = `
            <div class="detail-section">
                <h5>Secondary Outcomes (${study.secondary_outcomes.length})</h5>
                <ul class="outcomes-list">
                    ${study.secondary_outcomes.slice(0, 5).map(o => `
                        <li>
                            <strong>${escapeHtml(o.measure)}</strong>
                            ${o.time_frame ? `<br><small>Time Frame: ${escapeHtml(o.time_frame)}</small>` : ''}
                        </li>
                    `).join('')}
                    ${study.secondary_outcomes.length > 5 ? `<li><em>... and ${study.secondary_outcomes.length - 5} more</em></li>` : ''}
                </ul>
            </div>`;
    }

    const html = `
        <div class="study-details-modal">
            <div class="modal-header">
                <h3>${escapeHtml(study.brief_title)}</h3>
                <button class="close-btn" onclick="closeStudyDetails()">✕</button>
            </div>
            <div class="modal-body">
                <div class="detail-row">
                    <strong>NCT ID:</strong>
                    <a href="https://clinicaltrials.gov/study/${study.nct_id}" target="_blank" class="nct-link">${study.nct_id}</a>
                </div>

                <div class="detail-section">
                    <h5>Study Design</h5>
                    <div class="detail-grid">
                        <div><strong>Type:</strong> ${study.study_type || 'N/A'}</div>
                        <div><strong>Phase:</strong> ${study.phase || 'N/A'}</div>
                        <div><strong>Allocation:</strong> ${study.allocation || 'N/A'}</div>
                        <div><strong>Model:</strong> ${study.intervention_model || study.observational_model || 'N/A'}</div>
                        <div><strong>Masking:</strong> ${study.masking || 'N/A'}${maskingDetails}</div>
                        <div><strong>Purpose:</strong> ${study.primary_purpose || 'N/A'}</div>
                    </div>
                    ${study.intervention_model_description ? `<p class="description"><strong>Design Description:</strong> ${escapeHtml(study.intervention_model_description)}</p>` : ''}
                </div>

                <div class="detail-section">
                    <h5>Primary Outcome</h5>
                    <p><strong>${escapeHtml(study.primary_endpoint || 'N/A')}</strong></p>
                    ${study.primary_outcome_time_frame ? `<p><small>Time Frame: ${escapeHtml(study.primary_outcome_time_frame)}</small></p>` : ''}
                    ${study.primary_outcome_description ? `<p class="description">${escapeHtml(study.primary_outcome_description)}</p>` : ''}
                </div>

                ${secondaryOutcomesHtml}

                <div class="detail-section">
                    <h5>Enrollment & Eligibility</h5>
                    <div class="detail-grid">
                        <div><strong>Enrollment:</strong> ${(study.enrollment || 0).toLocaleString()} ${study.enrollment_type === 'ANTICIPATED' ? '(Anticipated)' : '(Actual)'}</div>
                        <div><strong>Age Range:</strong> ${study.min_age || 'N/A'} to ${study.max_age || 'N/A'}</div>
                        <div><strong>Gender:</strong> ${formatGenderDisplay(study)}</div>
                        <div><strong>Healthy Volunteers:</strong> ${study.healthy_volunteers ? 'Yes' : 'No'}</div>
                    </div>
                </div>

                <div class="detail-section">
                    <h5>Sponsor & Collaborators</h5>
                    <p><strong>Lead Sponsor:</strong> ${escapeHtml(study.lead_sponsor_name || 'Unknown')} <span class="badge">${study.sponsor_class || 'N/A'}</span></p>
                    <p><strong>Funding Source:</strong> <span class="badge">${deriveFundingSource(study)}</span></p>
                    ${collaboratorsHtml}
                </div>

                <div class="detail-section">
                    <h5>Study Status</h5>
                    <div class="detail-grid">
                        <div><strong>Status:</strong> ${study.status || 'N/A'}</div>
                        <div><strong>Results Posted:</strong> ${study.results_date || 'N/A'}</div>
                        <div><strong>Completion Date:</strong> ${study.completion_date || study.primary_completion_date || 'N/A'}</div>
                        <div><strong>Last Update:</strong> ${study.last_update || 'N/A'}</div>
                    </div>
                    ${study.why_stopped ? `<p class="alert"><strong>Why Stopped:</strong> ${escapeHtml(study.why_stopped)}</p>` : ''}
                </div>

                ${renderStudySites(study)}
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
        type: 'line',
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
                    borderWidth: 1,
                    fill: true,
                    tension: 0.1
                },
                // 2. Other Races
                {
                    label: 'Other Races',
                    data: otherRacesData,
                    backgroundColor: COLORS.race.other,
                    borderColor: COLORS.race.other,
                    borderWidth: 1,
                    fill: true,
                    tension: 0.1
                },
                // 3. Explicitly Unknown (solid grey)
                {
                    label: 'Explicitly Unknown',
                    data: explicitUnknownData,
                    backgroundColor: '#9ca3af',
                    borderColor: '#6b7280',
                    borderWidth: 1,
                    fill: true,
                    tension: 0.1
                },
                // 4. Black/African American
                {
                    label: 'Black/African American',
                    data: blackData,
                    backgroundColor: COLORS.race.black_african_american,
                    borderColor: COLORS.race.black_african_american,
                    borderWidth: 1,
                    fill: true,
                    tension: 0.1
                },
                // 5. White
                {
                    label: 'White',
                    data: whiteData,
                    backgroundColor: COLORS.race.white,
                    borderColor: COLORS.race.white,
                    borderWidth: 1,
                    fill: true,
                    tension: 0.1
                },
                // 6. Not Reported/Missing (top layer - light translucent grey)
                {
                    label: 'Not Reported (Missing)',
                    data: notReportedData,
                    backgroundColor: 'rgba(229, 231, 235, 0.7)',
                    borderColor: 'rgba(209, 213, 219, 0.8)',
                    borderWidth: 1,
                    fill: true,
                    tension: 0.1
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
        type: 'line',
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
                    borderWidth: 1,
                    fill: true,
                    tension: 0.1
                },
                // 2. Hispanic/Latino
                {
                    label: 'Hispanic/Latino',
                    data: hispanicData,
                    backgroundColor: COLORS.ethnicity.hispanic_latino,
                    borderColor: COLORS.ethnicity.hispanic_latino,
                    borderWidth: 1,
                    fill: true,
                    tension: 0.1
                },
                // 3. Not Hispanic/Latino
                {
                    label: 'Not Hispanic/Latino',
                    data: notHispanicData,
                    backgroundColor: COLORS.ethnicity.not_hispanic_latino,
                    borderColor: COLORS.ethnicity.not_hispanic_latino,
                    borderWidth: 1,
                    fill: true,
                    tension: 0.1
                },
                // 4. Not Reported/Missing (top layer - light translucent grey)
                {
                    label: 'Not Reported (Missing)',
                    data: notReportedData,
                    backgroundColor: 'rgba(229, 231, 235, 0.7)',
                    borderColor: 'rgba(209, 213, 219, 0.8)',
                    borderWidth: 1,
                    fill: true,
                    tension: 0.1
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

    const totals = { Woman: 0, Man: 0, 'Non-binary': 0, Other: 0, Unknown: 0 };

    filtered.forEach(study => {
        if (!study.gender?.reported) return;
        totals.Woman += study.gender.totals.woman || 0;
        totals.Man += study.gender.totals.man || 0;
        totals['Non-binary'] += study.gender.totals.nonbinary || 0;
        totals.Other += study.gender.totals.other || 0;
        totals.Unknown += study.gender.totals.unknown || 0;
    });

    if (charts.genderDistribution) charts.genderDistribution.destroy();

    charts.genderDistribution = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: Object.keys(totals),
            datasets: [{
                label: 'Count',
                data: Object.values(totals),
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
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const total = context.dataset.data.reduce((a, b) => a + b, 0);
                            const pct = total > 0 ? ((context.parsed.y / total) * 100).toFixed(1) : '0.0';
                            return ` ${context.parsed.y.toLocaleString()} participants (${pct}%)`;
                        }
                    }
                }
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
function aggregateGeography(studies, view) {
    if (view === 'us') {
        const stateData = {};

        studies.forEach(study => {
            // Prefer study_sites (new format) over countries (old format)
            const locations = study.study_sites || study.countries || [];

            locations.forEach(loc => {
                if (!loc || !loc.country) return;

                if (loc.country === 'United States' && loc.state) {
                    const state = loc.state;
                    const city = loc.city || 'Unknown City';

                    if (!stateData[state]) {
                        stateData[state] = { count: 0, cities: {}, trials: [], facilities: {} };
                    }
                    stateData[state].count++;
                    stateData[state].cities[city] = (stateData[state].cities[city] || 0) + 1;
                    stateData[state].trials.push(study);

                    // Track facilities if available
                    if (loc.facility) {
                        stateData[state].facilities[loc.facility] = (stateData[state].facilities[loc.facility] || 0) + 1;
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
    if (!study.baseline_data || !study.baseline_data.race) return false;
    const race = study.baseline_data.race;
    // Check if any race category has data
    return Object.values(race).some(val => val && val > 0);
}

/**
 * Check if a trial reports ethnicity data
 */
function trialReportsEthnicity(study) {
    if (!study.baseline_data || !study.baseline_data.ethnicity) return false;
    const eth = study.baseline_data.ethnicity;
    return Object.values(eth).some(val => val && val > 0);
}

/**
 * Check if a trial reports sex data
 */
function trialReportsSex(study) {
    if (!study.baseline_data || !study.baseline_data.sex) return false;
    const sex = study.baseline_data.sex;
    return Object.values(sex).some(val => val && val > 0);
}

/**
 * Check if a trial reports gender data
 */
function trialReportsGender(study) {
    if (!study.baseline_data || !study.baseline_data.gender) return false;
    const gender = study.baseline_data.gender;
    return Object.values(gender).some(val => val && val > 0);
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

    // Normalize value to 0-1 range
    const range = maxVal - minVal;
    const normalized = range > 0 ? (value - minVal) / range : 0;

    // Green gradient: light to dark
    const colors = [
        { r: 232, g: 245, b: 233 }, // #e8f5e9 - lightest
        { r: 165, g: 214, b: 167 }, // #a5d6a7
        { r: 102, g: 187, b: 106 }, // #66bb6a
        { r: 56, g: 142, b: 60 },   // #388e3c
        { r: 27, g: 67, b: 50 }     // #1b4332 - darkest
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

// US State abbreviation to name mapping
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

// US Map SVG paths (simplified for main continental states)
const usMapPaths = {
    'AL': 'M628.5,466.8l-2.2-24.1l-2.4-22.6l-15.8,1.8l-11.4,1.2l0.3,3.3l1.8,7.6l3.3,13.6l3.7,11.3l1.3,7.1l3.6,9.5l3.1,4.9l-0.5,5.9l2.6,4.9l0.7,3.5l2.2,0.7l0.6-2.5l-0.5-2.1l2-4.3l2.7-3.3l-0.1-2l3.5,0.6l0.7-10.9z',
    'AK': 'M158.1,573.9l-0.3,86.2l2.5,1.5l3.9-1l2.5,2.2l5,0.2l1.3-1.5l-1.5-3.2l2-4.7l4.2-4l3.2,0.7l0.5,2.5l2.2-0.5l3.7-3.5l1.2-0.5l0.7-2.7l3.7-1.2l5.5,2.5l1.7,2.7l0.3,3.2l4.5,0.7l5-2.5l0.7,2l3.5-0.2l4-3.2l0.2-1.7l3.5-0.7l2.7-3.2l2-0.7l3,3l4.5,0.2l3.2-2.7l2.5,0.5l0.5-0.5l5,1l2-1.7l2.7-0.7l1.5-2.5l3.5,1l1.2,2.7l2.2-1l-0.7-2l1.7-0.7l4-0.7l2.2,0.7l1.2,2.5l3.5-2.7l2,1.5l2-5l5.5-3.2l0.7-2.7l-2.5-3l-2.5-1l-3.5,1l-3-0.5l-2.2,0.7l-2.2-1.2l2.2-2.5l-0.7-2.7l3.7-1l-1.2-2.2l-3-0.7l-1-1.7l-3.7,1l-3.2-2.2l-0.7-2.5l-4.2,0.7l-4.5-1.7l-2.5,0.7l-0.7-2.5l-3.5,0.2l-4.5-3l-5-0.2l-3.5-3.7l-5.2-3.5l-1-2.5l-4.7-4l-3.7,0.2l-2.2-3.7l-5,0.7l-2-2.7l-3,1l-3-0.5l-1.7-2.2l-3.5-0.5l-2.5,1l-0.5-2l-4-0.7l-1.5-4l-2.5,1.5l-3.5-2.7l0.2-2l-2.5-0.5l-3.5-3.7l-2.2,0.7l-5.2-4.2l-1.2,1l-4.2-0.7l-1.7-2.7l-2,0.5l-0.7-1.5l-3.5,2.5z',
    'AZ': 'M213.9,412.5l-1.8,1.1l-1.1,2.8l0.4,1.4l-18.3,10.1l-26.6,14.3l-21.7,11.1l-18.5,9.5l6.8,13.4l13.5,25.8l11.5,22.2l14.2,27.4l10.9,21.1l4.5,3.9l2.4,0.2l0.9-1.7l3.9-0.8l2.5,0.5l1.4,3l7.6,0.8l3.5,2.1l0.2-1.7l-0.4-4.6l1.7-0.4l0.7-0.5l0.1-8.8l0.5-2l2.7-1.7l1-2.7l-0.6-1.7l1.1-2.7l0.5-2.3l0.5-4.6l2.5-2.2l2.7-0.1l2.6-3l0.7-4.7l-0.2-3.6l1.1-0.6l-0.2-4l3-5.5l0.9-5.7l0.2-2.7l-1-2l0.7-2.9l-0.6-1.9l1.7-2.9l0.7-6.8l2-2.2l0.2-1.2l-1.3-2.5l0.9-5.2l0.2-4.6l1.3-1.5l-0.5-2.9l1.4-3l-0.2-1l-1.5-1l-0.6-2.9l1.5-2.6l-0.6-0.9l-24.3,3.3l-24.9,2.7z',
    'AR': 'M568.5,394.5l-7.3,0.4l-3.9-2.4l-3.1,1.5l-2.9-0.5l-35.1,1.3l-0.9,4.2l1.9,2.4l-0.6,3.9l-2.7,3l-0.3,3.3l1.7,3.7l-0.7,2.2l-2.1,3l0.7,1.3l-0.7,2l0.2,3.2l1.9,3l-0.2,2.4l-1.1,4.1l0.3,1.7l0.1,4.1l4.3,2l2.7-0.6l1-2l3.5-0.4l0.1-3.4l4.7,0.2l44.5-0.8l0.9-5l1.2-2.9l-0.9-3.4l1.7-5.9l-1.5-3.4l1.9-2.1l-0.5-4.4l-2.3-2.2l0.7-2.7l-1-3.5l1.9-1.7l-1.1-4.3z',
    'CA': 'M135.2,335.9l-2.7,0.3l-2,2.3l0.2,2.9l2.7,3.6l1.2,3.9l2.9,2.1l2.6,0.5l1.9,4.2l0.5,6.9l1.2,3.7l1.7,1.2l0.7,3.1l-1.5,1.5l-1,3.9l1.2,1.7l3.6,2.9l2.4,4.1l2,5.4l1.7,6.9l2.2,1.2l3.4,0.5l1.5,1.5l0,3.9l-1,3.4l1.7,4.1l2.6,3.5l0.2,2.6l-0.5,1l0.2,1.9l7.8,9.4l1.7,3.4l1.5,4.6l-0.2,2.6l3.4,4.4l3.6,2.6l-0.5,1.9l1.2,2.2l2.2,0.7l3.6,3.1l4.6,0.5l2.6,2.9l0.2,1.2l3.4,2.4l2.2,2.4l-0.5,3.1l0.7,2.6l-0.5,4.4l1.5,4.4l21.7-11.1l26.6-14.3l18.3-10.1l-0.4-1.4l1.1-2.8l1.8-1.1l-5.9-17.2l-6.3-17.9l-14.2-38.7l-15.2-42.1l-1-1.7l-2.1-0.2l-2.3-1.5l-1.4,1l-2.6-0.4l-3.9-2l-2.9,0.1l-2.5,2.3l-1.2-0.2l-2.7-2.7l-2.6-0.6l0.7-1.3l-2-1.7l-1.6-3.1l-1.2-4.9l1.1-1.5l-1.9-0.9l-0.7-1.6l-0.7,0.5l-1.1-1.9l0.5-1.4l-2.9-3.1l-0.1-2l-2.1-2.2l-1.5-4.2l-2.2-1.6l-2.4-2.7l0.1-2.5l-1.9-1.1l-0.6-2.5l-2.6-1l-2.6-2.5l-0.1-4l-2.1-2.7l0.2-3.7l-3.6-0.7l-0.9-2.9l-2.1,0.9l-2.6,3.3l-0.3,2.2l-2.7,3.5l-1.9,4.1l-1.9,2.4l-0.2,2.6l-1.8,3l-3.7,3.5l-1.3,3.2l-2.9,4l-0.9,4.8l-3.1,4.3l-0.5,3.2l-1.9,3.3l0.7,3.8l1.1,1.8l-0.2,3.7l-1.5,2l-0.5,5.9l-2.3,2.9l-0.2,2.2l1.2,4l-1.2,5.3z',
    'CO': 'M378.6,296.5l-46.5,3.3l-49.9,2.6l-7.2,0.2l2.6,17.2l3.3,18.6l3.7,18.5l3.6,21l53.1-4.5l53.7-6.2l-2.9-23.2l-3.7-24.9l-2.9-22.6z',
    'CT': 'M852.6,205.3l-4.9-18.4l-1.9,0.2l-21.9,5.4l1.7,6.7l1.4,8.3l-0.1,5.7l3.1,0.1l2.3-2.1l1.4,1.2l4.7-3.2l11.9-2.7z',
    'DE': 'M820.3,266.7l0.3-3.2l-1.9-0.1l-1.9-3.1l-3.7-0.9l-2.6,2.6l0.7,5.3l2.8,9.7l4.2,13l5.3-1.1l-0.9-6.2l-0.2-8.2l-2.4-0.3l0.3-7.5z',
    'FL': 'M702.9,470l-0.3,3.3l4.4,6.5l5.2,6.6l3.4,6l3.7,10.5l4,7.5l0.5,4.7l3.7,7.2l4.5,5.2l2.2,4l-0.5,2l1,1.7l-0.2,4.2l-2.2,1.2l0.5,2.2l-1.2,3.2l-0.5,5.5l-3,1.2l-1.5,3.5l-0.2,2.2l-2.5,0.2l0.5,5l-1.2,3.2l-1.5,0l-0.2,3.5l2.2,4l1.2,5l3.7,4.7l1.7-0.5l0.5-2.5l-0.7-3l0.2-3l-2.5-4.7l1.5-1.2l3.5,2l1.5,3.5l3,3l1,3.7l-0.5,2l2.7,5.5l4.2,2.2l2.2,0l0.7-3.5l-1.5-1l0.2-2.7l2.5-3.7l2-7l-0.2-2.5l2.2-4.5l-0.7-6l2.5-5.2l0.2-4.7l1.7-3.2l-1.2-5l-1.7,0.7l0-7.2l1-2.7l-0.2-1.7l1.7-2.7l0.2-2.5l-3-4.7l-4-3.2l-3.7-5l-2.5-1.7l-1-3.5l-3.7-2.5l-1.7-2.2l-3.2-1.7l-0.7-1.5l-3-1l-3.5-3.2l-5.2-1l-2.7-2l-5.2-0.7l-0.8-2l-4.9,1.5z',
    'GA': 'M703.2,469.8l-5.2,0.8l-4.5-0.1l-4.1-1.4l-1.2,0.2l-0.3,1.7l-2.7-1.7l-0.4,0.8l-4.9-0.2l-3.3,0.6l-4.7-0.3l-15.6,1.8l-0.3-3.1l1.7-2.2l1-3.7l-0.8-2.2l1.6-5.2l0.5-2.9l2.9-4.5l-0.3-3.1l-1.9-1.9l0.2-2l-3.3-5.7l-0.6-4.1l-2.2-4.3l0.5-2.3l-1.9-0.5l-1.9-2.7l0.7-5.5l-1.3-4.9l-2.9-5.6l-0.2-2.5l2-2.9l-1.1-4.2l27.4-3.6l14.7-1.7l5.9,36.7l1.9,10.9l4.7,0.4l6.9,0.6l-0.8,6.2l2.3,4.3l4.2,2.9l0.7,4.3l2.9,4.9l2.9,2.4l0.7,2.3l-3.9,0.1l-0.9-2.9l-2.2-0.6l-0.9,1.6z',
    'HI': 'M233.1,578.5l1.9-3.1l0.4-1.9l-0.8-2.6l-2.5-0.5l-1.3,0.8l-0.3,3.5l0.8,2.9zm18.8-5.9l3.6-0.8l0.8-1.1l-1-3l-3.2-0.3l-2.6,1.3l-0.3,2.1zm16.9,0.3l1.1,2.4l2.9,0.3l0.5-0.8l-0.3-2.1l-2.6-1.1l-1.6,1.3zm5.4,6.1l1.6-0.5l1.6-2.4l-0.5-1.9l-3.4,1.3zm13-7.4l-0.5,2.9l2.4,2.1l2.6-1.1l2.9-3.7l-0.3-1.6l-2.7-0.8zm10.7,8.2l-0.3-2.4l2.9-1.6l1.5-3.1l1.8-1.5l1.9,0.3l2.4,2.4l-0.3,2.6l-4,2.4l-2.6,0.3z',
    'ID': 'M224.1,205.6l-7.4,34.5l-4.2,18.8l-0.6,4.6l1.6,3.2l-1.5,3.2l0.7,2.6l2.3,2.6l1.9,0.7l2.7,5.5l-0.6,3.2l2.7,2l-0.2,3l1.2,2.4l-1.3,3.5l-1.4-0.6l-3.9,1.8l0.6,3.5l-4.3,0.3l-2.9,3.4l-0.5,3.7l2.6,2.8l-36.3,6.3l-1.3-7.7l3.5-14l0.2-5.2l2.7-5l-0.2-2.8l3.2-5l0.2-3.3l0.2-1.3l-3.3-3.5l-1.5-5l1.5-7.5l-1.3-2.2l0.8-5.3l3.3-4.5l0.2-2.5l-3.5-3l-2.3-5.3l2.2-9l-2.2-4.8l1.5-6l-0.7-3.5l2-6.3l4.9,1.2l8.7,2l8.6,1.8l8.3,1.5l7.9,1.3l7.9,1.2l8.9,1.2z',
    'IL': 'M584.2,282.5l0.7-2.2l0.1-3.7l-0.9-2.7l0.9-2.2l2.7-2.5l0.3-3.7l-0.7-6l-2.1-5.9l-0.3-5.6l1.4-2.7l-1.1-2l-1.9-1.7l-0.3-5.6l-1.4,0.5l-3.2,2.5l-4.5,0.2l-1.7-1.2l-3.2,1.5l-2.9-1.2l-1.3,0.8l-7.7-3.1l-1-2.7l-7.7,0.8l0.7,3.6l-1.2,2.9l0.7,4.7l-0.8,2.7l2.3,4.5l4.9,4.7l-0.3,6l3,3.6l-0.3,1.7l1.7,4.5l-0.2,7.1l2,4.5l5.9,5l1,4.5l-0.6,7.3l-2.7,4.5l-0.9,4.7l1.4,4.1l4.9,4.1l3.3,0.3l0.9-2.7l2.8-2.2l0.4-1.2l2.9,1.1l2-1.2l0.9,0.5l2.2-2.8l1.1-4l-1.9-2.1l-0.2-3l1.2-3.3l2.9-3.5l-1.7-2.7l-0.6-2l1.4-3.1z',
    'IN': 'M619.5,267.5l0.6-1.7l-0.1-3.4l-2.3-2.2l-0.5-4.9l-1.9-5.5l0.2-2.3l-1.5-2.6l0.1-2.7l-0.6-3.6l-21.4,2.1l-4.9,0.2l0.7,3.6l-1.2,2.9l0.7,4.7l-0.8,2.7l2.3,4.5l4.9,4.7l-0.3,6l3,3.6l-0.3,1.7l1.7,4.5l-0.2,7.1l2,4.5l5.9,5l1.1,4.6l1.9-1l3.2-4l1.2,0.3l1,3.2l1.7,1.5l2.5-2.7l0.3-1.7l-1.3-1.3l1.1-2.5l-0.5-2.6l1.6-3.6l0.3-3.9l-1.2-0.8l0.4-2.3l2.2-2.5l-0.4-2.7l0.3-2.7l-1.7-2.7l1.2-1.3z',
    'IA': 'M558.1,224.5l-0.6-3l-2.2-1.7l-0.5-1.9l-2.9-1.9l-1.4-3.7l0.3-4.2l-1.4-3.5l-2.9-2.2l-0.3-1.5l-56.9,2.4l-1.1,3.1l2.3,4.3l3.1,3.7l0.1,3.2l2.3,3.2l0.6,3l-1.9,4.1l-0.7,4.1l-2,1.9l0.1,2.5l2.4,2.4l2.7,0.7l0.8,2.5l-1.1,2.7l-0.2,2.7l2.2,2l1.7-0.8l3.2,1.2l2.4-1l3.4,0.7l4.9-1.7l6.7,1.5l4.4-1.2l5.4,0.5l4,1.5l1.2-1.7l-0.5-3.5l2.5-0.8l1.2-3.9l2.2-1.9l1-2.7l3-1.7l0.5-3.5l3.5-4l0.8-1.7l-0.8-3.2l3.5-3.5l0.6-2z',
    'KS': 'M490.3,313.5l-73.4,1.9l-32.5,0.5l2.9,22.6l3.7,24.9l2.9,23.2l35.9-1.6l63.3-4.6l1.2-24.1l-0.3-25.2l-1.5-1.2l-0.7-2.7l-1.3-0.8l1.2-3.2l-0.9-1.7z',
    'KY': 'M686.6,344.8l-2.9,2.9l-4.5,4.4l-5.2,3.3l1.3,3.2l-3.4,4.5l0.5,2.7l-3.5,1l-0.5,2.5l-3.4,0.5l-3.2,2l-0.2,2.3l-0.7,2.9l-3.2,0.5l-0.7-1.5l-4.5,3.7l1,2.9l-5.5,4.5l-1.5,0.2l-1.5,2.5l-3.9-0.2l-3-2l-3.4,1.2l-0.7,2.9l-3.7-0.5l-0.5,4.9l-2.7-0.7l-5.7,2.7l-3-0.7l-2.7-1.2l-4.7,1.5l-1.5-2.7l-2.7,0.2l-1.8-1.1l-1.6,1l-1.6-1l0.6-2.5l-2.9-0.5l0.1-2.5l-3.4-2.2l-5.4,4.2l-4.9,0.2l-2.4-2.5l0.5-5.2l-2.2-3.5l4.6-5.2l3.2-0.3l0.6-2l10.9-1l22.7-2.5l8.3-1.2l14.7-1.7l22.3-2.6l6.9-0.7l3.5-5.2l3.7-2.6l3.7-3.6l2.9,0l3.6,2.2l0,3.4l2.7-0.9z',
    'LA': 'M569.7,521.5l-1.7-7.5l-2.5-6.4l0.1-5.6l-1.8-3.2l0.9-5.5l2.4-3.7l-2.2-1.2l1.1-2.2l-2.1-2.4l0.6-4.5l-0.9-3.2l-0.3-2.9l-11.9,0.5l-13.9,0.5l-0.3,3.6l1.2,4.3l4.4,5.7l0.2,4.2l-0.2,3.2l-3,1.5l0.8,3l-0.2,2.5l-2.8,3.5l-1.4-0.3l-1-3.3l-3.4-2.3l-5-0.3l-1.3-2.5l0.2-3l-3.5,0.5l-3.5,2l-0.2-3.2l-4.5,1.2l-4,2.7l0.3,4.7l3.7,2.2l0.2,2.2l-2,1.5l1.8,2.2l-0.8,5.2l3.5,1.2l4.5-1l4-2l1.3,1.7l-3,3.2l2,1.7l0.2,1.5l4.8,1.2l2.2-2.5l1.5,0.7l-0.2,4l3.2,0.2l1.5-2l3.7,0.7l1.5,1.7l3.7-0.5l3.8-3.7l-0.5-3.2l2.7-0.2l0.2,2.7l4,1.5l2.8-0.5l0.5-2.5l2-0.5l2.7,2.2l0.2,3.5l3.5,0.7l1.7-1.5l0.7,1l-0.7,3.2l4.2,1.7l0.2-1.5l1.7-0.5l0.2,2l4.4-0.5l0.7-2l-1.8-1.2l3.5-2.3z',
    'ME': 'M900.6,105.7l1.5-1.8l1.8-4.1l-1.2-4.9l1.7-4.2l-1.8-4.8l-2-0.9l-1.5,2l-0.5,4.1l-1.1-0.5l-0.5-3.9l-0.8,0l-1.7,3.9l-0.6,0.3l0.5,3.7l-3.2-2l-0.3-2.4l1.3-1.2l0.3-3.3l-1.3-3.2l-1.7,0.7l-1-3l-2.3,0.2l-0.7-3.3l-1.8-3.8l-2.2-1.5l-2.1,0.6l-0.8,2l-0.9-1.5l-1.9,3.3l-3.9,6.3l-2.1,1.2l-3.9,0.2l-1.7-0.3l-0.8-1.2l-2.3,2.3l-1.9,0.5l4.9,19.4l0.9,2.5l5.1,16.7l3.4-0.3l1.6,2.2l2.2-2.2l0.3-1.9l2.2,0.3l1.9-3.1l2.2,2.2l0.9-0.6l-0.3-2.8l2.2-1.5l0.3-4.4l0.9-4.4l2.2-3.8l2.8-4.1l1.9,1.2l1.2-0.9l0.6-2.7z',
    'MD': 'M823.9,291.3l-3.2-9.9l-2.5-8.1l-4.9,1l-5.7,0.3l-5.8,1.7l-4.9,0.3l-1.7-3.1l-2.1-0.2l-4.2,2.1l-2.7-0.7l-8.9,2l-18.9,3.9l-12.6,2.3l0.6,4.9l0.2,2l0.7,3.5l4.7-5.3l2.9-0.7l2.2,1.5l3,0.2l2.2-3.5l3-0.2l3.2,2.7l-4,4.2l-1.2,2.2l-0.5,2.2l2.9,0.7l1.5,2.2l-1.7,0.7l0.6,5.4l5.3-0.2l1.8-2.1l1.8,1.1l2.6-0.2l1-2.7l2.5-1l1.2,2.8l5,0.3l3.9-0.3l0-2.7l1.7-1.4l0.5-4.3l3.2-1.2l0.9,1.7l-0.7,3.7l0.5,1l1.7-2.5l1.9,1.2l-0.2,2l-0.7,1.7l1.4,1.7l2.2-0.5l3.4-2.9l3.9-0.2l2.7,1l1.4-1l0.8-3.3l-0.8-2.2l1.4-1.5l0.5,1.5z',
    'MA': 'M889.8,176.6l-0.2-1.7l2-0.3l0.5,1l-2.3,1zm12.6-3.6l-2.1-0.5l-1.3,0.8l-1.4-2.5l1.7-0.5l1.6,0.8l2.1,0.5l-0.6,1.4zm-23.7,13.7l2.2-0.8l0.9-1.7l2.2,1.5l-0.3,1.5l-1.7,0.8l-3.3-0.2v-1.1zm-38.6-7.9l1.7-3.2l2.9-4.9l2.7-0.5l1.5-2.2l5.5-2l0.3,2l4.2,0.2l3.7,3l7.5,1.5l2.2-0.2l3.2-3l1.5,3l-2.7,0.7l-4.2,1.2l-2.7,2.2l-0.5,1.5l3.5,0.5l0.2,1l-4.5,1.7l-5.7,1.5l-1.5,0.7l-3.5-3.7l0.5-2.5l-3.2-0.5l-4.9,1.7l-0.5-2l-5.7,1l-1.4-1.7zm-1.5,9.9l2.9,0.5l1.5-0.5l1.2,1.2l4.4-0.2l0.5,1l-4.4,1.5l-4.4-0.5l-1.9-1l0.2-2z',
    'MI': 'M548.6,135.7l2.6-3.8l3.6-3.3l3.1-1.5l-0.3-4.1l1.2-1.7l0.2-3.9l1.3-0.9l3.6,2.5l5.9,1.7l3.6,0.5l2.5-0.7l6.5,1.7l1,1.5l-0.2,2.6l0.7,0.7l7.8-3l2.4-0.5l-0.2-2.2l1.2-0.7l0.5,0.5l2.7-1l5.5-4l2.7-3.8l-0.7-17.8l-1.5-1.2l-2.2-0.2l-1-1.5l-2.9-0.5l-2.2,0.7l-3,1.8l-0.5,2.5l1.2,1.5l0.2,1l-2.7,2l-3.2-0.2l-1.2-1.7l-0.7-2.7l-2.2-0.5l-5,1.2l-1.3-0.8l-7.8,2.5l-2,3.3l0.2,2l-2.2,3.7l-2.7,0.5l-0.7,2.7l0.2,3.7l3,1.5l3.4,0.2l0.8,1l0.3,6l-2.8,1.2l-1.2,1.5l-0.5,2.7l-3.1,5l-0.3,4.6zm8.9,3l1.9-2.7l1.7-1.2l5.4-2.2l1.5-1.5l0-1.7l-3.4,1.2l-3.4,2.9l-2.4,1.7l-1,3.5zm65.6,84l-1.9-12l-2.9-13.2l-1.5-3l-1.7-0.5l-0.9-4.1l-3.1-5.2l-1.2-1.6l0.9-0.4l-0.2-2.1l-2.3-1.7l-2.5-4.5l-0.6-6.3l1.1-4.1l-0.3-4.5l-1-2l0.3-6.7l2.1-3.4l0.3-2.9l-0.7-1.1l1.2-4.5l-0.9-3.6l-1.4-0.5l-0.3-3.4l-3.5-1l-3.4-2.8l-6.5-3.6l-7-1.2l-3.1-1.3l-5.9-0.3l-0.7,1.2l-4.4,1l-2.4-1.7l-8.2-1.5l-6.6,0.3l-0.2,2.2l2.5,1.5l0.2,2l-1.2,2.2l-0.2,1.7l2.7,3.6l3.7,3.5l-0.2,4.6l1,0.7l3.7-2.9l2.9,0.5l0.5,0.7l-2.9,2.5l-4.7,6l-1.2,3.6l0.2,4.1l-1.7,1.7l0,1.6l2.7,2.3l4.5,0.8l0.7-1.5l-0.3-2.3l1.7-1.5l3.9,0.8l1,3.6l-1.2,5.1l-0.3,5.6l1.5,3.5l-0.5,6.8l-1.2,5.6l1,4.5l0,3.6l-1.2,4.9l0,3.8l22.2-2.5l21.4-2.9z',
    'MN': 'M487.9,125.7l-0.7-10.9l-1-10.2l-1.9-4.9l-0.5-8.4l0.7-4.5l-1.5-4l-0.4-8.9l-0.9-1.2l-0.2-4.2l43.9-1l0.2,3.7l2.3,5.4l3.9,4l0.5,5.8l2.9,6l0.2,4.5l3.1,4l0.2,7.3l-2.3,5l0.5,3.8l2.9,2l-0.2,6.2l-2.5,0.2l-0.2,5.3l0.7,5l-0.2,4.3l-4.3,0.2l-1.1,3.9l-5.1,0.2l-0.7,5.2l-2.4,0.2l-0.7,2.3l0.5,2.5l-1.1,2.1l-3.6-0.7l-2.3,2.9l-3.2-0.5l-5.3,3.8l-2.3-0.2l-1.4-3l-3.9,0.5l-3.6,3.2l-2.1-0.9l-1.1-4.5l-2.9-1.4l-4.3-3.4l-8.2-1.1l-1.8-3.6l-3.7-0.2l-0.5-1.6l2.6-2.5l1.5-2.8l1-4.5l2.2-3.1l0.8-5.7l-1.7-2.7l-0.1-3.2l2-1z',
    'MS': 'M591.7,523.2l-23.5,1.7l-12.6,0.2l-4.4,3.1l-2.9-1.5l0.2-4.7l5.2-0.5l1.5-1.7l0.7-4.4l-1.7-1.2l1-2.5l-2-1.6l-0.2-2.9l-1.9-2.3l1.1-2.2l-2.1-2.4l0.6-4.5l-0.9-3.2l-0.3-2.7l-11.9,0.5l-14,0.5l-0.3,3.6l1.2,4.3l4.4,5.7l0.2,4.2l-0.2,3.2l-3,1.5l0.8,3l-0.2,2.5l-2.8,3.5l-1.4-0.3l-1-3.3l-3.4-2.3l-5-0.3l-1.3-2.5l0.2-3l-3.5,0.5l-1.2,0.2l1.9,9.9l2.7,9l0.3,4.2l3.4,5.9l0.7,5.5l3,5.4l0.5,3.7l-1,5.9l0.9,2l37.9-1.9l3.3-0.3l1.2-3.8l2.4-1.5l-0.2-3.2l2.2-4l0.9-5.9l3.6-3.4l-0.8-2.7l1.6-4.4l-0.5-3.9l2.9-4.4z',
    'MO': 'M568.2,308.3l-1.8-2.5l-3.2-0.7l-2.3,0.7l-2.4-3l-0.2-3.2l-1.7-1.5l-3.2,2.2l-0.7-1.5l-0.8-6.2l-2.6-3.1l-1.6,1l-1.7-0.7l-1.9,1.2l-2-2.3l-2-4.6l-2.3-2.2l-52.1,1.4l0,8l1,4.7l3.1,3.7l2.4,1.7l2.3,3.9l3.5,1.5l1.9,1.7l1.1,5.3l-1.1,4.9l0.6,1.6l-1,1.7l0.1,1.3l-1.5,1.2l0.7,2.7l1.5,1.2l0.3,25.2l-1.2,24.1l28.3-0.6l28.9-1.3l8.7-0.5l-0.1-4.1l-0.3-1.7l1.1-4.1l0.2-2.4l-1.9-3l-0.2-3.2l0.7-2l-0.7-1.3l2.1-3l0.7-2.2l-1.7-3.7l0.3-3.3l2.7-3l0.6-3.9l-1.9-2.4l0.9-4.2l35.1-1.3l2.9,0.5l3.1-1.5l3.9,2.4l7.3-0.4l0.2-1.5l-2.3-4.1l0.8-3l-3.9-5.1l-3.3-4.1l-5.7-1l-2.3-2l-0.9-3.6l-3.4,0.3l-5.9-2.1z',
    'MT': 'M330.9,99.7l-0.9,15.9l1.7,10.2l0.3,16.4l1.8,18.2l-42.7,3l-42.9,1.5l-26.1,0.3l7.4-34.5l-8.9-1.2l-7.9-1.2l-7.9-1.3l-8.3-1.5l-8.6-1.8l-8.7-2l-4.9-1.2l4.9-22.7l3.4-16.7l50.9,10.9l48.2,8.2l50.2,6.9z',
    'NE': 'M380.8,235.9l-24.9-0.5l-34.5-1.4l1.9-25l-36.6,0.3l-3.6,0.3l1.4,3.3l4.7,5.7l4.6,4.6l5.5,4l1.7,3.6l3.9,2.7l1.9,3.7l-0.2,5.2l3,3l1.2,3.4l2.8,0.3l1.5,2.3l2.1-0.3l1.4,1.2l39.6-1l46.5-3.3l-2.2-18.9l-2.9-20l-16.3,0.5z',
    'NV': 'M175.8,318.9l15.2,42.1l14.2,38.7l6.3,17.9l5.9,17.2l24.9-2.7l24.3-3.3l-8.6-39.3l-10.1-45.9l-6.2-29.7l-3.9-17.9l-36.3,6.3l-2.6-2.8l0.5-3.7l2.9-3.4l4.3-0.3l-0.6-3.5l3.9-1.8l1.4,0.6l1.3-3.5l-1.2-2.4l0.2-3l-2.7-2l0.6-3.2l-2.7-5.5l-1.9-0.7l-2.3-2.6l-0.7-2.6l1.5-3.2l-1.6-3.2l0.6-4.6l4.2-18.8l-27.6,4.7l-3.5,54.2l-4.9,72.7z',
    'NH': 'M868.7,147.2l0.5-3.1l3.2-0.5l0.8-2.7l-0.4-5.9l-2.9-1.5l-0.2-2.5l1.3-3.7l-1.9-4.7l0.5-3l-0.4-5.9l-2-6.6l0.5-2.5l-0.8-3.7l0.6-5.7l-1.3-5.3l-5.1,1.4l-0.7,4.7l-2.4,0.7l-2.5,0.2l-1.9,3.3l-3.9,6.3l-2.1,1.2l-3.9,0.2l-1.2-0.4l0.5,3.9l2.7,1.3l1,2.8l0.3,11.9l-1.6,2.9l0.8,2.3l-0.3,5.9l0.3,7.9l3.2,0.3l1.8-1.6l2,1.8l4.7-0.5l0.3-2.5l1.9-0.6l3.9,0l1.3,3.3l5.2,1.7z',
    'NJ': 'M836.3,229l-2.9-0.5l-2.9,2.7l-1,3.7l0.7,1.2l-0.9,3.4l-2.2,3l-0.2,1.7l2.2,2.5l-1,2.5l-1.9,1l1.7,1.5l1.2,3.7l2.2,2.5l2.7,5.4l4.5,6.7l2.5,1.5l1-0.5l1.5-3.5l-0.9-1.7l-2.9-0.2l-2.5-4l0.5-1.5l1.2,0.2l0.7-2.2l-0.2-7l0.5-4l-1.7-3l0.5-2.7l0.2-5.2l-1.2-3.2l-0.3-3z',
    'NM': 'M300.4,384.5l-4.3,0.5l-7.2,0.2l2.6,17.2l3.3,18.6l3.7,18.5l3.6,21l9.9-0.8l24.5-2.8l24.2-2.8l9-1.3l-0.7-6.2l-7.1-66.3l-27,2.3l-4-0.1l0,5.9l-28.3,2.6l-2.2-6.3z',
    'NY': 'M846.4,193.2l-1.9-0.1l-2.1,2.4l-2.3,0l-1.7-2.4l-1.4,0.6l-2.5,2.9l-2.5,0.6l-3.7,3.6l-3,3.8l-2.5,1.2l-5.6,1.4l-5.6,0l-0.2-2.9l0.5-2.2l1.2-0.7l1.2-2.2l-0.5-1.2l-3.3-0.2l-3.2-3.6l-9.2-30.9l-4.5-1.5l-37.2,9.1l3.4,13l2.7,2.5l0.3,6.4l4.9,5.7l0.7,3.3l-0.9,4.2l2,4.4l-0.3,5.5l-0.9,1.7l0.3,2.3l-2.4,2.7l1.6,2.9l-0.3,1.7l-2.4,2l-3.9,1.4l-2.9,3.7l-3.3,3.2l-2.4,0.7l-2.5,2.7l-1.9-0.3l-0.3-5.5l1-3.9l1.9-2.4l0-3.2l-3.1-2.9l0.3-2.5l1.6-2.7l1.1-7.7l3.5-6.6l5.4-6.1l2.4-3.5l-0.6-0.6l-4.9,2.5l-3.6,3.8l-4.3,5.9l-2.4,5.9l-2.9,4.9l-0.7,3.5l0.2,8.5l-2.7,3.2l-0.3,1.5l2.3,2.8l-0.7,2.5l-3.7,3.8l-1.3,3.7l7.7,0.3l59.1-12l18.9-3.9l8.9-2l2.7,0.7l4.2-2.1l2.1,0.2l1.7,3.1l4.9-0.3l5.8-1.7l5.7-0.3l4.9-1l1.4-8.3z',
    'NC': 'M818.9,359l2-2.9l3.4-1.7l1-3l1.4-0.3l0.7,2.1l3.2-2.4l3.4-3.6l1.5-3.6l2.2-2l-0.2-1.4l-4.3-0.1l0-2.3l1.2-0.4l1.5-3l1.8-0.3l-0.2-1.8l-3-1.7l-0.5-2.4l1.9-0.4l0.2-2l-3.6,1.2l-7.2,0.6l-22.2,2.7l-22.7,2.3l-21.9,1.7l-22.7,2.5l-10.9,1l-0.6,2l-3.2,0.3l-4.6,5.2l2.2,3.5l-0.5,5.2l2.4,2.5l4.9-0.2l5.4-4.2l3.4,2.2l-0.1,2.5l2.9,0.5l-0.6,2.5l1.6,1l1.6-1l1.8,1.1l2.7-0.2l1.5,2.7l4.7-1.5l2.7,1.2l3,0.7l5.7-2.7l2.7,0.7l0.5-4.9l3.7,0.5l0.7-2.9l3.4-1.2l3,2l3.9,0.2l1.5-2.5l1.5-0.2l5.5-4.5l-1-2.9l4.5-3.7l0.7,1.5l3.2-0.5l0.7-2.9l0.2-2.3l3.2-2l3.4-0.5l0.5-2.5l3.5-1l-0.5-2.7l3.4-4.5l-1.3-3.2l5.2-3.3l4.5-4.4l2.9-2.9l4.2,8.7l3.1,11.3l2.4,5.2l4.4,5.3z',
    'ND': 'M430.7,118.7l0.1-2.1l-0.7-6.3l-0.7-8.6l-0.5-4.6l-2.2-8.2l0.2-6.1l-0.7-6.4l-0.5-6.7l-43.8,1.5l-50.2-1.1l-0.3,16.4l1.8,18.2l1.5,18.9l0.8,16.3l56.2-1.7l38.9-2.2z',
    'OH': 'M692.5,265l-3.2-3.4l-4.2-1.2l-2.5,0.7l-3.4,3.3l-3.1,0.5l-4.2,2.5l-7.5,3.2l-3.1,0.5l-2.9,1.7l-14.6,1.5l-10.9,1.7l-14.9,1.3l0.6,3.6l-0.1,2.7l1.5,2.6l-0.2,2.3l1.9,5.5l0.5,4.9l2.3,2.2l0.1,3.4l-0.6,1.7l-1.2,1.3l1.7,2.7l-0.3,2.7l0.4,2.7l-2.2,2.5l-0.4,2.3l1.2,0.8l-0.3,3.9l-1.6,3.6l0.5,2.6l-1.1,2.5l1.3,1.3l-0.3,1.7l-2.5,2.7l-1.7-1.5l-1-3.2l-1.2-0.3l-3.2,4l-1.9,1l4.9,4.3l4.4,3.8l6.2,5.3l9.5,7l3.6,0.8l2.8-3.7l3.4,1.2l2.9-2.9l2.4,1.2l3.5-3.6l5.4-4.8l1.9-2.8l1.2-4.6l4.4-4.4l-0.7-1.9l3.4-4.4l5.8-5.4l1.9-4.6l4-2.4l-0.5-5.6l1.9-4.2l3.1-3.5l3.4-5.5l3-7.2l3.7-3.4z',
    'OK': 'M438.7,403.5l-26.5,0.2l-0.6-11.6l-47.8,0.6l-0.7-5.2l0-0.6l-0.9-1.7l1.2-3.2l-0.7-2.7l1.5-1.2l-0.1-1.3l1-1.7l-0.6-1.6l1.1-4.9l-1.1-5.3l-1.9-1.7l-3.5-1.5l-2.3-3.9l-2.4-1.7l-3.1-3.7l-1-4.7l0-8l52.1-1.4l2,4.6l2,2.3l1.9-1.2l1.7,0.7l1.6-1l2.6,3.1l0.8,6.2l0.7,1.5l3.2-2.2l1.7,1.5l0.2,3.2l2.4,3l2.3-0.7l3.2,0.7l1.8,2.5l6.7-0.8l0.5,10.7l34.3-1l29.9-2.5l-1.9,1.7l1,3.5l-0.7,2.7l2.3,2.2l0.5,4.4l-1.9,2.1l1.5,3.4l-1.7,5.9l0.9,3.4l-1.2,2.9l-0.9,5l-0.4,0.7z',
    'OR': 'M173.3,189.2l-2.2,9l2.3,5.3l3.5,3l-0.2,2.5l-3.3,4.5l-0.8,5.3l1.3,2.2l-1.5,7.5l1.5,5l3.3,3.5l-0.2,1.3l-0.2,3.3l-3.2,5l0.2,2.8l-2.7,5l-0.2,5.2l-3.5,14l1.3,7.7l27.6-4.7l3.5-54.2l4.9-72.7l-26.5,5.5l-27.3,4.5l-4.9-0.5l-2.2-2.2l-3.2-0.3l-0.5,3.3l-5.7,1.8l-4.4,2.2l-1.6-0.4l-2.5,1.8l-0.5-0.5l2.8-5.8l4.5-4.3l1.4-4.7l-1.5-3l2.5-4.2l0.5-6.5l2-3.5l-0.4-1.4l-2.7,0.4l-2.5,4.5l-2.2,1.2l-4.3,1.4l-2.2,2.3l-4.7,1.7l-2-0.5l-3.5,3.8l-0.2,2.7l3.5,2.6l0.3,3.9l-2.8,4.2l-0.2,3.3l1.2,4.7l-2.8,6.7l-0.2,5.6l2.3,5.1l0.4,5l-0.9,2.9l3.7,4.6l-0.5,4.5l4.5-0.3l5.9-0.8l4.7,2.2l3.7,1.2l2.7-0.2l6.4,3.3l4.5,1l4.4,0.3l3.6,2l3.7-0.2l2.9-1.7l4,0.5l3.4,2.8l3.1-0.3z',
    'PA': 'M825.4,230.7l-3.2-12.6l-34.8,7.9l-37.2,7.1l-3.4-13l-2.7-2.5l0.9-4.2l-0.7-3.3l-4.9-5.7l-0.3-6.4l4.5,1.5l9.2,30.9l3.2,3.6l3.3,0.2l0.5,1.2l-1.2,2.2l-1.2,0.7l-0.5,2.2l0.2,2.9l5.6,0l5.6-1.4l2.5-1.2l3-3.8l3.7-3.6l2.5-0.6l2.5-2.9l1.4-0.6l1.7,2.4l2.3,0l2.1-2.4l1.9,0.1l1.9-0.2l4.9,18.4l2.7,10.6l1,5l5.7-0.3l22.5-4.5l6.2-1.1z',
    'RI': 'M867.2,197.7l-1.1-6.3l-0.6-4l-5.2-1.7l-1.3-3.3l-3.9,0l-1.9,0.6l-0.3,2.5l-4.7,0.5l0.8,2.5l3.5,4.3l3.2,4.5l1,3l5.1,1.9l0.5-3.3l2.2,0l2.7-1.2z',
    'SC': 'M732.9,416.4l-3.6-2.7l-4.1-1.1l-1.3-2.4l-2.7-1.3l-3.2,1.8l-4.5,5.3l-2.9-1.2l-1.1-2.3l-5.7,0.5l-2.1,0.9l-4.4-2l-9.7,2.7l-9.3,4.6l-6,4.9l-2.9,0.5l-0.7,2.9l-3.2,3.3l0.3,4.8l2,2.5l-0.3,4.1l2.2,0.6l0.9,2.9l3.9-0.1l-0.7-2.3l-2.9-2.4l-2.9-4.9l-0.7-4.3l-4.2-2.9l-2.3-4.3l0.8-6.2l-6.9-0.6l-4.7-0.4l-1.9-10.9l-5.9-36.7l22.7-2.5l21.9-1.7l3.4,10.1l8.3,15l7.3,8l6,4l4.7,0.2l1.5,5.7l6.4,3l4.9,5l3.7,2.3l1.7,4l4.7,4.6z',
    'SD': 'M431.1,213.7l-0.5-5.6l-0.1-12.9l-56.2,1.7l-38.9,2.2l0.5,10.7l2.2,6.9l-1.6,4l1.3,3l3.1,6.2l1.3,1.7l0.2,3.3l5.7,7.1l0.7,3.4l-1.6,4.5l0.5,0.6l34.5,1.4l24.9,0.5l16.3-0.5l2.9,20l2.2,18.9l4.3,0.2l4-1.5l0.2-3l3.9-1.4l1.3-2.8l-0.2-2.7l-2.4-2.2l-0.3-2.5l0.4-5.7l-0.2-9l2.3-0.5l0.4-7.2l-1.2-3.4l-3-3l0.2-5.2l-1.9-3.7l-3.9-2.7l-1.7-3.6l-5.5-4l-4.6-4.6l-4.7-5.7l-1.4-3.3l3.6-0.3z',
    'TN': 'M664.9,378l-3.1,2.8l-5.4,1.2l-2.8,2l-1.3-0.2l-5.2,3.5l-1.5,2.4l-2.5,1.4l-3.6-0.3l-2.3-2.3l-3.5,2.5l-4.7,1.6l-0.3,1.9l-4.3,2.7l-3.4,3.3l-3.1,1.6l-6.2,1.1l-6.7,3.9l-3.9,0.9l-2.6,1.7l-24,2.2l-7.2,0.9l-3.7,0.4l-11.6,1.4l-12.9,0.5l-9.5,1l0.9-4.3l-1.9-2.9l4.9-4.9l1.1-2.5l8.4-0.4l24.9-2.3l8.7-0.5l1.2-2.4l2.7-2l2.2-2.6l3.5,0.5l4.3-4.5l4.1,0.7l2.5-3.7l2.1-0.2l2.3-2.8l-0.2-2.6l2.9-1.7l4.7-1.9l4.6-1.5l0.7,2.5l2.4-2.1l-0.4-4.5l3.1-2l1.9,1l1.5-3.1l3.6-0.2l1.7-3.2l1.4,0.5l0.7-1.7l2.9-1l22.3-2.6l14.7-1.7l7.9-1.2l-2.7,0.9l0,3.4l-2.7,0.9l0,3.4l-3.6-2.2l-2.9,0l-3.7,3.6l-3.7,2.6l-3.5,5.2z',
    'TX': 'M438.3,404.2l29.9-2.5l34.3-1l-0.5-10.7l-6.7,0.8l-1.8-2.5l5.9-0.5l5.9,2.1l3.4-0.3l0.9,3.6l2.3,2l5.7,1l3.3,4.1l3.9,5.1l-0.8,3l2.3,4.1l-0.2,1.5l-7.3,0.4l-0.9,5l1.1,4.3l0.8,4.4l1.1,2.2l0.7,2l0.3,2.7l0.9,3.2l-0.6,4.5l2.1,2.4l-1.1,2.2l1.9,2.3l0.2,2.9l2,1.6l-1,2.5l1.7,1.2l-0.7,4.4l-1.5,1.7l-5.2,0.5l-0.2,4.7l2.9,1.5l4.4-3.1l12.6-0.2l23.5-1.7l-2.9,4.4l0.5,3.9l-1.6,4.4l0.8,2.7l-3.6,3.4l-0.9,5.9l-2.2,4l0.2,3.2l-2.4,1.5l-1.2,3.8l-1.4,0.5l-0.9,3.4l0.8,1.5l-3,6.3l1.7,2.7l-0.2,2.2l0.7,3.5l1.5,3.5l0.7,4.2l2.5,2l0.7,2.7l2.2,2.2l0.2,1.5l2.5,4.3l3.4,3.4l1,2.5l2,2l-0.7,2.8l-3.4,0.3l-4.7,2.2l-0.7,2l-4.2,4.5l-1.2,2.2l2.5,1.2l-2,4.7l-2.5,3l0,2l-2.5,1.7l-4.2,0.5l-4.2,2.2l-5.2,1l-2,2.7l-2.5,1l-3,2.9l-4,1.7l-5.7,4.7l-4.7,2.7l-3.7,3.5l-1.2,4l-5,4.2l-1.2,0.5l-0.2,2.5l-3.4,1.5l-2.5-1.3l-4.5,1.8l-5.1,0.3l-3.5-2.9l-1.5-4.2l-4.2-5.9l-1.3-1l-0.3-2.7l-2.8-2.5l-0.5-3l-1.2-1.2l-0.2-2.2l-2.2-2.2l-0.3-5.2l-4.5-8.2l-0.3-3.5l-2-2.5l0.2-5.5l-0.7-3.5l0.2-2.5l0.7-1.8l-1.2-3l0-2.2l-1.5-5l-1.8-2.3l-0.8-3.7l-2.4-3.5l0.1-2.2l-2.2-1.7l-0.5-5.2l-2.5-5.2l0.2-1.9l-2.8-2.5l-5.7-15.2l-1.9-1.7l0.3-1l-6.9-14.4l-7.5-3.5l-3.4-0.3l-1.8,0.3l-1.8-1.5l-3.1,0.8l-3.4-2.2l-3.2,0.6l-3.4,2.9l-3.7,0.7l-1.4,1.4l-1.7-0.8l-2.1,1.1l-2.7-0.3l-2.1-1.5l-0.5-2.7l0.8-3.7l-0.1-4.1l-2-1l-3.1-4.5l-5.7-2.2l-0.5-1l-3.2-1.5l-2.4-3.3l-0.1-4.7l-2.7-4.4l2.4,0l6.4,3l3.4-0.3l0.6-3.7l2.7-0.2l1-3l3.7-2.7l1.7-1l2.5-2.2l-0.8-1.6l-2.9-0.3l-2.4-3l-1-2.9l-3.9-0.7l0.5-3l-2.4-2.2l-0.2-4.7l26.5-0.2z',
    'UT': 'M283.7,283l-5.6,0.5l-27.5,2.8l-2.2-18l-3.2-19.5l-1.2-6.1l-3.9-19.4l27.5-5.3l-1.8-9l32.6-5.5l7.2,40.7l6.2,35.9l-28.1,2.9z',
    'VT': 'M838.2,148.7l2.5-0.6l0.4-2.9l1.7-4l0.5-3.7l-3.1-8.6l1.6-3.5l-1.7-4.5l-0.5-7.6l2.3-5.4l-0.5-1.7l-0.8,0l-0.3-7.9l0.3-5.9l-0.8-2.3l1.6-2.9l-0.3-11.9l-1-2.8l-2.7-1.3l-0.5-3.9l1.2,0.4l-24.3,6.6l2.1,8.9l0.6,27l0.7,15.7l-0.7,6.3l0.3,2.2l1.7,0.5l0.8,2l3.6,0.5l1.9,3l4,0.2l0.5,2.2l2.1,0.8l3.2,4.7l3.7,1.7z',
    'VA': 'M821.6,322.9l-0.5-1.5l-1.4,1.5l0.8,2.2l-0.8,3.3l-1.4,1l-2.7-1l-3.9,0.2l-3.4,2.9l-2.2,0.5l-1.4-1.7l0.7-1.7l0.2-2l-1.9-1.2l-1.7,2.5l-0.5-1l0.7-3.7l-0.9-1.7l-3.2,1.2l-0.5,4.3l-1.7,1.4l0-2.7l-3.9,0.3l-5-0.3l-1.2-2.8l-2.5,1l-1,2.7l-2.6,0.2l-1.8-1.1l-1.8,2.1l-5.3,0.2l-0.6-5.4l1.7-0.7l-1.5-2.2l-2.9-0.7l0.5-2.2l1.2-2.2l4-4.2l-3.2-2.7l-3,0.2l-2.2,3.5l-3-0.2l-2.2-1.5l-2.9,0.7l-4.7,5.3l-0.7-3.5l-0.2-2l-0.6-4.9l-10.7,4.4l2.6,3.5l-1.7,6l0.2,9l-0.2,4.7l0.5,2.7l-0.3,1.8l-0.3,6.9l-2.7,0l-1.4-2.2l-2.9,2.3l-0.3,2.4l1.6,1.4l0.3,2.8l1.9,2.4l0.1,3.9l0.7,2.3l25.9-7l25.2-6l5.7-1.2l5.1,10.1l2.5-1.9l3.9-0.9l2.2,0.3l2.2,0.5l2-2.5l0.3-3.5l3.3,0.2l2.5-1.4l3-3.1l4.2,3.2l3.2,0.2l2-0.9l-4.4-5.3l-2.4-5.2l-3.1-11.3l-4.2-8.7z',
    'WA': 'M173.2,61.7l-2.5,0.2l-1.2,1.5l-3.2,0.2l-0.7-0.7l-3.5,2.2l-0.2,2.2l-1.5,0.5l-2.5,3l-3,1.5l1.2,2.3l-0.2,5.7l0.7,2l-2,2.2l0.2,3l1.5,1.7l0.5,4.5l0.5,6.5l-2.5,4.2l1.5,3l-1.4,4.7l-4.5,4.3l-2.8,5.8l0.5,0.5l2.5-1.8l1.6,0.4l4.4-2.2l5.7-1.8l0.5-3.3l3.2,0.3l2.2,2.2l4.9,0.5l27.3-4.5l26.5-5.5l-4.9-22.7l-3.4-16.7l-2.2,0.4l-1.5-3.7l-3.7-0.5l-1.7-3l-1.2,1.2l-2.4-2.5l-0.8,1.5l-0.8-2l-2.5-0.5l0.3-1.5l-2-0.7l-0.3,1.2l-2.5-1.2l0.8,3.7l-1.8,0.2l-0.8-1.5l-0.3-3.2l-3.4,0.7l-0.2,2.4l-1.2-3l-2.9,2.7l-1.3-0.5l-1.2,3z',
    'WV': 'M732.9,290l-2.4,1.7l-1.7,4l0.3,2.2l-1.4,2.6l0.2,1.3l-1.5,3.7l0.5,2.5l-2.2,1l-2.2,2.3l-2.9,0.6l-4.1,4.2l-2.9,4.6l0.1,1.9l-1.7,1.3l-0.5,2.8l-2.1,0.7l-0.5,1.6l-3.5,0.5l-0.7,3.6l-2.4,0.5l-2,2l-1.2-0.7l-0.7,2.5l-1.7-0.3l-0.5,1l-2.1,0.2l-1.7-3.9l-2.4,2.5l-2.2-1.8l-1.5,0.5l-0.2-2.4l1.4-1.1l0.2-2.9l1-2l-1.2-1.5l0.5-2.5l-1.5-3.2l3.7-2.4l0.7-2.4l1.9-2.3l-0.5-3l1.9-4l2.2-2l0.3-4.2l1.2-3.6l-1-4l2.4-0.7l3.3-3.2l2.9-3.7l3.9-1.4l2.4-2l-1.6-2.9l2.4-2.7l-0.3-2.3l0.9-1.7l0.3-5.5l-2-4.4l0.9-4.2l2.9-1.7l3.1-0.5l7.5-3.2l4.2-2.5l3.1-0.5l3.4-3.3l2.5-0.7l4.2,1.2l3.2,3.4l-3.7,3.4l-3,7.2l-3.4,5.5l-3.1,3.5l-1.9,4.2l0.5,5.6l-4,2.4l-1.9,4.6l-5.8,5.4l-3.4,4.4l0.7,1.9l-4.4,4.4z',
    'WI': 'M558.9,202.3l-0.2-2.5l1.2-2.5l1-5.2l-1.2-2.2l-0.2-3.5l1.2-3.7l0.5-4.2l-1.5-4.9l-0.5-5.2l-0.5-1.9l-1.4-1.1l1.1-2l-0.6-1.7l0.7-2.2l-0.4-3l0.9-4.1l1.7-3l-0.5-1.9l0.7-2.7l1.5-2l0-3.2l-0.7-2.2l2.4-4.9l3.1-4.4l-0.5-1l-1.8,0.5l-4.8,2.9l-1.7,0l-4.6,2.2l-2,3.2l-4.4,2.7l-0.7-0.2l-2.9,1.7l-3.4,0.5l-3.4-0.5l-0.2-2.7l-3.1-0.2l-2.4-1.5l-9-1.2l-5.3-0.2l-1.2-1.7l-4.3-3.6l-0.2-7.3l-3.1-4l-0.2-4.5l-2.9-6l-0.5-5.8l-3.9-4l-2.3-5.4l-0.2-3.7l-3.1,0.4l0.5,3.2l-3.3,0.5l-4.2,1.2l0.2,4.7l-0.5,3.2l-2,1.7l-0.2,4l1.2,3l-1.7,2l-0.2,2.7l1.2,4.2l1.2,2.5l-0.9,5.7l-2.2,3.1l-1,4.5l-1.5,2.8l-2.6,2.5l0.5,1.6l3.7,0.2l1.8,3.6l8.2,1.1l4.3,3.4l2.9,1.4l1.1,4.5l2.1,0.9l3.6-3.2l3.9-0.5l1.4,3l2.3,0.2l5.3-3.8l3.2,0.5l2.3-2.9l3.6,0.7l-1.1-2.1l-0.5-2.5l0.7-2.3l2.4-0.2l0.7-5.2l5.1-0.2l1.1-3.9l4.3-0.2l0.2-4.3l-0.7-5l0.2-5.3l2.5-0.2l0.2-6.2l-2.9-2l-0.5-3.8l2.3-5l-0.2-7.3l5.3,1.9l1.2,0.3l7.2,2.1l1.3,7.9l1.5,3.8l-0.5,4.5l1,4.8l-0.6,5.9l1.7,5l-0.9,3.4l0.5,2.6l-1.3,2.6l1.2,2.3l-0.2,4.7l4.6,5.2l0.4,3l-0.3,3.4l0.5,3.9l3.4,4.4l0.5,1.9l-1.5,2.7l0.2,2z',
    'WY': 'M335.1,219.6l-4.3-0.2l-39.6,1l-1.4-1.2l-2.1,0.3l-1.5-2.3l-2.8-0.3l-1.2-3.4l-7.2-40.7l42.7-6.1l42.9-5.2l5.1,36.6l5.7,43.9l-46.5,4.1l7.2,0.2l4.3-0.5l-1.3-25.9z'
};

/**
 * Render the US Map with choropleth coloring
 */
function renderUSMap() {
    const container = document.getElementById('us-map-container');
    if (!container) return;

    // Calculate min/max values for current layer
    const values = Object.keys(currentStateData).map(state => getStateValue(currentStateData[state]));
    const minVal = Math.min(...values.filter(v => v > 0), 0);
    const maxVal = Math.max(...values, 1);

    // Update legend
    const legendLow = document.getElementById('legend-low');
    const legendHigh = document.getElementById('legend-high');
    if (legendLow && legendHigh) {
        if (currentMapLayer === 'volume') {
            legendLow.textContent = '0';
            legendHigh.textContent = maxVal.toLocaleString();
        } else {
            legendLow.textContent = '0%';
            legendHigh.textContent = '100%';
        }
    }

    // Build SVG
    let pathsHtml = '';
    for (const [abbr, path] of Object.entries(usMapPaths)) {
        const stateName = abbrToStateName[abbr];
        const stateInfo = currentStateData[stateName];
        const value = stateInfo ? getStateValue(stateInfo) : 0;
        const color = getChoroplethColor(value, minVal, maxVal);
        const isSelected = selectedState === stateName;

        pathsHtml += `<path
            id="state-${abbr}"
            d="${path}"
            fill="${color}"
            data-state="${stateName}"
            data-abbr="${abbr}"
            class="${isSelected ? 'selected' : ''}"
        />`;
    }

    container.innerHTML = `
        <svg viewBox="100 50 750 520" xmlns="http://www.w3.org/2000/svg">
            ${pathsHtml}
        </svg>
    `;

    // Add event listeners
    const paths = container.querySelectorAll('path');
    const tooltip = document.getElementById('map-tooltip');

    paths.forEach(path => {
        path.addEventListener('mouseenter', (e) => showMapTooltip(e, tooltip));
        path.addEventListener('mousemove', (e) => moveMapTooltip(e, tooltip));
        path.addEventListener('mouseleave', () => hideMapTooltip(tooltip));
        path.addEventListener('click', (e) => handleStateClick(e));
    });
}

/**
 * Show tooltip on state hover
 */
function showMapTooltip(e, tooltip) {
    if (!tooltip) return;

    const stateName = e.target.dataset.state;
    const stateInfo = currentStateData[stateName];
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

    tooltip.innerHTML = `
        <div class="tooltip-title">${stateName}</div>
        <div class="tooltip-value">${valueLabel}: ${valueDisplay}</div>
        ${currentMapLayer !== 'volume' ? `<div>Total Trials: ${trialCount.toLocaleString()}</div>` : ''}
    `;
    tooltip.classList.add('visible');
}

/**
 * Move tooltip with cursor
 */
function moveMapTooltip(e, tooltip) {
    if (!tooltip) return;
    const rect = e.target.closest('#us-map-container').getBoundingClientRect();
    const x = e.clientX - rect.left + 15;
    const y = e.clientY - rect.top + 15;
    tooltip.style.left = `${x}px`;
    tooltip.style.top = `${y}px`;
}

/**
 * Hide tooltip
 */
function hideMapTooltip(tooltip) {
    if (!tooltip) return;
    tooltip.classList.remove('visible');
}

/**
 * Handle state click to show city breakdown
 */
function handleStateClick(e) {
    const stateName = e.target.dataset.state;
    const stateInfo = currentStateData[stateName];

    // Update selected state
    selectedState = stateName;

    // Re-render map to show selection
    renderUSMap();

    // Show city breakdown
    showCityBreakdown(stateName, stateInfo);
}

/**
 * Show city breakdown for selected state
 */
function showCityBreakdown(stateName, stateInfo) {
    const detailRow = document.getElementById('state-detail-row');
    const title = document.getElementById('state-detail-title');
    const tbody = document.getElementById('city-table-body');
    const metricHeader = document.getElementById('city-metric-header');

    if (!detailRow || !tbody) return;

    if (!stateInfo || !stateInfo.cities) {
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
        .sort((a, b) => b[1] - a[1]);

    const totalInState = stateInfo.count;

    tbody.innerHTML = '';

    sortedCities.forEach(([city, count], index) => {
        const pct = totalInState > 0 ? ((count / totalInState) * 100).toFixed(1) : '0.0';

        // For reporting layers, we'd need city-level trial data
        // For simplicity, showing trial counts for now
        let metricValue = count.toLocaleString();

        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${index + 1}</td>
            <td>${city}</td>
            <td>${metricValue}</td>
            <td>${pct}%</td>
        `;
        tbody.appendChild(row);
    });

    // Show detail section
    detailRow.style.display = 'block';

    // Scroll to detail section
    detailRow.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/**
 * Close state detail section
 */
function closeStateDetail() {
    const detailRow = document.getElementById('state-detail-row');
    if (detailRow) {
        detailRow.style.display = 'none';
    }
    selectedState = null;
    renderUSMap();
}

/**
 * Render the international geography table
 */
function renderInternationalTable(geoCounts, totalTrials) {
    const tbody = document.getElementById('geography-table-body');

    if (!tbody) return;

    // Sort by count (for international view, geoCounts is { country: count })
    const sorted = Object.entries(geoCounts)
        .sort((a, b) => b[1] - a[1]);

    tbody.innerHTML = '';

    if (sorted.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 2rem;">No international location data available for current filters.</td></tr>';
        return;
    }

    sorted.forEach(([location, count], index) => {
        const pct = totalTrials > 0 ? ((count / totalTrials) * 100).toFixed(1) : '0.0';
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
        document.getElementById('us-map-row').style.display = 'block';
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
            showCityBreakdown(selectedState, currentStateData[selectedState]);
        }
    } else {
        // Show international table, hide US map
        document.getElementById('us-map-row').style.display = 'none';
        document.getElementById('international-table-row').style.display = 'block';
        document.getElementById('reporting-layer-controls').classList.add('hidden');
        document.getElementById('state-detail-row').style.display = 'none';

        // Render international table
        renderInternationalTable(geoCounts, filtered.length);
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

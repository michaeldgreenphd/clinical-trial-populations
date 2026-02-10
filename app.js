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

// Build list of URL strategies to try for fetching data
// Returns array of { name, urls } objects in priority order
function getUrlStrategies(date) {
    // Latest data: just use local relative paths
    if (!date || date === 'latest') {
        return [{
            name: 'Local',
            urls: ['data/demographics.part1.json.gz', 'data/demographics.part2.json.gz']
        }];
    }

    // Historical data: try multiple strategies
    return [
        // Strategy 1: jsDelivr CDN (works on GitHub Pages, proper CORS)
        {
            name: 'jsDelivr CDN',
            urls: [
                `${JSDELIVR_BASE}@${date}/data/demographics.part1.json.gz`,
                `${JSDELIVR_BASE}@${date}/data/demographics.part2.json.gz`
            ]
        },
        // Strategy 2: GitHub Release assets (may have CORS issues)
        {
            name: 'GitHub Release',
            urls: [
                `${RELEASE_BASE}/${date}/demographics.part1.json.gz`,
                `${RELEASE_BASE}/${date}/demographics.part2.json.gz`
            ]
        },
        // Strategy 3: raw.githubusercontent.com (works if file exists at tag)
        {
            name: 'Raw GitHub',
            urls: [
                `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${date}/data/demographics.part1.json.gz`,
                `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${date}/data/demographics.part2.json.gz`
            ]
        },
        // Strategy 4: Fall back to latest local data (for development/testing)
        {
            name: 'Local (fallback)',
            urls: ['data/demographics.part1.json.gz', 'data/demographics.part2.json.gz']
        }
    ];
}

async function loadData(date) {
    const strategies = getUrlStrategies(date);
    let lastError = null;

    for (const strategy of strategies) {
        try {
            console.log(`Trying ${strategy.name} strategy...`);
            const [part1, part2] = await Promise.all([
                fetchAndDecompress(strategy.urls[0]),
                fetchAndDecompress(strategy.urls[1])
            ]);

            data = [...part1.data, ...part2.data];
            console.log(`✓ Loaded ${data.length} studies via ${strategy.name}`);

            // Show which snapshot is loaded
            let dateLabel = '';
            if (date && date !== 'latest') {
                // Check if we fell back to local data
                if (strategy.name === 'Local (fallback)') {
                    dateLabel = ` (showing latest - ${date} unavailable)`;
                } else {
                    dateLabel = ` (${date} snapshot)`;
                }
            }
            document.getElementById('last-updated').textContent =
                new Date(part1.extracted_at).toLocaleDateString() + dateLabel;
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

// Wrapper function to reload with a specific date
async function loadDataAndRender(date) {
    document.getElementById('history-date').value = date;
    await loadData(date);
    if (data && data.length > 0) {
        populateConditionsDropdown();
        populateCountriesDropdown();
        renderDashboard();
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

                    // Always count cities (a study can have multiple sites in different cities)
                    stateData[stateName].cities[city] = (stateData[stateName].cities[city] || 0) + 1;

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

// D3 map state variables
let mapSvg = null;
let mapG = null;
let cityG = null;
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

    // Get container dimensions
    const width = container.clientWidth || 900;
    const height = Math.min(width * 0.62, 560);

    // Create SVG with D3
    mapSvg = d3.select(container)
        .append('svg')
        .attr('viewBox', `0 0 ${width} ${height}`)
        .attr('preserveAspectRatio', 'xMidYMid meet')
        .attr('class', 'us-map-svg');

    // Create main group for states (will be transformed on zoom)
    mapG = mapSvg.append('g').attr('class', 'states-group');

    // Create group for city markers (on top of states)
    cityG = mapSvg.append('g').attr('class', 'cities-group');

    // Fetch TopoJSON if not already loaded
    if (!usTopology) {
        try {
            usTopology = await d3.json('https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json');
            const statesGeo = topojson.feature(usTopology, usTopology.objects.states);

            // Attach state name and abbreviation to each feature
            statesGeo.features.forEach(f => {
                const fips = String(f.id).padStart(2, '0');
                f.properties.name = fipsToStateName[fips] || '';
                f.properties.abbr = stateNameToAbbr[f.properties.name] || '';
            });

            usGeoFeatures = statesGeo;

            // Pre-projected data (Albers USA) - use geoIdentity to fit to our SVG
            const projection = d3.geoIdentity().reflectY(true).fitSize([width, height], statesGeo);
            geoPathGenerator = d3.geoPath(projection);
        } catch (err) {
            console.error('Failed to load US TopoJSON:', err);
            return;
        }
    } else {
        // Recalculate projection for current container size
        const projection = d3.geoIdentity().reflectY(true).fitSize([width, height], usGeoFeatures);
        geoPathGenerator = d3.geoPath(projection);
    }

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
    const minVal = Math.min(...values.filter(v => v > 0), 0);
    const maxVal = Math.max(...values, 1);

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
            legendLow.textContent = '0%';
            legendHigh.textContent = '100%';
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

    const container = document.getElementById('us-map-container');
    const rect = container.getBoundingClientRect();
    const x = event.clientX - rect.left + 15;
    const y = event.clientY - rect.top + 15;

    // Keep tooltip within container
    const tooltipRect = tooltip.getBoundingClientRect();
    const maxX = rect.width - tooltipRect.width - 10;
    const maxY = rect.height - tooltipRect.height - 10;

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

        // Show city markers after zoom completes
        setTimeout(() => {
            renderCityMarkers(stateName, stateAbbr, stateInfo, transform);
        }, 750);

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
 * Render city markers on the zoomed state
 */
function renderCityMarkers(stateName, stateAbbr, stateInfo, transform) {
    if (!cityG || !stateInfo || !stateInfo.cities) {
        cityG.selectAll('*').remove();
        return;
    }

    // Calculate centroid dynamically from the GeoJSON feature
    let centroid = [480, 300]; // fallback
    if (usGeoFeatures && geoPathGenerator) {
        const feature = usGeoFeatures.features.find(f => f.properties.abbr === stateAbbr);
        if (feature) {
            const c = geoPathGenerator.centroid(feature);
            if (c && isFinite(c[0]) && isFinite(c[1])) {
                centroid = c;
            }
        }
    }

    // Prepare city data with positions
    const cities = Object.entries(stateInfo.cities)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20); // Limit to top 20 cities

    const maxCount = cities.length > 0 ? cities[0][1] : 1;

    // Generate positions for cities around the centroid
    const cityData = cities.map(([cityName, count], i) => {
        // Distribute cities in a spiral pattern from centroid
        const angle = (i / cities.length) * Math.PI * 2;
        const radius = 20 + (i * 8); // Increasing radius
        const x = centroid[0] + Math.cos(angle) * radius;
        const y = centroid[1] + Math.sin(angle) * radius;

        return {
            name: cityName,
            count,
            x,
            y,
            radius: Math.max(3, Math.sqrt(count / maxCount) * 12)
        };
    });

    // Clear existing markers
    cityG.selectAll('*').remove();

    // Apply same transform as states
    cityG.attr('transform', transform.toString());

    // Add city markers with animation
    const markers = cityG.selectAll('g.city-marker')
        .data(cityData)
        .enter()
        .append('g')
        .attr('class', 'city-marker')
        .attr('transform', d => `translate(${d.x}, ${d.y})`)
        .style('opacity', 0);

    // Add circles
    markers.append('circle')
        .attr('r', 0)
        .attr('fill', '#0d9488')
        .attr('fill-opacity', 0.7)
        .attr('stroke', '#fff')
        .attr('stroke-width', 1.5 / transform.k) // Adjust stroke for zoom level
        .transition()
        .duration(400)
        .delay((d, i) => i * 30)
        .attr('r', d => d.radius / transform.k); // Adjust size for zoom level

    // Add labels for larger cities
    markers.filter(d => d.count >= maxCount * 0.2)
        .append('text')
        .attr('class', 'city-label')
        .attr('y', d => -(d.radius / transform.k) - 4)
        .attr('text-anchor', 'middle')
        .attr('font-size', `${10 / transform.k}px`)
        .attr('fill', '#1e293b')
        .attr('font-weight', '500')
        .text(d => d.name.length > 15 ? d.name.substring(0, 15) + '...' : d.name);

    // Animate in
    markers.transition()
        .duration(400)
        .delay((d, i) => i * 30)
        .style('opacity', 1);

    // Add hover tooltips
    markers
        .on('mouseenter', (event, d) => showCityTooltip(event, d))
        .on('mouseleave', hideCityTooltip);
}

/**
 * Show tooltip for city marker
 */
function showCityTooltip(event, d) {
    const tooltip = document.getElementById('map-tooltip');
    if (!tooltip) return;

    tooltip.innerHTML = `
        <div class="tooltip-title">${d.name}</div>
        <div class="tooltip-value">Trials: ${d.count.toLocaleString()}</div>
    `;
    tooltip.classList.add('visible');

    const container = document.getElementById('us-map-container');
    const rect = container.getBoundingClientRect();
    tooltip.style.left = `${event.clientX - rect.left + 15}px`;
    tooltip.style.top = `${event.clientY - rect.top + 15}px`;
}

/**
 * Hide city tooltip
 */
function hideCityTooltip() {
    const tooltip = document.getElementById('map-tooltip');
    if (tooltip) {
        tooltip.classList.remove('visible');
    }
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

    // Remove city markers
    cityG.selectAll('*')
        .transition()
        .duration(300)
        .style('opacity', 0)
        .remove();

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
        .sort((a, b) => b[1] - a[1]);

    const totalInState = sortedCities.reduce((sum, [, count]) => sum + count, 0);

    tbody.innerHTML = '';

    sortedCities.forEach(([city, count], index) => {
        const pct = totalInState > 0 ? ((count / totalInState) * 100).toFixed(1) : '0.0';

        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${index + 1}</td>
            <td>${city}</td>
            <td>${count.toLocaleString()}</td>
            <td>${pct}%</td>
        `;
        tbody.appendChild(row);
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

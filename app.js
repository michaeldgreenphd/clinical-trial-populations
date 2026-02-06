// ClinicalTrials.gov Demographics Dashboard - Enhanced Version

let data = null;
let charts = {};
let currentSort = { field: null, direction: 'asc' };
let currentPage = 0;
const PAGE_SIZE = 100;

// GitHub release-asset URL base for historical snapshots
const REPO_OWNER = 'michaeldgreenphd';
const REPO_NAME  = 'clinical-trial-populations';
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

// Return the two .json.gz URLs for a given date.
// "latest" (or no argument) → relative paths served from the repo root.
// A date string (YYYY-MM-DD) → absolute GitHub-Release asset URLs.
function dataURLsForDate(date) {
    if (!date || date === 'latest') {
        return [
            'data/demographics.part1.json.gz',
            'data/demographics.part2.json.gz'
        ];
    }
    return [
        `${RELEASE_BASE}/${date}/demographics.part1.json.gz`,
        `${RELEASE_BASE}/${date}/demographics.part2.json.gz`
    ];
}

async function loadData(date) {
    const [url1, url2] = dataURLsForDate(date);
    try {
        console.log('Loading data parts...');
        const [part1, part2] = await Promise.all([
            fetchAndDecompress(url1),
            fetchAndDecompress(url2)
        ]);

        data = [...part1.data, ...part2.data];
        console.log(`Total studies loaded: ${data.length}`);

        document.getElementById('last-updated').textContent =
            new Date(part1.extracted_at).toLocaleDateString();
    } catch (error) {
        console.error('Error loading data:', error);
        document.getElementById('last-updated').textContent = 'Error loading data';

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
            </div>
        </div>
    `;

    overlay.innerHTML = html;
    overlay.style.display = 'flex';
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
 * Graph C for Race: Reported Distribution (Scaled by Confidence)
 * 100% stacked area chart showing proportions of REPORTED race data
 * Opacity encodes Visual Confidence (% of total enrollment that reported race)
 * Faint colors = low reporting; Vivid colors = high reporting
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
                other: 0,
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
            byYear[year].other += (omb.american_indian_alaska_native || 0) +
                                  (omb.native_hawaiian_pacific_islander || 0) +
                                  (omb.more_than_one_race || 0) +
                                  (omb.other || 0) +
                                  (omb.unknown_not_reported || 0);
        }
    });

    const years = Object.keys(byYear).sort();

    // Calculate percentages - normalize ONLY reported categories to 100%
    // Encode missingness as opacity (visual confidence)
    const whiteData = [];
    const blackData = [];
    const asianData = [];
    const otherData = [];
    const confidenceData = []; // Store confidence for each year

    years.forEach(y => {
        const data = byYear[y];
        // Fix: Use max of (enrollment, knownSum) to prevent negative unknown
        const knownSum = data.white + data.black + data.asian + data.other;
        const effectiveTotal = Math.max(data.totalEnrollment, knownSum);

        if (knownSum === 0) {
            whiteData.push(0);
            blackData.push(0);
            asianData.push(0);
            otherData.push(0);
            confidenceData.push(0.3); // Minimum opacity
            return;
        }

        // Normalize reported categories to 100% of REPORTED population
        whiteData.push((data.white / knownSum) * 100);
        blackData.push((data.black / knownSum) * 100);
        asianData.push((data.asian / knownSum) * 100);
        otherData.push((data.other / knownSum) * 100);

        // Visual confidence = proportion of total that was reported
        // Minimum 0.3 so data is never invisible
        const confidence = Math.max(0.3, knownSum / effectiveTotal);
        confidenceData.push(confidence);
    });

    // Helper to apply opacity to a hex color
    const applyOpacity = (hexColor, opacityArray) => {
        // Convert hex to RGB
        const r = parseInt(hexColor.slice(1, 3), 16);
        const g = parseInt(hexColor.slice(3, 5), 16);
        const b = parseInt(hexColor.slice(5, 7), 16);
        return opacityArray.map(opacity => `rgba(${r}, ${g}, ${b}, ${opacity})`);
    };

    if (charts.raceFullDistribution) charts.raceFullDistribution.destroy();

    charts.raceFullDistribution = new Chart(ctx, {
        type: 'line',
        data: {
            labels: years,
            datasets: [
                {
                    label: 'White',
                    data: whiteData,
                    backgroundColor: applyOpacity(COLORS.race.white, confidenceData),
                    borderColor: applyOpacity(COLORS.race.white, confidenceData.map(c => Math.min(1, c + 0.2))),
                    fill: true,
                    tension: 0.1
                },
                {
                    label: 'Black/African American',
                    data: blackData,
                    backgroundColor: applyOpacity(COLORS.race.black_african_american, confidenceData),
                    borderColor: applyOpacity(COLORS.race.black_african_american, confidenceData.map(c => Math.min(1, c + 0.2))),
                    fill: true,
                    tension: 0.1
                },
                {
                    label: 'Asian',
                    data: asianData,
                    backgroundColor: applyOpacity(COLORS.race.asian, confidenceData),
                    borderColor: applyOpacity(COLORS.race.asian, confidenceData.map(c => Math.min(1, c + 0.2))),
                    fill: true,
                    tension: 0.1
                },
                {
                    label: 'Other Races',
                    data: otherData,
                    backgroundColor: applyOpacity(COLORS.race.other, confidenceData),
                    borderColor: applyOpacity(COLORS.race.other, confidenceData.map(c => Math.min(1, c + 0.2))),
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
                    title: { display: true, text: '% of Reported Participants' }
                },
                x: {
                    stacked: true,
                    title: { display: true, text: 'Year' }
                }
            },
            plugins: {
                legend: { position: 'right' },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const pct = context.parsed.y.toFixed(1);
                            return ` ${context.dataset.label}: ${pct}%`;
                        },
                        afterBody: function(tooltipItems) {
                            if (tooltipItems.length === 0) return '';
                            const yearIndex = tooltipItems[0].dataIndex;
                            const confidence = (confidenceData[yearIndex] * 100).toFixed(0);
                            const opacity = confidenceData[yearIndex] < 0.5 ? 'faint' :
                                           confidenceData[yearIndex] < 0.75 ? 'moderate' : 'solid';
                            return `\nVisual Confidence: ${confidence}%\n(Data is ${opacity} because ${confidence}% of participants reported race)`;
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
 * Graph C for Ethnicity: Reported Distribution (Scaled by Confidence)
 * 100% stacked area chart showing proportions of REPORTED ethnicity data
 * Opacity encodes Visual Confidence (% of total enrollment that reported ethnicity)
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
                totalEnrollment: 0
            };
        }

        const enrollment = study.enrollment || 0;
        byYear[year].totalEnrollment += enrollment;

        if (study.ethnicity?.reported) {
            const omb = study.ethnicity.omb_totals;
            byYear[year].hispanic += omb.hispanic_latino || 0;
            byYear[year].notHispanic += omb.not_hispanic_latino || 0;
        }
    });

    const years = Object.keys(byYear).sort();

    // Calculate percentages - normalize ONLY reported categories to 100%
    // Encode missingness as opacity (visual confidence)
    const hispanicData = [];
    const notHispanicData = [];
    const confidenceData = []; // Store confidence for each year

    years.forEach(y => {
        const data = byYear[y];
        // Fix: Use max of (enrollment, knownSum) to prevent negative unknown
        const knownSum = data.hispanic + data.notHispanic;
        const effectiveTotal = Math.max(data.totalEnrollment, knownSum);

        if (knownSum === 0) {
            hispanicData.push(0);
            notHispanicData.push(0);
            confidenceData.push(0.3); // Minimum opacity
            return;
        }

        // Normalize reported categories to 100% of REPORTED population
        hispanicData.push((data.hispanic / knownSum) * 100);
        notHispanicData.push((data.notHispanic / knownSum) * 100);

        // Visual confidence = proportion of total that was reported
        // Minimum 0.3 so data is never invisible
        const confidence = Math.max(0.3, knownSum / effectiveTotal);
        confidenceData.push(confidence);
    });

    // Helper to apply opacity to a hex color
    const applyOpacity = (hexColor, opacityArray) => {
        // Convert hex to RGB
        const r = parseInt(hexColor.slice(1, 3), 16);
        const g = parseInt(hexColor.slice(3, 5), 16);
        const b = parseInt(hexColor.slice(5, 7), 16);
        return opacityArray.map(opacity => `rgba(${r}, ${g}, ${b}, ${opacity})`);
    };

    if (charts.ethnicityFullDistribution) charts.ethnicityFullDistribution.destroy();

    charts.ethnicityFullDistribution = new Chart(ctx, {
        type: 'line',
        data: {
            labels: years,
            datasets: [
                {
                    label: 'Hispanic/Latino',
                    data: hispanicData,
                    backgroundColor: applyOpacity(COLORS.ethnicity.hispanic_latino, confidenceData),
                    borderColor: applyOpacity(COLORS.ethnicity.hispanic_latino, confidenceData.map(c => Math.min(1, c + 0.2))),
                    fill: true,
                    tension: 0.1
                },
                {
                    label: 'Not Hispanic/Latino',
                    data: notHispanicData,
                    backgroundColor: applyOpacity(COLORS.ethnicity.not_hispanic_latino, confidenceData),
                    borderColor: applyOpacity(COLORS.ethnicity.not_hispanic_latino, confidenceData.map(c => Math.min(1, c + 0.2))),
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
                    title: { display: true, text: '% of Reported Participants' }
                },
                x: {
                    stacked: true,
                    title: { display: true, text: 'Year' }
                }
            },
            plugins: {
                legend: { position: 'right' },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const pct = context.parsed.y.toFixed(1);
                            return ` ${context.dataset.label}: ${pct}%`;
                        },
                        afterBody: function(tooltipItems) {
                            if (tooltipItems.length === 0) return '';
                            const yearIndex = tooltipItems[0].dataIndex;
                            const confidence = (confidenceData[yearIndex] * 100).toFixed(0);
                            const opacity = confidenceData[yearIndex] < 0.5 ? 'faint' :
                                           confidenceData[yearIndex] < 0.75 ? 'moderate' : 'solid';
                            return `\nVisual Confidence: ${confidence}%\n(Data is ${opacity} because ${confidence}% of participants reported ethnicity)`;
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

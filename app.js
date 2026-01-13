// ClinicalTrials.gov Demographics Dashboard - Enhanced Version

let data = null;
let charts = {};
let currentSort = { field: null, direction: 'asc' };

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

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    await loadData();
    initTabs();
    initFilters();
    initSubcategoryButtons();
    initTable();
    renderDashboard();
});

async function loadData() {
    try {
        const response = await fetch('data/demographics.json');
        const json = await response.json();
        data = json.data;
        document.getElementById('last-updated').textContent =
            new Date(json.extracted_at).toLocaleDateString();
    } catch (error) {
        console.error('Error loading data:', error);
        document.getElementById('last-updated').textContent = 'Error loading data';

        // Show friendly error message
        document.querySelector('main').innerHTML = `
            <div class="chart-container">
                <h3>No Data Available</h3>
                <p class="note">The demographics data file has not been generated yet. Run the extraction script to generate data:</p>
                <pre style="background: #f1f5f9; padding: 1rem; border-radius: 0.25rem; margin-top: 1rem;">
python src/extract_all.py --output data/demographics.json --limit 100
                </pre>
            </div>
        `;
    }
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
                renderStudiesTable();
            }
        });
    });
}

function initFilters() {
    const filterIds = ['year-start', 'year-end', 'study-type', 'phase', 'sponsor-class'];
    filterIds.forEach(id => {
        const element = document.getElementById(id);
        if (element) {
            element.addEventListener('change', () => {
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

    // Condition search
    const conditionSearch = document.getElementById('condition-search');
    const clearCondition = document.getElementById('clear-condition');

    if (conditionSearch) {
        conditionSearch.addEventListener('input', (e) => {
            const hasValue = e.target.value.trim().length > 0;
            clearCondition.style.display = hasValue ? 'block' : 'none';
            renderDashboard();
            updateActiveFilters();
        });
    }

    if (clearCondition) {
        clearCondition.addEventListener('click', () => {
            conditionSearch.value = '';
            clearCondition.style.display = 'none';
            renderDashboard();
            updateActiveFilters();
        });
    }

    // Reset filters button
    const resetBtn = document.getElementById('reset-filters');
    if (resetBtn) {
        resetBtn.addEventListener('click', resetFilters);
    }
}

function resetFilters() {
    document.getElementById('year-start').value = 2009;
    document.getElementById('year-end').value = 2026;
    document.getElementById('year-start-label').textContent = '2009';
    document.getElementById('year-end-label').textContent = '2026';
    document.getElementById('study-type').value = 'all';
    document.getElementById('phase').value = 'all';
    document.getElementById('sponsor-class').value = 'all';
    document.getElementById('condition-search').value = '';
    document.getElementById('clear-condition').style.display = 'none';

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

    const condition = document.getElementById('condition-search').value.trim();
    if (condition) {
        filters.push({ label: `Condition: ${condition}`, reset: () => {
            document.getElementById('condition-search').value = '';
            document.getElementById('clear-condition').style.display = 'none';
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
        tableSearch.addEventListener('input', renderStudiesTable);
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
    const conditionSearch = document.getElementById('condition-search')?.value?.toLowerCase().trim() || '';

    return data.filter(study => {
        const year = parseInt(study.results_date?.substring(0, 4));
        if (isNaN(year) || year < yearStart || year > yearEnd) return false;
        if (studyType !== 'all' && study.study_type !== studyType) return false;
        if (phase !== 'all') {
            if (phase === 'N/A') {
                if (study.phase && study.phase.trim() !== '') return false;
            } else {
                if (!study.phase?.includes(phase)) return false;
            }
        }
        if (sponsorClass !== 'all' && study.sponsor_class !== sponsorClass) return false;
        if (conditionSearch) {
            const title = study.brief_title?.toLowerCase() || '';
            if (!title.includes(conditionSearch)) return false;
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
    renderEthnicityDistribution(filtered);
    renderEthnicityTrends(filtered);
    renderEthnicitySubcategories(filtered);
    renderSexDistribution(filtered);
    renderSexTrends(filtered);
    renderGenderDistribution(filtered);

    // Update table if visible
    const studiesTab = document.querySelector('.tab[data-tab="studies"]');
    if (studiesTab?.classList.contains('active')) {
        renderStudiesTable();
    }
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
            if (currentSort.field === 'enrollment') {
                aVal = parseInt(aVal) || 0;
                bVal = parseInt(bVal) || 0;
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

    // Render rows
    tbody.innerHTML = filtered.map(study => `
        <tr>
            <td>
                <a href="https://clinicaltrials.gov/study/${study.nct_id}"
                   target="_blank"
                   class="nct-link">${study.nct_id}</a>
            </td>
            <td>${escapeHtml(study.brief_title || 'N/A')}</td>
            <td><span class="phase-badge">${study.phase || 'N/A'}</span></td>
            <td>${study.study_type || 'N/A'}</td>
            <td>${study.sponsor_class || 'N/A'}</td>
            <td class="text-right">${(study.enrollment || 0).toLocaleString()}</td>
            <td>${study.results_date || 'N/A'}</td>
            <td class="text-center">${study.race?.reported ? '<span class="check-mark">✓</span>' : '<span class="x-mark">✗</span>'}</td>
            <td class="text-center">${study.ethnicity?.reported ? '<span class="check-mark">✓</span>' : '<span class="x-mark">✗</span>'}</td>
            <td class="text-center">${study.sex?.reported ? '<span class="check-mark">✓</span>' : '<span class="x-mark">✗</span>'}</td>
        </tr>
    `).join('');

    // Update count
    if (countSpan) {
        countSpan.textContent = `Showing ${filtered.length} ${filtered.length === 1 ? 'study' : 'studies'}`;
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
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
                legend: { position: 'right' }
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
    if (!ctx) return;

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

    if (charts.raceSubcategory) charts.raceSubcategory.destroy();

    charts.raceSubcategory = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels.length > 0 ? labels : ['No subcategories found'],
            datasets: [{
                label: 'Count',
                data: labels.length > 0 ? Object.values(subcategories) : [0],
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
                legend: { position: 'right' }
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
    if (!ctx) return;

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

    if (charts.ethnicitySubcategory) charts.ethnicitySubcategory.destroy();

    charts.ethnicitySubcategory = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels.length > 0 ? labels : ['No subcategories found'],
            datasets: [{
                label: 'Count',
                data: labels.length > 0 ? Object.values(subcategories) : [0],
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
                legend: { position: 'right' }
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
                legend: { display: false }
            }
        }
    });
}

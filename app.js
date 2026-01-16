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
    const filterIds = [
        'year-start', 'year-end', 'study-type', 'phase', 'sponsor-class',
        'intervention-model', 'masking', 'primary-purpose',
        'enrollment-type', 'healthy-volunteers'
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
    document.getElementById('intervention-model').value = 'all';
    document.getElementById('masking').value = 'all';
    document.getElementById('primary-purpose').value = 'all';
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
    const interventionModel = document.getElementById('intervention-model')?.value || 'all';
    const masking = document.getElementById('masking')?.value || 'all';
    const primaryPurpose = document.getElementById('primary-purpose')?.value || 'all';
    const enrollmentType = document.getElementById('enrollment-type')?.value || 'all';
    const healthyVolunteers = document.getElementById('healthy-volunteers')?.value || 'all';
    const conditionSearch = document.getElementById('condition-search')?.value?.toLowerCase().trim() || '';

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
    tbody.innerHTML = filtered.map(study => {
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
            <td>${escapeHtml(study.brief_title || 'N/A')}</td>
            <td><span class="phase-badge">${study.phase || 'N/A'}</span></td>
            <td class="text-center">${renderDemographicCell(study, 'race')}</td>
            <td class="text-center">${renderDemographicCell(study, 'ethnicity')}</td>
            <td class="text-center">${renderDemographicCell(study, 'sex')}</td>
            <td class="text-center">
                <button class="details-btn" onclick="showStudyDetails('${study.nct_id}')" title="View full study details">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M8 4.5a.5.5 0 0 1 .5.5v3h3a.5.5 0 0 1 0 1h-3v3a.5.5 0 0 1-1 0v-3h-3a.5.5 0 0 1 0-1h3v-3A.5.5 0 0 1 8 4.5z"/>
                    </svg>
                </button>
            </td>
            <td>${study.study_type || 'N/A'}</td>
            <td>${study.intervention_model || study.observational_model || 'N/A'}</td>
            <td title="${escapeHtml(study.primary_endpoint || 'N/A')}">${truncateText(study.primary_endpoint || 'N/A', 40)}</td>
            <td title="${escapeHtml(study.lead_sponsor_name || 'Unknown')}">${truncateText(study.lead_sponsor_name || 'Unknown', 30)}</td>
            <td class="text-right">${enrollmentBadge}</td>
            <td>${ageRange}</td>
            <td>${statusWithReason}</td>
        </tr>
        `;
    }).join('');

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

    return `<button class="demo-check"
                    onclick="showBreakdown('${study.nct_id}', '${breakdownKey}')"
                    title="Click to view breakdown">
                ✓
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

    // Get raw categories for transparency (if available)
    const rawCategories = study[categoryName]?.raw_categories || [];

    // Build breakdown HTML
    let html = `<div class="breakdown-modal">
        <h4>${categoryDisplay} Distribution - ${nctId}</h4>
        <p class="modal-subtitle">Click outside to close</p>
        <table class="breakdown-table">
            <thead><tr><th>NIH/OMB Category</th><th>Original Label</th><th>Match Quality</th><th>Count</th><th>Percent</th></tr></thead>
            <tbody>`;

    // Sort by count descending
    const entries = Object.entries(breakdown).sort((a, b) => b[1].count - a[1].count);

    for (const [category, data] of entries) {
        // Find matching raw category for this entry
        const rawCat = rawCategories.find(rc =>
            (rc.original === category ||
             (rc.omb_category && formatOmbCategory(rc.omb_category) === category))
        );

        const originalLabel = rawCat?.original || category;
        const confidence = rawCat?.confidence || 'n/a';
        const isFuzzy = rawCat?.flags?.some(f => f.includes('fuzzy_match')) || false;
        const isUnmapped = rawCat?.flags?.includes('unmapped') || false;

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
            <td>${data.count.toLocaleString()}</td>
            <td style="--percent: ${data.percent}">${data.percent.toFixed(1)}%</td>
        </tr>`;
    }

    html += `</tbody></table>
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
                        <div><strong>Gender:</strong> ${study.gender || 'ALL'}</div>
                        <div><strong>Healthy Volunteers:</strong> ${study.healthy_volunteers ? 'Yes' : 'No'}</div>
                    </div>
                </div>

                <div class="detail-section">
                    <h5>Sponsor & Collaborators</h5>
                    <p><strong>Lead Sponsor:</strong> ${escapeHtml(study.lead_sponsor_name || 'Unknown')} <span class="badge">${study.sponsor_class || 'N/A'}</span></p>
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

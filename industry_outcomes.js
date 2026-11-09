/*
 * Industry tab, "Trial outcomes" pane (beta).
 *
 * Reads the outcomes artifact family the engine writes by hand into data/outcomes/
 * (civicsample-engine outcomes/README.md, schema version 1): run.json, summary.json,
 * index.json and records/rNN.json. It presents; it computes no aggregate. Every count shown
 * is a published numerator with its published denominator; list filters only select rows.
 *
 * Three layers stay visibly apart in the evidence panel: what the registry reports, what the
 * method concludes, and what a person checked. A machine assessment that no person has
 * reviewed is labelled as such wherever it appears, and is shown only on a local preview
 * (localhost); elsewhere a provisional build renders as evidence only.
 *
 * Loaded by index.html before app.js; app.js calls IndustryOutcomes.open(el, deps) when the
 * Industry tab's switch selects "Trial outcomes".
 */
(function (root) {
    'use strict';

    const SCHEMA_VERSION = 1;
    const BASE = 'data/outcomes/';
    const TRIAL_STATES = ['MET', 'NOT_MET', 'INSUFFICIENT_EVIDENCE', 'NOT_APPLICABLE', 'PENDING', 'UNREPORTED',
        'CONFLICTING', 'ROLL_UP_NOT_SUPPORTED'];
    const RESULTS_STATES = {
        POSTED: [null],
        NOT_APPLICABLE: ['WITHDRAWN_NO_PARTICIPANTS', 'TERMINATED_NO_DATA'],
        PENDING: ['WITHIN_STANDARD_WINDOW', 'CERTIFIED_DELAY', 'STATUS_UNCERTAIN'],
        UNREPORTED: ['PAST_STANDARD_WINDOW'],
    };
    const KINDS = ['human_reviewed', 'machine_provisional'];
    const MODES = ['evidence_only', 'provisional_preview'];
    const PAGE = 100;

    const STATE_LABELS = {
        MET: 'Met its primary objective',
        NOT_MET: 'Did not meet its primary objective',
        INSUFFICIENT_EVIDENCE: 'Cannot be determined from the evidence',
        NOT_APPLICABLE: 'Not applicable',
        PENDING: 'No posted results; not yet past the standard window',
        UNREPORTED: 'No posted results; past the standard window',
        CONFLICTING: 'Sources conflict',
        ROLL_UP_NOT_SUPPORTED: 'Several primary analyses, no stated way to combine them',
    };
    // Precise statements of what is missing. Never a confidence score.
    const REASONS = {
        ALPHA_NOT_DETERMINABLE: 'The registry does not state the significance threshold for this analysis, or whether the posted p-value is one- or two-sided.',
        BOUNDARY_NOT_DETERMINABLE: 'The design includes interim analyses; the boundary that applied at the deciding look is not stated in the registry.',
        MARGIN_NOT_STATED: 'A non-inferiority or equivalence analysis is posted without a numeric margin.',
        MARGIN_AMBIGUOUS: 'The margin stated is ambiguous: several margins disagree, or the criterion does not match the registered hypothesis type.',
        HYPOTHESIS_TYPE_UNKNOWN: 'The registry does not say whether this is a superiority, non-inferiority or equivalence analysis.',
        DIRECTION_UNKNOWN: 'The registry does not say which arm the result favours.',
        ORIENTATION_UNKNOWN: 'The registry does not say which arm is the reference for the estimate, or which confidence limit the margin bounds.',
        P_CI_INCONSISTENT: 'The posted p-value and confidence interval disagree.',
        NO_ANALYSIS_POSTED: 'Results are posted for the primary outcome, but no statistical analysis is.',
        DESCRIPTIVE_PRIMARY: 'The primary outcome is a single-group summary with no comparison.',
        P_VALUE_UNINTERPRETABLE: 'The posted p-value could not be read, or none is posted.',
        CI_NOT_POSTED: 'The confidence limit the margin needs is not posted.',
        ZERO_ANALYZED: 'No participant was analysed for the primary outcome.',
        GROUPS_NOT_IDENTIFIABLE: 'The compared groups cannot be identified.',
        WITHDRAWN_NO_PARTICIPANTS: 'The trial was withdrawn before enrolling anyone.',
        TERMINATED_NO_DATA: 'The trial was terminated without primary outcome data.',
        WITHIN_STANDARD_WINDOW: 'Less than one year has passed since actual primary completion.',
        CERTIFIED_DELAY: 'The sponsor certified a delay; results are not due for up to two years after certification.',
        STATUS_UNCERTAIN: 'The registry gives an estimated primary completion date or an unknown status, so the reporting window cannot be placed.',
        PAST_STANDARD_WINDOW: 'More than one year has passed since actual primary completion. This is a timing fact, not a finding of non-compliance: applicable-trial status and extensions are not established.',
    };
    const EXCLUSION_LABELS = {
        NOT_INTERVENTIONAL: 'not interventional', NOT_PHASE3: 'not Phase 3',
        PHASE2_PHASE3_STRATUM: 'Phase 2/3 (a separate stratum)', LEAD_SPONSOR_NOT_INDUSTRY: 'lead sponsor not industry',
        NOT_RANDOMIZED: 'not randomized', PRIMARY_COMPLETION_OUTSIDE_WINDOW: 'primary completion outside 2020',
    };
    const RESULTS_SHORT = {
        WITHIN_STANDARD_WINDOW: 'within the standard window', CERTIFIED_DELAY: 'certified delay',
        STATUS_UNCERTAIN: 'completion not confirmed', PAST_STANDARD_WINDOW: 'past the standard window',
        WITHDRAWN_NO_PARTICIPANTS: 'withdrawn', TERMINATED_NO_DATA: 'terminated, no participants',
    };

    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
    const isInt = v => Number.isInteger(v) && v >= 0;
    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    // "2026-11-09" -> "9 Nov 2026"; "2020-06" -> "Jun 2020"; anything else verbatim.
    function fmtDate(iso) {
        const m = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/.exec(iso || '');
        if (!m) return iso ? String(iso) : '';
        if (m[3]) return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
        if (m[2]) return `${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
        return m[1];
    }

    // Consumer-side contract (the engine's outcomes/contract.py is the producer side): what is
    // wrong with the three top-level files as this view reads them, or null.
    function dataProblem(run, summary, index) {
        if (!isObj(run) || run.schema_version !== SCHEMA_VERSION) return 'run.json is not schema version 1';
        if (typeof run.run_id !== 'string' || !/^outcomes-\d{4}-\d{2}-\d{2}-[0-9a-f]{10}$/.test(run.run_id)) return 'run.json has no run id';
        if (!MODES.includes(run.display_mode)) return 'unknown display mode';
        if (typeof run.cutoff !== 'string') return 'run.json has no cutoff';
        for (const [name, f] of [['summary.json', summary], ['index.json', index]]) {
            if (!isObj(f) || f.run_id !== run.run_id || f.schema_version !== SCHEMA_VERSION) return `${name} is from another run`;
        }
        if (!Array.isArray(index.rows)) return 'index.json has no rows';
        const den = summary.denominators;
        if (!isObj(den) || !isObj(den.eligible) || den.eligible.n !== index.rows.length) return 'the eligible denominator does not match the trial list';
        for (const m of summary.metrics || []) {
            const d = den[m.denominator];
            if (!d || !isInt(m.numerator) || m.numerator > d.n || !m.definition) return `metric ${m.id} is incomplete`;
        }
        const byKind = (summary.assessment_states || {}).by_kind || {};
        for (const [kind, counts] of Object.entries(byKind)) {
            if (!KINDS.includes(kind)) return `unknown assessment kind ${kind}`;
            if (TRIAL_STATES.some(s => !isInt(counts[s])) || Object.keys(counts).length !== TRIAL_STATES.length) {
                return `assessment counts for ${kind} do not list all eight states`;
            }
        }
        if (run.display_mode === 'evidence_only' && byKind.machine_provisional) return 'machine counts in an evidence-only build';
        const seen = new Set();
        for (const r of index.rows) {
            if (!/^NCT\d{8}$/.test(r.nct_id || '') || seen.has(r.nct_id)) return 'a trial row has no distinct NCT id';
            seen.add(r.nct_id);
            if (!(r.results_state in RESULTS_STATES) || !RESULTS_STATES[r.results_state].includes(r.results_sub_reason)) return `${r.nct_id}: unknown results state`;
            if (r.assessment_kind != null && !KINDS.includes(r.assessment_kind)) return `${r.nct_id}: unknown assessment kind`;
            if (r.assessment_kind != null && !TRIAL_STATES.includes(r.trial_state)) return `${r.nct_id}: unknown trial state`;
            if (r.assessment_kind === 'machine_provisional' && run.display_mode !== 'provisional_preview') return `${r.nct_id}: machine assessment in an evidence-only build`;
            if ((r.review_status === 'human_reviewed') !== (r.assessment_kind === 'human_reviewed')) return `${r.nct_id}: review status and assessment disagree`;
            if (!/^records\/r\d{2}\.json$/.test(r.record || '')) return `${r.nct_id}: no record shard`;
        }
        return null;
    }

    function shardProblem(shard, run) {
        if (!isObj(shard) || shard.run_id !== run.run_id || shard.schema_version !== SCHEMA_VERSION || !isObj(shard.records)) {
            return 'the evidence record is from another run';
        }
        return null;
    }

    // Whether machine assessments may be shown here: only on a local preview of a preview build.
    function showsMachine(run, hostname) {
        return run.display_mode === 'provisional_preview' && ['localhost', '127.0.0.1', '[::1]', ''].includes(hostname);
    }

    // The rows a view may show: on a public host a provisional build loses its machine
    // assessments (the row stays; it reads as not yet assessed).
    function visibleRows(rows, run, hostname) {
        if (showsMachine(run, hostname)) return rows;
        return rows.map(r => r.assessment_kind === 'machine_provisional'
            ? { ...r, assessment_kind: null, trial_state: null } : r);
    }

    function filterRows(rows, f) {
        const q = (f.q || '').trim().toLowerCase();
        return rows.filter(r =>
            (!q || [r.nct_id, r.title, r.sponsor, r.primary_objective].some(v => (v || '').toLowerCase().includes(q))) &&
            (!f.results || (f.results === 'NO_RESULTS' ? r.results_state !== 'POSTED' : r.results_state === f.results)) &&
            (!f.area || r.area === f.area) &&
            (!f.sponsor || r.sponsor === f.sponsor) &&
            (!f.docs || (f.docs === 'any' ? (r.protocol || r.sap) : !(r.protocol || r.sap))) &&
            (!f.collection || (f.collection === 'audit' ? r.in_audit : f.collection === 'reviewed' ? r.review_status === 'human_reviewed' : true)) &&
            (!f.state || r.trial_state === f.state));
    }

    function resultsLabel(r, cutoff) {
        if (r.results_state === 'POSTED') return r.results_first_post_date ? `Posted ${fmtDate(r.results_first_post_date)}` : 'Posted';
        const why = RESULTS_SHORT[r.results_sub_reason];
        return `No posted results as of ${fmtDate(cutoff)}${why ? ` (${why})` : ''}`;
    }

    function stateBadge(state, kind) {
        const prov = kind === 'machine_provisional';
        return `<span class="oc-state"><span class="oc-swatch st-${esc(state)}" aria-hidden="true"></span>${esc(STATE_LABELS[state] || state)}</span>` +
            (prov ? ' <span class="oc-prov">Provisional, machine only</span>' : '');
    }

    function assessmentCell(r) {
        if (r.trial_state) return stateBadge(r.trial_state, r.assessment_kind);
        return r.in_audit ? '<span class="oc-none">Not shown until reviewed by a person</span>'
            : '<span class="oc-none">Not assessed</span>';
    }

    function reviewLabel(r) {
        if (r.review_status === 'human_reviewed') return 'Reviewed by a person';
        if (r.review_status === 'awaiting_human_review') return 'Awaiting review';
        return '';
    }

    function pct(num, den) {
        return den ? `${num.toLocaleString()} of ${den.toLocaleString()} (${Math.round((100 * num) / den)}%)` : `${num} of 0`;
    }

    function overviewHTML(run, summary, machineShown) {
        const den = summary.denominators;
        const m = Object.fromEntries(summary.metrics.map(x => [x.id, x]));
        const card = (id, label) => {
            const x = m[id];
            if (!x) return '';
            return `<div class="oc-card"><div class="oc-card-label">${esc(label || x.label)}</div>` +
                `<div class="oc-card-value">${esc(pct(x.numerator, den[x.denominator].n))}</div>` +
                `<p class="oc-card-def">${esc(x.definition)} Denominator: ${esc(den[x.denominator].definition.toLowerCase())}</p></div>`;
        };
        const noResults = ['no_results_past_window', 'no_results_within_window', 'no_results_status_uncertain', 'no_results_not_applicable']
            .filter(id => m[id]).map(id => `<li>${esc(m[id].label)}: ${esc(pct(m[id].numerator, den[m[id].denominator].n))}</li>`).join('');
        const excl = Object.entries(run.cohort.exclusions || {}).filter(([, n]) => n > 0)
            .map(([k, n]) => `${n.toLocaleString()} ${esc(EXCLUSION_LABELS[k] || k)}`).join('; ');
        const kinds = (summary.assessment_states || {}).by_kind || {};
        const stateRows = Object.keys(kinds).filter(k => k === 'human_reviewed' || machineShown).map(k =>
            `<tr><th scope="row">${k === 'human_reviewed' ? 'Reviewed by a person' : 'Provisional, machine only'}</th>` +
            TRIAL_STATES.map(s => `<td>${kinds[k][s]}</td>`).join('') + '</tr>').join('');
        return `
        <div class="oc-cards">
            <div class="oc-card"><div class="oc-card-label">Eligible trials</div>
                <div class="oc-card-value">${run.cohort.n_eligible.toLocaleString()}</div>
                <p class="oc-card-def">${esc(run.cohort.definition)} Of ${run.cohort.n_frame.toLocaleString()} registry records the query matched${excl ? `, excluded: ${excl}` : ''}.</p></div>
            ${card('results_posted')}
            ${card('protocol_or_sap_posted', 'Protocol or SAP posted')}
            ${card('human_reviewed', 'Assessments reviewed by a person')}
        </div>
        <details class="oc-more"><summary>Trials without posted results, and documents</summary>
            <ul class="oc-list">${noResults}<li>${esc(m.protocol_posted.label)}: ${esc(pct(m.protocol_posted.numerator, den.eligible.n))}</li><li>${esc(m.sap_posted.label)}: ${esc(pct(m.sap_posted.numerator, den.eligible.n))}</li></ul>
            <p class="note">A posted protocol or SAP is a document that exists, not a decision rule that someone has read and found usable.</p>
        </details>
        <div class="oc-states">
            <h4>Assessments in the development collection</h4>
            <p class="note">${esc(summary.assessment_states.note)} The development collection is the ${den.audit_eligible.n} eligible trials of the feasibility audit${machineShown ? '' : '; only assessments a person has reviewed are shown'}.</p>
            <div class="oc-table-scroll" tabindex="0" role="region" aria-label="Assessment states by review status">
                <table class="oc-table"><thead><tr><th scope="col">Assessment</th>${TRIAL_STATES.map(s =>
                    `<th scope="col"><span class="oc-swatch st-${s}" aria-hidden="true"></span>${esc(STATE_LABELS[s])}</th>`).join('')}</tr></thead>
                <tbody>${stateRows || `<tr><td colspan="${TRIAL_STATES.length + 1}">No assessment has been reviewed by a person yet.</td></tr>`}</tbody></table>
            </div>
        </div>`;
    }

    function optionList(rows, key, current, all) {
        const vals = [...new Set(rows.map(r => r[key]).filter(Boolean))].sort((a, b) => a.localeCompare(b));
        return `<option value="">${esc(all)}</option>` + vals.map(v => `<option value="${esc(v)}"${v === current ? ' selected' : ''}>${esc(v)}</option>`).join('');
    }

    function filtersHTML(rows, f) {
        const sel = (v, cur) => (v === cur ? ' selected' : '');
        return `
        <div class="oc-filters panel-chrome">
            <label class="oc-filter oc-search"><span>Search</span><input type="search" data-of="q" value="${esc(f.q || '')}" placeholder="NCT id, title, sponsor, objective"></label>
            <label class="oc-filter"><span>Results</span><select data-of="results">
                <option value="">All</option><option value="POSTED"${sel('POSTED', f.results)}>Posted</option>
                <option value="NO_RESULTS"${sel('NO_RESULTS', f.results)}>No posted results</option>
                <option value="UNREPORTED"${sel('UNREPORTED', f.results)}>No posted results, past the standard window</option>
                <option value="PENDING"${sel('PENDING', f.results)}>No posted results, not yet past it</option>
                <option value="NOT_APPLICABLE"${sel('NOT_APPLICABLE', f.results)}>Not applicable</option></select></label>
            <label class="oc-filter"><span>Area</span><select data-of="area">${optionList(rows, 'area', f.area, 'All areas')}</select></label>
            <label class="oc-filter"><span>Sponsor</span><select data-of="sponsor">${optionList(rows, 'sponsor', f.sponsor, 'All sponsors')}</select></label>
            <label class="oc-filter"><span>Documents</span><select data-of="docs">
                <option value="">All</option><option value="any"${sel('any', f.docs)}>Protocol or SAP posted</option>
                <option value="none"${sel('none', f.docs)}>Neither posted</option></select></label>
            <label class="oc-filter"><span>Collection</span><select data-of="collection">
                <option value="">All eligible trials</option><option value="audit"${sel('audit', f.collection)}>Development collection</option>
                <option value="reviewed"${sel('reviewed', f.collection)}>Reviewed by a person</option></select></label>
            <label class="oc-filter"><span>Assessment</span><select data-of="state"><option value="">All</option>${TRIAL_STATES.map(s =>
                `<option value="${s}"${sel(s, f.state)}>${esc(STATE_LABELS[s])}</option>`).join('')}</select></label>
        </div>`;
    }

    function listHTML(rows, run, shown) {
        const head = ['Trial', 'Sponsor', 'Area', 'Primary objective', 'Results', 'Assessment', 'Review'];
        const body = rows.slice(0, shown).map(r => `
            <tr>
                <td><button type="button" class="oc-open" data-nct="${esc(r.nct_id)}" aria-label="Open the evidence for ${esc(r.nct_id)}">${esc(r.nct_id)}</button>
                    <div class="oc-title">${esc(r.title)}</div>${r.in_audit ? '<span class="oc-tag">Development collection</span>' : ''}</td>
                <td>${esc(r.sponsor)}${r.sponsor_state !== 'attributed' ? '<div class="oc-sub">as registered; not yet curated</div>' : ''}</td>
                <td>${esc(r.area)}</td>
                <td>${esc(r.primary_objective || 'Not registered')}${r.n_primary_outcomes > 1 ? `<div class="oc-sub">+${r.n_primary_outcomes - 1} more primary</div>` : ''}</td>
                <td>${esc(resultsLabel(r, run.cutoff))}</td>
                <td>${assessmentCell(r)}</td>
                <td>${esc(reviewLabel(r))}</td>
            </tr>`).join('');
        const more = rows.length > shown ? `<button type="button" class="oc-more-btn">Show ${Math.min(PAGE, rows.length - shown)} more of ${(rows.length - shown).toLocaleString()}</button>` : '';
        return `
        <p class="oc-count" aria-live="polite">${rows.length.toLocaleString()} trial${rows.length === 1 ? '' : 's'} match</p>
        <div class="oc-table-scroll" tabindex="0" role="region" aria-label="Trials">
            <table class="oc-table oc-trials"><thead><tr>${head.map(h => `<th scope="col">${h}</th>`).join('')}</tr></thead>
            <tbody>${body || `<tr><td colspan="${head.length}">No trial matches these filters.</td></tr>`}</tbody></table>
        </div>${more}`;
    }

    function evidenceList(items) {
        if (!items || !items.length) return '';
        return '<ul class="oc-evidence">' + items.map(e => e.document
            ? `<li><span class="oc-loc">${esc(e.document)}, page ${esc(e.page)}</span> <q>${esc(e.quotation)}</q></li>`
            : `<li><code class="oc-loc">${esc(e.json_path)}</code> <q>${esc(e.excerpt)}</q></li>`).join('') + '</ul>';
    }

    function reportedLine(rep) {
        if (!rep) return 'No statistical analysis posted.';
        const parts = [];
        if (rep.paramType) parts.push(`${rep.paramType} ${rep.paramValue ?? ''}`.trim());
        if (rep.ciLowerLimit != null || rep.ciUpperLimit != null) parts.push(`${rep.ciPctValue || '?'}% CI ${rep.ciLowerLimit ?? '?'} to ${rep.ciUpperLimit ?? '?'}${rep.ciNumSides === 'ONE_SIDED' ? ' (one-sided)' : ''}`);
        if (rep.pValue) parts.push(`p ${rep.pValue}`);
        return parts.join('; ') || 'No estimate posted.';
    }

    function ruleLine(rule) {
        if (!rule) return '';
        if (rule.margin != null) return `Margin ${Array.isArray(rule.margin) ? rule.margin.join(' and ') : rule.margin} (${rule.margin_side} limit), from ${String(rule.source || '').toLowerCase().replace(/_/g, ' ')}`;
        if (rule.alpha != null) return `Threshold ${rule.alpha}${rule.alpha_sides ? `, ${rule.alpha_sides}-sided` : ''}, from ${String(rule.source || '').toLowerCase().replace(/_/g, ' ')}`;
        return 'No threshold or margin stated in the registry (the protocol or SAP may state one)';
    }

    function recordHTML(rec, run, machineShown) {
        const f = rec.facts;
        let a = rec.assessment;
        if (a && a.assessment_kind === 'machine_provisional' && !machineShown) a = null;
        const docs = f.documents.length
            ? '<ul class="oc-list">' + f.documents.map(d => `<li><a href="${esc(d.url)}" target="_blank" rel="noopener">${esc(d.label)}</a> (registry date ${esc(fmtDate(d.document_date))})</li>`).join('') + '</ul>'
            : '<p>No protocol or statistical analysis plan is posted on the registry.</p>';
        const results = rec.results.state === 'POSTED'
            ? `<p>Results posted ${esc(fmtDate(f.results_first_post_date))}.</p>`
            : `<p><strong>No posted results as of ${esc(fmtDate(rec.results.as_of))}.</strong> ${esc(REASONS[rec.results.sub_reason] || '')}</p>`;
        const units = a ? (a.units || []).map(u => `
            <div class="oc-unit">
                <h6>${esc(u.au_id)}: ${esc(u.measure_title)}</h6>
                <p class="oc-sub">${esc((u.analysis_role || 'no analysis').toLowerCase().replace(/_/g, ' '))}; ${esc((u.hypothesis_type || '').toLowerCase().replace(/_/g, ' '))}${u.group_titles ? `; ${esc(u.group_titles.join(' vs '))}` : ''}</p>
                <p><span class="oc-layer">Reported</span> ${esc(reportedLine(u.reported))}</p>
                <p><span class="oc-layer">Rule</span> ${esc(ruleLine(u.decision_rule))}</p>
                <p><span class="oc-layer">Conclusion</span> ${stateBadge(u.state, a.assessment_kind)}${u.amended_by_review ? ' <span class="oc-tag">amended by review</span>' : ''} ${esc(u.sub_reason ? REASONS[u.sub_reason] || '' : u.rationale || '')}</p>
                ${evidenceList(u.evidence)}
            </div>`).join('') : '';
        const method = a ? `
            <p>${stateBadge(a.trial_state, a.assessment_kind)}</p>
            <p>${esc(a.trial_sub_reason ? REASONS[a.trial_sub_reason] || a.trial_rationale : a.trial_rationale)}</p>
            <p class="oc-sub">Multiplicity: ${esc((a.multiplicity || '').toLowerCase().replace(/_/g, ' '))}. Method ${esc(a.method_version)}, assessed as of ${esc(fmtDate(a.assessment_cutoff))}. Registration ${esc((a.prespecification || {}).registration_timing || '').toLowerCase()}.</p>
            ${units}`
            : `<p>${rec.collections.audit ? 'This trial is in the development collection; its assessment has not been reviewed by a person and is not shown here.' : 'Not assessed: only trials in the development collection are assessed in this beta.'}</p>`;
        const review = a && a.assessment_kind === 'human_reviewed'
            ? `<p>Reviewed by a person on ${esc(fmtDate(a.review.reviewed_on))}: ${esc(a.review.decision === 'CONFIRM' ? 'confirmed the method\'s conclusion' : a.review.decision === 'AMEND' ? `amended it (the method had said: ${STATE_LABELS[a.review.machine_trial_state] || a.review.machine_trial_state})` : 'could not determine the outcome')}.</p>${evidenceList(a.human_evidence)}`
            : `<p>${a ? '<span class="oc-prov">Provisional, machine only</span> No person has reviewed this assessment.' : 'No person has reviewed an assessment of this trial.'}</p>`;
        const link = rec.demographics_link
            ? (rec.demographics_link.in_dataset
                ? `In the participant-demographics dataset (sex ${rec.demographics_link.sex_reported ? 'reported' : 'not reported'}, race ${rec.demographics_link.race_reported ? 'reported' : 'not reported'}, ethnicity ${rec.demographics_link.ethnicity_reported ? 'reported' : 'not reported'}).`
                : 'Not in the participant-demographics dataset.')
            : 'Link to the participant-demographics dataset not computed for this build.';
        return `
        <div class="oc-panel-head">
            <h4>${esc(rec.nct_id)}</h4>
            <button type="button" class="oc-close" aria-label="Close the evidence panel">Close</button>
        </div>
        <p class="oc-panel-title">${esc(f.brief_title)}</p>
        <p class="oc-sub">${esc(rec.sponsor.display)}${rec.sponsor.review_state !== 'attributed' ? ' (sponsor name as registered)' : ''} · ${esc(rec.area.primary)} · ${esc(f.overall_status || '')} · <a href="${esc(rec.registry_url)}" target="_blank" rel="noopener">ClinicalTrials.gov record</a></p>
        <section class="oc-layer-block"><h5>What the registry reports</h5>
            ${results}
            <p>Primary completion ${esc(fmtDate(f.primary_completion_date))}${f.primary_completion_type === 'ESTIMATED' ? ' (estimated)' : ''}${f.why_stopped ? `; stopped: ${esc(f.why_stopped)}` : ''}.</p>
            <p>Registered primary outcome${f.registered_primary_outcomes.length === 1 ? '' : 's'}:</p>
            <ul class="oc-list">${f.registered_primary_outcomes.map(o => `<li>${esc(o.measure)}${o.time_frame ? ` (${esc(o.time_frame)})` : ''}</li>`).join('') || '<li>None registered</li>'}</ul>
            ${docs}
        </section>
        <section class="oc-layer-block"><h5>What the method concludes</h5>${method}</section>
        <section class="oc-layer-block"><h5>What a person checked</h5>${review}</section>
        <section class="oc-layer-block"><h5>Dates and links</h5>
            <p>Results availability as of ${esc(fmtDate(run.cutoff))}; registry record last updated ${esc(fmtDate(f.last_update_post_date))}${a ? `; assessment as of ${esc(fmtDate(a.assessment_cutoff))}` : ''}${run.dates && run.dates.demographics_snapshot ? `; demographics data of ${esc(fmtDate(run.dates.demographics_snapshot))}` : ''}.</p>
            <p>${esc(link)}</p>
        </section>`;
    }

    // ---------------------------------------------------------------- the live view

    const state = { data: null, filters: {}, shown: PAGE, shards: {}, opener: null, request: 0 };

    async function load(fetchJSON) {
        const get = async (path, reload) => fetchJSON(BASE + path, reload);
        const run = await get('run.json');
        let [summary, index] = await Promise.all([get('summary.json'), get('index.json')]);
        if (summary.run_id !== run.run_id || index.run_id !== run.run_id) {
            // A file cached from another run: once more past the cache, then give up.
            [summary, index] = await Promise.all([get('summary.json', true), get('index.json', true)]);
        }
        const problem = dataProblem(run, summary, index);
        if (problem) throw new Error(problem);
        return { run, summary, index, get };
    }

    function render(el) {
        const { run, summary, index } = state.data;
        const host = (root.location && root.location.hostname) || '';
        const machineShown = showsMachine(run, host);
        const rows = filterRows(visibleRows(index.rows, run, host), state.filters);
        const banner = run.display_mode === 'provisional_preview'
            ? (machineShown
                ? '<div class="oc-banner" role="note"><strong>Local preview.</strong> Provisional machine assessments are shown and labelled; no person has reviewed them. Never publish this build.</div>'
                : '<div class="oc-banner" role="note">This build contains unreviewed machine assessments, so only registry evidence is shown here.</div>')
            : '';
        el.innerHTML = `
            ${banner}
            <div class="panel-hero">
                <h3>Industry Trial Outcomes <span class="oc-beta">Beta</span></h3>
                <div class="industry-claim">
                    <p class="finding-headline">Which 2020 industry Phase 3 trials posted results, and what their records let anyone conclude.</p>
                    <p class="finding-context">evidence availability &middot; traceable assessments &middot; reviewed by a person before they count</p>
                </div>
                <p class="note">Results availability as of ${esc(fmtDate(run.cutoff))}. Not a success rate for any sponsor, drug or the cohort.</p>
            </div>
            ${overviewHTML(run, summary, machineShown)}
            <h4 class="oc-section">Trials</h4>
            ${filtersHTML(index.rows, state.filters)}
            <div class="oc-list-wrap">${listHTML(rows, run, state.shown)}</div>
            <div class="oc-panel" id="oc-panel" role="region" aria-label="Trial evidence" tabindex="-1" hidden></div>
            <p class="chart-footnote">Run ${esc(run.run_id)}. Registry data retrieved ${esc(fmtDate((run.acquisition || {}).retrieved_at))}; method ${esc((run.method || {}).version || 'not supplied')}; sponsor names by the curated rules where reviewed, otherwise as registered.</p>`;
        wire(el);
    }

    function rerenderList(el) {
        const { run, index } = state.data;
        const host = (root.location && root.location.hostname) || '';
        const rows = filterRows(visibleRows(index.rows, run, host), state.filters);
        el.querySelector('.oc-list-wrap').innerHTML = listHTML(rows, run, state.shown);
        wireList(el);
    }

    function wire(el) {
        el.querySelectorAll('[data-of]').forEach(input => {
            input.addEventListener(input.tagName === 'INPUT' ? 'input' : 'change', () => {
                state.filters[input.dataset.of] = input.value;
                state.shown = PAGE;
                rerenderList(el);
            });
        });
        wireList(el);
    }

    function wireList(el) {
        el.querySelectorAll('.oc-open').forEach(b => b.addEventListener('click', () => openRecord(el, b.dataset.nct, b)));
        const more = el.querySelector('.oc-more-btn');
        if (more) more.addEventListener('click', () => { state.shown += PAGE; rerenderList(el); });
    }

    // data defaults to the loaded view's; tests pass their own.
    async function openRecord(el, nct, opener, data = state.data) {
        const { run, index, get } = data;
        const row = index.rows.find(r => r.nct_id === nct);
        const panel = el.querySelector('#oc-panel');
        // The latest selection wins: a record that arrives after another trial was opened (or the
        // panel closed) is dropped, with its error and its focus move.
        const request = ++state.request;
        state.opener = opener;
        panel.hidden = false;
        panel.innerHTML = '<p class="note">Loading the evidence record…</p>';
        let html;
        try {
            let shard = state.shards[row.record];
            if (!shard) {
                shard = await get(row.record);
                if (shardProblem(shard, run)) shard = await get(row.record, true);
                const problem = shardProblem(shard, run);
                if (problem) throw new Error(problem);
                state.shards[row.record] = shard;
            }
            const rec = shard.records[nct];
            if (!rec) throw new Error(`${nct} is not in ${row.record}`);
            const host = (root.location && root.location.hostname) || '';
            html = recordHTML(rec, run, showsMachine(run, host));
        } catch (e) {
            html = `<p class="note">Could not load the evidence record (${esc(e.message)}).</p><button type="button" class="oc-close">Close</button>`;
        }
        if (request !== state.request) return;
        panel.innerHTML = html;
        panel.querySelector('.oc-close').addEventListener('click', () => closeRecord(el));
        panel.focus();
        if (panel.scrollIntoView) panel.scrollIntoView({ block: 'nearest' });
    }

    function closeRecord(el) {
        state.request++;   // any record still loading is now stale
        const panel = el.querySelector('#oc-panel');
        panel.hidden = true;
        panel.innerHTML = '';
        if (state.opener && state.opener.isConnected) state.opener.focus();
    }

    // deps.fetchJSON(path, reload) -> parsed JSON; throws on HTTP errors.
    async function open(el, deps) {
        if (state.data) { render(el); return; }
        el.innerHTML = '<p class="note">Loading the trial outcomes data…</p>';
        try {
            state.data = await load(deps.fetchJSON);
        } catch (e) {
            const missing = /HTTP 404/.test(e.message);
            el.innerHTML = missing
                ? '<div class="panel-hero"><h3>Industry Trial Outcomes <span class="oc-beta">Beta</span></h3><p class="note">The trial outcomes data is not published. It is built by hand with the engine (civicsample-engine outcomes/README.md) and previewed locally until publication is decided.</p></div>'
                : `<p class="note">Could not load the trial outcomes data (${esc(e.message)}).</p>`;
            return;
        }
        render(el);
    }

    root.IndustryOutcomes = {
        open, openRecord, dataProblem, shardProblem, filterRows, visibleRows, showsMachine, resultsLabel, fmtDate,
        overviewHTML, filtersHTML, listHTML, recordHTML, TRIAL_STATES, STATE_LABELS, REASONS,
    };
})(typeof window !== 'undefined' ? window : globalThis);

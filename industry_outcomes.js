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
 * It also reads the results-structure family from data/results_structure/ when it is present
 * (run.json, summary.json, records.json): per trial, what the posted results section contains and
 * one subgroup-results state per dimension. A trial absent from that family, or the family being
 * absent or failing its check, reads "Not yet processed", never "none detected".
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
        PENDING: 'No posted results; not yet due, or completion not confirmed',
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

    // PENDING covers two different situations: results not yet due (within the standard window,
    // or a certified delay) and a completion the registry has not confirmed, where no window can be
    // placed. The filter keeps them apart; 'PENDING' itself still selects both (older share links).
    const PENDING_SPLIT = {
        PENDING_DUE: ['WITHIN_STANDARD_WINDOW', 'CERTIFIED_DELAY'],
        PENDING_UNCERTAIN: ['STATUS_UNCERTAIN'],
    };

    function resultsMatch(r, want) {
        if (want === 'NO_RESULTS') return r.results_state !== 'POSTED';
        if (PENDING_SPLIT[want]) return r.results_state === 'PENDING' && PENDING_SPLIT[want].includes(r.results_sub_reason);
        return r.results_state === want;
    }

    function filterRows(rows, f) {
        const q = (f.q || '').trim().toLowerCase();
        return rows.filter(r =>
            (!q || [r.nct_id, r.title, r.sponsor, r.primary_objective].some(v => (v || '').toLowerCase().includes(q))) &&
            (!f.results || resultsMatch(r, f.results)) &&
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

    // The texture class of a row's results state, shared by the list and the overview legend.
    function resultsClass(r) {
        if (r.results_state === 'POSTED') return 'rs-posted';
        if (r.results_state === 'UNREPORTED') return 'rs-past';
        if (r.results_state === 'NOT_APPLICABLE') return 'rs-none';
        return r.results_sub_reason === 'STATUS_UNCERTAIN' ? 'rs-uncertain' : 'rs-due';
    }

    function stateBadge(state, kind) {
        const prov = kind === 'machine_provisional';
        return `<span class="oc-state"><span class="oc-swatch st-${esc(state)}" aria-hidden="true"></span>${esc(STATE_LABELS[state] || state)}</span>` +
            (prov ? ' <span class="oc-prov">Provisional, machine only</span>' : '');
    }

    // Four situations kept apart: reviewed, machine-only (local preview), awaiting review, not assessed.
    function assessmentCell(r) {
        if (r.trial_state) {
            return stateBadge(r.trial_state, r.assessment_kind) +
                (r.review_status === 'human_reviewed' ? '<div class="oc-sub">Reviewed by a person</div>' : '');
        }
        return r.in_audit
            ? '<span class="oc-none">Awaiting review</span><div class="oc-sub">Development collection; shown once a person has reviewed it</div>'
            : '<span class="oc-none">Not assessed</span><div class="oc-sub">Outside the development collection</div>';
    }

    const pctOf = (num, den) => (den ? Math.round((100 * num) / den) : 0);
    const figure = (num, den) =>
        `<span class="oc-fig"><strong>${num.toLocaleString()}</strong> of ${den.toLocaleString()} <span class="oc-pct">${pctOf(num, den)}%</span></span>`;

    // ---------------------------------------------------------------- head and overview

    // The pane's one statement of who is in it, when the data was retrieved, and how many
    // assessments a person has reviewed (from summary.json, never assumed). Inclusion rules sit in
    // the disclosure; review detail lives in its own section further down.
    function reviewStatus(summary) {
        const m = Object.fromEntries(((summary || {}).metrics || []).map(x => [x.id, x]));
        const r = m.human_reviewed;
        if (!r) return '';
        const n = (summary.denominators[r.denominator] || {}).n ?? r.denominator;
        const lead = `<strong>${r.numerator.toLocaleString()} of ${Number(n).toLocaleString()}</strong> development-collection trials have an assessment reviewed by a person`;
        const tail = r.numerator === 0
            ? '; none is published yet. Registry evidence for every trial is below.'
            : '; only those are shown, and they describe the development collection, not the cohort.';
        return `<p class="oc-status" role="status">${lead}${tail} <button type="button" class="oc-status-link" aria-controls="oc-review-h">About review</button></p>`;
    }

    function headHTML(run, summary) {
        const excl = Object.entries((run.cohort || {}).exclusions || {}).filter(([, n]) => n > 0)
            .map(([k, n]) => `${n.toLocaleString()} ${esc(EXCLUSION_LABELS[k] || k)}`).join('; ');
        return `
        <div class="oc-head">
            <h3>What outcome evidence is there for each trial? <span class="oc-beta">Beta</span></h3>
            <p class="oc-dateline"><strong>${run.cohort.n_eligible.toLocaleString()} randomized Phase 3 industry trials</strong> with primary completion in 2020 · registry retrieved ${esc(fmtDate((run.acquisition || {}).retrieved_at))}, results as of ${esc(fmtDate(run.cutoff))} · a fixed cohort: the weekly “Last updated” date and snapshot selector do not apply to it.</p>
            ${reviewStatus(summary)}
            <details class="oc-scope"><summary>Who is included: ${run.cohort.n_eligible.toLocaleString()} of ${run.cohort.n_frame.toLocaleString()} registry records</summary>
                <p>${esc(run.cohort.definition)}</p>
                <p>The registry query matched ${run.cohort.n_frame.toLocaleString()} records${excl ? `; excluded: ${excl}` : ''}.${run.cohort.differs_from_frame ? ` ${esc(run.cohort.differs_from_frame)}` : ''}</p>
            </details>
        </div>`;
    }

    function meterRow(label, num, den, note) {
        const w = den ? (100 * num) / den : 0;
        return `
            <div class="oc-meter-row">
                <div class="oc-meter-label">${esc(label)}${note ? `<div class="oc-sub">${note}</div>` : ''}</div>
                <div class="oc-meter" role="img" aria-label="${num.toLocaleString()} of ${den.toLocaleString()} trials (${pctOf(num, den)}%)"><span class="oc-meter-fill" style="width:${w.toFixed(2)}%"></span></div>
                ${figure(num, den)}
            </div>`;
    }

    // The five results states are exclusive and, in a valid build, sum to the eligible count; the
    // bar is drawn only when the published numerators do, otherwise the list stands alone.
    const RESULTS_PARTS = [
        ['results_posted', 'rs-posted', 'Results posted'],
        ['no_results_past_window', 'rs-past', 'No posted results, past the standard one-year window'],
        ['no_results_status_uncertain', 'rs-uncertain', 'No posted results, completion not confirmed'],
        ['no_results_within_window', 'rs-due', 'No posted results, within the standard window'],
        ['no_results_not_applicable', 'rs-none', 'No posted results, no participants'],
    ];

    function availabilityHTML(summary) {
        const den = summary.denominators;
        const m = Object.fromEntries(summary.metrics.map(x => [x.id, x]));
        const N = den.eligible.n;
        const docs = m.protocol_or_sap_posted;
        const docNote = m.protocol_posted && m.sap_posted
            ? `protocol ${m.protocol_posted.numerator.toLocaleString()} · statistical analysis plan ${m.sap_posted.numerator.toLocaleString()}` : '';
        const parts = RESULTS_PARTS.filter(([id]) => m[id]);
        const total = parts.reduce((s, [id]) => s + m[id].numerator, 0);
        const bar = total === N && N > 0
            ? `<div class="oc-split" role="img" aria-label="${parts.map(([id, , label]) => `${label}: ${m[id].numerator} of ${N}`).join('; ')}">` +
              parts.filter(([id]) => m[id].numerator > 0).map(([id, cls]) => `<span class="oc-seg ${cls}" style="flex-grow:${m[id].numerator}"></span>`).join('') + '</div>'
            : '';
        const legend = parts.map(([id, cls, label]) => `
                <li><span class="oc-swatch ${cls}" aria-hidden="true"></span><span class="oc-split-label">${esc(label)}</span>${figure(m[id].numerator, N)}</li>`).join('');
        return `
        <section class="oc-block oc-avail" aria-labelledby="oc-avail-h">
            <h4 id="oc-avail-h">Evidence available <span class="oc-h-sub">all ${N.toLocaleString()} eligible trials</span></h4>
            <div class="oc-meters">
                ${m.results_posted ? meterRow('Results posted on ClinicalTrials.gov', m.results_posted.numerator, N) : ''}
                ${docs ? meterRow('Protocol or statistical analysis plan posted', docs.numerator, N, esc(docNote)) : ''}
            </div>
            <p class="oc-note">Both rows count out of the same ${N.toLocaleString()} trials and overlap: a trial can have both. Neither is a step toward the other. A posted document is a file on the registry; it does not show which analysis it covers, or that it was finalised before results were known.</p>
            <h5 class="oc-sub-h">Results status <span class="oc-h-sub">each trial in exactly one state</span></h5>
            ${bar}
            <ul class="oc-split-legend">${legend}</ul>
            <p class="oc-note">Posted results show that results exist, not that the trial met its objective. A trial without posted results has not failed; the state says why results are absent. “Past the standard window” is a timing fact, not a finding of non-compliance.</p>
        </section>`;
    }

    function taxonomyHTML() {
        return `
            <details class="oc-taxonomy"><summary>The eight assessment states</summary>
                <ul class="oc-taxo">${TRIAL_STATES.map(s => `<li>${stateBadge(s)}</li>`).join('')}</ul>
                <p class="oc-note">“Met” and “did not meet” are decided against the trial's own prespecified criterion. The other states say why no decision can be made, or why none applies. None of them measures clinical importance or regulatory approval.</p>
            </details>`;
    }

    function reviewHTML(run, summary, machineShown) {
        const den = summary.denominators;
        const m = Object.fromEntries(summary.metrics.map(x => [x.id, x]));
        const n = den.audit_eligible.n;
        const reviewed = m.human_reviewed ? m.human_reviewed.numerator : 0;
        const audit = (run.collections || {}).audit || {};
        const cells = Array.from({ length: n }, (_, i) => `<span class="oc-cell${i < reviewed ? ' is-reviewed' : ''}"></span>`).join('');
        const kinds = (summary.assessment_states || {}).by_kind || {};
        const rows = Object.keys(kinds).filter(k => k === 'human_reviewed' || machineShown);
        const anyCount = rows.some(k => TRIAL_STATES.some(s => kinds[k][s] > 0));
        const body = anyCount
            ? `<div class="oc-table-scroll" tabindex="0" role="region" aria-label="Assessment states, development collection">
                <table class="oc-table oc-state-table"><thead><tr><th scope="col">State</th>${rows.map(k =>
                    `<th scope="col" class="num">${k === 'human_reviewed' ? 'Reviewed by a person' : 'Provisional, machine only'}</th>`).join('')}</tr></thead>
                <tbody>${TRIAL_STATES.map(s => `<tr><th scope="row">${stateBadge(s)}</th>${rows.map(k => `<td class="num">${kinds[k][s]}</td>`).join('')}</tr>`).join('')}</tbody></table>
               </div>
               <p class="oc-note">${esc(summary.assessment_states.note)} Counts are of the development collection's ${n} eligible trials, not of the cohort.</p>`
            : `<div class="oc-empty">
                <p class="oc-empty-lead">No assessment has been reviewed by a person yet, so none is shown.</p>
                <details class="oc-empty-more"><summary>What review adds, and what it will not say</summary>
                <dl class="oc-empty-dl">
                    <dt>Available now</dt><dd>Registry evidence for all ${den.eligible.n.toLocaleString()} trials: results status, dates, registered primary outcomes and posted documents. Open any trial below.</dd>
                    <dt>What review adds</dt><dd>For each reviewed trial: whether its prespecified primary objective was met, not met, or cannot be determined from the evidence, with the decision criterion, the reported finding and the cited sources, and the reviewer's decision (confirm, amend or cannot determine).</dd>
                    <dt>What it will not say</dt><dd>Clinical importance, regulatory approval, or a success rate for any sponsor, drug or the cohort.</dd>
                </dl>
                </details>
              </div>`;
        return `
        <section class="oc-block oc-review" aria-labelledby="oc-review-h">
            <h4 id="oc-review-h">Review progress <span class="oc-h-sub">development collection, ${n} eligible trials</span></h4>
            <p class="oc-note">${esc(audit.definition || 'The development collection.')} A separate set with its own denominator; it is not drawn on the cohort's scale.</p>
            <div class="oc-progress">
                <div class="oc-cells" role="img" aria-label="${reviewed} of ${n} reviewed by a person">${cells}</div>
                ${figure(reviewed, n)}<span class="oc-progress-label">reviewed by a person</span>
            </div>
            ${body}
            ${taxonomyHTML()}
        </section>`;
    }

    // Kept for callers and tests: the evidence and review sections together.
    function overviewHTML(run, summary, machineShown) {
        return availabilityHTML(summary) + reviewHTML(run, summary, machineShown);
    }

    function methodsHTML(run, summary) {
        const m = Object.fromEntries(summary.metrics.map(x => [x.id, x]));
        const N = summary.denominators.eligible.n;
        const sa = run.sponsor_attribution || {};
        const ls = sa.lead_review_states || {};
        const dl = run.demographics_link || {};
        const acq = run.acquisition || {};
        const meth = run.method || {};
        const short = s => (s ? `${String(s).slice(0, 12)}…` : 'not recorded');
        const defs = Object.values(m).filter(x => x.denominator === 'eligible')
            .map(x => `<li><strong>${esc(x.label)}</strong>: ${esc(x.definition)} (${x.numerator.toLocaleString()} of ${N.toLocaleString()})</li>`).join('');
        return `
        <details class="oc-methods"><summary>Methods and provenance</summary>
            <h5>Definitions, as published with this build</h5>
            <ul class="oc-def-list">${defs}</ul>
            <h5>Sponsors</h5>
            <p>${sa.method ? `Names follow the ${esc(sa.method)} where a lead sponsor has been reviewed (${(ls.attributed || 0).toLocaleString()} trials); otherwise the registered name is shown as registered (${(ls.unreviewed || 0).toLocaleString()} trials).` : 'Sponsor names as registered.'}${sa.n_differs_from_industry_recode != null ? ` For ${sa.n_differs_from_industry_recode.toLocaleString()} trials the name differs from the Participant demographics view's company grouping, which this pane does not change.` : ''}</p>
            <h5>Link to the participant-demographics data</h5>
            <p>${m.demographics_linked ? `${m.demographics_linked.numerator.toLocaleString()} of ${N.toLocaleString()} trials appear in the participant-demographics dataset` : 'The link was not computed for this build'}${dl.n_in_industry_demographics_cohort != null ? `, ${dl.n_in_industry_demographics_cohort.toLocaleString()} of them in its Industry cohort` : ''}${dl.site_snapshot_date ? `, as of that dataset's ${esc(fmtDate(dl.site_snapshot_date))} data` : ''}. The two views have different cohorts and dates.</p>
            <h5>This build</h5>
            <dl class="oc-prov-dl">
                <dt>Run</dt><dd><code>${esc(run.run_id)}</code>, generated ${esc(fmtDate(run.generated_at))}${run.producer ? ` by ${esc(run.producer.repository)} <code>${esc(short(run.producer.commit))}</code>` : ''}</dd>
                <dt>Registry data</dt><dd>${esc(acq.source || '')}, retrieved ${esc(fmtDate(acq.retrieved_at))}, ${acq.n_records != null ? `${acq.n_records.toLocaleString()} records, ` : ''}sha256 <code>${esc(short(acq.sha256_uncompressed))}</code></dd>
                <dt>Method</dt><dd>Version ${esc(meth.version || 'not recorded')}, rules <code>${esc(short(meth.rules_sha256))}</code>, assessment cutoff ${esc(fmtDate(meth.assessment_cutoff || run.cutoff))}</dd>
                <dt>Display</dt><dd>${run.display_mode === 'evidence_only' ? 'Evidence only: registry evidence, and assessments a person has reviewed' : 'Provisional preview (local only)'}</dd>
            </dl>
        </details>`;
    }

    // ---------------------------------------------------------------- the trial browser

    function optionList(rows, key, current, all) {
        const vals = [...new Set(rows.map(r => r[key]).filter(Boolean))].sort((a, b) => a.localeCompare(b));
        return `<option value="">${esc(all)}</option>` + vals.map(v => `<option value="${esc(v)}"${v === current ? ' selected' : ''}>${esc(v)}</option>`).join('');
    }

    function filtersHTML(rows, f) {
        const sel = (v, cur) => (v === cur ? ' selected' : '');
        return `
        <div class="oc-filters">
            <label class="oc-filter oc-search"><span>Search</span><input type="search" data-of="q" value="${esc(f.q || '')}" placeholder="NCT id, title, sponsor, primary outcome"></label>
            <label class="oc-filter"><span>Results</span><select data-of="results">
                <option value="">All</option><option value="POSTED"${sel('POSTED', f.results)}>Posted</option>
                <option value="NO_RESULTS"${sel('NO_RESULTS', f.results)}>No posted results</option>
                <option value="UNREPORTED"${sel('UNREPORTED', f.results)}>No posted results, past the standard window</option>
                <option value="PENDING_DUE"${sel('PENDING_DUE', f.results)}>No posted results, not yet due</option>
                <option value="PENDING_UNCERTAIN"${sel('PENDING_UNCERTAIN', f.results)}>No posted results, completion not confirmed</option>
                <option value="NOT_APPLICABLE"${sel('NOT_APPLICABLE', f.results)}>No posted results, no participants</option></select></label>
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

    const HEAD = ['Trial', 'Sponsor', 'Primary outcome', 'Results', 'Subgroup results', 'Assessment'];

    // structure: the results-structure family (loadStructure), or nothing; without it every row
    // reads "Not yet processed" for subgroup results.
    function listHTML(rows, run, shown, structure) {
        const body = rows.slice(0, shown).map(r => `
            <tr data-row="${esc(r.nct_id)}">
                <td data-label="Trial"><button type="button" class="oc-open" data-nct="${esc(r.nct_id)}" aria-expanded="false" aria-controls="oc-detail">${esc(r.nct_id)}<span class="oc-open-hint" aria-hidden="true">Evidence</span><span class="oc-vh"> — show the evidence</span></button>
                    <div class="oc-title">${esc(r.title)}</div>
                    <div class="oc-sub">${esc([r.area, r.area_secondary].filter(Boolean).join(' · '))}${r.in_audit ? ' <span class="oc-tag">Development collection</span>' : ''}</div></td>
                <td data-label="Sponsor">${esc(r.sponsor)}${r.sponsor_state !== 'attributed' ? '<div class="oc-sub">as registered; not yet curated</div>' : ''}</td>
                <td data-label="Primary outcome">${r.primary_objective ? esc(r.primary_objective) : '<span class="oc-none">None registered</span>'}${r.n_primary_outcomes > 1 ? `<div class="oc-sub">and ${r.n_primary_outcomes - 1} more primary outcome${r.n_primary_outcomes > 2 ? 's' : ''}</div>` : ''}</td>
                <td data-label="Results"><span class="oc-state"><span class="oc-swatch ${resultsClass(r)}" aria-hidden="true"></span>${esc(resultsLabel(r, run.cutoff))}</span></td>
                <td data-label="Subgroup results">${subgroupCell(subgroupStates(structure, r.nct_id))}</td>
                <td data-label="Assessment">${assessmentCell(r)}</td>
            </tr>`).join('');
        const more = rows.length > shown ? `<button type="button" class="oc-more-btn">Show ${Math.min(PAGE, rows.length - shown)} more of ${(rows.length - shown).toLocaleString()}</button>` : '';
        return `
        <p class="oc-count" aria-live="polite">${rows.length.toLocaleString()} trial${rows.length === 1 ? '' : 's'} match${rows.length > shown ? `; showing ${shown.toLocaleString()}` : ''}</p>
        <div class="oc-table-wrap" role="region" aria-label="Trials">
            <table class="oc-table oc-trials"><thead><tr>${HEAD.map(h => `<th scope="col">${h}</th>`).join('')}</tr></thead>
            <tbody>${body || `<tr class="oc-empty-row"><td colspan="${HEAD.length}"><p class="oc-empty-lead">No trial matches these filters.</p><p class="oc-note">Clear the search or set a filter back to “All”.</p></td></tr>`}</tbody></table>
        </div>${more}`;
    }

    // ---------------------------------------------------------------- the evidence record

    function evidenceList(items) {
        if (!items || !items.length) return '<span class="oc-absent">No citation recorded</span>';
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
        if (rep.statisticalMethod) parts.push(rep.statisticalMethod);
        return parts.join('; ') || 'No estimate posted.';
    }

    function ruleLine(rule) {
        if (!rule) return 'No decision criterion recorded.';
        const src = String(rule.source || '').toLowerCase().replace(/_/g, ' ');
        if (rule.margin != null) return `Margin ${Array.isArray(rule.margin) ? rule.margin.join(' and ') : rule.margin} on the ${rule.margin_side || 'unstated'} confidence limit${src ? `, from ${src}` : ''}`;
        if (rule.alpha != null) return `Significance threshold ${rule.alpha}${rule.alpha_sides ? `, ${rule.alpha_sides}-sided` : ''}${src ? `, from ${src}` : ''}`;
        return 'No threshold or margin is stated in the registry (the protocol or SAP may state one).';
    }

    const words = s => String(s || '').toLowerCase().replace(/_/g, ' ');

    function unitHTML(u, kind) {
        const objective = [esc(u.measure_title), u.time_frame ? esc(u.time_frame) : '<span class="oc-absent">time frame not stated</span>'].join(' — ');
        const comparison = u.group_titles && u.group_titles.length ? esc(u.group_titles.join(' vs ')) : '<span class="oc-absent">compared groups not identified</span>';
        return `
            <div class="oc-unit">
                <h6><span class="oc-unit-id">${esc(u.au_id)}</span> ${esc(u.measure_title)}</h6>
                <dl class="oc-grid">
                    <dt>Objective</dt><dd>${objective}<div class="oc-sub">${u.hypothesis_type ? esc(words(u.hypothesis_type)) : 'hypothesis type not stated'}; ${esc(words(u.analysis_role) || 'no analysis')}${u.part ? `; part ${esc(u.part)}` : ''}</div></dd>
                    <dt>Comparison</dt><dd>${comparison}</dd>
                    <dt>Analysis population</dt><dd><span class="oc-absent">Not recorded in this release</span></dd>
                    <dt>Decision criterion</dt><dd>${esc(ruleLine(u.decision_rule))}</dd>
                    <dt>Reported finding</dt><dd>${esc(reportedLine(u.reported))}</dd>
                    <dt>Interpretation</dt><dd>${stateBadge(u.state, kind)}${u.amended_by_review ? ' <span class="oc-tag">amended by review</span>' : ''}<div>${esc(u.sub_reason ? REASONS[u.sub_reason] || '' : u.rationale || '')}</div></dd>
                    <dt>Sources</dt><dd>${evidenceList(u.evidence)}</dd>
                </dl>
            </div>`;
    }

    function recordHTML(rec, run, machineShown, structure) {
        const f = rec.facts;
        let a = rec.assessment;
        if (a && a.assessment_kind === 'machine_provisional' && !machineShown) a = null;
        const docs = f.documents.length
            ? `<table class="oc-table oc-doc-table"><thead><tr><th scope="col">Document</th><th scope="col">Registry date</th><th scope="col">Uploaded</th></tr></thead><tbody>${
                f.documents.map(d => `<tr><td><a href="${esc(d.url)}" target="_blank" rel="noopener">${esc(d.label)}</a></td><td>${esc(fmtDate(d.document_date)) || '<span class="oc-absent">not stated</span>'}</td><td>${esc(fmtDate(d.upload_date)) || '<span class="oc-absent">not stated</span>'}</td></tr>`).join('')}</tbody></table>
               <p class="oc-note">A posted document is a file on the registry; it does not show which analysis it covers, or that it was finalised before results were known.</p>`
            : '<p><span class="oc-absent">No protocol or statistical analysis plan is posted on the registry.</span></p>';
        const results = rec.results.state === 'POSTED'
            ? `Posted ${esc(fmtDate(f.results_first_post_date))}`
            : `<strong>No posted results as of ${esc(fmtDate(rec.results.as_of))}.</strong> ${esc(REASONS[rec.results.sub_reason] || '')}`;
        const outcomes = f.registered_primary_outcomes.length
            ? '<ul class="oc-list">' + f.registered_primary_outcomes.map(o => `<li>${esc(o.measure)}${o.time_frame ? ` <span class="oc-sub">— ${esc(o.time_frame)}</span>` : ''}</li>`).join('') + '</ul>'
            : '<span class="oc-absent">None registered</span>';
        const method = a ? `
            <p>${stateBadge(a.trial_state, a.assessment_kind)}</p>
            <p>${esc(a.trial_sub_reason ? REASONS[a.trial_sub_reason] || a.trial_rationale : a.trial_rationale)}</p>
            <dl class="oc-grid oc-grid-trial">
                <dt>Multiplicity</dt><dd>${esc(words(a.multiplicity)) || '<span class="oc-absent">not recorded</span>'}</dd>
                <dt>Prespecification</dt><dd>Registration ${esc(words((a.prespecification || {}).registration_timing)) || 'timing not recorded'}${(a.prespecification || {}).level ? `, level ${esc(a.prespecification.level)}` : ''}</dd>
                <dt>Method</dt><dd>Version ${esc(a.method_version)}, assessed as of ${esc(fmtDate(a.assessment_cutoff))}</dd>
            </dl>
            ${(a.units || []).map(u => unitHTML(u, a.assessment_kind)).join('')}`
            : `<p>${rec.collections.audit
                ? '<strong>Awaiting review.</strong> This trial is in the development collection; its assessment is shown only after a person has reviewed it.'
                : '<strong>Not assessed.</strong> Only trials in the development collection are assessed in this beta; that says nothing about this trial.'}</p>`;
        const review = a && a.assessment_kind === 'human_reviewed'
            ? `<p>Reviewed by a person on ${esc(fmtDate(a.review.reviewed_on))}: ${esc(a.review.decision === 'CONFIRM' ? 'confirmed the method\'s conclusion' : a.review.decision === 'AMEND' ? `amended it (the method had said: ${STATE_LABELS[a.review.machine_trial_state] || a.review.machine_trial_state})` : 'could not determine the outcome')}.</p>${a.human_evidence && a.human_evidence.length ? evidenceList(a.human_evidence) : ''}`
            : `<p>${a ? '<span class="oc-prov">Provisional, machine only</span> No person has reviewed this assessment.' : 'No person has reviewed an assessment of this trial.'}</p>`;
        const link = rec.demographics_link
            ? (rec.demographics_link.in_dataset
                ? `In the participant-demographics dataset (sex ${rec.demographics_link.sex_reported ? 'reported' : 'not reported'}, race ${rec.demographics_link.race_reported ? 'reported' : 'not reported'}, ethnicity ${rec.demographics_link.ethnicity_reported ? 'reported' : 'not reported'}).`
                : 'Not in the participant-demographics dataset.')
            : 'Link to the participant-demographics dataset not computed for this build.';
        const enrol = f.enrollment != null ? `${Number(f.enrollment).toLocaleString()} enrolled${f.enrollment_type === 'ESTIMATED' ? ' (estimated)' : ''}` : '';
        return `
        <div class="oc-detail-head">
            <div>
                <p class="oc-detail-title">${esc(f.brief_title)}</p>
                <p class="oc-sub">${esc(rec.sponsor.display)}${rec.sponsor.review_state !== 'attributed' ? ' (as registered; not yet curated)' : ''} · ${esc([rec.area.primary, rec.area.secondary].filter(Boolean).join(' · '))}${f.overall_status ? ` · ${esc(words(f.overall_status))}` : ''}${enrol ? ` · ${esc(enrol)}` : ''} · <a href="${esc(rec.registry_url)}" target="_blank" rel="noopener">ClinicalTrials.gov record</a></p>
            </div>
            <button type="button" class="oc-close">Close<span class="oc-vh"> the evidence for ${esc(rec.nct_id)}</span></button>
        </div>
        <div class="oc-layers">
            <section class="oc-layer-block"><h5><span class="oc-layer-n" aria-hidden="true">1</span> What the registry reports</h5>
                <dl class="oc-grid">
                    <dt>Primary outcome${f.registered_primary_outcomes.length === 1 ? '' : 's'}</dt><dd>${outcomes}</dd>
                    <dt>Results</dt><dd>${results}</dd>
                    <dt>Primary completion</dt><dd>${esc(fmtDate(f.primary_completion_date)) || '<span class="oc-absent">not stated</span>'}${f.primary_completion_type === 'ESTIMATED' ? ' (estimated)' : ''}${f.why_stopped ? `; stopped: ${esc(f.why_stopped)}` : ''}</dd>
                    <dt>Documents</dt><dd>${docs}</dd>
                </dl>
            </section>
            <section class="oc-layer-block"><h5><span class="oc-layer-n" aria-hidden="true">2</span> What the method concludes</h5>${method}</section>
            <section class="oc-layer-block"><h5><span class="oc-layer-n" aria-hidden="true">3</span> What a person checked</h5>${review}</section>
            ${structureDetailHTML(rec, structure, results)}
        </div>
        <p class="oc-note oc-detail-dates">Dates and links. Results availability as of ${esc(fmtDate(run.cutoff))}; registry record last updated ${esc(fmtDate(f.last_update_post_date))}${a ? `; assessment as of ${esc(fmtDate(a.assessment_cutoff))}` : ''}${run.dates && run.dates.demographics_snapshot ? `; demographics data of ${esc(fmtDate(run.dates.demographics_snapshot))}` : ''}. ${esc(link)}</p>`;
    }

    // ---------------------------------------------------------------- posted results structure and subgroup reporting
    //
    // A second artifact family, data/results_structure/ (civicsample-engine outcomes/README.md,
    // "Results structure"): run.json, summary.json and records.json, built by hand from the posted
    // results section of each trial in the cohort's frame. This view shows, per trial, three
    // statuses that stay apart: Results (the outcomes family's states, unchanged), Demographics
    // (what the demographics link already says) and Subgroup results per dimension.
    //
    // Rules this section keeps:
    //   - A trial absent from records.json, or the family being absent or failing structureProblem,
    //     reads "Not yet processed". It never reads as "none detected".
    //   - "Explicit subgroup results detected" appears only when the record carries a review a
    //     person accepted; structureProblem refuses a family that says otherwise.
    //   - Every count shown is a numerator and denominator published in summary.json. Nothing here
    //     counts, sums or divides: no percentage is derived, and no row is counted.
    //   - The build's scope is stated from summary.json: how many registry records were fetched,
    //     how many trials the build covers, and how many fetched records it leaves out and why.
    //     The counts are over the trials it covers, which is the cohort this pane lists.
    //   - Posted documents and publications are not read by the method; each trial says so on its
    //     own line, so absence in the structured fields is not presented as absence everywhere.
    const RS_BASE = 'data/results_structure/';
    const RS_SCHEMA_VERSION = 1;
    const RS_DIMENSIONS = ['age', 'sex', 'race', 'ethnicity'];
    const RS_DIMENSION_LABELS = { age: 'Age', sex: 'Sex', race: 'Race', ethnicity: 'Ethnicity', other: 'No named dimension' };
    const NOT_YET_PROCESSED = 'not_yet_processed';
    const SUBGROUP_DETECTED = 'explicit_subgroup_results_detected';
    const SUBGROUP_LABELS = {
        not_yet_processed: 'Not yet processed',
        processing_failed_or_indeterminate: 'Processing failed or indeterminate',
        no_explicit_subgroup_results_detected_in_reviewed_structured_fields: 'No explicit subgroup results detected in reviewed structured fields',
        explicit_subgroup_results_detected: 'Explicit subgroup results detected',
        not_applicable_no_posted_results: 'No posted results',
    };
    const SUBGROUP_STATES = Object.keys(SUBGROUP_LABELS);
    const MODULE_LABELS = [
        ['baseline', 'Baseline characteristics'], ['participant_flow', 'Participant flow'],
        ['outcome_measures', 'Primary outcome'], ['adverse_events', 'Adverse events'],
    ];
    // Why a usable-content rule did not pass, in words. An unknown code is shown as published.
    const USABLE_REASONS = {
        no_groups: 'no groups are posted',
        no_measures: 'no baseline measure is posted',
        no_numeric_values: 'no baseline measure has a numeric value',
        values_or_denominators_incomplete: 'values or participant counts are missing for the total and for at least one arm',
        no_STARTED_milestone: 'no period has a started count',
        no_COMPLETED_milestone: 'no period has a completed count',
        counts_missing_for_a_group_or_all_zero: 'a started or completed count is missing for a group, or no participant started',
        no_primary_measure: 'no primary measure is posted',
        no_data_table: 'a primary measure has no data table',
        no_unit: 'a primary measure has no unit',
        no_number_analysed: 'a primary measure has no number analysed',
        number_analysed_missing_for_a_group: 'the number analysed is missing for a group',
        zero_analysed_in_every_group: 'no participant was analysed in any group',
        no_numeric_value_for_an_analysed_group: 'an analysed group has no numeric value',
        module_absent: 'the module is not posted',
        no_event_groups: 'no event groups are posted',
        numbers_at_risk_missing_for_a_group: 'the number at risk is missing for a group',
        zero_at_risk_in_every_group: 'no participant is at risk in any group',
        no_event_rows_and_no_group_totals: 'no event rows and no group totals are posted',
        not_evaluated_parse_failure: 'the record could not be parsed, so the rule was not evaluated',
    };

    // Consumer-side integrity check of the results-structure family: what is wrong with the three
    // files as this view reads them, or null. A family that fails is not shown at all.
    function structureProblem(run, summary, recordsFile) {
        if (!isObj(run) || run.schema_version !== RS_SCHEMA_VERSION) return 'run.json is not schema version 1';
        if (typeof run.run_id !== 'string' || !/^results-structure-\d{4}-\d{2}-\d{2}-[0-9a-f]{10}$/.test(run.run_id)) return 'run.json has no run id';
        const version = (run.method || {}).version;
        if (typeof version !== 'string' || !version) return 'run.json has no method version';
        for (const [name, f] of [['summary.json', summary], ['records.json', recordsFile]]) {
            if (!isObj(f) || f.run_id !== run.run_id || f.schema_version !== RS_SCHEMA_VERSION || f.method_version !== version) {
                return `${name} is from another run or method version`;
            }
        }
        for (const key of ['fields_inspected', 'fields_not_inspected']) {
            if (!Array.isArray(run[key]) || !run[key].length) return `run.json does not list ${key.replace(/_/g, ' ')}`;
        }
        if (!isObj(recordsFile.records)) return 'records.json has no records';
        const den = summary.denominators;
        if (!isObj(den) || !isObj(den.requested) || !isInt(den.requested.n) || den.requested.n !== run.n_records) return 'the requested denominator does not match run.json';
        // The summary block maps over this list; a family without it is a failed family, not an empty one.
        if (!Array.isArray(summary.metrics)) return 'summary.json has no metrics list';
        for (const m of summary.metrics) {
            if (!isObj(m)) return 'summary.json has a metric that is not an object';
            const d = den[m.denominator];
            if (!isObj(d) || !isInt(d.n) || !isInt(m.numerator) || m.numerator > d.n || !m.definition || !m.label) return `metric ${m.id} is incomplete`;
        }
        const scope = summary.scope;
        if (!isObj(scope) || !Array.isArray(scope.rows) || scope.rows.some(r => !isObj(r) || !isInt(r.n) || !r.label)) return 'summary.json does not state the scope of the build';
        const scoped = Object.fromEntries(scope.rows.map(r => [r.id, r]));
        if (!scoped.frame || !scoped.included || !scoped.excluded) return 'summary.json does not state the scope of the build';
        if (scoped.included.n !== den.requested.n) return 'the scope does not match the requested denominator';
        if (scoped.excluded.n > 0 && !scoped.excluded.reason) return 'records are left out of the build without a stated reason';
        const states = summary.subgroup_states;
        if (!isObj(states) || !isObj(states.by_dimension) || !isObj(den[states.denominator]) || !isInt(den[states.denominator].n)) return 'summary.json has no subgroup state counts';
        for (const d of RS_DIMENSIONS) {
            const c = states.by_dimension[d];
            if (!isObj(c) || SUBGROUP_STATES.some(s => !isInt(c[s])) || Object.keys(c).length !== SUBGROUP_STATES.length) {
                return `subgroup state counts for ${d} do not list all five values`;
            }
        }
        const tables = summary.tables;
        if (!isObj(tables) || ['retrieval_failures', 'parsing_failures', 'missing_data', 'negative_findings'].some(t => !isObj(tables[t]) || !Array.isArray(tables[t].rows) || tables[t].rows.some(row => !isObj(row)))) {
            return 'summary.json does not keep failures, missing data and negative findings as separate tables';
        }
        let seen = 0;
        for (const [id, r] of Object.entries(recordsFile.records)) {
            seen += 1;
            if (!isObj(r) || r.nct_id !== id || r.method_version !== version) return `${id}: record from another method version`;
            const sg = r.subgroup;
            if (!isObj(sg) || !isObj(sg.by_dimension) || RS_DIMENSIONS.some(d => !SUBGROUP_STATES.includes(sg.by_dimension[d]))) {
                return `${id}: a subgroup state is outside the vocabulary`;
            }
            if (sg.signals != null && !Array.isArray(sg.signals)) return `${id}: signals are not a list`;
            const signals = sg.signals || [];
            const reviewOk = v => isObj(v) && typeof v.dimension === 'string' && typeof v.decision === 'string';
            if (signals.some(s => !isObj(s) || (s.review != null && (!Array.isArray(s.review) || !s.review.every(reviewOk))))) {
                return `${id}: a signal or its review list is malformed`;
            }
            const failures = isObj(r.parse) ? r.parse.failures : null;
            if ((r.parse != null && !isObj(r.parse)) || (failures != null && (!Array.isArray(failures) || failures.some(f => !isObj(f))))) {
                return `${id}: the parse failures are not a list of records`;
            }
            // "Detected" for a characteristic needs an accepted human review naming that characteristic,
            // on a signal of that characteristic or one with no named characteristic ('other'). An
            // accepted review of another characteristic does not carry over. This is the engine's rule
            // (outcomes/results_structure.py, apply_reviews), checked again on what was published.
            const acceptedFor = d => signals.some(s => (s.dimension === d || s.dimension === 'other')
                && (s.review || []).some(v => v.decision === 'accepted' && v.dimension === d));
            const lacking = RS_DIMENSIONS.find(d => sg.by_dimension[d] === SUBGROUP_DETECTED && !acceptedFor(d));
            if (lacking) return `${id}: ${lacking} is marked detected without an accepted human review for ${lacking}`;
        }
        if (seen !== run.n_records) return 'records.json does not hold the number of records run.json states';
        return null;
    }

    // The family, or why it cannot be used. Never throws: a missing or broken family leaves every
    // trial "Not yet processed" and the rest of the pane as it was.
    async function loadStructure(fetchJSON) {
        try {
            const get = (name, reload) => fetchJSON(RS_BASE + name, reload);
            const run = await get('run.json');
            let [summary, recordsFile] = await Promise.all([get('summary.json'), get('records.json')]);
            if (isObj(run) && ((summary || {}).run_id !== run.run_id || (recordsFile || {}).run_id !== run.run_id)) {
                // A file cached from another run: once more past the cache, then give up.
                [summary, recordsFile] = await Promise.all([get('summary.json', true), get('records.json', true)]);
            }
            const problem = structureProblem(run, summary, recordsFile);
            if (problem) return { ok: false, reason: problem };
            return { ok: true, run, summary, records: recordsFile.records };
        } catch (e) {
            return { ok: false, reason: /HTTP 404/.test(e.message) ? 'the files are not published on this site' : e.message };
        }
    }

    const structureRecord = (structure, nct) => (structure && structure.ok && structure.records[nct]) || null;

    // One state per dimension for a trial. No usable family, or no record for the trial, is
    // "not yet processed" for every dimension.
    function subgroupStates(structure, nct) {
        const rec = structureRecord(structure, nct);
        return Object.fromEntries(RS_DIMENSIONS.map(d => [d, rec ? rec.subgroup.by_dimension[d] : NOT_YET_PROCESSED]));
    }

    const subgroupLabel = s => SUBGROUP_LABELS[s] || SUBGROUP_LABELS[NOT_YET_PROCESSED];

    // The list cell: one label when the four dimensions share a state, otherwise one line each.
    function subgroupCell(states) {
        const values = RS_DIMENSIONS.map(d => states[d]);
        if (values.every(v => v === values[0])) {
            return `<span class="oc-sg oc-sg-${esc(values[0])}">${esc(subgroupLabel(values[0]))}</span><div class="oc-sub">age, sex, race and ethnicity</div>`;
        }
        return '<ul class="oc-sg-list">' + RS_DIMENSIONS.map(d =>
            `<li><span class="oc-sg-dim">${RS_DIMENSION_LABELS[d]}</span> <span class="oc-sg oc-sg-${esc(states[d])}">${esc(subgroupLabel(states[d]))}</span></li>`).join('') + '</ul>';
    }

    const count = (num, den) => `<span class="oc-fig"><strong>${num.toLocaleString()}</strong> of ${den.toLocaleString()}</span>`;

    const STRUCTURE_METHOD_TEXT = `
            <p>These figures are <strong>subgroup reporting detected by the current method</strong>: a text rule over structured fields of the posted results, after which a person reviews each signal. They are not a measure of how often trials report subgroup results.</p>
            <p>A signal is wording in one of the inspected fields that looks like subgroup reporting. It is labelled “signal awaiting review” until a person has reviewed it, and only a signal a person accepted gives “Explicit subgroup results detected”.</p>
            <p>Results are never inferred for a subgroup from a trial's overall result and baseline proportions. A trial that reports its participants by race at baseline and one overall estimate says nothing here about the estimate within any group.</p>
            <p>Outcome switching is not assessed. The current registry record does not show how the registered outcomes changed over time.</p>
            <p>Posted documents and publications: not reviewed. Protocols, statistical analysis plans, study reports and journal articles are not read, so a subgroup result reported only there is not found.</p>`;

    function structureMethodsHTML(structure) {
        if (!structure || !structure.ok) {
            return `
        <details class="oc-methods oc-structure-methods"><summary>Methods and limitations: subgroup reporting</summary>${STRUCTURE_METHOD_TEXT}
            <p>The lists of fields inspected and not inspected are published with the data, which is not available here.</p>
        </details>`;
        }
        const { run } = structure;
        const acq = run.acquisition || {};
        const reg = run.registry || {};
        const list = items => '<ul class="oc-field-list">' + items.map(f => `<li><code>${esc(f)}</code></li>`).join('') + '</ul>';
        const short = s => (s ? `${String(s).slice(0, 12)}…` : 'not recorded');
        return `
        <details class="oc-methods oc-structure-methods"><summary>Methods and limitations: subgroup reporting</summary>${STRUCTURE_METHOD_TEXT}
            <h5>Fields inspected</h5>
            <p>For every posted outcome measure, of every type:</p>
            ${list(run.fields_inspected)}
            <h5>Fields not inspected</h5>
            ${list(run.fields_not_inspected)}
            <h5>Usable content and comparisons</h5>
            <p>“Usable” means a table can be read: the values and participant counts a rule needs are posted as numbers. It does not mean the content is correct or complete. Two or more groups on a primary measure is the structure of the record; the groups are not necessarily randomised arms. Participant flow counts are for the first period only.</p>
            <h5>This build</h5>
            <dl class="oc-prov-dl">
                <dt>Run</dt><dd><code>${esc(run.run_id)}</code>, generated ${esc(fmtDate(run.generated_at))}${run.producer ? ` by ${esc(run.producer.repository)} <code>${esc(short(run.producer.commit))}</code>` : ''}</dd>
                <dt>Method</dt><dd>Version ${esc(run.method.version)}; subgroup rule ${esc(run.method.subgroup_rule || 'not recorded')}</dd>
                <dt>Registry data</dt><dd>${esc(acq.source || '')}, retrieved ${esc(fmtDate(acq.retrieved_at))}${reg.api_version ? `, API version ${esc(reg.api_version)}` : ''}${reg.data_timestamp ? `, registry data of ${esc(fmtDate(reg.data_timestamp))}` : ''}; sha256 <code>${esc(short(acq.sha256_uncompressed))}</code></dd>
                <dt>Human reviews</dt><dd>${isObj(run.reviews) && isInt(run.reviews.n_rows) ? `${run.reviews.n_rows.toLocaleString()} review record${run.reviews.n_rows === 1 ? '' : 's'} in the review file` : 'not recorded'}</dd>
            </dl>
        </details>`;
    }

    // The summary block. Every number is read from summary.json with the denominator it names.
    function structureSummaryHTML(structure) {
        const head = '<h4 id="oc-structure-h">Posted results structure and subgroup reporting';
        if (!structure || !structure.ok) {
            return `
        <section class="oc-block oc-structure" aria-labelledby="oc-structure-h">
            ${head}</h4>
            <p class="oc-note"><strong>Not yet processed.</strong> The results-structure data cannot be shown${structure && structure.reason ? ` (${esc(structure.reason)})` : ''}. Every trial below reads “${SUBGROUP_LABELS[NOT_YET_PROCESSED]}” for subgroup results. That is not a finding that no subgroup result was posted.</p>
            ${structureMethodsHTML(structure)}
        </section>`;
        }
        const { summary } = structure;
        const den = summary.denominators;
        // The scope rows as published: fetched, covered, left out (with the reason when any are).
        const scopeRows = summary.scope.rows.map(r =>
            `<dt>${esc(r.label)}</dt><dd><strong>${r.n.toLocaleString()}</strong>${r.id === 'excluded' && r.n > 0 ? ` <span class="oc-sub">Reason: ${esc(r.reason)}.</span>` : ''} <span class="oc-sub">${esc(r.definition || '')}</span></dd>`).join('');
        const metricRow = m => `<tr><th scope="row">${esc(m.label)}</th><td class="num">${count(m.numerator, den[m.denominator].n)}</td><td>${esc(den[m.denominator].definition)} <span class="oc-sub">${esc(m.definition)}</span></td></tr>`;
        const states = summary.subgroup_states;
        const stateRows = SUBGROUP_STATES.map(s =>
            `<tr><th scope="row">${esc(SUBGROUP_LABELS[s])}</th>${RS_DIMENSIONS.map(d => `<td class="num">${states.by_dimension[d][s].toLocaleString()}</td>`).join('')}</tr>`).join('');
        const tables = summary.tables;
        const tableCount = t => (isInt(t.n) && isObj(den[t.denominator]) ? count(t.n, den[t.denominator].n) : '<span class="oc-absent">count not published</span>');
        const findingRow = r => `<tr><th scope="row">${esc(r.label)}</th><td class="num">${isObj(den[r.denominator]) && isInt(r.n) ? count(r.n, den[r.denominator].n) : '<span class="oc-absent">count not published</span>'}</td><td>${isObj(den[r.denominator]) ? esc(den[r.denominator].definition) : ''} <span class="oc-sub">${esc(r.scope ? `Scope: ${r.scope} ` : '')}${esc(r.definition || '')}</span></td></tr>`;
        const sig = summary.signals || {};
        const signalLine = isInt(sig.n_signals) && isInt(sig.n_trials_with_a_signal) && isObj(den[sig.denominator])
            ? `<p class="oc-note">The current method found <strong>${sig.n_signals.toLocaleString()}</strong> signals, in ${count(sig.n_trials_with_a_signal, den[sig.denominator].n)} trials with posted results. ${isInt(sig.n_reviewed) ? `${sig.n_reviewed.toLocaleString()} of the signals have a review record; the rest are signals awaiting review.` : ''}</p>` : '';
        const table = (caption, rows) => `
            <div class="oc-table-scroll" tabindex="0" role="region" aria-label="${esc(caption)}">
                <table class="oc-table oc-structure-table"><caption>${esc(caption)}</caption>
                <thead><tr><th scope="col">Count</th><th scope="col" class="num">Trials</th><th scope="col">Out of, and definition</th></tr></thead>
                <tbody>${rows}</tbody></table>
            </div>`;
        return `
        <section class="oc-block oc-structure" aria-labelledby="oc-structure-h">
            ${head} <span class="oc-h-sub">${den.requested.n.toLocaleString()} trials</span></h4>
            <p class="oc-note">What the posted results section of each trial contains, and where its wording looks like subgroup reporting. Every count below is over the trials in this build, and each count names its own denominator.</p>
            <dl class="oc-grid oc-structure-scope">${scopeRows}</dl>
            ${table('Posted results: content that can be read', summary.metrics.map(metricRow).join(''))}
            <h5 class="oc-sub-h">Subgroup results, by dimension <span class="oc-h-sub">each of the ${den[states.denominator].n.toLocaleString()} trials is in exactly one state per dimension</span></h5>
            <div class="oc-table-scroll" tabindex="0" role="region" aria-label="Subgroup result states by dimension">
                <table class="oc-table oc-structure-states"><thead><tr><th scope="col">State</th>${RS_DIMENSIONS.map(d => `<th scope="col" class="num">${RS_DIMENSION_LABELS[d]}</th>`).join('')}</tr></thead>
                <tbody>${stateRows}</tbody></table>
            </div>
            ${signalLine}
            <p class="oc-note oc-doc-review">Posted documents and publications: not reviewed, for every trial. “No explicit subgroup results detected in reviewed structured fields” describes those fields only.</p>
            <details class="oc-taxonomy"><summary>Failures, missing data and negative findings</summary>
                <dl class="oc-grid">
                    <dt>Retrieval failures</dt><dd>${tableCount(tables.retrieval_failures)} <span class="oc-sub">${esc(tables.retrieval_failures.definition || '')}</span></dd>
                    <dt>Parsing failures</dt><dd>${tableCount(tables.parsing_failures)} <span class="oc-sub">${esc(tables.parsing_failures.definition || '')}</span></dd>
                </dl>
                ${table('Missing data: what the records do not contain', tables.missing_data.rows.map(findingRow).join(''))}
                ${table('Negative findings: searches that found nothing, with their scope', tables.negative_findings.rows.map(findingRow).join(''))}
            </details>
            ${structureMethodsHTML(structure)}
        </section>`;
    }

    function usableLine(m) {
        if (m.usable === true) return 'Usable';
        const why = String(m.reason || '').split('+').map(r => USABLE_REASONS[r] || r).join('; ');
        return `${m.usable === false ? 'Not usable' : 'Not evaluated'}: ${why}`;
    }

    function signalHTML(s) {
        const reviews = Array.isArray(s.review) ? s.review : [];
        const tag = reviews.length
            ? reviews.map(v => `<span class="oc-tag">reviewed by a person: ${esc(v.decision)} for ${esc((RS_DIMENSION_LABELS[v.dimension] || v.dimension || '').toLowerCase())}${v.reviewed_on ? `, ${esc(fmtDate(v.reviewed_on))}` : ''}</span>`).join(' ')
            : '<span class="oc-tag oc-awaiting">signal awaiting review</span>';
        const matched = (Array.isArray(s.matched_text) ? s.matched_text : []).map(t => `<q>${esc(t)}</q>`).join(' ');
        return `<li class="oc-signal">${tag} <strong>${esc(RS_DIMENSION_LABELS[s.dimension] || s.dimension)}</strong>
                    <dl class="oc-grid">
                        <dt>Measure</dt><dd>${esc(s.measure_title)}${s.measure_type ? ` <span class="oc-sub">${esc(words(s.measure_type))}</span>` : ''}</dd>
                        <dt>Field</dt><dd><code class="oc-loc">${esc(s.field_path)}</code></dd>
                        <dt>Matched text</dt><dd>${matched || '<span class="oc-absent">not recorded</span>'}${s.matched_text_truncated ? ' <span class="oc-sub">(cut at 400 characters)</span>' : ''}</dd>
                        ${s.context ? `<dt>In context</dt><dd><q>${esc(s.context)}</q></dd>` : ''}
                    </dl></li>`;
    }

    // The trial's three statuses, kept apart, then its signals and its usable-content flags.
    // resultsHTML is the Results line the evidence record already shows (the outcomes family's).
    function structureDetailHTML(rec, structure, resultsHTML) {
        const s = structureRecord(structure, rec.nct_id);
        const states = subgroupStates(structure, rec.nct_id);
        const link = rec.demographics_link;
        const reported = v => (v ? 'Reported' : 'Not reported');
        // Demographics: exactly what the demographics link carries (sex, race, ethnicity). It has
        // no age field, so no age line is shown.
        const demographics = link
            ? (link.in_dataset
                ? `<ul class="oc-sg-list"><li><span class="oc-sg-dim">Sex</span> ${reported(link.sex_reported)}</li><li><span class="oc-sg-dim">Race</span> ${reported(link.race_reported)}</li><li><span class="oc-sg-dim">Ethnicity</span> ${reported(link.ethnicity_reported)}</li></ul><div class="oc-sub">Baseline reporting, from the participant-demographics dataset.</div>`
                : 'Not in the participant-demographics dataset.')
            : '<span class="oc-absent">Link to the participant-demographics dataset not computed for this build.</span>';
        const subgroup = '<ul class="oc-sg-list">' + RS_DIMENSIONS.map(d =>
            `<li><span class="oc-sg-dim">${RS_DIMENSION_LABELS[d]}</span> <span class="oc-sg oc-sg-${esc(states[d])}">${esc(subgroupLabel(states[d]))}</span></li>`).join('') + '</ul>';
        const docReview = s && s.document_and_publication_review && s.document_and_publication_review !== 'not_reviewed'
            ? words(s.document_and_publication_review) : 'not reviewed';
        let signals;
        let usable = '';
        if (!s) {
            signals = `<p class="oc-note">This trial is not in the results-structure data${structure && !structure.ok && structure.reason ? ` (${esc(structure.reason)})` : ''}, so its posted results have not been read by the current method. That is not a finding that no subgroup result was posted.</p>`;
        } else if (s.results_status === 'no_posted_results') {
            signals = '<p class="oc-note">The registry holds no posted results for this trial, so there is nothing for the method to read.</p>';
        } else if (s.results_status === 'not_retrieved') {
            signals = `<p class="oc-note">The registry record was not retrieved (${esc((s.retrieval || {}).reason || 'reason not recorded')}), so its posted results have not been read.</p>`;
        } else {
            const failures = ((s.parse || {}).failures || []).map(f => `<li><strong>${esc(words(f.section))}</strong>: ${esc(f.reason)}</li>`).join('');
            const list = Array.isArray(s.subgroup.signals) ? s.subgroup.signals : null;
            signals = (failures ? `<p class="oc-note"><strong>Processing failed</strong> for part of this record:</p><ul class="oc-list">${failures}</ul>` : '') +
                (list === null ? '<p class="oc-note">The outcome measures could not be read, so the subgroup rule was not applied.</p>'
                    : list.length
                        ? `<details class="oc-signals" open><summary>${isInt(s.subgroup.n_signals) ? `${s.subgroup.n_signals.toLocaleString()} ` : ''}signal${s.subgroup.n_signals === 1 ? '' : 's'} found by the current method</summary><ul class="oc-signal-list">${list.map(signalHTML).join('')}</ul></details>`
                        : '<p class="oc-note">The current method found no signal in the fields it inspects. Posted documents and publications were not read.</p>');
            if (isObj(s.modules)) {
                usable = `
                <h6 class="oc-sub-h">Posted results: content that can be read</h6>
                <dl class="oc-grid">${MODULE_LABELS.filter(([k]) => isObj(s.modules[k])).map(([k, label]) =>
                    `<dt>${label} <span class="oc-sub">rule ${esc(s.modules[k].rule)}</span></dt><dd>${esc(usableLine(s.modules[k]))}${s.modules[k].present ? '' : ' <span class="oc-sub">(module not posted)</span>'}</dd>`).join('')}
                </dl>
                <p class="oc-note">“Usable” means the table can be read as numbers; it does not mean the content is correct or complete.</p>`;
            }
        }
        return `
            <section class="oc-layer-block oc-structure-detail"><h5>Posted results structure and subgroup reporting</h5>
                <dl class="oc-grid">
                    <dt>Results</dt><dd>${resultsHTML}</dd>
                    <dt>Demographics</dt><dd>${demographics}</dd>
                    <dt>Subgroup results</dt><dd>${subgroup}</dd>
                </dl>
                <p class="oc-note oc-doc-review">Posted documents and publications: ${esc(docReview)}</p>
                ${signals}${usable}
            </section>`;
    }

    // ---------------------------------------------------------------- the live view

    const state = { data: null, filters: {}, shown: PAGE, shards: {}, opener: null, openNct: null, request: 0 };

    async function load(fetchJSON) {
        const get = async (path, reload) => fetchJSON(BASE + path, reload);
        // Started alongside the outcomes files; it never rejects (a missing family is a value).
        const structure = loadStructure(fetchJSON);
        const run = await get('run.json');
        let [summary, index] = await Promise.all([get('summary.json'), get('index.json')]);
        if (summary.run_id !== run.run_id || index.run_id !== run.run_id) {
            // A file cached from another run: once more past the cache, then give up.
            [summary, index] = await Promise.all([get('summary.json', true), get('index.json', true)]);
        }
        const problem = dataProblem(run, summary, index);
        if (problem) throw new Error(problem);
        return { run, summary, index, get, structure: await structure };
    }

    function currentRows() {
        const { run, index } = state.data;
        const host = (root.location && root.location.hostname) || '';
        return filterRows(visibleRows(index.rows, run, host), state.filters);
    }

    function render(el) {
        const { run, summary, index } = state.data;
        const host = (root.location && root.location.hostname) || '';
        const machineShown = showsMachine(run, host);
        const banner = run.display_mode === 'provisional_preview'
            ? (machineShown
                ? '<div class="oc-banner" role="note"><strong>Local preview.</strong> Provisional machine assessments are shown and labelled; no person has reviewed them. Never publish this build.</div>'
                : '<div class="oc-banner" role="note">This build contains unreviewed machine assessments, so only registry evidence is shown here.</div>')
            : '';
        el.innerHTML = `
            ${banner}
            ${headHTML(run, summary)}
            ${availabilityHTML(summary)}
            ${structureSummaryHTML(state.data.structure)}
            <section class="oc-block oc-browser" aria-labelledby="oc-browser-h">
                <h4 id="oc-browser-h">Trials <span class="oc-h-sub">search and filter the ${index.rows.length.toLocaleString()} eligible trials; open one to read its evidence in place</span></h4>
                ${filtersHTML(index.rows, state.filters)}
                <div class="oc-list-wrap">${listHTML(currentRows(), run, state.shown, state.data.structure)}</div>
            </section>
            ${reviewHTML(run, summary, machineShown)}
            ${methodsHTML(run, summary)}`;
        wire(el);
    }

    // Re-draw the list after a filter or "show more", keeping an open record open (without moving
    // focus) when its trial is still listed.
    function rerenderList(el) {
        el.querySelector('.oc-list-wrap').innerHTML = listHTML(currentRows(), state.data.run, state.shown, state.data.structure);
        wireList(el);
        const nct = state.openNct;
        const opener = nct && [...el.querySelectorAll('.oc-open')].find(b => b.dataset.nct === nct);
        if (opener) openRecord(el, nct, opener, state.data, mountDetail, { focus: false });
        else { state.openNct = null; state.opener = null; state.request++; }
    }

    function wire(el) {
        // A button, not a #fragment link: the site routes on location.hash.
        const about = el.querySelector('.oc-status-link');
        const target = el.querySelector('#oc-review-h');
        if (about && target) about.addEventListener('click', () => {
            target.setAttribute('tabindex', '-1');
            target.scrollIntoView({ block: 'start' });
            target.focus({ preventScroll: true });
        });
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
        el.querySelectorAll('.oc-open').forEach(b => b.addEventListener('click', () => {
            if (b.getAttribute('aria-expanded') === 'true') closeRecord(el);
            else openRecord(el, b.dataset.nct, b);
        }));
        const more = el.querySelector('.oc-more-btn');
        if (more) more.addEventListener('click', () => { state.shown += PAGE; rerenderList(el); });
    }

    // The evidence opens in a row directly under its trial, so the list keeps its place. One record
    // is open at a time; the region is #oc-detail, which the open trial's button controls.
    function mountDetail(el, opener) {
        el.querySelectorAll('.oc-detail-row').forEach(n => n.remove());
        el.querySelectorAll('.oc-open[aria-expanded="true"]').forEach(b => b.setAttribute('aria-expanded', 'false'));
        const tr = opener.closest('tr');
        const row = document.createElement('tr');
        row.className = 'oc-detail-row';
        row.innerHTML = `<td colspan="${HEAD.length}"><div class="oc-detail" id="oc-detail" role="region" tabindex="-1" aria-label="Evidence for ${esc(opener.dataset.nct)}"></div></td>`;
        tr.after(row);
        opener.setAttribute('aria-expanded', 'true');
        return row.querySelector('.oc-detail');
    }

    // data and mount default to the live view's; tests pass their own.
    async function openRecord(el, nct, opener, data = state.data, mount = mountDetail, opts = {}) {
        const { run, index, get } = data;
        const row = index.rows.find(r => r.nct_id === nct);
        // The latest selection wins: a record that arrives after another trial was opened (or the
        // record closed) is dropped, with its error and its focus move.
        const request = ++state.request;
        state.opener = opener;
        state.openNct = nct;
        const panel = mount(el, opener);
        panel.hidden = false;
        panel.innerHTML = '<p class="oc-note">Loading the evidence record…</p>';
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
            html = recordHTML(rec, run, showsMachine(run, host), data.structure);
        } catch (e) {
            html = `<div class="oc-detail-head"><p class="oc-note">Could not load the evidence record (${esc(e.message)}).</p><button type="button" class="oc-close">Close</button></div>`;
        }
        if (request !== state.request) return;
        panel.innerHTML = html;
        panel.querySelector('.oc-close').addEventListener('click', () => closeRecord(el));
        if (panel.addEventListener) panel.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); closeRecord(el); } });
        if (opts.focus !== false) {
            // Keep the reader's place: focus without scrolling, and scroll only when the evidence
            // would start below the fold, and then just far enough to put the trial's row on top.
            panel.focus({ preventScroll: true });
            const rowEl = panel.closest ? (panel.closest('tr') || {}).previousElementSibling : null;
            const vh = root.innerHeight || 0;
            if (rowEl && panel.getBoundingClientRect && panel.getBoundingClientRect().top > vh - 160) rowEl.scrollIntoView({ block: 'start' });
        }
    }

    function closeRecord(el) {
        state.request++;   // any record still loading is now stale
        el.querySelectorAll('.oc-detail-row').forEach(n => n.remove());
        el.querySelectorAll('.oc-open[aria-expanded="true"]').forEach(b => b.setAttribute('aria-expanded', 'false'));
        const opener = state.opener;
        state.openNct = null;
        state.opener = null;
        if (opener && opener.isConnected) opener.focus();
    }

    // deps.fetchJSON(path, reload) -> parsed JSON; throws on HTTP errors.
    // Loading, missing and failed states keep the pane's heading, so the page does not change shape
    // when the data arrives; none of them shows a number.
    const SHELL = '<div class="oc-head"><h3>What outcome evidence is there for each trial? <span class="oc-beta">Beta</span></h3></div>';

    async function open(el, deps) {
        if (state.data) { render(el); return; }
        el.innerHTML = `${SHELL}<p class="oc-state-msg" role="status" aria-live="polite">Loading the trial outcomes data…</p>`;
        try {
            state.data = await load(deps.fetchJSON);
        } catch (e) {
            const missing = /HTTP 404/.test(e.message);
            el.innerHTML = missing
                ? `${SHELL}<div class="oc-state-msg" role="status"><p>The trial outcomes data is not published on this site.</p><p class="oc-note">The Participant demographics view is unaffected.</p></div>`
                : `${SHELL}<div class="oc-state-msg" role="alert"><p>Could not load the trial outcomes data (${esc(e.message)}). Nothing is shown rather than a partial or zero count.</p>
                    <button type="button" class="oc-retry">Try again</button></div>`;
            const retry = el.querySelector('.oc-retry');
            if (retry) retry.addEventListener('click', () => { open(el, deps); });
            return;
        }
        render(el);
    }

    root.IndustryOutcomes = {
        open, openRecord, dataProblem, shardProblem, filterRows, visibleRows, showsMachine, resultsLabel, fmtDate,
        overviewHTML, availabilityHTML, reviewHTML, headHTML, methodsHTML, filtersHTML, listHTML, recordHTML,
        TRIAL_STATES, STATE_LABELS, REASONS,
        structureProblem, loadStructure, subgroupStates, subgroupCell, structureSummaryHTML, structureMethodsHTML,
        structureDetailHTML, SUBGROUP_LABELS, SUBGROUP_STATES, RS_DIMENSIONS,
    };
})(typeof window !== 'undefined' ? window : globalThis);

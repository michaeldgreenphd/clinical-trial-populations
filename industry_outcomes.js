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

    function headHTML(run) {
        const excl = Object.entries((run.cohort || {}).exclusions || {}).filter(([, n]) => n > 0)
            .map(([k, n]) => `${n.toLocaleString()} ${esc(EXCLUSION_LABELS[k] || k)}`).join('; ');
        return `
        <div class="oc-head">
            <h3>Industry Trial Outcomes <span class="oc-beta">Beta</span></h3>
            <p class="oc-lede">${run.cohort.n_eligible.toLocaleString()} randomized Phase 3 trials with an industry lead sponsor and primary completion in 2020. For each: what evidence ClinicalTrials.gov makes available, whether a prespecified primary objective can be assessed from it, and, once a person has reviewed it, what that assessment concludes.</p>
            <p class="oc-dateline"><strong>A fixed cohort</strong>, retrieved from the registry on ${esc(fmtDate((run.acquisition || {}).retrieved_at))}; results availability as of ${esc(fmtDate(run.cutoff))}. It is not refreshed weekly: the “Last updated” date and the snapshot selector at the top of the page belong to the weekly participant-demographics data and do not change this pane.</p>
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
                <dl class="oc-empty-dl">
                    <dt>Available now</dt><dd>Registry evidence for all ${den.eligible.n.toLocaleString()} trials: results status, dates, registered primary outcomes and posted documents. Open any trial below.</dd>
                    <dt>What review adds</dt><dd>For each reviewed trial: whether its prespecified primary objective was met, not met, or cannot be determined from the evidence, with the decision criterion, the reported finding and the cited sources, and the reviewer's decision (confirm, amend or cannot determine).</dd>
                    <dt>What it will not say</dt><dd>Clinical importance, regulatory approval, or a success rate for any sponsor, drug or the cohort.</dd>
                </dl>
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

    const HEAD = ['Trial', 'Sponsor', 'Primary outcome', 'Results', 'Assessment'];

    function listHTML(rows, run, shown) {
        const body = rows.slice(0, shown).map(r => `
            <tr data-row="${esc(r.nct_id)}">
                <td data-label="Trial"><button type="button" class="oc-open" data-nct="${esc(r.nct_id)}" aria-expanded="false" aria-controls="oc-detail">${esc(r.nct_id)}<span class="oc-open-hint" aria-hidden="true">Evidence</span><span class="oc-vh"> — show the evidence</span></button>
                    <div class="oc-title">${esc(r.title)}</div>
                    <div class="oc-sub">${esc([r.area, r.area_secondary].filter(Boolean).join(' · '))}${r.in_audit ? ' <span class="oc-tag">Development collection</span>' : ''}</div></td>
                <td data-label="Sponsor">${esc(r.sponsor)}${r.sponsor_state !== 'attributed' ? '<div class="oc-sub">as registered; not yet curated</div>' : ''}</td>
                <td data-label="Primary outcome">${r.primary_objective ? esc(r.primary_objective) : '<span class="oc-none">None registered</span>'}${r.n_primary_outcomes > 1 ? `<div class="oc-sub">and ${r.n_primary_outcomes - 1} more primary outcome${r.n_primary_outcomes > 2 ? 's' : ''}</div>` : ''}</td>
                <td data-label="Results"><span class="oc-state"><span class="oc-swatch ${resultsClass(r)}" aria-hidden="true"></span>${esc(resultsLabel(r, run.cutoff))}</span></td>
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

    function recordHTML(rec, run, machineShown) {
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
        </div>
        <p class="oc-note oc-detail-dates">Dates and links. Results availability as of ${esc(fmtDate(run.cutoff))}; registry record last updated ${esc(fmtDate(f.last_update_post_date))}${a ? `; assessment as of ${esc(fmtDate(a.assessment_cutoff))}` : ''}${run.dates && run.dates.demographics_snapshot ? `; demographics data of ${esc(fmtDate(run.dates.demographics_snapshot))}` : ''}. ${esc(link)}</p>`;
    }

    // ---------------------------------------------------------------- the live view

    const state = { data: null, filters: {}, shown: PAGE, shards: {}, opener: null, openNct: null, request: 0 };

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
            ${headHTML(run)}
            ${availabilityHTML(summary)}
            ${reviewHTML(run, summary, machineShown)}
            <section class="oc-block oc-browser" aria-labelledby="oc-browser-h">
                <h4 id="oc-browser-h">Trials <span class="oc-h-sub">search and filter the ${index.rows.length.toLocaleString()} eligible trials; open one to read its evidence in place</span></h4>
                ${filtersHTML(index.rows, state.filters)}
                <div class="oc-list-wrap">${listHTML(currentRows(), run, state.shown)}</div>
            </section>
            ${methodsHTML(run, summary)}
            <p class="chart-footnote">Run ${esc(run.run_id)}. A fixed registry pull, retrieved ${esc(fmtDate((run.acquisition || {}).retrieved_at))} and not refreshed weekly; method ${esc((run.method || {}).version || 'not supplied')}; sponsor names by the curated rules where reviewed, otherwise as registered.</p>`;
        wire(el);
    }

    // Re-draw the list after a filter or "show more", keeping an open record open (without moving
    // focus) when its trial is still listed.
    function rerenderList(el) {
        el.querySelector('.oc-list-wrap').innerHTML = listHTML(currentRows(), state.data.run, state.shown);
        wireList(el);
        const nct = state.openNct;
        const opener = nct && [...el.querySelectorAll('.oc-open')].find(b => b.dataset.nct === nct);
        if (opener) openRecord(el, nct, opener, state.data, mountDetail, { focus: false });
        else { state.openNct = null; state.opener = null; state.request++; }
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
            html = recordHTML(rec, run, showsMachine(run, host));
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
    async function open(el, deps) {
        if (state.data) { render(el); return; }
        el.innerHTML = '<p class="note">Loading the trial outcomes data…</p>';
        try {
            state.data = await load(deps.fetchJSON);
        } catch (e) {
            const missing = /HTTP 404/.test(e.message);
            el.innerHTML = missing
                ? '<div class="panel-hero"><h3>Industry Trial Outcomes <span class="oc-beta">Beta</span></h3><p class="note">The trial outcomes data is not available on this site.</p></div>'
                : `<p class="note">Could not load the trial outcomes data (${esc(e.message)}).</p>`;
            return;
        }
        render(el);
    }

    root.IndustryOutcomes = {
        open, openRecord, dataProblem, shardProblem, filterRows, visibleRows, showsMachine, resultsLabel, fmtDate,
        overviewHTML, availabilityHTML, reviewHTML, headHTML, methodsHTML, filtersHTML, listHTML, recordHTML,
        TRIAL_STATES, STATE_LABELS, REASONS,
    };
})(typeof window !== 'undefined' ? window : globalThis);

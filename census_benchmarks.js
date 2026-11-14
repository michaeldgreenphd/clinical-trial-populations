/*
 * Geography tab, "Site-area benchmarks" pane.
 *
 * Reads the census benchmark family the engine writes by hand into data/census/
 * (civicsample-engine census/README.md and scripts/census/export_site.py, site schema 1):
 * run.json, summary.json and areas.<dimension>.json. It presents; it computes no aggregate.
 * Every figure shown is a published value; the controls only choose which published rows and
 * which published denominator to show.
 *
 * What the figures are. Participants of trials whose registration lists one US facility,
 * beside residents of an area around that facility who meet the trial's age and sex
 * eligibility. That is a site-area population benchmark: a proxy for a potential recruitment
 * population, not where participants live, not the population with the condition, and not an
 * enrolment target. The pane says so before any number, and offers every area level side by
 * side rather than one as the answer.
 *
 * Loaded by index.html before app.js; app.js calls CensusBenchmarks.open(el, deps) when the
 * Geography tab's switch selects this pane.
 */
(function (root) {
    'use strict';

    const SCHEMA_VERSION = 1;
    const BASE = 'data/census/';
    const DIMENSIONS = ['race', 'ethnicity', 'sex'];
    const LEVELS = ['cbsa', 'county', 'zcta', 'state', 'region', 'us'];
    const LEVEL_LABELS = {
        cbsa: 'Metro area', county: 'County', zcta: 'ZIP Code Tabulation Area', state: 'State',
        region: 'Census region', us: 'United States',
    };
    const VARIANTS = { with_referral_zips: 'All sites', without_referral_zips: 'Without referral-centre ZIPs' };
    const DENOMINATORS = {
        all: 'Of all participants in the table',
        classified: 'Of participants with a reported category',
    };
    const CATEGORY_LABELS = {
        american_indian_alaska_native: 'American Indian or Alaska Native', asian: 'Asian',
        black_african_american: 'Black or African American',
        native_hawaiian_pacific_islander: 'Native Hawaiian or Other Pacific Islander', white: 'White',
        more_than_one_race: 'More than one race', other: 'Other (survey: Some Other Race)',
        hispanic_latino: 'Hispanic or Latino', not_hispanic_latino: 'Not Hispanic or Latino',
        female: 'Female', male: 'Male',
    };
    const DEFAULT_CATEGORY = { race: 'black_african_american', ethnicity: 'hispanic_latino', sex: 'female' };

    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const num = n => (typeof n === 'number' ? n.toLocaleString('en-US') : '—');
    const pct = v => (typeof v === 'number' ? v.toFixed(1) + '%' : '—');
    const pts = v => (typeof v === 'number' ? (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(1) : '—');
    const fmtDate = iso => {
        const d = new Date(iso);
        return isNaN(d) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
    };

    // What is wrong with the fetched family as this pane reads it, or null. A file from another
    // build, or a schema this pane does not know, is refused rather than half-rendered.
    function dataProblem(run, summary, areas) {
        if (!run || run.schema_version !== SCHEMA_VERSION) return 'run.json is missing or has a schema this view does not read';
        if (!run.run_id || !run.default_level || !Array.isArray(run.limitations)) return 'run.json lacks its run id, default level or limitations';
        if (!summary || summary.run_id !== run.run_id) return 'summary.json belongs to a different build';
        if (!summary.reference_population_assessed || typeof summary.reference_population_assessed.n !== 'number') return 'summary.json lacks the assessed-trials count';
        if (areas) {
            if (areas.schema_version !== SCHEMA_VERSION || areas.run_id !== run.run_id) return 'the areas file belongs to a different build';
            if (!DIMENSIONS.includes(areas.dimension) || !Array.isArray(areas.areas)) return 'the areas file is not an areas file';
            for (const a of areas.areas) {
                if (!LEVELS.includes(a.level) || !(a.variant in VARIANTS)) return 'an area has a level or variant this view does not know';
                if (a.display_rule === 'show' && !Array.isArray(a.categories)) return 'a shown area has no categories';
                if (a.display_rule === 'withheld' && (a.categories || !a.gate_reason)) return 'a withheld area carries figures or lacks its reason';
                if (a.display_rule !== 'show' && a.display_rule !== 'withheld') return 'an area has a display rule this view does not know';
            }
        }
        return null;
    }

    // The published rows for one level and variant: shown areas by trial count, then withheld ones.
    function areaRows(areas, level, variant, query) {
        const q = (query || '').trim().toLowerCase();
        const rows = areas.areas.filter(a => a.level === level && a.variant === variant &&
            (!q || (a.name || '').toLowerCase().includes(q) || String(a.geoid).includes(q)));
        const by = (x, y) => y.n_trials - x.n_trials || String(x.geoid).localeCompare(String(y.geoid));
        return { shown: rows.filter(a => a.display_rule === 'show').sort(by),
                 withheld: rows.filter(a => a.display_rule === 'withheld').sort(by) };
    }

    // One category of one area, under the chosen denominator. Denominator B has no interval of
    // its own in the published file, so none is shown for it.
    function cell(area, category, denominator) {
        const c = (area.categories || []).find(x => x.category === category);
        if (!c) return null;
        const b = denominator === 'classified' ? c.of_classified : null;
        if (denominator === 'classified' && !b) return { reference: c.expected_pct, moe: c.expected_moe90_pp, unavailable: true };
        return {
            reference: c.expected_pct, moe: c.expected_moe90_pp,
            observed: b ? b.observed_pct : c.observed_pct, diff: b ? b.diff_pp : c.diff_pp,
            lo: b ? null : c.lo_pp, hi: b ? null : c.hi_pp, ratio: b ? b.ratio : c.ratio,
            settled: c.unknown_bounds ? c.unknown_bounds.direction_settled : null,
            ceiling: c.unknown_bounds ? c.unknown_bounds.diff_pp_if_every_unknown_is_in_category : null,
        };
    }

    function headHTML(run, summary) {
        const funnel = summary.cohort_funnel || {};
        const fit = summary.reference_population_fit || {};
        const assessed = (summary.reference_population_assessed || {}).n;    // published, not added up here
        return `
            <div class="panel-hero cb-head">
                <h3>Site-area population benchmarks <span class="cb-tag">US, one listed site</span></h3>
                <p class="note cb-lede">Participants of trials whose registration lists one US facility, beside residents of an
                    area around that facility who meet the trial's age and sex eligibility. <strong>The area is a proxy for a
                    potential recruitment population.</strong> It is not where participants live, not the population with the
                    condition, and not an enrolment target; a referral centre may recruit nationally.</p>
                <p class="note cb-dateline">${num(funnel.us_one_listed_facility)} of ${num(funnel.records)} trials with posted results
                    list one US facility. Of the ${num(assessed)} whose eligibility could be read, ${num(fit.contextual)} are marked
                    <em>contextual</em>: a general-population denominator does not match them, most often because they enrol patients. Built ${esc(fmtDate(run.generated_at))}
                    from the ${esc(run.source_release && run.source_release.tag)} release; reference populations from the
                    ${esc(run.product)}, windows ${esc((run.windows || []).join(', '))}. Not refreshed weekly.</p>
            </div>`;
    }

    function controlsHTML(state, run) {
        const group = (name, label, options, value) => `
            <div class="cb-control"><span class="cb-control-label" id="cb-${name}-label">${esc(label)}</span>
                <div class="geography-view-toggle cb-toggle" role="group" aria-labelledby="cb-${name}-label">
                    ${Object.entries(options).map(([k, v]) => `<button type="button" class="view-btn${k === value ? ' active' : ''}"
                        data-cb-${name}="${esc(k)}" aria-pressed="${k === value}">${esc(v)}</button>`).join('')}
                </div></div>`;
        const dims = { race: 'Race', ethnicity: 'Ethnicity', sex: 'Sex' };
        const levels = Object.fromEntries(LEVELS.map(l => [l, LEVEL_LABELS[l] + (l === run.default_level.level ? ' (default)' : '')]));
        const cats = (state.categories || []).map(c => `<option value="${esc(c)}"${c === state.category ? ' selected' : ''}>${esc(CATEGORY_LABELS[c] || c)}</option>`).join('');
        return `
            <div class="cb-controls">
                ${group('dimension', 'Characteristic', dims, state.dimension)}
                ${group('level', 'Reference area', levels, state.level)}
                ${group('variant', 'Sites', VARIANTS, state.variant)}
                ${group('denominator', 'Trial denominator', DENOMINATORS, state.denominator)}
                <div class="cb-control"><label class="cb-control-label" for="cb-category">Category</label>
                    <select id="cb-category">${cats}</select></div>
                <div class="cb-control"><label class="cb-control-label" for="cb-search">Find an area</label>
                    <input type="search" id="cb-search" value="${esc(state.query)}" placeholder="Name or code" autocomplete="off"></div>
            </div>
            <p class="note cb-area-note">${esc(LEVEL_LABELS[state.level])}: the choice of reference area changes the comparison, sometimes by
                more than the difference shown. No level is the answer; the default is the ${esc(run.default_level.label.toLowerCase())}
                because it covers nearly every site with stable estimates. Compare levels before reading a difference as a finding.</p>`;
    }

    function tableHTML(rows, state) {
        if (!rows.shown.length && !rows.withheld.length) return '<p class="note cb-empty">No area matches.</p>';
        const label = CATEGORY_LABELS[state.category] || state.category;
        const body = rows.shown.map(a => {
            const c = cell(a, state.category, state.denominator);
            if (!c) return '';
            const interval = c.lo != null ? ` <span class="cb-interval">[${pts(c.lo)}, ${pts(c.hi)}]</span>` : '';
            const open = state.open === a.geoid;
            return `<tr class="cb-row${open ? ' cb-open' : ''}">
                <th scope="row"><button type="button" class="cb-area-btn" data-cb-area="${esc(a.geoid)}" aria-expanded="${open}"
                    aria-controls="cb-detail-${esc(a.geoid)}">${esc(a.name || a.geoid)}</button></th>
                <td class="cb-num">${num(a.n_trials)}</td>
                <td class="cb-num">${pct(c.reference)}${typeof c.moe === 'number' ? ` <span class="cb-interval">±${c.moe.toFixed(1)}</span>` : ''}</td>
                <td class="cb-num">${c.unavailable ? '—' : pct(c.observed)}</td>
                <td class="cb-num cb-diff">${c.unavailable ? '—' : pts(c.diff)}${interval}</td>
                <td class="cb-num">${pct(a.denominators && a.denominators.unknown_or_unmapped_pct_mean)}</td>
                <td>${c.settled === false ? '<span class="cb-flag">Open: unknowns could reverse it</span>' : c.settled ? 'Settled' : '—'}</td>
            </tr>${open ? `<tr class="cb-detail-row"><td colspan="7" id="cb-detail-${esc(a.geoid)}" tabindex="-1">${detailHTML(a, state)}</td></tr>` : ''}`;
        }).join('');
        const withheld = rows.withheld.length ? `
            <details class="cb-withheld"><summary>${num(rows.withheld.length)} ${rows.withheld.length === 1 ? 'area' : 'areas'} withheld:
                too few trials to show a figure</summary>
                <p class="note">An area is shown only with at least 50 qualifying trials. Withheld areas are listed with their count and
                    are never filled from a wider level.</p>
                <ul class="cb-withheld-list">${rows.withheld.slice(0, 400).map(a =>
                    `<li>${esc(a.name || a.geoid)} <span class="cb-interval">${num(a.n_trials)} ${a.n_trials === 1 ? 'trial' : 'trials'}</span></li>`).join('')}</ul>
                ${rows.withheld.length > 400 ? `<p class="note">and ${num(rows.withheld.length - 400)} more.</p>` : ''}
            </details>` : '';
        const denomNote = state.denominator === 'classified'
            ? 'Observed share of participants with a reported category. Not a correction for missing data: people without a recorded category may differ from those with one. No interval is published for this view.'
            : 'Observed share of everyone in the trial table, unknown included, so each share is a floor. The interval is over trials and does not include survey error.';
        return `
            ${rows.shown.length ? `<div class="cb-table-wrap"><table class="cb-table">
                <caption>${esc(label)}: participants compared with residents of the selected area. ${esc(denomNote)}</caption>
                <thead><tr><th scope="col">${esc(LEVEL_LABELS[state.level])}</th><th scope="col" class="cb-num">Trials</th>
                    <th scope="col" class="cb-num">Residents <span class="cb-interval">±90% margin</span></th>
                    <th scope="col" class="cb-num">Participants</th>
                    <th scope="col" class="cb-num">Difference, points</th>
                    <th scope="col" class="cb-num">Unknown</th><th scope="col">Direction</th></tr></thead>
                <tbody>${body}</tbody></table></div>` : '<p class="note cb-empty">No area at this level has enough trials to show.</p>'}
            ${withheld}`;
    }

    // Everything published for one area: every category, both denominators, the bounds.
    function detailHTML(area, state) {
        const d = area.denominators || {};
        const windows = Object.entries(area.windows || {}).map(([w, n]) => `${esc(w)}: ${num(n)}`).join(' · ');
        const rows = (area.categories || []).map(c => `<tr>
            <th scope="row">${esc(CATEGORY_LABELS[c.category] || c.category)}</th>
            <td class="cb-num">${pct(c.expected_pct)}</td>
            <td class="cb-num">${pct(c.observed_pct)}</td>
            <td class="cb-num">${pts(c.diff_pp)} <span class="cb-interval">[${pts(c.lo_pp)}, ${pts(c.hi_pp)}]</span></td>
            <td class="cb-num">${c.unknown_bounds ? pts(c.unknown_bounds.diff_pp_if_every_unknown_is_in_category) : '—'}</td>
            <td class="cb-num">${c.of_classified ? pct(c.of_classified.observed_pct) : '—'}</td>
            <td class="cb-num">${c.of_classified ? pts(c.of_classified.diff_pp) : '—'}</td>
            <td class="cb-num">${typeof c.ratio === 'number' ? c.ratio.toFixed(2) : 'undefined'}</td>
        </tr>`).join('');
        return `
            <div class="cb-detail">
                <p class="note"><strong>${esc(area.name || area.geoid)}</strong> · ${num(area.n_trials)} trials, each counted once ·
                    ${num(d.participants_in_tables)} participants in the tables, ${num(d.participants_classified)} with a reported category ·
                    survey windows ${windows || '—'} · ${num(area.trials_sensitive_to_geography)} of these trials have a reference share
                    that moves by 10 points or more between area levels${area.concentration_flag ? ' · one trial holds more than half of the participants (affects the participant-weighted figure only)' : ''}.</p>
                <div class="cb-table-wrap"><table class="cb-table cb-detail-table">
                    <caption>All categories. "If every unknown" is the difference were all unknown participants in the category: with
                        the first difference it bounds the truth. The ratio divides the participants' share (all in the table) by the
                        residents' share and is undefined when that is zero.</caption>
                    <thead><tr><th scope="col">Category</th><th scope="col" class="cb-num">Residents</th>
                        <th scope="col" class="cb-num">Participants, of all</th><th scope="col" class="cb-num">Difference</th>
                        <th scope="col" class="cb-num">If every unknown</th>
                        <th scope="col" class="cb-num">Participants, of reported</th><th scope="col" class="cb-num">Difference</th>
                        <th scope="col" class="cb-num">Ratio</th></tr></thead>
                    <tbody>${rows}</tbody></table></div>
                <p class="note">Unknown or unmapped: ${pct(d.unknown_or_unmapped_pct_mean)} of the table on average. A pooled area mixes
                    trials from different survey windows, so this is not a trend.</p>
            </div>`;
    }

    function methodsHTML(run, summary) {
        const dims = summary.dimensions || {};
        const row = (k, label) => `<tr><th scope="row">${label}</th>${DIMENSIONS.map(d => `<td class="cb-num">${num((dims[d] || {})[k])}</td>`).join('')}</tr>`;
        return `
            <details class="cb-methods"><summary>Method, coverage and limitations</summary>
                <div class="cb-table-wrap"><table class="cb-table"><caption>Trials in the cohort, by what could be compared</caption>
                    <thead><tr><th scope="col"></th><th scope="col" class="cb-num">Race</th><th scope="col" class="cb-num">Ethnicity</th><th scope="col" class="cb-num">Sex</th></tr></thead>
                    <tbody>${row('reported', 'Table reported')}${row('not_reported', 'Not reported')}${row('pooled', 'Used in area figures')}</tbody></table></div>
                <ul class="cb-limitations">${(run.limitations || []).map(l => `<li>${esc(l)}</li>`).join('')}</ul>
                <p class="note">Build ${esc(run.run_id)} · method ${esc(run.method_version)} · engine commit
                    ${esc(((run.producer || {}).commit || '').slice(0, 10))} · registry text retrieved ${esc(fmtDate(run.registry_retrieved_at))}.
                    Reproducible builds and passing checks show the arithmetic is right; they do not show that a site-area benchmark
                    is the appropriate comparison for a given trial.</p>
            </details>`;
    }

    const state = { dimension: 'race', level: null, variant: 'with_referral_zips', denominator: 'all',
                    category: null, categories: [], query: '', open: null };
    const cache = {};

    async function open(el, deps) {
        const fetchJSON = deps.fetchJSON;
        el.innerHTML = '<p class="note">Loading site-area benchmarks…</p>';
        let run, summary;
        // This family is published on its own schedule, so the page's weekly cache key says nothing
        // about it. The manifest is always read past the browser cache; any other file that names
        // a different build is a cached copy of an earlier one and is read once more past the cache.
        const current = async name => {
            const data = await fetchJSON(BASE + name);
            return data && run && data.run_id !== run.run_id ? fetchJSON(BASE + name, true) : data;
        };
        try {
            run = await fetchJSON(BASE + 'run.json', true);
            summary = await current('summary.json');
        } catch (err) {
            el.innerHTML = `<p class="note">${/404/.test(String(err && err.message))
                ? 'The site-area benchmark data is not available on this site.'
                : 'Could not load the site-area benchmark data (' + esc(err && err.message) + ').'}</p>`;
            return;
        }
        const bad = dataProblem(run, summary, null);
        if (bad) { el.innerHTML = `<p class="note">The site-area benchmark data could not be read: ${esc(bad)}.</p>`; return; }
        if (!state.level) state.level = run.default_level.level;

        // A draw replaces the pane's markup, and with it whichever control had focus. The caller
        // names what should hold focus afterwards: an element id, or a control by its data key.
        async function draw(focusId, control) {
            // The characteristic this draw is for. A file can arrive after the reader has chosen
            // another one; a draw that is no longer current stops rather than paint the wrong rows.
            const dimension = state.dimension;
            let areas = cache[dimension];
            if (!areas) {
                try { areas = cache[dimension] = await current(`areas.${dimension}.json`); }
                catch (err) {
                    if (dimension === state.dimension) el.innerHTML = `<p class="note">Could not load the areas for this characteristic (${esc(err && err.message)}).</p>`;
                    return;
                }
                if (dimension !== state.dimension) return;
            }
            const problem = dataProblem(run, summary, areas);
            if (problem) { el.innerHTML = `<p class="note">The site-area benchmark data could not be read: ${esc(problem)}.</p>`; return; }
            const first = areas.areas.find(a => a.display_rule === 'show');
            state.categories = first ? first.categories.map(c => c.category) : [];
            if (!state.categories.includes(state.category)) state.category = DEFAULT_CATEGORY[dimension];
            const rows = areaRows(areas, state.level, state.variant, state.query);
            el.innerHTML = headHTML(run, summary) + controlsHTML(state, run) + tableHTML(rows, state) + methodsHTML(run, summary);
            const target = focusId ? el.querySelector('#' + focusId)
                : control ? Array.from(el.querySelectorAll('button')).find(b => b.dataset[control.key] === control.value) : null;
            if (target) target.focus({ preventScroll: true });
        }

        el.onclick = ev => {
            const b = ev.target.closest('button');
            if (!b || !el.contains(b)) return;
            for (const key of ['dimension', 'level', 'variant', 'denominator']) {
                const attr = 'cb' + key[0].toUpperCase() + key.slice(1);
                const v = b.dataset[attr];
                if (v) { state[key] = v; if (key !== 'denominator') state.open = null; draw(null, { key: attr, value: v }); return; }
            }
            if (b.dataset.cbArea) {
                const id = b.dataset.cbArea;
                state.open = state.open === id ? null : id;
                draw(state.open ? 'cb-detail-' + id : null);
            }
        };
        el.onchange = ev => { if (ev.target.id === 'cb-category') { state.category = ev.target.value; draw('cb-category'); } };
        el.oninput = ev => {
            if (ev.target.id !== 'cb-search') return;
            state.query = ev.target.value; state.open = null;
            draw().then(() => { const s = el.querySelector('#cb-search'); if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); } });
        };
        el.onkeydown = ev => { if (ev.key === 'Escape' && state.open) { const id = state.open; state.open = null; draw().then(() => {
            const btn = el.querySelector(`[data-cb-area="${CSS.escape(id)}"]`); if (btn) btn.focus(); }); } };
        await draw();
    }

    root.CensusBenchmarks = { open, dataProblem, areaRows, cell, headHTML, controlsHTML, tableHTML, detailHTML, methodsHTML,
                              LEVELS, LEVEL_LABELS, CATEGORY_LABELS, DENOMINATORS };
})(typeof globalThis !== 'undefined' ? globalThis : this);

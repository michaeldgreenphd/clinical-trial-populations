/**
 * geo_ui.js — DOM rendering for the geography tab.
 *
 * Everything shown here comes from a GeoRender model; this file holds no
 * numbers and computes none. The contract's caveats are rendered as standing
 * text beside the numbers they qualify, not as footnotes (handoff §8).
 */
(function (root) {
    'use strict';

    // The handoff §7/§8 caveat texts live in index.html beside the numbers
    // they qualify — one copy, visible before any script runs.

    const state = {
        ctx: null,
        countryMeasure: 'trials',   // 'trials' (where) | 'share' (who)
        stateMeasure: 'trials',
        countryEstimand: 'pw_raw',
        stateEstimand: 'pw_raw',
        mapDrawn: false,
        usTopology: null,
    };

    function esc(s) {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function badgeHtml(badge) {
        if (!badge) return '';
        const share = badge.topTrialSharePct === null ? '' :
            ' (' + badge.topTrialSharePct.toFixed(1) + '% of participants)';
        return ' <span class="geo-badge" title="Concentration: one trial supplies more than half of ' +
            'this geography’s participants — ' + esc(badge.topTrialId) + esc(share) + '">◆</span>';
    }

    /** One-sentence finding under a section title, from a count model's top
     *  entries — values verbatim from shipped rows, so it can never go stale. */
    function setHeadline(elId, model, verb) {
        const el = document.getElementById(elId);
        if (!el || model.items.length < 3) return;
        const top = model.items.slice(0, 3);
        el.textContent = top[0].geo_name + ', ' + top[1].geo_name + ' and ' + top[2].geo_name +
            ' ' + verb + ' (' + top.map(function (t) { return t.text; }).join(', ') + ').';
    }

    // ── Ranked list (rankable rows only — the model enforces it) ──────────
    function renderRanked(elId, model, level) {
        const el = document.getElementById(elId);
        if (!el) return;
        const max = model.items.length ? model.items[0].value : 1;
        // Counts are heavy-tailed (one geography can dwarf the rest), so bars
        // degenerate into hairlines against empty track — the ranked number
        // column carries the information instead. Shares keep bars: they
        // cluster in a band where relative length is readable.
        const bars = model.axis.metric !== 'n_trials';
        let html = '<div class="geo-ranked' + (bars ? '' : ' geo-ranked-nobar') + '">';
        model.items.forEach(function (it, i) {
            html += '<div class="geo-ranked-row" data-level="' + level + '" data-code="' + esc(it.geo_code) + '">' +
                '<span class="geo-rank">' + (i + 1) + '</span>' +
                '<span class="geo-rname">' + esc(it.geo_name) + badgeHtml(it.badge) + '</span>' +
                (bars ? '<span class="geo-rbar"><span class="geo-rbar-fill" style="width:' +
                    (100 * it.value / max).toFixed(1) + '%"></span></span>' : '') +
                '<span class="geo-rval">' + esc(it.text) + '</span></div>';
        });
        html += '</div>';
        if (model.onRequestCount > 0) {
            html += '<p class="note">' + model.onRequestCount + ' further geograph' +
                (model.onRequestCount === 1 ? 'y is' : 'ies are') +
                ' viewable on request via the look-up box: ' + esc(model.onRequestNames.join(', ')) + '.</p>';
        }
        el.innerHTML = html;
        el.querySelectorAll('.geo-ranked-row').forEach(function (row) {
            row.addEventListener('click', function () {
                showDetail(row.dataset.level, row.dataset.code);
            });
        });
    }

    // ── Adjusted panel: shown geographies + withheld reasons, no numbers ──
    function renderAdjusted(elId, model) {
        const el = document.getElementById(elId);
        if (!el) return;
        let html = '<table class="geography-table geo-adjusted-table"><thead><tr>' +
            '<th></th><th>Adjusted share</th><th>Interval</th><th>Δ vs raw</th></tr></thead><tbody>';
        model.shown.forEach(function (it) {
            html += '<tr><td>' + esc(it.geo_name) + badgeHtml(it.badge) + '</td>' +
                '<td>' + esc(it.text) + '</td>' +
                '<td class="geo-muted">' + esc(it.interval) + '</td>' +
                '<td>' + esc(it.deltaText) + '</td></tr>';
        });
        html += '</tbody></table>';
        html += '<details class="geo-withheld"><summary>' + model.withheld.length +
            ' geographies have no adjusted value — the reasons, not substitutes</summary><ul>';
        model.withheld.forEach(function (w) {
            html += '<li><strong>' + esc(w.geo_name) + ':</strong> <em>' + esc(w.reason) + '</em></li>';
        });
        html += '</ul></details>';
        el.innerHTML = html;
    }

    // ── Detail card: the by-name context ──────────────────────────────────
    function showDetail(level, code) {
        const el = document.getElementById('geo-detail-card');
        if (!el || !state.ctx) return;
        const m = state.ctx.render.detailCardModel(level, code);
        let html = '<div class="geo-card"><h4>' + esc(m.geo_name) +
            ' <span class="geo-muted">(' + (level === 'country' ? 'country' : 'US state/territory') + ')</span></h4>';

        if (m.gateFail) {
            html += '<p class="geo-withheld-text">Not on the single-geography spine — <em>' +
                esc(m.gateFail.reason) + '</em></p>';
        }
        if (m.composition.length) {
            html += '<p class="geo-dim-head">Sex composition</p>';
            html += '<table class="geography-table"><tbody>';
            m.composition.forEach(function (c) {
                if (c.cell.kind === 'withheld') {
                    html += '<tr><td>' + esc(c.label) + '</td><td class="geo-withheld-text" colspan="2"><em>' +
                        esc(c.cell.text) + '</em></td></tr>';
                } else {
                    html += '<tr><td>' + esc(c.label) + '</td><td>' + esc(c.cell.text) +
                        (c.interval ? ' <span class="geo-muted">[' + esc(c.interval) + ']</span>' : '') + '</td>' +
                        '<td>' + (c.deltaText ? esc(c.deltaText) + ' vs raw' : '') + '</td></tr>';
                }
            });
            html += '</tbody></table>';
            html += '<p class="note geo-dim-coming">Race, ethnicity and gender identity: not in this contract ' +
                'run — the frozen geography pipeline ships sex composition only. These panels populate here ' +
                'when a future run ships those dimensions; nothing is estimated in the meantime.</p>';
        }
        html += '<p class="note">Trials on the spine: <strong>' + esc(m.nTrials.text) +
            '</strong> · participants: <strong>' + esc(m.nParticipants.text) + '</strong>' +
            (m.iqrText ? ' · trial-level IQR width: ' + esc(m.iqrText) : '') +
            (m.singleSexText ? ' · single-sex-reporting trials: ' + esc(m.singleSexText) : '') + '</p>';

        if (m.concentration) {
            html += '<p class="note geo-badge-note">◆ One trial supplies more than half of this geography’s ' +
                'participants: <strong>' + esc(m.concentration.topTrialId) + '</strong>' +
                (m.concentration.topTrialSharePct !== null ?
                    ' (' + m.concentration.topTrialSharePct.toFixed(1) + '%)' : '') + '.';
            if (m.concentration.drivers.length) {
                html += ' Contributing trials: ' + m.concentration.drivers.map(function (d) {
                    return esc(d.nct_id) + ' (' + esc(d.lead_sponsor) + ', ' +
                        Number(d.share_of_unit_participants_pct).toFixed(1) + '%)';
                }).join('; ') + '.';
            }
            html += '</p>';
        }
        if (m.tier3) {
            html += '<div class="geo-tier3"><span class="geo-tier3-label">' + esc(m.tier3.label) +
                ':</span> ' + esc(m.tier3.text) + '<br><span class="note">' + esc(m.tier3.note) + '</span></div>';
        }
        html += '</div>';
        el.innerHTML = html;
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    // ── The US map ────────────────────────────────────────────────────────
    async function renderMap() {
        const container = document.getElementById('us-map-container');
        if (!container || !state.ctx) return;
        if (typeof root.ensureD3 !== 'function') return;
        await root.ensureD3();
        if (!state.usTopology) {
            state.usTopology = await d3.json('https://cdn.jsdelivr.net/npm/us-atlas@3/states-albers-10m.json');
        }
        const counts = state.stateMeasure === 'trials';
        const model = counts ? state.ctx.render.countMapModel()
            : state.ctx.render.mapModel(state.stateEstimand);
        const values = Object.values(model.units)
            .filter(function (u) { return u.status === 'value'; })
            .map(function (u) { return u.value; });
        const lo = Math.min.apply(null, values), hi = Math.max.apply(null, values);
        const scale = d3.scaleSequential(d3.interpolateGreens).domain([lo - (hi - lo) * 0.25, hi]);

        container.innerHTML = '';
        const width = 975, height = 610;
        const svg = d3.select(container).append('svg')
            .attr('viewBox', '0 0 ' + width + ' ' + height)
            .attr('style', 'max-width:100%;height:auto;');
        const features = topojson.feature(state.usTopology, state.usTopology.objects.states).features;
        const tooltip = document.getElementById('map-tooltip');

        svg.append('g').selectAll('path').data(features).enter().append('path')
            .attr('d', d3.geoPath())
            .attr('stroke', '#fff').attr('stroke-width', 0.7)
            .attr('fill', function (f) {
                const key = f.properties.name.toLowerCase();
                const u = model.units[key];
                if (u && u.status === 'value') return scale(u.value);
                if (u && u.status === 'on_request') return '#d5d9d5';
                return '#f0f2f0';        // not on the spine (gate-failed or no data attached)
            })
            .attr('cursor', function (f) {
                const key = f.properties.name.toLowerCase();
                return (model.units[key] || model.gateFailed[key]) ? 'pointer' : 'default';
            })
            .on('mousemove', function (event, f) {
                if (!tooltip) return;
                const key = f.properties.name.toLowerCase();
                const u = model.units[key];
                const gf = model.gateFailed[key];
                let text;
                if (u && u.status === 'value') {
                    const line = counts ? esc(u.text) + ' single-state trials sited here'
                        : esc(model.estimandLabel) + ': ' + esc(u.text);
                    text = '<strong>' + esc(u.geo_name) + '</strong><br>' + line +
                        (u.badge ? '<br>◆ concentration — one trial dominates' : '') +
                        '<br><em>click for demographics</em>';
                } else if (u && u.status === 'on_request') {
                    text = '<strong>' + esc(u.geo_name) + '</strong><br>Viewable on request — click to ask for ' +
                        'this geography by name.';
                } else if (gf) {
                    text = '<strong>' + esc(gf.geo_name) + '</strong><br>Not on the single-state spine — <em>' +
                        esc(gf.reason) + '</em>';
                } else {
                    text = '<strong>' + esc(f.properties.name) + '</strong><br>Not on the single-state spine ' +
                        '(see the selectivity note below the map).';
                }
                tooltip.innerHTML = text;
                tooltip.style.display = 'block';
                tooltip.style.left = (event.pageX + 12) + 'px';
                tooltip.style.top = (event.pageY - 10) + 'px';
            })
            .on('mouseleave', function () { if (tooltip) tooltip.style.display = 'none'; })
            .on('click', function (event, f) {
                const key = f.properties.name.toLowerCase();
                const u = model.units[key] || model.gateFailed[key];
                if (u && u.geo_code) showDetail('us_state', u.geo_code);
            });

        const legendLow = document.getElementById('legend-low');
        const legendHigh = document.getElementById('legend-high');
        if (legendLow) legendLow.textContent = counts ? lo.toLocaleString('en-US') : lo.toFixed(1) + '%';
        if (legendHigh) legendHigh.textContent = counts ? hi.toLocaleString('en-US') : hi.toFixed(1) + '%';
        const legendLabel = document.getElementById('geo-map-metric-label');
        if (legendLabel) {
            legendLabel.textContent = counts ? 'Single-state trials sited'
                : model.estimandLabel + ' — female share';
        }
    }

    // ── Measure (where / who) and estimand toggles ────────────────────────
    function currentModel(level) {
        const r = state.ctx.render;
        if (level === 'country') {
            return state.countryMeasure === 'trials' ? r.countListModel('country')
                : r.rankedListModel('country_descriptive', state.countryEstimand);
        }
        return state.stateMeasure === 'trials' ? r.countListModel('us_state')
            : r.rankedListModel('state_descriptive', state.stateEstimand);
    }

    function rankNote(level) {
        const el = document.getElementById(level === 'country' ?
            'geo-country-rank-metric' : 'geo-state-rank-metric');
        if (!el) return;
        const measure = level === 'country' ? state.countryMeasure : state.stateMeasure;
        if (measure === 'trials') {
            el.textContent = level === 'country' ? 'Number of single-country trials.'
                : 'Number of single-state trials sited in each state — sites, not enrollment.';
        } else {
            el.textContent = (level === 'country' ?
                { pw_raw: 'Participant-weighted', tw_median: 'Trial-weighted median' }[state.countryEstimand]
                : { pw_raw: 'Participant-weighted', tw_median: 'Trial-weighted median' }[state.stateEstimand]) +
                ' female share of participants.';
        }
    }

    function renderLevel(level) {
        renderRanked(level === 'country' ? 'geo-country-ranked' : 'geo-state-ranked',
            currentModel(level), level);
        rankNote(level);
        if (level === 'us_state') renderMap();
    }

    function wireToggles() {
        document.querySelectorAll('[data-geo-measure-country]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                state.countryMeasure = btn.dataset.geoMeasureCountry;
                document.querySelectorAll('[data-geo-measure-country]').forEach(function (b) {
                    b.classList.toggle('active', b === btn);
                });
                const est = document.getElementById('geo-country-est-toggle');
                if (est) est.classList.toggle('geo-hidden', state.countryMeasure !== 'share');
                renderLevel('country');
            });
        });
        document.querySelectorAll('[data-geo-est-country]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                state.countryEstimand = btn.dataset.geoEstCountry;
                document.querySelectorAll('[data-geo-est-country]').forEach(function (b) {
                    b.classList.toggle('active', b === btn);
                });
                renderLevel('country');
            });
        });
        document.querySelectorAll('[data-geo-measure-state]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                state.stateMeasure = btn.dataset.geoMeasureState;
                document.querySelectorAll('[data-geo-measure-state]').forEach(function (b) {
                    b.classList.toggle('active', b === btn);
                });
                const est = document.getElementById('geo-state-est-toggle');
                if (est) est.classList.toggle('geo-hidden', state.stateMeasure !== 'share');
                renderLevel('us_state');
            });
        });
        document.querySelectorAll('[data-geo-est-state]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                state.stateEstimand = btn.dataset.geoEstState;
                document.querySelectorAll('[data-geo-est-state]').forEach(function (b) {
                    b.classList.toggle('active', b === btn);
                });
                renderLevel('us_state');
            });
        });
    }

    function wireSearch() {
        const input = document.getElementById('geo-search-input');
        const list = document.getElementById('geo-search-list');
        if (!input || !list || !state.ctx) return;
        const idx = state.ctx.render.searchIndex('country')
            .map(function (g) { return { level: 'country', code: g.geo_code, name: g.geo_name }; })
            .concat(state.ctx.render.searchIndex('us_state')
                .map(function (g) { return { level: 'us_state', code: g.geo_code, name: g.geo_name + ' (US)' }; }));
        list.innerHTML = idx.map(function (g) { return '<option value="' + esc(g.name) + '">'; }).join('');
        input.addEventListener('change', function () {
            const hit = idx.find(function (g) { return g.name === input.value; });
            if (hit) showDetail(hit.level, hit.code);
        });
    }

    // ── Entry point (idempotent) ──────────────────────────────────────────
    let _rendered = false;
    async function render() {
        const section = document.getElementById('geography');
        if (!section) return;
        if (_rendered) return;
        try {
            if (typeof root.ensureD3 === 'function') await root.ensureD3();
            state.ctx = await GeoData.load();
        } catch (e) {
            ['geo-state-ranked', 'geo-country-ranked'].forEach(function (id) {
                const el = document.getElementById(id);
                if (el) el.innerHTML = '<p class="note">Could not load the geography contract: ' + esc(e.message) + '</p>';
            });
            throw e;
        }
        _rendered = true;

        renderLevel('us_state');    // map + ranked states, trials-first
        renderLevel('country');
        renderAdjusted('geo-country-adjusted', state.ctx.render.adjustedPanelModel('country'));
        renderAdjusted('geo-state-adjusted', state.ctx.render.adjustedPanelModel('us_state'));
        setHeadline('geo-state-headline', state.ctx.render.countListModel('us_state'),
            'host the most single-state trials');
        setHeadline('geo-country-headline', state.ctx.render.countListModel('country'),
            'run the most single-country trials');
        wireToggles();
        wireSearch();

        const pin = document.getElementById('geo-run-pin');
        if (pin) {
            pin.textContent = 'Data: ' + state.ctx.pin.run_id + ' · AACT snapshot ' +
                state.ctx.pin.snapshot_date + ' · a frozen, audited contract table — the dashboard’s ' +
                'year/type/sponsor filters do not apply to this tab.';
        }
    }

    root.GeoUI = { render: render, showDetail: showDetail };
}(typeof self !== 'undefined' ? self : this));

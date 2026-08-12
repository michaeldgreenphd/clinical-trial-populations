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
        worldTopology: null,
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

    // ── Choropleth color scales ───────────────────────────────────────────
    // Female share is diverging around 50% parity: blue = skews male, pink =
    // skews female, neutral gray at the midpoint. The pink arm's OKLab
    // lightness ladder was fitted numerically to the blue arm's, so equal
    // deviations from parity read equally intense on both sides.
    const SHARE_STOPS = ['#1c5cab', '#2a78d6', '#5598e7', '#9ec5f4', '#f0efec',
        '#e6b0c3', '#ca7996', '#b8507a', '#97345f'];
    // Trial counts stay a single-hue sequential ramp (the site's green).
    const COUNT_STOPS = ['#e8f2e6', '#a9d2a4', '#5fA268', '#2C5F2D', '#123c1a'];

    function shareScale(lo, hi) {
        const e = Math.max(50 - lo, hi - 50, 1);
        return {
            scale: d3.scaleSequential(d3.piecewise(d3.interpolateRgb, SHARE_STOPS))
                .domain([50 - e, 50 + e]),
            lo: 50 - e, hi: 50 + e,
        };
    }

    function setLegend(ids, cfg) {
        const grad = document.getElementById(ids.grad);
        if (grad) grad.style.background = 'linear-gradient(to right, ' + cfg.stops.join(', ') + ')';
        const low = document.getElementById(ids.low);
        const mid = document.getElementById(ids.mid);
        const high = document.getElementById(ids.high);
        if (low) low.textContent = cfg.low;
        if (high) high.textContent = cfg.high;
        if (mid) {
            mid.textContent = cfg.mid || '';
            mid.style.display = cfg.mid ? '' : 'none';
        }
        const label = document.getElementById(ids.label);
        if (label) label.textContent = cfg.label;
    }

    /** Shared choropleth painter: fills from the model via the scale,
     *  tooltips carry values or gate reasons, click opens the detail card. */
    function drawChoropleth(cfg) {
        const container = document.getElementById(cfg.containerId);
        if (!container) return;
        container.innerHTML = '';
        const svg = d3.select(container).append('svg')
            .attr('viewBox', '0 0 ' + cfg.width + ' ' + cfg.height)
            .attr('style', 'max-width:100%;height:auto;');
        const tooltip = document.getElementById('map-tooltip');
        const model = cfg.model;

        svg.append('g').selectAll('path').data(cfg.features).enter().append('path')
            .attr('d', cfg.path)
            .attr('stroke', '#fff').attr('stroke-width', 0.6)
            .attr('fill', function (f) {
                const u = model.units[cfg.keyOf(f)];
                if (u && u.status === 'value') return cfg.scale(u.value);
                if (u && u.status === 'on_request') return '#d5d9d5';
                return '#f0f2f0';        // not on the spine (gate-failed or no data attached)
            })
            .attr('cursor', function (f) {
                const key = cfg.keyOf(f);
                return (model.units[key] || model.gateFailed[key]) ? 'pointer' : 'default';
            })
            .on('mousemove', function (event, f) {
                if (!tooltip) return;
                const key = cfg.keyOf(f);
                const u = model.units[key];
                const gf = model.gateFailed[key];
                let text;
                if (u && u.status === 'value') {
                    text = '<strong>' + esc(u.geo_name) + '</strong><br>' + cfg.valueLine(u) +
                        (u.badge ? '<br>◆ concentration — one trial dominates' : '') +
                        '<br><em>click for demographics</em>';
                } else if (u && u.status === 'on_request') {
                    text = '<strong>' + esc(u.geo_name) + '</strong><br>Viewable on request — click to ask for ' +
                        'this geography by name.';
                } else if (gf) {
                    text = '<strong>' + esc(gf.geo_name) + '</strong><br>Not on the ' + cfg.spineNoun +
                        ' — <em>' + esc(gf.reason) + '</em>';
                } else {
                    text = '<strong>' + esc(cfg.nameOf(f)) + '</strong><br>' + cfg.absentLine;
                }
                tooltip.innerHTML = text;
                tooltip.style.display = 'block';
                tooltip.style.left = (event.clientX + 12) + 'px';
                tooltip.style.top = (event.clientY - 10) + 'px';
            })
            .on('mouseleave', function () { if (tooltip) tooltip.style.display = 'none'; })
            .on('click', function (event, f) {
                const key = cfg.keyOf(f);
                const u = model.units[key] || model.gateFailed[key];
                if (u && u.geo_code) showDetail(cfg.level, u.geo_code);
            });
    }

    function unitValues(model) {
        return Object.values(model.units)
            .filter(function (u) { return u.status === 'value'; })
            .map(function (u) { return u.value; });
    }

    // ── The US map ────────────────────────────────────────────────────────
    async function renderMap() {
        if (!document.getElementById('us-map-container') || !state.ctx) return;
        if (typeof root.ensureD3 !== 'function') return;
        await root.ensureD3();
        if (!state.usTopology) {
            state.usTopology = await d3.json('https://cdn.jsdelivr.net/npm/us-atlas@3/states-albers-10m.json');
        }
        const counts = state.stateMeasure === 'trials';
        const model = counts ? state.ctx.render.countMapModel()
            : state.ctx.render.mapModel(state.stateEstimand);
        const values = unitValues(model);
        const lo = Math.min.apply(null, values), hi = Math.max.apply(null, values);

        let scale;
        const legendIds = { grad: 'legend-grad', low: 'legend-low', mid: 'legend-mid', high: 'legend-high', label: 'geo-map-metric-label' };
        if (counts) {
            scale = d3.scaleSequential(d3.piecewise(d3.interpolateRgb, COUNT_STOPS))
                .domain([Math.max(0, lo - (hi - lo) * 0.15), hi]);
            setLegend(legendIds, {
                stops: COUNT_STOPS, label: 'Single-state trials sited',
                low: lo.toLocaleString('en-US'), high: hi.toLocaleString('en-US'), mid: null,
            });
        } else {
            const s = shareScale(lo, hi);
            scale = s.scale;
            setLegend(legendIds, {
                stops: SHARE_STOPS, label: model.estimandLabel + ' — female share',
                low: s.lo.toFixed(1) + '% skews male', high: s.hi.toFixed(1) + '% skews female',
                mid: '50% parity',
            });
        }

        drawChoropleth({
            containerId: 'us-map-container', width: 975, height: 610,
            features: topojson.feature(state.usTopology, state.usTopology.objects.states).features,
            path: d3.geoPath(),
            keyOf: function (f) { return f.properties.name.toLowerCase(); },
            nameOf: function (f) { return f.properties.name; },
            model: model, scale: scale, level: 'us_state',
            spineNoun: 'single-state spine',
            absentLine: 'Not on the single-state spine (see the selectivity note below the map).',
            valueLine: function (u) {
                return counts ? esc(u.text) + ' single-state trials sited here'
                    : esc(model.estimandLabel) + ': ' + esc(u.text);
            },
        });
    }

    // ── The world map ─────────────────────────────────────────────────────
    // geo_dictionary polygon_keys use R maps-package world names; translate
    // the atlas's Natural Earth names into that vocabulary before joining.
    // Never the other way: shipped keys are the contract, the atlas adapts.
    const ATLAS_TO_KEY = {
        'United States of America': 'USA',
        'United Kingdom': 'UK',
        'Czechia': 'Czech Republic',
        'Côte d\'Ivoire': 'Ivory Coast',
        'Dem. Rep. Congo': 'Democratic Republic of the Congo',
        'Dominican Rep.': 'Dominican Republic',
        'Bosnia and Herz.': 'Bosnia and Herzegovina',
        'Macedonia': 'North Macedonia',
        'Central African Rep.': 'Central African Republic',
        'S. Sudan': 'South Sudan',
        'Eq. Guinea': 'Equatorial Guinea',
        'Solomon Is.': 'Solomon Islands',
        'eSwatini': 'Eswatini',
    };

    async function renderWorldMap() {
        if (!document.getElementById('world-map-container') || !state.ctx) return;
        if (typeof root.ensureD3 !== 'function') return;
        await root.ensureD3();
        if (!state.worldTopology) {
            state.worldTopology = await d3.json('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json');
        }
        const counts = state.countryMeasure === 'trials';
        const model = counts ? state.ctx.render.countryCountMapModel()
            : state.ctx.render.countryMapModel(state.countryEstimand);
        const values = unitValues(model);
        const lo = Math.min.apply(null, values), hi = Math.max.apply(null, values);

        let scale;
        const legendIds = { grad: 'legend-w-grad', low: 'legend-w-low', mid: 'legend-w-mid', high: 'legend-w-high', label: 'geo-worldmap-metric-label' };
        if (counts) {
            // One country dwarfs the rest (heavy tail), so color is on a log
            // scale — labeled as such; the ranked list carries exact counts.
            scale = d3.scaleSequentialLog(d3.piecewise(d3.interpolateRgb, COUNT_STOPS))
                .domain([Math.max(1, lo), hi]);
            setLegend(legendIds, {
                stops: COUNT_STOPS, label: 'Single-country trials (log color scale)',
                low: lo.toLocaleString('en-US'), high: hi.toLocaleString('en-US'), mid: null,
            });
        } else {
            const s = shareScale(lo, hi);
            scale = s.scale;
            setLegend(legendIds, {
                stops: SHARE_STOPS, label: model.estimandLabel + ' — female share',
                low: s.lo.toFixed(1) + '% skews male', high: s.hi.toFixed(1) + '% skews female',
                mid: '50% parity',
            });
        }

        const width = 975, height = 500;
        const features = topojson.feature(state.worldTopology, state.worldTopology.objects.countries)
            .features.filter(function (f) { return f.properties.name !== 'Antarctica'; });
        const projection = d3.geoNaturalEarth1().fitSize([width, height], { type: 'Sphere' });

        drawChoropleth({
            containerId: 'world-map-container', width: width, height: height,
            features: features,
            path: d3.geoPath(projection),
            keyOf: function (f) { return ATLAS_TO_KEY[f.properties.name] || f.properties.name; },
            nameOf: function (f) { return f.properties.name; },
            model: model, scale: scale, level: 'country',
            spineNoun: 'single-country spine',
            absentLine: 'Not on the single-country spine, or no polygon at this map scale — use the look-up.',
            valueLine: function (u) {
                return counts ? esc(u.text) + ' single-country trials'
                    : esc(model.estimandLabel) + ': ' + esc(u.text);
            },
        });
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
        else renderWorldMap();
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

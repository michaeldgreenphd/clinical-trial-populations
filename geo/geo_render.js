/**
 * geo_render.js — pure render-model layer for the geography tab.
 *
 * Every function here turns contract rows into plain objects the DOM code
 * displays verbatim. The contract's rendering rules are enforced in THIS
 * layer, so the acceptance tests can assert them without a browser:
 *
 *   - display_rule is handled by one exhaustive switch; an unrecognised value
 *     throws rather than rendering a default (acceptance test 5).
 *   - a withheld row contributes gate_reason text and carries no value under
 *     any key (tests 2, 3); nothing here ever substitutes another estimand.
 *   - ranked models are built from rankable() rows only (test 4).
 *   - every model declares one geo_level and one tier and throws on mixed
 *     input, so no screen can put two levels or two tiers on one axis
 *     (tests 8, 9).
 *   - a blank cell renders the meaning documented in d3_blank_inventory.csv,
 *     never zero (test 10).
 *   - the map only attaches data to geographies with has_polygon = TRUE
 *     (test 7), and omit_from_ranking units are 'on_request': uncolored until
 *     the user asks for that geography by name (click).
 */
(function (root, factory) {
    if (typeof module !== 'undefined' && module.exports) module.exports = factory();
    else root.GeoRender = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const ESTIMAND_LABELS = {
        pw_raw: 'Participant-weighted share',
        tw_median: 'Trial-weighted median',
        std_gcomp: 'Case-mix adjusted (g-computation)',
        std_modal: 'Case-mix adjusted (modal cell, sensitivity)',
    };

    function fmtShare(v) { return v === null ? null : v.toFixed(1) + '%'; }
    function fmtPP(v) { return v === null ? null : (v > 0 ? '+' : '') + v.toFixed(1) + ' pp'; }
    function fmtCount(v) { return v === null ? null : v.toLocaleString('en-US'); }

    /** Single geo_level and single tier per model — throws on mixed input. */
    function assertHomogeneous(rows, what) {
        const levels = Array.from(new Set(rows.map(function (r) { return r.geo_level; })));
        const tiers = Array.from(new Set(rows.map(function (r) { return r.tier; })));
        if (levels.length > 1) {
            throw new Error(what + ': refusing to build a model mixing geo_levels [' +
                levels.join(', ') + '] — country and us_state rows never share an axis');
        }
        if (tiers.length > 1) {
            throw new Error(what + ': refusing to build a model mixing tiers [' +
                tiers.join(', ') + '] — tier 1 and tier 3 never share an axis or scale');
        }
        return { geo_level: levels[0], tier: tiers[0] };
    }

    function createGeoRender(deps) {
        const reader = deps.reader;
        const geoDict = deps.geoDict;               // geo_dictionary.csv rows
        const blankInventory = deps.blankInventory; // d3_blank_inventory.csv rows
        const unitDrivers = deps.unitDrivers;       // g1_unit_drivers.csv rows

        const dictByKey = {};
        geoDict.forEach(function (r) { dictByKey[r.geo_level + '|' + r.geo_code] = r; });

        const blankMeans = {};
        blankInventory.forEach(function (r) { blankMeans[r.column] = r.blank_means; });

        const driversByUnit = {};
        unitDrivers.forEach(function (r) {
            (driversByUnit[r.unit_code] = driversByUnit[r.unit_code] || []).push(r);
        });

        /** The meaning of a blank in `column`, from d3_blank_inventory.csv. */
        function blankMeaning(column) {
            if (!(column in blankMeans)) {
                throw new Error('geo_render: blank in column "' + column +
                    '" which d3_blank_inventory.csv does not document');
            }
            return blankMeans[column];
        }

        /**
         * The one display_rule switch. Returns what a value cell shows.
         * kind 'value'      -> render `text` (and optional badge)
         * kind 'on_request' -> render `text` ONLY in a by-name context
         *                      (detail card, explicit search); never in a
         *                      ranking, top-N, or default map coloring
         * kind 'withheld'   -> render `text` (the gate_reason) and nothing
         *                      else; the object carries no value key at all
         */
        function valueCell(row, fmt) {
            fmt = fmt || fmtShare;
            switch (row.display_rule) {
                case 'show':
                    return { kind: 'value', text: fmt(row.value), value: row.value, badge: null };
                case 'badge_concentration':
                    return {
                        kind: 'value', text: fmt(row.value), value: row.value,
                        badge: {
                            topTrialId: row.top_trial_id,
                            topTrialSharePct: row.top_trial_share_pct,
                            drivers: driversByUnit[row.geo_code] || [],
                        },
                    };
                case 'omit_from_ranking':
                    return { kind: 'on_request', text: fmt(row.value), value: row.value, badge: null };
                case 'withheld':
                    return { kind: 'withheld', text: row.gate_reason };
                default:
                    throw new Error('geo_render: unrecognised display_rule "' + row.display_rule +
                        '" — refusing to render a default');
            }
        }

        /**
         * A ranked list for one descriptive view and one estimand.
         * Only rankable rows (show, badge_concentration) enter the ranking;
         * the model records how many geographies were viewable-on-request so
         * the UI can say so instead of silently shortening the list.
         */
        function rankedListModel(viewName, estimand) {
            const viewRows = reader.geoView(viewName)
                .filter(function (r) { return r.estimand === estimand; });
            if (!viewRows.length) throw new Error('rankedListModel: no rows for ' + viewName + ' / ' + estimand);
            const axis = assertHomogeneous(viewRows, 'rankedListModel(' + viewName + ')');
            const ranked = reader.rankable(viewRows)
                .slice()
                .sort(function (a, b) { return b.value - a.value; });
            const onRequest = viewRows.filter(function (r) { return r.display_rule === 'omit_from_ranking'; });

            return {
                axis: { geo_level: axis.geo_level, tier: axis.tier, metric: 'female_share_pct', estimand: estimand },
                estimandLabel: ESTIMAND_LABELS[estimand] || estimand,
                items: ranked.map(function (r) {
                    const cell = valueCell(r);
                    return {
                        geo_code: r.geo_code, geo_name: r.geo_name,
                        value: cell.value, text: cell.text, badge: cell.badge,
                        display_rule: r.display_rule,
                    };
                }),
                onRequestCount: onRequest.length,
                onRequestNames: onRequest.map(function (r) { return r.geo_name; }).sort(),
                totalGeographies: new Set(viewRows.map(function (r) { return r.geo_code; })).size,
            };
        }

        /**
         * The adjusted panel for one level: the view's geographies (withheld
         * rows are excluded BY DEFINITION of the view), plus the withheld
         * list rendering gate_reason text and no number, drawn from the long
         * table where those rows still live.
         */
        function adjustedPanelModel(geoLevel) {
            const viewName = geoLevel === 'country' ? 'country_adjusted' : 'state_adjusted';
            const viewRows = reader.geoView(viewName);
            const axis = assertHomogeneous(viewRows, 'adjustedPanelModel(' + viewName + ')');

            const shown = viewRows.slice()
                .sort(function (a, b) { return b.value - a.value; })
                .map(function (r) {
                    const cell = valueCell(r);
                    if (cell.kind === 'withheld') {
                        throw new Error('adjustedPanelModel: a withheld row leaked into ' + viewName);
                    }
                    return {
                        geo_code: r.geo_code, geo_name: r.geo_name,
                        value: cell.value, text: cell.text, badge: cell.badge,
                        display_rule: r.display_rule, kind: cell.kind,
                        lo: r.lo, hi: r.hi,
                        interval: (r.lo === null || r.hi === null) ? blankMeaning('lo')
                            : fmtShare(r.lo) + ' – ' + fmtShare(r.hi),
                        delta_from_raw_pp: r.delta_from_raw_pp,
                        deltaText: r.delta_from_raw_pp === null ? blankMeaning('delta_from_raw_pp')
                            : fmtPP(r.delta_from_raw_pp),
                    };
                });

            const withheld = reader.readGeo({
                geoLevel: geoLevel, estimand: 'std_gcomp', metric: 'female_share_pct',
                includeGateFailures: false, includeWithheld: true,
            }).filter(function (r) { return r.display_rule === 'withheld'; })
                .map(function (r) {
                    const cell = valueCell(r);   // kind 'withheld' — text is gate_reason, no value key
                    return { geo_code: r.geo_code, geo_name: r.geo_name, reason: cell.text };
                })
                .sort(function (a, b) { return a.geo_name < b.geo_name ? -1 : 1; });

            return {
                axis: { geo_level: axis.geo_level, tier: axis.tier, metric: 'female_share_pct', estimand: 'std_gcomp' },
                estimandLabel: ESTIMAND_LABELS.std_gcomp,
                shown: shown,
                shownGeographies: new Set(shown.map(function (s) { return s.geo_code; })).size,
                withheld: withheld,
            };
        }

        /**
         * The US map model. Data attaches only to geographies whose
         * geo_dictionary entry has has_polygon = TRUE. Fills:
         *   'value'      show / badge_concentration rows — colored by value
         *   'on_request' omit_from_ranking rows — uncolored until clicked
         * Units absent from the model (gate failures, absent geographies)
         * take the UI's 'not in spine' fill; gate-failed units with a polygon
         * get their gate_reason for the tooltip via `gateFailed`.
         */
        function mapUnits(rows, fmt) {
            const units = {};
            rows.forEach(function (r) {
                const dict = dictByKey[r.geo_level + '|' + r.geo_code];
                if (!dict) throw new Error('mapModel: ' + r.geo_code + ' missing from geo_dictionary.csv');
                if (dict.has_polygon !== 'TRUE') return;    // never on a map
                const cell = valueCell(r, fmt);
                units[dict.polygon_key] = {
                    geo_code: r.geo_code, geo_name: r.geo_name,
                    status: cell.kind === 'on_request' ? 'on_request' : 'value',
                    value: cell.kind === 'on_request' ? null : cell.value,   // no color before the user asks
                    text: cell.kind === 'on_request' ? null : cell.text,
                    badge: cell.badge || null,
                };
            });
            return units;
        }

        function gateFailedUnits() {
            const gateFailed = {};
            reader.readGeo({ geoLevel: 'us_state', metric: 'no_value_gate_failed' })
                .forEach(function (r) {
                    const dict = dictByKey[r.geo_level + '|' + r.geo_code];
                    if (!dict || dict.has_polygon !== 'TRUE') return;
                    gateFailed[dict.polygon_key] = { geo_code: r.geo_code, geo_name: r.geo_name, reason: r.gate_reason };
                });
            return gateFailed;
        }

        function mapModel(estimand) {
            const viewRows = reader.geoView('state_descriptive')
                .filter(function (r) { return r.estimand === estimand; });
            const axis = assertHomogeneous(viewRows, 'mapModel');
            return {
                axis: { geo_level: axis.geo_level, tier: axis.tier, metric: 'female_share_pct', estimand: estimand },
                estimandLabel: ESTIMAND_LABELS[estimand] || estimand,
                units: mapUnits(viewRows, fmtShare),
                gateFailed: gateFailedUnits(),
            };
        }

        /**
         * "Where the trials are" — the shipped tier-1 `n_trials` metric rows
         * for one level, ranked within that level only. Deliberately NOT one
         * of the four b1 views (those define the share views and stay the
         * only source for them): each geography's count is a shipped row
         * rendered verbatim through the same display_rule switch. Counts are
         * never compared across levels (the model is level-homogeneous, and
         * metric_dictionary.csv marks n_trials not comparable across the two
         * spines) and never differenced or summed client-side.
         */
        function countListModel(geoLevel) {
            const rows = reader.readGeo({
                geoLevel: geoLevel, metric: 'n_trials', includeGateFailures: false,
            });
            if (!rows.length) throw new Error('countListModel: no n_trials rows for ' + geoLevel);
            const axis = assertHomogeneous(rows, 'countListModel(' + geoLevel + ')');
            const ranked = reader.rankable(rows).slice()
                .sort(function (a, b) { return b.value - a.value; });
            const onRequest = rows.filter(function (r) { return r.display_rule === 'omit_from_ranking'; });

            return {
                axis: { geo_level: axis.geo_level, tier: axis.tier, metric: 'n_trials', estimand: 'not_applicable' },
                estimandLabel: geoLevel === 'country' ? 'Single-country trials' : 'Single-state trials sited',
                items: ranked.map(function (r) {
                    const cell = valueCell(r, fmtCount);
                    return {
                        geo_code: r.geo_code, geo_name: r.geo_name,
                        value: cell.value, text: cell.text, badge: cell.badge,
                        display_rule: r.display_rule,
                    };
                }),
                onRequestCount: onRequest.length,
                onRequestNames: onRequest.map(function (r) { return r.geo_name; }).sort(),
                totalGeographies: new Set(rows.map(function (r) { return r.geo_code; })).size,
            };
        }

        /** The US map colored by trials sited — same terms as countListModel. */
        function countMapModel() {
            const rows = reader.readGeo({
                geoLevel: 'us_state', metric: 'n_trials', includeGateFailures: false,
            });
            const axis = assertHomogeneous(rows, 'countMapModel');
            return {
                axis: { geo_level: axis.geo_level, tier: axis.tier, metric: 'n_trials', estimand: 'not_applicable' },
                estimandLabel: 'Single-state trials sited',
                units: mapUnits(rows, fmtCount),
                gateFailed: gateFailedUnits(),
            };
        }

        /**
         * Everything the long table holds for one geography, sectioned for
         * the detail card. Opening this card is the "asks for this geography
         * by name" act that makes on_request values renderable. Tier 3 is a
         * separate block flagged `separateAxis` — the UI gives it its own
         * palette and never charts it with tier 1.
         */
        function detailCardModel(geoLevel, geoCode) {
            const rows = reader.readGeo({ geoLevel: geoLevel })
                .filter(function (r) { return r.geo_code === geoCode; });
            if (!rows.length) throw new Error('detailCardModel: no rows for ' + geoLevel + '/' + geoCode);
            const name = rows[0].geo_name;

            function metricRow(metric, estimand, fmt) {
                const r = rows.find(function (x) { return x.metric === metric && (estimand === null || x.estimand === estimand); });
                if (!r) return null;
                if (r.value === null && r.display_rule !== 'withheld') {
                    // blank with the row present: render the documented meaning
                    return { row: r, cell: { kind: 'blank', text: blankMeaning('value') } };
                }
                return { row: r, cell: valueCell(r, fmt) };
            }

            function countRow(metric) {
                // Tier-1 only: a gate-failed geography's tier-3 portfolio row
                // carries its own n_trials, which is a different quantity and
                // must never stand in for the spine count.
                const t1 = rows.filter(function (x) { return x.tier === '1'; });
                const mrow = t1.find(function (x) { return x.metric === metric; });
                if (mrow) {
                    return { text: mrow.value === null ? blankMeaning(metric) : fmtCount(mrow.value) };
                }
                // No metric row: on the gate-fail registry row the count
                // column is blank, and the blank has a documented meaning.
                const gf = t1.find(function (x) { return x.metric === 'no_value_gate_failed'; });
                if (gf) return { text: blankMeaning(metric) };
                return null;
            }

            const composition = ['pw_raw', 'tw_median', 'std_gcomp', 'std_modal']
                .map(function (est) {
                    const m = metricRow('female_share_pct', est);
                    if (!m) return null;
                    const out = {
                        estimand: est, label: ESTIMAND_LABELS[est], cell: m.cell,
                        display_rule: m.row.display_rule,
                    };
                    if (est === 'std_gcomp' && m.cell.kind === 'value') {
                        out.interval = (m.row.lo === null) ? null : fmtShare(m.row.lo) + ' – ' + fmtShare(m.row.hi);
                        out.deltaText = (m.row.delta_from_raw_pp === null) ? null : fmtPP(m.row.delta_from_raw_pp);
                    }
                    return out;
                })
                .filter(Boolean);

            const tier1 = rows.filter(function (r) { return r.tier === '1'; });
            const tier3row = rows.find(function (r) { return r.metric === 'portfolio_female_share_pct'; });
            const gateFail = rows.find(function (r) { return r.metric === 'no_value_gate_failed'; });
            const iqr = tier1.find(function (r) { return r.metric === 'iqr_width_pp'; });
            const singleSex = tier1.find(function (r) { return r.metric === 'pct_single_sex_reported'; });
            const anyBadge = tier1.find(function (r) { return r.display_rule === 'badge_concentration' && r.top_trial_id; });

            return {
                geo_code: geoCode, geo_name: name, geo_level: geoLevel,
                gateFail: gateFail ? { reason: gateFail.gate_reason } : null,
                composition: gateFail ? [] : composition,
                nTrials: countRow('n_trials'),
                nParticipants: countRow('n_participants'),
                iqrText: iqr ? (iqr.value === null ? blankMeaning('value') : fmtPP(iqr.value).replace('+', '')) : null,
                singleSexText: singleSex ? (singleSex.value === null ? blankMeaning('value') : fmtShare(singleSex.value)) : null,
                concentration: anyBadge ? {
                    topTrialId: anyBadge.top_trial_id,
                    topTrialSharePct: anyBadge.top_trial_share_pct,
                    drivers: driversByUnit[geoCode] || [],
                } : null,
                tier3: tier3row ? {
                    separateAxis: true, tier: '3',
                    label: 'Portfolio exposure (tier 3)',
                    text: tier3row.value === null ? blankMeaning('value') : fmtShare(tier3row.value),
                    note: 'Sex composition of the multinational trial portfolio this geography participates in. ' +
                        'A different quantity from the single-geography shares above; never on the same axis or scale.',
                } : null,
            };
        }

        /** Names for the by-name search box (names are public; values render
         *  only after the user selects one — that selection is the "ask"). */
        function searchIndex(geoLevel) {
            return geoDict
                .filter(function (r) { return r.geo_level === geoLevel; })
                .map(function (r) { return { geo_code: r.geo_code, geo_name: r.geo_name }; })
                .sort(function (a, b) { return a.geo_name < b.geo_name ? -1 : 1; });
        }

        return {
            valueCell: valueCell,
            rankedListModel: rankedListModel,
            countListModel: countListModel,
            adjustedPanelModel: adjustedPanelModel,
            mapModel: mapModel,
            countMapModel: countMapModel,
            detailCardModel: detailCardModel,
            searchIndex: searchIndex,
            assertHomogeneous: assertHomogeneous,
            blankMeaning: blankMeaning,
            _fmt: { share: fmtShare, pp: fmtPP, count: fmtCount },
        };
    }

    return { createGeoRender: createGeoRender, assertHomogeneous: assertHomogeneous };
}));

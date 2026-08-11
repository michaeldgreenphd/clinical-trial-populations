/**
 * geo_reader.js — JavaScript port of geo_reader.R, the reference reader for
 * the geography contract (run pinned in data/geo/active_run.json).
 *
 * THE CONTRACT IN ONE SENTENCE: never decide rendering yourself. Read
 * display_rule, look it up in d2_display_rule_vocabulary.csv, and do what it
 * says. A row with display_rule = withheld has no number and no substitute.
 *
 * THE VIEWS ARE NOT DEFINED IN THIS FILE. They are read from
 * b1_view_definitions.csv — the same file CONTRACT.md renders and the shipped
 * figures filter by. The R reader's history note applies here verbatim: the
 * views were hardcoded once and the three artifacts drifted (contract said 13,
 * reader returned 34, figure plotted 13). Do not reintroduce that bug.
 *
 * This is a pure module: it takes already-parsed CSV rows (arrays of
 * plain objects, all values strings as parsed) and never touches the network
 * or the DOM. Browser glue lives in geo_data.js; Node tests require() this
 * file directly and feed it the staged CSVs.
 */
(function (root, factory) {
    if (typeof module !== 'undefined' && module.exports) module.exports = factory();
    else root.GeoReader = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // Quantity types in column_dictionary.csv whose columns hold numbers.
    const NUMERIC_QUANTITY_TYPES = new Set([
        'share_pct', 'pp_difference', 'probability', 'count', 'correlation', 'p_value',
    ]);

    // CONTRACT GAP, reported upstream: column_dictionary.csv claims to cover
    // every column by name pattern, but `lo`, `hi` and `delta_from_raw_pp`
    // match none of its patterns while being numeric in fact (CONTRACT.md's
    // own blank inventory describes them as the std_gcomp interval and the
    // case-mix delta). Until the dictionary grows patterns for them, they are
    // coerced via this explicit allowlist rather than silently left as text.
    const CONTRACT_GAP_NUMERIC = new Set(['lo', 'hi', 'delta_from_raw_pp']);

    // The three-state flag columns ('true' / 'false' / 'not_applicable') stay
    // strings: a boolean coercion would collapse 'false' and 'not_applicable',
    // which is exactly the distinction the sentinel convention exists to keep.

    function asArray(x) {
        if (x === null || x === undefined) return null;
        return Array.isArray(x) ? x : [x];
    }

    /** Which columns of `row` are numeric, per column_dictionary patterns. */
    function numericColumns(columnNames, columnDict) {
        const patterns = columnDict.map(function (r) {
            return { re: new RegExp(r.column_pattern), numeric: NUMERIC_QUANTITY_TYPES.has(r.quantity_type) };
        });
        const out = new Set();
        columnNames.forEach(function (c) {
            const hit = patterns.find(function (p) { return p.re.test(c); });
            if ((hit && hit.numeric) || CONTRACT_GAP_NUMERIC.has(c)) out.add(c);
        });
        return out;
    }

    /**
     * Coerce one parsed CSV row: numeric columns become Number, with the
     * blank-cell rule from d3_blank_inventory.csv — a blank is null, never 0.
     * A non-blank cell that fails to parse as a number throws: a corrupt cell
     * must be loud, not NaN propagated into a chart.
     */
    function coerceRow(row, numericCols) {
        const out = {};
        Object.keys(row).forEach(function (k) {
            const raw = row[k];
            if (!numericCols.has(k)) { out[k] = raw; return; }
            if (raw === undefined || raw === null || String(raw).trim() === '') {
                out[k] = null;                      // blank = absence-with-a-reason
                return;
            }
            const n = Number(raw);
            if (!isFinite(n)) {
                throw new Error('geo_reader: non-numeric value "' + raw + '" in numeric column ' +
                    k + ' (geo ' + (row.geo_code || '?') + ')');
            }
            out[k] = n;
        });
        return Object.freeze(out);
    }

    /**
     * createGeoReader(tables) — tables are parsed CSV row arrays:
     *   long        geo_representation_long_*.csv
     *   vocabulary  d2_display_rule_vocabulary.csv
     *   viewDefs    b1_view_definitions.csv
     *   columnDict  column_dictionary.csv
     */
    function createGeoReader(tables) {
        ['long', 'vocabulary', 'viewDefs', 'columnDict'].forEach(function (k) {
            if (!tables || !Array.isArray(tables[k]) || tables[k].length === 0) {
                throw new Error('geo_reader: missing or empty table "' + k + '"');
            }
        });

        const numCols = numericColumns(Object.keys(tables.long[0]), tables.columnDict);
        const long = tables.long.map(function (r) { return coerceRow(r, numCols); });

        const uiMeaning = {};
        tables.vocabulary.forEach(function (r) { uiMeaning[r.display_rule] = r.ui_meaning; });

        /** Port of read_geo(). Filters, then joins the display_rule
         *  vocabulary; any rule outside the published vocabulary throws. */
        function readGeo(opts) {
            opts = opts || {};
            const geoLevel = asArray(opts.geoLevel);
            const estimand = asArray(opts.estimand);
            const metric = asArray(opts.metric);
            const includeGateFailures = opts.includeGateFailures !== undefined ? opts.includeGateFailures : true;
            const includeWithheld = opts.includeWithheld !== undefined ? opts.includeWithheld : true;

            let out = long;
            if (geoLevel) out = out.filter(function (r) { return geoLevel.indexOf(r.geo_level) !== -1; });
            if (estimand) out = out.filter(function (r) { return estimand.indexOf(r.estimand) !== -1; });
            if (metric) out = out.filter(function (r) { return metric.indexOf(r.metric) !== -1; });
            if (!includeGateFailures) out = out.filter(function (r) { return r.gate_status === 'pass'; });
            if (!includeWithheld) out = out.filter(function (r) { return r.display_rule !== 'withheld'; });

            const unknown = out.filter(function (r) { return !(r.display_rule in uiMeaning); });
            if (unknown.length) {
                const vals = Array.from(new Set(unknown.map(function (r) { return r.display_rule; })));
                throw new Error('display_rule value not in the published vocabulary: ' + vals.join(', '));
            }
            return out.map(function (r) {
                const joined = Object.assign({}, r, { ui_meaning: uiMeaning[r.display_rule] });
                return Object.freeze(joined);
            });
        }

        /** Port of rankable(): the only rows a ranking or top-N may contain. */
        function rankable(rows) {
            return rows.filter(function (r) {
                return r.display_rule === 'show' || r.display_rule === 'badge_concentration';
            });
        }

        function viewDefinitions() { return tables.viewDefs.slice(); }

        /** Port of geo_view(): one named view, built from its shipped definition. */
        function geoView(viewName) {
            const defs = tables.viewDefs.filter(function (d) { return d.view_name === viewName; });
            if (defs.length !== 1) {
                throw new Error('unknown view: ' + viewName + '. Known: ' +
                    tables.viewDefs.map(function (d) { return d.view_name; }).join(', '));
            }
            const d = defs[0];
            return readGeo({
                geoLevel: d.geo_level,
                estimand: d.estimands.split('|'),
                metric: d.metric,
                includeGateFailures: d.include_gate_failures === 'TRUE',
                includeWithheld: d.include_withheld === 'TRUE',
            });
        }

        /** Port of geo_tab_views(): every view in b1_view_definitions.csv. */
        function views() {
            const out = {};
            tables.viewDefs.forEach(function (d) { out[d.view_name] = geoView(d.view_name); });
            return out;
        }

        return {
            readGeo: readGeo,
            rankable: rankable,
            viewDefinitions: viewDefinitions,
            geoView: geoView,
            views: views,
            _numericColumns: numCols,       // exposed for tests
        };
    }

    return { createGeoReader: createGeoReader, coerceRow: coerceRow, numericColumns: numericColumns };
}));

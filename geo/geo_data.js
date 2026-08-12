/**
 * geo_data.js — browser loader for the geography contract.
 *
 * Reads data/geo/active_run.json (the pin) and the contract CSVs from the
 * pinned run directory, parses them with d3.csvParse — the same d3-dsv
 * implementation the Node acceptance tests use — and constructs the reader
 * and render layers. Nothing here reads geo_rep_LATEST.txt, and nothing here
 * reads any file outside the pinned directory: advancing runs is a deliberate
 * edit to active_run.json, not an automatic act.
 */
(function (root) {
    'use strict';

    let _loading = null;

    async function fetchText(url) {
        const resp = await fetch(url + '?v=' + Date.now());
        if (!resp.ok) throw new Error('geo_data: failed to fetch ' + url + ' (' + resp.status + ')');
        return resp.text();
    }

    async function load() {
        if (_loading) return _loading;
        _loading = (async function () {
            if (typeof d3 === 'undefined' || !d3.csvParse) {
                throw new Error('geo_data: d3 must be loaded before the contract CSVs are parsed');
            }
            const pin = JSON.parse(await fetchText('data/geo/active_run.json'));
            const dir = pin.run_dir.replace(/\/$/, '') + '/';
            const [long, vocabulary, viewDefs, columnDict, geoDict, blankInventory, unitDrivers] =
                await Promise.all([
                    fetchText(dir + pin.long_table),
                    fetchText(dir + 'd2_display_rule_vocabulary.csv'),
                    fetchText(dir + 'b1_view_definitions.csv'),
                    fetchText(dir + 'column_dictionary.csv'),
                    fetchText(dir + 'geo_dictionary.csv'),
                    fetchText(dir + 'd3_blank_inventory.csv'),
                    fetchText(dir + 'g1_unit_drivers.csv'),
                ].map(function (p) { return p.then ? p : p; }));

            const reader = GeoReader.createGeoReader({
                long: d3.csvParse(long),
                vocabulary: d3.csvParse(vocabulary),
                viewDefs: d3.csvParse(viewDefs),
                columnDict: d3.csvParse(columnDict),
            });
            const render = GeoRender.createGeoRender({
                reader: reader,
                geoDict: d3.csvParse(geoDict),
                blankInventory: d3.csvParse(blankInventory),
                unitDrivers: d3.csvParse(unitDrivers),
            });
            return { pin: pin, reader: reader, render: render };
        })();
        _loading.catch(function () { _loading = null; });   // allow retry after a failure
        return _loading;
    }

    root.GeoData = { load: load };
}(typeof self !== 'undefined' ? self : this));

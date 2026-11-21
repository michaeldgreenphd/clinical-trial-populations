/**
 * The Country filter's location options: where a trial enrolled.
 *
 * Three options sit above the country list: "United States only", "United
 * States and other countries" and "Outside the United States". A trial's
 * place among them is read from the countries it lists (enrollmentScope).
 * US territories, which the registry lists as countries of their own, count
 * as the United States; a trial listing no country matches none of the
 * three. A single country still filters as before.
 *
 * enrollmentScope, studyMatchesCountryFilter, countryFilterLabel and
 * populateCountriesDropdown run in a vm with a stub document; the callers in
 * getFilteredData and updateActiveFilters are checked in the source.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');

function fnSource(signature) {
    const at = app.indexOf(signature);
    assert.ok(at >= 0, `app.js lost ${signature}`);
    const end = app.indexOf('\n}\n', at);
    return app.slice(at, end + 2);
}

const RULE_START = app.indexOf('const US_JURISDICTIONS');
const RULE_END = app.indexOf('function populateCountriesDropdown()');
assert.ok(RULE_START >= 0 && RULE_END > RULE_START, 'app.js lost the enrollment-scope rule before populateCountriesDropdown');

// A select, optgroup and option, as far as populateCountriesDropdown uses them.
function node(tag) {
    const n = { tag, children: [], value: '', textContent: '', label: '' };
    n.appendChild = (child) => { n.children.push(child); return child; };
    Object.defineProperty(n, 'innerHTML', {
        set(html) {
            // Only the "All Countries" reset is written as markup.
            assert.equal(html, '<option value="all">All Countries</option>');
            n.children = [{ tag: 'option', value: 'all', textContent: 'All Countries', children: [] }];
        }
    });
    return n;
}

function load(studies) {
    const select = node('select');
    const context = vm.createContext({
        data: studies,
        document: {
            getElementById: (id) => (id === 'country' ? select : null),
            createElement: (tag) => node(tag)
        }
    });
    vm.runInContext(app.slice(RULE_START, RULE_END) + fnSource('function populateCountriesDropdown()'), context);
    return { run: (src) => vm.runInContext(src, context), context, select };
}

const at = (...names) => ({ countries: names.map(country => ({ country })) });

test('a trial is placed by the countries it lists', () => {
    const { context } = load([]);
    const scope = (s) => context.enrollmentScope(s);
    assert.equal(scope(at('United States')), 'us_only');
    assert.equal(scope(at('United States', 'Canada')), 'us_and_other');
    assert.equal(scope(at('Germany', 'France')), 'outside_us');
    assert.equal(scope(at('Canada')), 'outside_us');
});

test('US territories count as the United States', () => {
    const { context } = load([]);
    const scope = (s) => context.enrollmentScope(s);
    // The registry lists them as countries; 29 trials in the 2026-11-15
    // snapshot list a territory and not the United States.
    assert.equal(scope(at('Puerto Rico')), 'us_only');
    assert.equal(scope(at('United States', 'Puerto Rico')), 'us_only');
    assert.equal(scope(at('Guam')), 'us_only');
    assert.equal(scope(at('American Samoa')), 'us_only');
    assert.equal(scope(at('United States Minor Outlying Islands')), 'us_only');
    assert.equal(scope(at('Puerto Rico', 'Mexico')), 'us_and_other');
});

test('a trial listing no country is in none of the three', () => {
    const { context } = load([]);
    const scope = (s) => context.enrollmentScope(s);
    assert.equal(scope({}), 'none');
    assert.equal(scope({ countries: [] }), 'none');
    assert.equal(scope({ countries: null }), 'none');
    assert.equal(scope({ countries: [{ country: '' }, { country: '  ' }, {}] }), 'none');
    for (const value of ['scope:us_only', 'scope:us_and_other', 'scope:outside_us']) {
        assert.equal(context.studyMatchesCountryFilter({ countries: [] }, value), false, value);
    }
    assert.equal(context.studyMatchesCountryFilter({ countries: [] }, 'all'), true);
});

test('names are trimmed, and a bare string is read as a country', () => {
    const { context } = load([]);
    assert.equal(context.enrollmentScope({ countries: [' United States '] }), 'us_only');
    assert.equal(context.enrollmentScope({ countries: ['Japan', { country: 'United States' }] }), 'us_and_other');
});

test('each location option keeps only its trials, and a country filters as before', () => {
    const { context } = load([]);
    const match = (s, v) => context.studyMatchesCountryFilter(s, v);
    const us = at('United States'), both = at('United States', 'Canada'), abroad = at('Canada');
    assert.deepEqual([us, both, abroad].map(s => match(s, 'scope:us_only')), [true, false, false]);
    assert.deepEqual([us, both, abroad].map(s => match(s, 'scope:us_and_other')), [false, true, false]);
    assert.deepEqual([us, both, abroad].map(s => match(s, 'scope:outside_us')), [false, false, true]);
    // A single country: listed anywhere in the trial, as before this change.
    assert.deepEqual([us, both, abroad].map(s => match(s, 'Canada')), [false, true, true]);
    assert.deepEqual([us, both, abroad].map(s => match(s, 'United States')), [true, true, false]);
    // A territory selected alone matches only trials listing it.
    assert.equal(match(at('Puerto Rico'), 'United States'), false);
    assert.equal(match(at('Puerto Rico'), 'Puerto Rico'), true);
});

test('the active-filter chip names the option', () => {
    const { context } = load([]);
    assert.equal(context.countryFilterLabel('scope:outside_us'), 'Enrolled: Outside the United States');
    assert.equal(context.countryFilterLabel('scope:us_only'), 'Enrolled: United States only');
    assert.equal(context.countryFilterLabel('scope:us_and_other'), 'Enrolled: United States and other countries');
    assert.equal(context.countryFilterLabel('Canada'), 'Country: Canada');
});

test('the dropdown lists the three options above the countries', () => {
    const { run, select } = load([at('United States', 'Puerto Rico'), at('Canada'), { countries: [] }]);
    run('populateCountriesDropdown()');
    const [all, scopes, countries] = select.children;
    assert.equal(select.children.length, 3);
    assert.deepEqual([all.value, all.textContent], ['all', 'All Countries']);
    assert.equal(scopes.tag, 'optgroup');
    assert.equal(scopes.label, 'Where the trial enrolled');
    assert.deepEqual(scopes.children.map(o => [o.value, o.textContent]), [
        ['scope:us_only', 'United States only'],
        ['scope:us_and_other', 'United States and other countries'],
        ['scope:outside_us', 'Outside the United States']
    ]);
    assert.equal(countries.label, 'Country listed');
    assert.deepEqual(countries.children.map(o => o.value), ['Canada', 'Puerto Rico', 'United States']);
});

test('the filter and the active-filter chips use these functions', () => {
    const filtered = fnSource('function getFilteredData()');
    // Called only away from the default view, so the default view (and the
    // engine's first-view gate, which slices getFilteredData) runs no new code.
    assert.match(filtered, /if \(countryFilter !== 'all' && !studyMatchesCountryFilter\(study, countryFilter\)\) return false;/);
    assert.doesNotMatch(filtered, /countryNames\.includes\(countryFilter\)/);
    const chips = fnSource('function updateActiveFilters()');
    assert.match(chips, /label: countryFilterLabel\(country\)/);
});

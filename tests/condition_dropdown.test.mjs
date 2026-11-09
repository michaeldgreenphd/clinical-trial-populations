import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// The primary/secondary condition dropdowns, run from app.js's own source.
const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const source = app.slice(app.indexOf("const NO_DISEASE_AREA ="), app.indexOf('// Pediatric status helper'));

function harness(ontology) {
    const make = () => ({ innerHTML: '', options: [], disabled: false, value: '',
        appendChild(o) { this.options.push(o); },
        querySelector(sel) { return this.options.find(o => sel === `option[value="${o.value}"]`) || null; } });
    const els = { 'condition-primary': make(), 'condition-secondary': make() };
    const context = vm.createContext({
        CONDITION_ONTOLOGY: ontology, CSS: { escape: s => s },
        document: { getElementById: id => els[id], createElement: () => ({ value: '', textContent: '' }) },
    });
    vm.runInContext(source, context);
    return { els, run: code => vm.runInContext(code, context) };
}

const ONTOLOGY = { Oncology: { 'Lung Cancer': [] }, Dermatology: { Psoriasis: [] } };

test('No disease area is listed before Other, labelled for the Industry view', () => {
    const h = harness(ONTOLOGY);
    h.run('populatePrimaryConditionDropdown()');
    const opts = h.els['condition-primary'].options;
    assert.deepEqual(opts.map(o => o.value), ['Dermatology', 'Oncology', 'No disease area', 'Other']);
    assert.equal(opts[2].textContent, 'No disease area (Industry view)');
    assert.equal(opts[3].textContent, 'Other');
});

test('a selected No disease area survives a repopulate, as a shared link needs', () => {
    const h = harness(ONTOLOGY);
    h.run('populatePrimaryConditionDropdown()');
    h.els['condition-primary'].value = 'No disease area';
    h.run('populatePrimaryConditionDropdown()');
    assert.equal(h.els['condition-primary'].value, 'No disease area');
});

test('No disease area has no subcategories, so the secondary dropdown stays disabled', () => {
    const h = harness(ONTOLOGY);
    h.run("populateSecondaryConditionDropdown('No disease area')");
    assert.equal(h.els['condition-secondary'].disabled, true);
    h.run("populateSecondaryConditionDropdown('Oncology')");
    assert.equal(h.els['condition-secondary'].disabled, false);
});

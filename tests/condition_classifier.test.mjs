/**
 * The site's fallback condition classifier (classifyCondition in app.js).
 *
 * Short ontology keywords (4 characters or fewer, mostly acronyms) match only
 * as whole words, as in the engine's src/condition_classifier.py: found inside
 * a longer word they name a different condition ("Trauma" holds "ra",
 * "Falls" holds "all"). Longer keywords may still sit inside a compound term.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const ontology = JSON.parse(readFileSync(new URL('../condition_ontology.json', import.meta.url), 'utf8'));
const fnAt = (sig) => {
    const at = app.indexOf(sig);
    assert.ok(at >= 0, `app.js lost ${sig}`);
    return app.slice(at, app.indexOf('\n}\n', at) + 2);
};
const lineAt = (sig) => {
    const at = app.indexOf(sig);
    assert.ok(at >= 0, `app.js lost ${sig}`);
    return app.slice(at, app.indexOf('\n', at) + 1);
};

function classifier() {
    const context = vm.createContext({ CONDITION_ONTOLOGY: ontology.categories });
    vm.runInContext(
        'let _conditionKeywordIndex = [];\n'
        + lineAt('const SHORT_CONDITION_KEYWORD_MAX_LEN')
        + lineAt('const CONDITION_WORD_CHAR')
        + fnAt('function _shortKeywordPattern(')
        + fnAt('function _buildKeywordIndex()')
        + fnAt('function classifyCondition(')
        + '_buildKeywordIndex();\nthis.classify = classifyCondition;\nthis.index = () => _conditionKeywordIndex;',
        context);
    return context;
}

test('a short keyword inside an unrelated word no longer sets the category', () => {
    const { classify } = classifier();
    const wrong = {
        'Falls': 'Hematologic Malignancy',               // "all"
        'Trauma': 'Rheumatoid Arthritis',                // "ra"
        'Fecal Transplant': 'Rheumatoid Arthritis',
        'Behavioral Symptoms': 'Multiple Sclerosis',     // "ms"
        'Sedation': 'Erectile Dysfunction',              // "ed"
        'Aging': 'Other Gastrointestinal',               // "gi"
        'Astigmatism': 'Sexually Transmitted Infections',  // "sti"
        'Caregiver Burnout': 'Wound and Ulcer',          // "burn"
        'Tardive Dyskinesia': 'Other Dermatology',       // "skin"
    };
    for (const [condition, secondary] of Object.entries(wrong)) {
        assert.notEqual(classify(condition).secondary, secondary, condition);
    }
});

test('whole-word acronyms, plurals and compound terms still classify', () => {
    const { classify } = classifier();
    const right = {
        'Rheumatoid Arthritis': 'Rheumatoid Arthritis',
        'RA': 'Rheumatoid Arthritis',
        'AIDS': 'HIV/AIDS',
        'HIV Infections': 'HIV/AIDS',
        'COPD': 'COPD',
        'Gliosarcoma': 'Sarcoma',
        'Heart Failure': 'Heart Failure',
    };
    for (const [condition, secondary] of Object.entries(right)) {
        assert.equal(classify(condition).secondary, secondary, condition);
    }
});

test('exactly the keywords of 4 characters or fewer carry a whole-word pattern', () => {
    const { index } = classifier();
    for (const entry of index()) {
        assert.equal(Boolean(entry.pattern), entry.keyword.length <= 4, entry.keyword);
    }
});

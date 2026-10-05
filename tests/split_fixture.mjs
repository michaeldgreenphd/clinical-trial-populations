/**
 * In-memory datasets laid out the way tests/record_contract.json's layout
 * section says, for the tests that read them (study_sidecars and
 * study_record_contract). Nothing here is written to disk: the files are
 * plain objects keyed by their published path, gzipped on demand.
 *
 * A record is projected onto a class the way the engine's split projects
 * it: every listed path that the record has is copied (lists item by item),
 * and nothing else. The detail shards carry their whole lists (whole_lists)
 * whole, so study_sites keeps its country beside the detail fields.
 */
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

export const contract = JSON.parse(readFileSync(new URL('./record_contract.json', import.meta.url), 'utf8'));
const optionalOf = (klass) => Object.entries(contract.layout.optional_class).filter(([, c]) => c === klass).map(([p]) => p);

// The paths each class file carries (layout: class paths plus the optional
// paths assigned to the class; detail adds the rest of its whole lists).
export const classPaths = {
    core: [...contract.classes.core, ...optionalOf('core')],
    studies_tab: [...contract.classes.studies_tab, ...optionalOf('studies_tab')],
    detail: [
        ...contract.classes.detail,
        ...optionalOf('detail'),
        ...contract.layout.detail.whole_lists.flatMap((list) =>
            Object.values(contract.classes).flat().filter((p) => p.startsWith(`${list}[].`)))
    ]
};

function segments(path) {
    return path.split('.').map((s) => (s.endsWith('[]') ? { key: s.slice(0, -2), each: true } : { key: s, each: false }));
}

function copyPath(src, dst, segs) {
    const [{ key, each }, ...rest] = segs;
    if (src === null || typeof src !== 'object' || !(key in src)) return;
    const value = src[key];
    if (!rest.length) {
        dst[key] = value;
        return;
    }
    if (each) {
        if (!Array.isArray(value)) {
            dst[key] = value;
            return;
        }
        if (!Array.isArray(dst[key])) dst[key] = value.map(() => ({}));
        value.forEach((item, i) => copyPath(item, dst[key][i], rest));
        return;
    }
    if (value === null || typeof value !== 'object') {
        dst[key] = value;
        return;
    }
    if (!dst[key] || typeof dst[key] !== 'object') dst[key] = {};
    copyPath(value, dst[key], rest);
}

// A record projected onto a list of contract paths.
export function project(record, paths) {
    const out = {};
    for (const path of new Set(paths)) copyPath(record, out, segments(path));
    return out;
}

// The layout's shard rule, n = Number(nct_id.slice(3)) % shards.
export const shardOf = (nctId, shards) => Number(nctId.slice(3)) % shards;

// A whole study record carrying every contract path (and two optional ones).
export function fullRecord(nctId, over = {}) {
    const raw = (omb, original, extra = {}) => ({ omb_category: omb, confidence: 'high', original, flags: [], ...extra });
    return {
        nct_id: nctId,
        brief_title: `Trial ${nctId}`,
        study_type: 'INTERVENTIONAL',
        phase: 'PHASE2',
        enrollment: 120,
        enrollment_type: 'ACTUAL',
        results_date: '2024-05-01',
        start_date: '2020-01-01',
        completion_date: '2023-01-01',
        primary_completion_date: '2022-12-01',
        completion_to_report_days: 486,
        sponsor_class: 'OTHER',
        countries: [{ country: 'United States' }, { country: 'Canada' }],
        study_sites: [
            { facility: 'Harbor Clinic', city: 'Boston', state: 'MA', zip: '02115', country: 'United States', geo_identification_method: 'High (zip)' },
            { facility: 'Lakeside Hospital', city: 'Toronto', state: 'ON', zip: 'M5G', country: 'Canada', geo_identification_method: 'Medium (city)' }
        ],
        conditions: ['Asthma'],
        condition_classifications: [{ primary: 'Respiratory', secondary: 'Asthma' }],
        primary_condition: 'Asthma',
        secondary_condition: null,
        intervention_model: 'PARALLEL',
        masking: 'DOUBLE',
        primary_purpose: 'TREATMENT',
        healthy_volunteers: false,
        pediatric_status: 'Adult Only',
        std_ages: ['ADULT'],
        min_age: '18 Years',
        max_age: '65 Years',
        primary_endpoint: 'Change in FEV1',
        is_fda_regulated_drug: true,
        is_fda_regulated_device: false,
        is_unapproved_device: null,
        race: {
            reported: true,
            omb_totals: { american_indian_alaska_native: 0, asian: 20, black_african_american: 0, native_hawaiian_pacific_islander: 0, white: 100, more_than_one_race: 0, unknown_not_reported: 0, other: 0 },
            subcategory_totals: {},
            raw_categories: [raw('white', 'Caucasian'), raw('asian', 'Asian', { category: 'asian' })],
            quarantined_labels: [{ original: 'Oral contraceptive', count: 3, reason: 'not_demographic' }]
        },
        ethnicity: {
            reported: true,
            omb_totals: { hispanic_latino: 12, not_hispanic_latino: 108, unknown_not_reported: 0 },
            subcategory_totals: {},
            raw_categories: [raw('hispanic_latino', 'Hispanic'), raw('not_hispanic_latino', 'Not Hispanic')]
        },
        sex: {
            reported: true,
            totals: { female: 60, male: 60, unknown: 0 },
            raw_categories: [{ category: 'female', confidence: 'high', original: 'Female', flags: [] }, { category: 'male', confidence: 'high', original: 'Male', flags: [] }],
            quarantined_labels: []
        },
        gender: { reported: false, totals: {}, raw_categories: [], quarantined_labels: [] },
        sex_gender: {
            sex_report_status: 'reported', reported_sex: true, reported_gender: false, reported_both: false,
            n_female: 60, n_male: 60, n_unknown: null, n_gender_diverse: null, n_ambiguous_gender: null,
            is_participant_count: true, uninformative_reason: null, declared_not_collected: false, parser_rules_version: 'test'
        },
        references: [{ pmid: '31000001', citation: 'Doe J. A randomized trial. 2024.', source: 'pubmed', title: 'A randomized trial', journal: 'Thorax' }],
        status: 'TERMINATED',
        why_stopped: 'Slow accrual',
        geo_identification_method: 'High (zip)',
        secondary_outcomes: [{ measure: 'Exacerbations per year', time_frame: '12 months' }],
        primary_outcome_description: 'Litres at 12 weeks',
        primary_outcome_time_frame: '12 weeks',
        intervention_model_description: 'Two parallel arms',
        allocation: 'RANDOMIZED',
        observational_model: null,
        subject_masked: true,
        caregiver_masked: false,
        investigator_masked: true,
        outcomes_assessor_masked: false,
        lead_sponsor_name: 'Harbor University',
        collaborators: [{ name: 'National Heart, Lung, and Blood Institute', class: 'NIH' }],
        last_update: '2024-06-01',
        ...over
    };
}

function chunks(records, parts) {
    const size = Math.ceil(records.length / parts);
    return Array.from({ length: parts }, (_, i) => records.slice(i * size, (i + 1) * size));
}

// A dataset as its published files: { path: body }. Inline when layout is
// false (the parts carry whole records, as every file published so far);
// split otherwise, with studies_tab parts aligned with the core parts and
// `shards` detail shards. base is the dataset's folder (data or
// snapshots/<date>).
export function dataset(records, { base = 'data', parts = 2, shards = 8, layout = true, stamp = '2026-10-11T06:00:00+00:00', commit = 'abc1234' } = {}) {
    const files = {};
    const header = { extracted_at: stamp, pipeline_commit: commit };
    const groups = chunks(records, parts);
    const block = { version: 1, studies_tab: { files: parts }, detail: { shards, key: 'nct_number_mod' } };
    groups.forEach((group, i) => {
        const part = { ...header, part: i + 1, total_parts: parts };
        if (!layout) {
            files[`${base}/demographics.part${i + 1}.json.gz`] = { ...part, data: group };
            return;
        }
        files[`${base}/demographics.part${i + 1}.json.gz`] = { ...part, layout: block, data: group.map((r) => project(r, classPaths.core)) };
        files[`${base}/studies_tab.part${i + 1}.json.gz`] = {
            ...header, class: 'studies_tab', part: i + 1, total_parts: parts,
            data: Object.fromEntries(group.map((r) => [r.nct_id, project(r, classPaths.studies_tab)]))
        };
    });
    if (layout) {
        for (let n = 0; n < shards; n++) {
            files[`${base}/detail/${n}.json.gz`] = {
                ...header, class: 'detail', shard: n, shards, key: 'nct_number_mod',
                data: Object.fromEntries(records.filter((r) => shardOf(r.nct_id, shards) === n).map((r) => [r.nct_id, project(r, classPaths.detail)]))
            };
        }
    }
    return files;
}

export const gz = (body) => gzipSync(Buffer.from(JSON.stringify(body)));

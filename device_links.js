/*
 * AI Devices tab, "Study links and evidence" pane.
 *
 * Reads the device-linkage family the engine writes by hand into data/devices/
 * (civicsample-engine devices/README.md and scripts/export_device_links_site.py, site schema 1):
 * run.json, summary.json, submissions.json and families.json when the pane opens;
 * evidence.json and documents.json when a row is first opened; evidence_set_aside.json only
 * when a reader asks for it. It presents; it computes no aggregate. Every count shown comes
 * from summary.json, or is a tally the engine wrote on the row being shown.
 *
 * What a row is. FDA's list has rows; rows share submission numbers; submissions are grouped
 * into candidate families by rule. A link between a submission (or a family) and a registered
 * study is an evidence record: a quote, where it stands, and what an automated check found. It
 * is not a finding. A device name in a study record reaches the family only, never one
 * submission. Human review is a separate field, set only by the engine from devices/reviews.csv.
 *
 * Review controls here make DRAFTS: held in memory, mirrored to localStorage when the browser
 * allows it, and exported as rows for devices/reviews.csv. A draft never changes the published
 * human_review value or any count; it takes effect only when a person adds the row to that
 * file and the engine build is rerun.
 *
 * Loaded by index.html before app.js; app.js calls DeviceLinks.open(el, deps) when the AI
 * Devices tab's switch selects this pane, and DeviceLinks.loadHead for the tab's unit cards.
 */
(function (root) {
    'use strict';

    const SCHEMA_VERSION = 1;
    const BASE = 'data/devices/';
    const PAGE = 25;
    const STORAGE_KEY = 'civicsample.deviceReviewDrafts';
    const REVIEW_FILE = 'devices/reviews.csv';
    // The column order of devices/reviews.csv in the engine (devices/links.py REVIEW_COLUMNS).
    const REVIEW_COLUMNS = ['link_id', 'human_review', 'reviewed_relationship', 'reviewed_on', 'note'];
    const EXPORT_SENTENCE = 'Decisions made here take effect only when these rows are added to devices/reviews.csv in the engine repository and the build is rerun.';
    const SET_ASIDE_LABEL = 'Set aside by rule (name returns 50 or more registry records, or the number is in no returned field)';
    const FAMILY_MARK = 'family-level candidate — not specific to this submission';

    // The seven coverage states. A state this view has no label for is refused by dataProblem
    // rather than shown under a guessed one.
    const COVERAGE_LABELS = {
        not_searched: 'Not searched',
        search_incomplete_or_blocked: 'Search incomplete or blocked',
        document_unavailable: 'Document unavailable',
        available_document_insufficient: 'Available document insufficient for the question',
        candidate_awaiting_review: 'Candidate link awaiting review',
        no_candidate_in_completed_scope: 'No candidate found in the completed search scope',
        verified_link: 'Verified link: identifier cited (what the citation means is not reviewed)',
    };
    const NEGATIVE_FINDING = 'no_candidate_in_completed_scope';
    const COVERAGE_MEANING = {
        not_searched: 'No search was run. Nothing is known either way.',
        search_incomplete_or_blocked: 'A search started and did not finish, or a source did not answer. Nothing is known either way.',
        document_unavailable: 'No document of the submission could be retrieved, so its text was not searched.',
        available_document_insufficient: 'A document is held and cannot answer the question: for example a scan with no text layer, or a type of document that describes no study.',
        candidate_awaiting_review: 'At least one candidate record exists and none has the automated status identifier_confirmed. A candidate is not a link.',
        no_candidate_in_completed_scope: 'Every search that can produce a link finished and found nothing. The finding is limited to the sources that were searched.',
        verified_link: 'An automated check found a shared identifier in a retrieved source. It shows that a citation exists, not what the citation means.',
    };
    const PATHWAY_LABELS = { '510k': '510(k)', de_novo: 'De Novo', pma: 'PMA', pma_supplement: 'PMA supplement', unknown: 'Unknown' };
    const KIND_SHORT = {
        submission_identifier: 'Identifier', family_name_and_organisation: 'Name + organisation', family_name_only: 'Name only',
        parent_submission: 'Parent submission', set_aside_by_rule: 'Set aside', other: 'Other',
    };
    const METHOD_LABELS = {
        nct_id_in_submission_document: 'NCT number found in a document of this submission',
        submission_number_in_registry_record: 'Submission number found in a registry record',
        documentary_statement: 'Documentary statement entered by a person',
        nct_id_in_parent_submission_document: 'NCT number found in a document of the original submission, not of this supplement',
        device_name_and_organisation_match: 'Device name in a study title or intervention, and the sponsor agrees with the manufacturer',
        device_name_match: 'Device name in a study title or intervention; no sponsor agrees',
    };
    const RELATIONSHIP_LABELS = {
        study_cited_in_submission_document: 'Study cited in a document of the submission',
        submission_cited_in_registry_record: 'Submission cited in the registry record',
        study_cited_in_parent_submission_document: 'Study cited in a document of the original submission',
        name_and_organisation_candidate: 'Candidate: device name and organisation',
        name_only_candidate: 'Candidate: device name only',
        explicitly_cited_supporting_study: 'Explicitly cited supporting study',
        related_validation_study: 'Related validation study',
        documented_postmarket_study: 'Documented post-market study',
        same_family_other_version: 'Same family, another version',
        citation_not_about_this_device: 'Citation is not about this device',
        not_related: 'Not related',
    };
    // The automated status, named as the data names it, with what the check covers.
    const VALIDATION_LABELS = {
        identifier_confirmed: 'Identifier confirmed (automated check: the citation exists and the identifier resolves)',
        quote_confirmed_in_source: 'Quote confirmed in source (automated check: the quote stands at the stated place)',
        identifier_not_resolved: 'Identifier not resolved (the registry does not hold the cited id)',
        rejected_by_rule: 'Rejected by rule',
        not_validated: 'Not validated',
    };
    const REVIEW_LABELS = { unreviewed: 'Unreviewed', accepted: 'Accepted', rejected: 'Rejected', unresolved: 'Unresolved' };
    const CONFIDENCE_LABELS = { identifier: 'Identifier', documentary: 'Documentary', moderate: 'Moderate', low: 'Low' };
    const TIMING_LABELS = {
        primary_completion_on_or_before_decision: 'Primary completion on or before the FDA decision date',
        started_on_or_before_decision_not_complete: 'Started on or before the FDA decision date; primary completion later or not recorded',
        started_within_365_days_after_decision: 'Started within 365 days after the FDA decision date',
        started_more_than_365_days_after_decision: 'Started more than 365 days after the FDA decision date',
        indeterminate_at_recorded_precision: 'Cannot be placed: a date is recorded to the month only',
        start_date_absent: 'Study start date not recorded',
        decision_date_absent: 'FDA decision date not available',
    };
    const DOCUMENT_LABELS = {
        '510k_summary': '510(k) summary', '510k_decision_summary': '510(k) decision summary',
        de_novo_decision_summary: 'De Novo decision summary', pma_ssed: 'Summary of safety and effectiveness (PMA)',
        '510k_statement': '510(k) statement', '510k_clearance_letter': '510(k) clearance letter',
        de_novo_granting_letter: 'De Novo granting letter', pma_approval_order: 'PMA approval order',
        pma_labeling: 'PMA labeling', other: 'Other', unclassified_no_text: 'Unclassified (no text layer)',
    };
    const TEXT_LABELS = { text: 'Text read', partial: 'Partly read', image_only: 'Scan with no text layer; not read',
                          failed: 'Could not be read', not_extracted: 'Not read' };
    const DUPLICATE_LABELS = {
        identical: 'the rows are identical in every column',
        alias_only: 'the rows differ only in a spelling of the company or device',
        substantive_conflict: 'the rows disagree on something other than a spelling',
    };
    const GROUPING_LABELS = {
        organisation_and_whole_core_name_equal: 'same organisation and the same whole core name',
        generic_name_not_grouped: 'not grouped with any other submission: the listed name is made only of device-type words',
        curated: 'listed in the engine\'s curated families file',
    };
    // The metrics of summary.json this view reads by id. dataProblem requires each.
    const METRICS = ['families_curated', 'evidence_records_human_reviewed', 'evidence_records_identifier_confirmed',
        'evidence_records_name_and_organisation', 'evidence_records_name_only', 'evidence_records_rejected_by_rule',
        'demographic_extractions_with_any_value', 'demographic_extractions_malformed'];
    const DENOMINATORS = ['source_rows', 'submissions', 'families', 'evidence_records', 'demographic_extractions'];

    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const num = n => (typeof n === 'number' ? n.toLocaleString('en-US') : '—');
    const label = (map, v) => (v == null ? '—' : map[v] || String(v).replace(/_/g, ' '));
    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    // A date as recorded: a day, a month (the registry records some dates to the month) or the
    // day of a timestamp. Anything else is shown as written; an absent date is said to be absent.
    function fmtDate(iso) {
        if (iso == null || iso === '') return 'not recorded';
        const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(String(iso));
        if (!m || !MONTHS[+m[2] - 1]) return String(iso);
        return (m[3] ? +m[3] + ' ' : '') + MONTHS[+m[2] - 1] + ' ' + m[1];
    }
    const attr = v => String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const metric = (summary, id) => {
        const m = summary && Array.isArray(summary.metrics) ? summary.metrics.find(x => x.id === id) : null;
        return m && typeof m.numerator === 'number' ? m : null;
    };
    const denominator = (summary, key) => ((summary && summary.denominators && summary.denominators[key]) || {}).n;

    // ---------------------------------------------------------------- the consumer contract

    const isList = (v, of) => Array.isArray(v) && v.every(of || (x => typeof x === 'string'));

    function recordProblem(rec, v, reasons, setAside) {
        const id = (rec && rec.link_id) || 'a record';
        if (!rec || typeof rec.link_id !== 'string' || !rec.source || !rec.target || !rec.evidence || !rec.timing) return 'an evidence record lacks its id, entities, evidence or timing';
        if (!v.link_levels.includes(rec.level)) return `${id} has a level this view does not know`;
        if (!v.link_methods.includes(rec.method)) return `${id} has a method this view does not know`;
        if (!v.automated_validation.includes(rec.automated_validation)) return `${id} has an automated validation status this view does not know`;
        if (!v.human_review.includes(rec.human_review)) return `${id} has a human review status this view does not know`;
        if (!v.proposed_relationships.includes(rec.proposed_relationship)) return `${id} has a proposed relationship this view does not know`;
        // The two rules a reader of this pane relies on. The engine enforces both; a file that
        // breaks either is not shown.
        const validated = rec.automated_validation === 'identifier_confirmed' || rec.automated_validation === 'quote_confirmed_in_source';
        if (rec.level === 'family' && validated) return `${id} is a family-level record marked ${rec.automated_validation}; a family-level record is never validated`;
        if (v.heuristic_methods.includes(rec.method)) {
            if (rec.level !== 'family' || rec.source.entity_type !== 'family') return `${id} is a name match at submission level; a name match reaches a family only`;
            if (rec.automated_validation !== 'not_validated' && rec.automated_validation !== 'rejected_by_rule') return `${id} is a name match marked ${rec.automated_validation}`;
        }
        if ((rec.automated_validation === 'rejected_by_rule') !== setAside) return setAside ? `${id} is in the set-aside file and was not rejected by rule` : `${id} was rejected by rule and is not in the set-aside file`;
        if (!/^NCT\d{8}$/.test(String(rec.target.id))) return `${id} does not name a registered study`;
        const loc = rec.evidence.location || {};
        if (!String(rec.evidence.quote || '').trim() || !((Number.isInteger(loc.page) && loc.page >= 1) || String(loc.registry_field || '').trim())) return `${id} has no quote, or no page or registry field for it`;
        if (!rec.source_version || typeof rec.source_version !== 'object') return `${id} has no source version`;
        for (const key of ['confidence_reasons', 'validation_reasons']) {
            if (!Array.isArray(rec[key]) || !rec[key].length || !rec[key].every(i => Number.isInteger(i) && i >= 0 && i < reasons.length)) return `${id} has no ${key.replace('_', ' ')}, or one outside the file's table`;
        }
        if (!v.confidence.includes(rec.confidence)) return `${id} has a confidence tier this view does not know`;
        if ((rec.human_review !== 'unreviewed') !== Boolean(rec.review && rec.review.reviewed_on && rec.review.note)) return `${id} has a human review status without its recorded review, or a review without a status`;
        if (rec.reviewed_relationship != null && !v.reviewed_relationships.includes(rec.reviewed_relationship)) return `${id} has a reviewed relationship this view does not know`;
        if (!Array.isArray(rec.timing.by_submission) || !rec.timing.by_submission.every(t => v.timing_relations.includes(t.relation))) return `${id} has a timing relation this view does not know`;
        if (!rec.study || typeof rec.study !== 'object') return `${id} lacks its study facts`;
        return null;
    }

    // What is wrong with the fetched family as this pane reads it, or null. `parts` holds the
    // files fetched so far: { submissions, families, evidence, setAside, documents }. A file from
    // another build, a schema or a status this pane does not know, or a record that breaks one
    // of the rules the pane states, is refused rather than half-rendered.
    function dataProblem(run, summary, parts) {
        if (!run || run.schema_version !== SCHEMA_VERSION) return 'run.json is missing or has a schema this view does not read';
        if (!run.run_id || !run.generated_at) return 'run.json lacks its run id or build time';
        const units = run.counting_units || {};
        if (![units.source_row, units.submission, units.family].every(d => typeof d === 'string' && d)) return 'run.json lacks the definitions of its counting units';
        const v = run.vocabularies || {};
        for (const key of ['coverage_states', 'coverage_routes', 'pathways', 'link_levels', 'link_methods', 'heuristic_methods',
            'proposed_relationships', 'reviewed_relationships', 'automated_validation', 'human_review', 'confidence',
            'timing_relations', 'evidence_kinds']) {
            if (!isList(v[key]) || !v[key].length) return `run.json lacks the ${key} vocabulary`;
        }
        const unknown = v.coverage_states.find(s => !(s in COVERAGE_LABELS));
        if (unknown) return `run.json lists a coverage state this view does not know (${unknown})`;
        if (v.human_review[0] !== 'unreviewed') return 'run.json does not list "unreviewed" as the first human review status';
        if (!run.evidence_kinds || !v.evidence_kinds.every(k => typeof run.evidence_kinds[k] === 'string')) return 'run.json lacks the definition of an evidence kind';
        if (!run.coverage_routes || !v.coverage_routes.every(r => typeof run.coverage_routes[r] === 'string')) return 'run.json lacks the description of a coverage route';
        if (!run.sources || !run.files) return 'run.json lacks its sources or its file list';

        if (!summary || summary.run_id !== run.run_id) return 'summary.json belongs to a different build';
        if (!DENOMINATORS.every(k => typeof denominator(summary, k) === 'number')) return 'summary.json lacks one of the counts this view shows';
        if (!METRICS.every(id => metric(summary, id))) return 'summary.json lacks one of the metrics this view shows';
        const overall = summary.tables && summary.tables.coverage_overall;
        if (!overall || typeof overall !== 'object') return 'summary.json lacks the coverage table';
        const stray = Object.keys(overall).find(s => !v.coverage_states.includes(s) || typeof overall[s] !== 'number');
        if (stray) return `summary.json counts a coverage state this view does not know (${stray})`;

        const p = parts || {};
        const sameBuild = (file, name) => (!file || file.schema_version !== SCHEMA_VERSION || file.run_id !== run.run_id ? `${name} belongs to a different build` : null);
        const sameList = (a, b) => isList(a) && a.length === b.length && a.every((x, i) => x === b[i]);
        const counts = c => isList(c, n => Number.isInteger(n) && n >= 0) && c.length === v.evidence_kinds.length;
        if (p.submissions) {
            const f = p.submissions;
            const bad = sameBuild(f, 'submissions.json');
            if (bad) return bad;
            if (!sameList(f.evidence_kinds, v.evidence_kinds) || !sameList(f.coverage_routes, v.coverage_routes)) return 'submissions.json orders its evidence kinds or coverage routes differently from run.json';
            if (!isList(f.coverage_reasons) || !Array.isArray(f.submissions)) return 'submissions.json is not a submissions file';
            for (const s of f.submissions) {
                const sn = s && s.submission_number;
                if (typeof sn !== 'string' || !sn) return 'a submission row has no submission number';
                if (!(s.coverage_overall in COVERAGE_LABELS) || !v.coverage_states.includes(s.coverage_overall)) return `${sn} has a coverage state this view does not know (${s.coverage_overall})`;
                if (!Array.isArray(s.coverage) || s.coverage.length !== v.coverage_routes.length) return `${sn} does not carry one coverage cell per route`;
                for (const cell of s.coverage) {
                    if (!Array.isArray(cell) || !v.coverage_states.includes(cell[0]) || !(cell[0] in COVERAGE_LABELS)) return `${sn} has a coverage state this view does not know (${cell && cell[0]})`;
                    if (!Number.isInteger(cell[1]) || cell[1] < 0 || cell[1] >= f.coverage_reasons.length) return `${sn} has a coverage cell without its reason`;
                }
                if (!counts(s.evidence_counts)) return `${sn} does not carry one evidence count per kind`;
                if (!v.pathways.includes(s.pathway)) return `${sn} has a pathway this view does not know`;
                if (typeof s.family_id !== 'string' || !isList(s.companies_as_listed) || !s.documents || typeof s.documents.n_held !== 'number') return `${sn} lacks its family, its listed company or its document counts`;
            }
        }
        if (p.families) {
            const f = p.families;
            const bad = sameBuild(f, 'families.json');
            if (bad) return bad;
            if (!sameList(f.evidence_kinds, v.evidence_kinds) || !f.families || typeof f.families !== 'object') return 'families.json is not a families file, or orders its evidence kinds differently from run.json';
            for (const [fid, fam] of Object.entries(f.families)) {
                if (fam.status !== 'candidate' && fam.status !== 'curated') return `${fid} is neither a candidate nor a curated family`;
                if (!isList(fam.submission_numbers) || !fam.submission_numbers.length || !counts(fam.evidence_counts)) return `${fid} lacks its members or its evidence counts`;
            }
            if (p.submissions) {
                const missing = p.submissions.submissions.find(s => !f.families[s.family_id] || !f.families[s.family_id].submission_numbers.includes(s.submission_number));
                if (missing) return `${missing.submission_number} is not a member of the family it names`;
            }
        }
        for (const [key, name, setAside] of [['evidence', 'evidence.json', false], ['setAside', 'evidence_set_aside.json', true]]) {
            const f = p[key];
            if (!f) continue;
            const bad = sameBuild(f, name);
            if (bad) return bad;
            if (!isList(f.reasons) || !Array.isArray(f.records)) return `${name} is not an evidence file`;
            for (const rec of f.records) {
                const problem = recordProblem(rec, v, f.reasons, setAside);
                if (problem) return problem;
            }
        }
        if (p.documents) {
            const bad = sameBuild(p.documents, 'documents.json');
            if (bad) return bad;
            if (!p.documents.documents || typeof p.documents.documents !== 'object') return 'documents.json is not a documents file';
        }
        return null;
    }

    // ---------------------------------------------------------------- reading rows

    // A row's coverage cells with the route and the reason written out.
    function coverageOf(row, file) {
        return file.coverage_routes.map((route, i) => ({ route, state: row.coverage[i][0], reason: file.coverage_reasons[row.coverage[i][1]] }));
    }
    // A row's (or a family's) evidence tallies, keyed by kind. Written by the engine.
    function countsOf(item, file) {
        return Object.fromEntries(file.evidence_kinds.map((k, i) => [k, item.evidence_counts[i]]));
    }
    // A record with its reasons and the file's shared registry version written back in.
    function expandRecord(rec, file) {
        return { ...rec, confidence_reasons: rec.confidence_reasons.map(i => file.reasons[i]),
                 validation_reasons: rec.validation_reasons.map(i => file.reasons[i]),
                 source_version: { ...(file.registry_version || {}), ...rec.source_version } };
    }

    // The submissions a reader's filters select. Filters only choose rows.
    function filterSubmissions(rows, f) {
        const q = ((f && f.query) || '').trim().toLowerCase();
        return rows.filter(s => (!f.coverage || s.coverage_overall === f.coverage) && (!f.pathway || s.pathway === f.pathway) &&
            (!q || [s.submission_number, s.device_name, s.organization_name].concat(s.device_names_as_listed || [], s.companies_as_listed || [])
                .some(t => String(t || '').toLowerCase().includes(q))));
    }
    // Families, in the order their first member stands in the list. A family is listed when at
    // least one member has the chosen coverage state and pathway, or when the search text
    // matches the family's name, its organisation or a member's number.
    function filterFamilies(families, rows, f) {
        const q = ((f && f.query) || '').trim().toLowerCase();
        const seen = new Set(); const out = [];
        const byNumber = new Map(rows.map(s => [s.submission_number, s]));
        for (const s of rows) {
            if (seen.has(s.family_id)) continue;
            seen.add(s.family_id);
            const fam = families[s.family_id];
            if (!fam) continue;
            const members = fam.submission_numbers.map(n => byNumber.get(n)).filter(Boolean);
            if ((f.coverage || f.pathway) && !members.some(m => (!f.coverage || m.coverage_overall === f.coverage) && (!f.pathway || m.pathway === f.pathway))) continue;
            if (q && ![fam.family_name].concat(fam.organization_names || [], fam.submission_numbers).some(t => String(t || '').toLowerCase().includes(q))) continue;
            out.push({ family_id: s.family_id, ...fam });
        }
        return out;
    }

    // ---------------------------------------------------------------- draft reviews

    // The decisions a reviewer may record: the human review vocabulary without "unreviewed".
    const decisionsOf = run => run.vocabularies.human_review.filter(s => s !== 'unreviewed');

    // What stops a draft from being a row of devices/reviews.csv, or null. The rules are the
    // engine loader's (devices/links.py read_reviews): a known decision, a known relationship
    // or none, a relationship when the link is accepted, a YYYY-MM-DD date and a note.
    function draftProblem(d, run) {
        if (!d || !decisionsOf(run).includes(d.human_review)) return 'Choose a decision: ' + decisionsOf(run).join(', ') + '.';
        if (d.reviewed_relationship && !run.vocabularies.reviewed_relationships.includes(d.reviewed_relationship)) return 'The reviewed relationship is not one the engine accepts.';
        if (d.human_review === 'accepted' && !d.reviewed_relationship) return 'An accepted link must say which relationship was accepted.';
        if (!String(d.note || '').trim()) return 'A note giving the reason is required.';
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d.reviewed_on || ''))) return 'The review date must be written YYYY-MM-DD.';
        return null;
    }

    const csvField = v => {
        const s = String(v == null ? '' : v);
        return /[",\r\n]|^\s|\s$/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    // CSV text for devices/reviews.csv: the file's header, then one row per complete draft in
    // link-id order. Incomplete drafts are left out and named in `skipped`.
    function reviewRowsCSV(drafts, run) {
        const ids = Object.keys(drafts || {}).sort();
        const ready = ids.filter(id => !draftProblem(drafts[id], run));
        const lines = [REVIEW_COLUMNS.join(',')].concat(ready.map(id => {
            const d = drafts[id];
            return [id, d.human_review, d.reviewed_relationship || '', d.reviewed_on, String(d.note).trim()].map(csvField).join(',');
        }));
        return { text: lines.join('\n') + '\n', n_rows: ready.length, skipped: ids.filter(id => !ready.includes(id)) };
    }

    // Drafts live in memory; storage is a mirror that may be missing, full or refused. Every
    // storage call is inside try/catch, and the pane works the same without it.
    function draftStore(storage) {
        let mem = {};
        let persisted = false;
        try {
            const raw = storage ? storage.getItem(STORAGE_KEY) : null;
            const parsed = raw ? JSON.parse(raw) : null;
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                for (const [id, d] of Object.entries(parsed)) {
                    if (d && typeof d === 'object' && typeof d.human_review === 'string' && typeof d.note === 'string') mem[id] = d;
                }
            }
            persisted = Boolean(storage);
        } catch (e) { persisted = false; }
        const mirror = () => {
            try { if (!storage) { persisted = false; return; } storage.setItem(STORAGE_KEY, JSON.stringify(mem)); persisted = true; } catch (e) { persisted = false; }
        };
        return {
            all: () => ({ ...mem }),
            get: id => mem[id] || null,
            set(id, draft) { mem[id] = draft; mirror(); },
            remove(id) { delete mem[id]; mirror(); },
            clear() { mem = {}; try { if (storage) storage.removeItem(STORAGE_KEY); } catch (e) { persisted = false; } },
            persisted: () => persisted,
        };
    }

    function localDate(now) {
        const d = now || new Date();
        const p = n => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    }

    // ---------------------------------------------------------------- the three counting units

    // The stat cards for the three units, side by side, each with the engine's definition.
    // Used by this pane and by the Device list pane's header (app.js).
    function unitCardsHTML(run, summary) {
        const curated = metric(summary, 'families_curated').numerator;
        const familyLabel = curated === 0
            ? 'Candidate product families: grouped by rule, none curated'
            : `Product families: ${num(curated)} curated, the rest candidates grouped by rule`;
        const card = (title, n, definition) => `
            <div class="stat-card dl-unit">
                <h3>${esc(title)}</h3>
                <p class="stat-value">${num(n)}</p>
                <p class="stat-sub">${esc(definition)}</p>
            </div>`;
        return card('Rows on FDA\'s list', denominator(summary, 'source_rows'), run.counting_units.source_row) +
            card('Distinct submissions', denominator(summary, 'submissions'), run.counting_units.submission) +
            card(familyLabel, denominator(summary, 'families'), run.counting_units.family);
    }

    // ---------------------------------------------------------------- the pane, part by part

    function headHTML(run, summary) {
        const reviewed = metric(summary, 'evidence_records_human_reviewed').numerator;
        const records = denominator(summary, 'evidence_records');
        const review = reviewed === 0
            ? `Nothing here has been reviewed by a person: ${num(reviewed)} of ${num(records)} evidence records have a recorded human review.`
            : `${num(reviewed)} of ${num(records)} evidence records have a recorded human review. The rest have not been reviewed by a person.`;
        return `
            <div class="panel-hero dl-head">
                <h3>Study links and evidence</h3>
                <ul class="dl-statements">
                    <li><strong>A link is an evidence record, not a finding.</strong> Each record is one piece of text found in one source, shown with the place it stands. It does not say that a study supported, tested or followed a device.</li>
                    <li><strong>A submission-level link exists only where an identifier was found in a retrieved source</strong>: a registry study number in a document FDA published for that submission, or the submission number in a field of a registry record.</li>
                    <li><strong>A name match is a family-level candidate.</strong> A device name in a study title or intervention never establishes a link to a submission, because every submission of the family carries that name.</li>
                    <li><strong>Agreement between manufacturer and sponsor is evidence, not a requirement.</strong> It is recorded when present; its absence rejects nothing, and on its own it creates no record.</li>
                    <li><strong>Timing is shown and never decides anything.</strong> Study dates stand beside FDA decision dates as a description.</li>
                    <li class="dl-review-line">${esc(review)}</li>
                </ul>
            </div>`;
    }

    function unitsHTML(run, summary) {
        return `<div class="stats-grid dl-units" role="group" aria-label="Counting units">${unitCardsHTML(run, summary)}</div>`;
    }

    function coverageHTML(run, summary) {
        const table = summary.tables.coverage_overall;
        const total = denominator(summary, 'submissions');
        // A state no submission is in has no entry in the engine's table; every submission is in
        // exactly one state, so that absence is a counted zero.
        const rows = run.vocabularies.coverage_states.map(s => `<tr${s === NEGATIVE_FINDING ? ' class="dl-negative"' : ''}>
                <th scope="row">${esc(COVERAGE_LABELS[s])}</th>
                <td class="dl-num" data-label="Submissions">${num(s in table ? table[s] : 0)}</td>
                <td data-label="Kind of result">${s === NEGATIVE_FINDING ? '<span class="dl-tag dl-tag-negative">Negative finding</span>' : '<span class="dl-tag">Not a negative finding</span>'}</td>
                <td data-label="What it means">${esc(COVERAGE_MEANING[s])}</td>
            </tr>`).join('');
        return `
            <section class="dl-block" aria-labelledby="dl-coverage-h">
                <h4 id="dl-coverage-h">Coverage of the ${num(total)} submissions</h4>
                <p class="note"><strong>Only “${esc(COVERAGE_LABELS[NEGATIVE_FINDING])}” is a negative finding.</strong> Every other state means that a search did not run, did not finish, could not read its source, or found something that has not been reviewed.</p>
                <div class="dl-table-wrap"><table class="dl-table dl-coverage">
                    <caption>Each submission is in exactly one state, taken over the routes that can produce a link. Counted by submission, of ${num(total)}.</caption>
                    <thead><tr><th scope="col">State</th><th scope="col" class="dl-num">Submissions</th><th scope="col">Kind of result</th><th scope="col">What it means</th></tr></thead>
                    <tbody>${rows}</tbody></table></div>
            </section>`;
    }

    // Evidence records by kind: the engine's metrics with the engine's definitions.
    function evidenceSummaryHTML(run, summary) {
        const records = denominator(summary, 'evidence_records');
        const rows = [['evidence_records_identifier_confirmed', 'Submission-level: identifier found in a retrieved source'],
            ['evidence_records_name_and_organisation', 'Family-level candidate: device name and organisation'],
            ['evidence_records_name_only', 'Family-level candidate: device name only'],
            ['evidence_records_rejected_by_rule', 'Set aside by rule'],
            ['evidence_records_human_reviewed', 'Reviewed by a person']].map(([id, title]) => {
            const m = metric(summary, id);
            return `<tr><th scope="row">${esc(title)}</th><td class="dl-num" data-label="Records">${num(m.numerator)}</td><td data-label="Definition">${esc(m.definition || '')}</td></tr>`;
        }).join('');
        return `
            <section class="dl-block" aria-labelledby="dl-evidence-h">
                <h4 id="dl-evidence-h">Evidence records</h4>
                <div class="dl-table-wrap"><table class="dl-table dl-evidence-summary">
                    <caption>Counted by evidence record, of ${num(records)}. One submission or family can hold several records, and one study can stand in several.</caption>
                    <thead><tr><th scope="col">Kind</th><th scope="col" class="dl-num">Records</th><th scope="col">Definition</th></tr></thead>
                    <tbody>${rows}</tbody></table></div>
            </section>`;
    }

    function controlsHTML(state, run) {
        const option = (value, text, current) => `<option value="${esc(value)}"${value === current ? ' selected' : ''}>${esc(text)}</option>`;
        const units = { submissions: 'Submissions', families: 'Candidate families' };
        return `
            <div class="dl-controls">
                <div class="dl-control"><span class="dl-control-label" id="dl-unit-label">List by</span>
                    <div class="geography-view-toggle dl-toggle" role="group" aria-labelledby="dl-unit-label">
                        ${Object.entries(units).map(([k, t]) => `<button type="button" class="view-btn${k === state.unit ? ' active' : ''}" data-dl-unit="${k}" aria-pressed="${k === state.unit}">${t}</button>`).join('')}
                    </div></div>
                <div class="dl-control"><label class="dl-control-label" for="dl-coverage">Coverage state</label>
                    <select id="dl-coverage">${option('', 'All states', state.coverage)}${run.vocabularies.coverage_states.map(s => option(s, COVERAGE_LABELS[s], state.coverage)).join('')}</select></div>
                <div class="dl-control"><label class="dl-control-label" for="dl-pathway">Pathway</label>
                    <select id="dl-pathway">${option('', 'All pathways', state.pathway)}${run.vocabularies.pathways.map(p => option(p, label(PATHWAY_LABELS, p), state.pathway)).join('')}</select></div>
                <div class="dl-control dl-control-search"><label class="dl-control-label" for="dl-search">Find</label>
                    <input type="search" id="dl-search" value="${esc(state.query)}" placeholder="Submission number, device or organisation" autocomplete="off"></div>
            </div>`;
    }

    // The kinds a list shows a column for: every kind but "other", which is shown only when the
    // file holds such a record somewhere (a look at which columns are needed, not a count).
    function shownKinds(file, items) {
        const other = file.evidence_kinds.indexOf('other');
        const hasOther = other >= 0 && items.some(x => x.evidence_counts[other] > 0);
        return file.evidence_kinds.map((k, i) => ({ kind: k, index: i })).filter(k => k.kind !== 'other' || hasOther);
    }

    function pagerHTML(total, page, what) {
        const pages = Math.max(1, Math.ceil(total / PAGE));
        const from = total ? page * PAGE + 1 : 0, to = Math.min(total, (page + 1) * PAGE);
        return `
            <div class="dl-pager">
                <span class="dl-pager-count" role="status">${total ? `Rows ${num(from)}–${num(to)} of ${num(total)} ${esc(what)} in this list` : `No ${esc(what)} in this list`}</span>
                ${pages > 1 ? `<button type="button" class="page-btn" data-dl-page="${page - 1}"${page === 0 ? ' disabled' : ''}>Previous</button>
                <span class="dl-pager-page">Page ${num(page + 1)} of ${num(pages)}</span>
                <button type="button" class="page-btn" data-dl-page="${page + 1}"${page >= pages - 1 ? ' disabled' : ''}>Next</button>` : ''}
            </div>`;
    }

    function listHTML(data, state, drafts) {
        const file = data.submissions;
        const families = data.families.families;
        const submissionMode = state.unit !== 'families';
        const items = submissionMode ? filterSubmissions(file.submissions, state) : filterFamilies(families, file.submissions, state);
        const kinds = shownKinds(submissionMode ? file : data.families, submissionMode ? file.submissions : Object.values(families));
        const defs = data.run.evidence_kinds;
        const pages = Math.max(1, Math.ceil(items.length / PAGE));
        const page = Math.min(Math.max(0, state.page), pages - 1);
        const shown = items.slice(page * PAGE, (page + 1) * PAGE);
        const kindHead = kinds.map(k => `<th scope="col" class="dl-num" title="${esc(defs[k.kind])}">${esc(KIND_SHORT[k.kind] || k.kind)}</th>`).join('');
        const kindCells = item => kinds.map(k => `<td class="dl-num" data-label="${esc(KIND_SHORT[k.kind] || k.kind)}">${num(item.evidence_counts[k.index])}</td>`).join('');
        const span = (submissionMode ? 7 : 4) + kinds.length;
        const isOpen = id => Boolean(state.open && state.open.unit === state.unit && state.open.id === id);
        const detailRow = (id, html, name) => `<tr class="dl-detail-row"><td colspan="${span}"><div class="dl-detail" id="dl-detail" role="region" tabindex="-1" aria-label="Evidence for ${esc(name)}">${html}</div></td></tr>`;
        let head, body, caption;
        if (submissionMode) {
            caption = 'One row per distinct FDA submission number, in the order of FDA\'s list. The evidence columns count evidence records on the submission and on its candidate family. A family-level record is counted on every member of the family, so these columns do not add up across rows.';
            head = `<th scope="col">Submission</th><th scope="col">Device</th><th scope="col">Organisation</th><th scope="col">Decision date</th>
                <th scope="col">Pathway</th><th scope="col" class="dl-num">Family size</th><th scope="col">Coverage state</th>${kindHead}`;
            body = shown.map(s => {
                const open = isOpen(s.submission_number);
                return `<tr class="dl-row${open ? ' dl-open' : ''}">
                    <th scope="row" data-label="Submission"><button type="button" class="dl-open-btn" data-dl-open="${esc(s.submission_number)}" aria-expanded="${open}"${open ? ' aria-controls="dl-detail"' : ''}>${esc(s.submission_number)}</button></th>
                    <td data-label="Device">${esc(s.device_name)}</td>
                    <td data-label="Organisation">${esc(s.organization_name)}</td>
                    <td data-label="Decision date">${esc(fmtDate(s.decision_date))}</td>
                    <td data-label="Pathway">${esc(label(PATHWAY_LABELS, s.pathway))}</td>
                    <td class="dl-num" data-label="Family size">${num(s.family_n_submissions)}</td>
                    <td data-label="Coverage state">${esc(COVERAGE_LABELS[s.coverage_overall])}</td>
                    ${kindCells(s)}
                </tr>${open ? detailRow(s.submission_number, submissionDetailHTML(s, data, state, drafts), s.submission_number) : ''}`;
            }).join('');
        } else {
            caption = 'One row per family. A candidate family groups submissions of one organisation whose listed names share the same whole core name; none is a curated product unless marked. The evidence columns count each record of the family and of its member submissions once.';
            head = `<th scope="col">Family</th><th scope="col">Organisation</th><th scope="col">Member submissions</th><th scope="col">Decision dates</th>${kindHead}`;
            body = shown.map(f => {
                const open = isOpen(f.family_id);
                const members = f.submission_numbers;
                const dates = f.decision_dates || {};
                return `<tr class="dl-row${open ? ' dl-open' : ''}">
                    <th scope="row" data-label="Family"><button type="button" class="dl-open-btn" data-dl-open="${esc(f.family_id)}" aria-expanded="${open}"${open ? ' aria-controls="dl-detail"' : ''}>${esc(f.family_name)}</button>
                        <span class="dl-sub">${f.status === 'curated' ? 'curated' : 'candidate'}</span></th>
                    <td data-label="Organisation">${esc((f.organization_names || []).join('; '))}</td>
                    <td data-label="Member submissions">${num(members.length)}: ${esc(members.slice(0, 6).join(', '))}${members.length > 6 ? `, and ${num(members.length - 6)} more` : ''}</td>
                    <td data-label="Decision dates">${esc(dates.first === dates.last ? fmtDate(dates.first) : `${fmtDate(dates.first)} to ${fmtDate(dates.last)}`)}</td>
                    ${kindCells(f)}
                </tr>${open ? detailRow(f.family_id, familyDetailHTML(f, data, state, drafts), f.family_name) : ''}`;
            }).join('');
        }
        const what = submissionMode ? 'submissions' : 'families';
        if (!items.length) return `<p class="note dl-empty">No ${what} match these filters.</p>${pagerHTML(0, 0, what)}`;
        return `
            <div class="dl-table-wrap"><table class="dl-table dl-list">
                <caption>${esc(caption)}</caption>
                <thead><tr>${head}</tr></thead>
                <tbody>${body}</tbody></table></div>
            ${pagerHTML(items.length, page, what)}`;
    }

    // ---------------------------------------------------------------- one record

    const studyURL = nct => 'https://clinicaltrials.gov/study/' + encodeURIComponent(nct);
    // Only FDA's own document addresses become links; anything else is shown as text.
    const fdaLink = (url, text) => (/^https:\/\/www\.accessdata\.fda\.gov\/[^?#\s"]*$/.test(String(url || ''))
        ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(text)}</a>` : esc(text));

    function reviewHTML(rec, ctx) {
        const id = rec.link_id;
        const n = ctx.index;
        const draft = ctx.drafts.get(id);
        const working = ctx.state.working[id] || draft || {};
        const message = ctx.state.messages[id];
        const decisions = decisionsOf(ctx.run);
        const published = rec.human_review === 'unreviewed'
            ? esc(label(REVIEW_LABELS, rec.human_review))
            : `${esc(label(REVIEW_LABELS, rec.human_review))}${rec.reviewed_relationship ? ' · ' + esc(label(RELATIONSHIP_LABELS, rec.reviewed_relationship)) : ''} · reviewed ${esc(fmtDate(rec.review.reviewed_on))}. Note: ${esc(rec.review.note)}`;
        const draftLine = draft ? `<p class="dl-draft"><strong>Draft review, not yet recorded</strong>: ${esc(label(REVIEW_LABELS, draft.human_review))}${draft.reviewed_relationship ? ' · ' + esc(label(RELATIONSHIP_LABELS, draft.reviewed_relationship)) : ''} · dated ${esc(draft.reviewed_on)}. Note: ${esc(draft.note)}</p>` : '';
        const open = ctx.state.toggles['review:' + id] || Boolean(ctx.state.working[id]) || Boolean(message);
        return `
            <div class="dl-review">
                <p class="dl-published"><span class="dl-k">Human review (published)</span> ${published}</p>
                ${draftLine}
                <details class="dl-review-form"${open ? ' open' : ''}>
                    <summary data-dl-toggle="review:${esc(id)}">${draft ? 'Change the draft review' : 'Draft a review of this record'}</summary>
                    <fieldset>
                        <legend>Decision</legend>
                        ${decisions.map(d => `<label class="dl-radio"><input type="radio" name="dl-decision-${n}" value="${esc(d)}" data-dl-decision="${esc(id)}"${working.human_review === d ? ' checked' : ''}> ${esc(label(REVIEW_LABELS, d))}</label>`).join('')}
                    </fieldset>
                    <label class="dl-control-label" for="dl-rel-${n}">Reviewed relationship (required when accepted)</label>
                    <select id="dl-rel-${n}" data-dl-relationship="${esc(id)}">
                        <option value="">No relationship stated</option>
                        ${ctx.run.vocabularies.reviewed_relationships.map(r => `<option value="${esc(r)}"${working.reviewed_relationship === r ? ' selected' : ''}>${esc(label(RELATIONSHIP_LABELS, r))}</option>`).join('')}
                    </select>
                    <label class="dl-control-label" for="dl-note-${n}">Note (required): the reason for the decision</label>
                    <textarea id="dl-note-${n}" rows="2" data-dl-note="${esc(id)}">${esc(working.note || '')}</textarea>
                    <div class="dl-review-actions">
                        <button type="button" class="dl-btn" data-dl-save="${esc(id)}">Save draft</button>
                        ${draft ? `<button type="button" class="dl-btn" data-dl-remove="${esc(id)}">Remove draft</button>` : ''}
                        <span class="dl-review-msg" role="status">${esc(message || '')}</span>
                    </div>
                    <p class="note">A draft is held in this browser. It does not change the published status above or any count.${rec.human_review !== 'unreviewed' ? ' This record already has a row in ' + REVIEW_FILE + '; the file holds one row per record, so a new row replaces the old one.' : ''}</p>
                </details>
            </div>`;
    }

    // One evidence record, every field. ctx: { run, state, drafts, docs (by document id),
    // index (unique within the open detail), viewing: { unit, id } }.
    function recordHTML(rec, file, ctx) {
        const x = expandRecord(rec, file);
        const ev = x.evidence, loc = ev.location || {}, sv = x.source_version, t = x.timing, study = x.study || {};
        const familyLevel = x.level === 'family';
        const doc = ev.source_kind === 'fda_document' ? (ctx.docs || {})[ev.source_id] : null;
        const where = ev.source_kind === 'fda_document'
            ? `Page ${num(loc.page)} of the ${esc(label(DOCUMENT_LABELS, ev.document_type))}${doc ? ' (' + fdaLink(doc.url, 'open the document at FDA') + ')' : ''}${(ev.other_pages || []).length ? `; the same number also stands on page ${esc(ev.other_pages.join(', '))}` : ''}`
            : `Registry field <code>${esc(loc.registry_field)}</code> of ${esc(ev.source_id)}`;
        const org = ev.organisation
            ? `<dt>Organisation</dt><dd>Listed manufacturer “${esc(ev.organisation.listed_name)}” and the study's ${esc(String(ev.organisation.role || '').replace(/_/g, ' '))} “${esc(ev.organisation.registry_name)}” (${esc(String(ev.organisation.tier || '').replace(/_/g, ' '))}). Agreement is evidence, not a requirement.</dd>` : '';
        const version = [
            sv.document_sha256 ? `document sha256 <code title="${esc(sv.document_sha256)}">${esc(String(sv.document_sha256).slice(0, 12))}</code>` : '',
            sv.retrieved_at ? `retrieved ${esc(fmtDate(sv.retrieved_at))}` : '',
            sv.source_last_modified ? `FDA's last-modified date ${esc(sv.source_last_modified)}` : '',
            sv.extraction_version ? `text extraction ${esc(sv.extraction_version)}` : '',
            sv.registry_data_timestamp ? `registry data of ${esc(fmtDate(sv.registry_data_timestamp))}${sv.registry_api_version ? ' (API ' + esc(sv.registry_api_version) + ')' : ''}` : '',
            sv.registry_retrieved_at ? `registry record retrieved ${esc(fmtDate(sv.registry_retrieved_at))}` : '',
            sv.unavailable ? esc(sv.unavailable) : '',
        ].filter(Boolean).join(' · ');
        const reasons = list => `<ul class="dl-reasons">${list.map(r => `<li>${esc(r)}</li>`).join('')}</ul>`;
        const timingRows = t.by_submission.map(row => `<li>${esc(row.submission_number)}: FDA decision ${esc(fmtDate(row.fda_decision_date))} — ${esc(label(TIMING_LABELS, row.relation))}</li>`).join('');
        const viewingSubmission = ctx.viewing && ctx.viewing.unit === 'submissions';
        const mark = familyLevel
            ? `<p class="dl-level dl-level-family">${viewingSubmission ? esc(FAMILY_MARK) : 'family-level candidate — not specific to any one submission of the family'}${x.source.entity_type === 'submission' ? ' (the evidence belongs to the original submission, not to this supplement)' : ''}</p>`
            : `<p class="dl-level dl-level-submission">submission-level record for ${esc(x.source.id)}</p>`;
        return `
            <article class="dl-record${familyLevel ? ' dl-record-family' : ''}" aria-label="Evidence record, ${esc(x.target.id)}">
                ${mark}
                <h6 class="dl-record-title"><a href="${esc(studyURL(x.target.id))}" target="_blank" rel="noopener">${esc(x.target.id)}</a> ${study.brief_title ? esc(study.brief_title) : '<span class="dl-absent">no title held for this study</span>'}</h6>
                <blockquote class="dl-quote">${esc(ev.quote)}</blockquote>
                <dl class="dl-fields">
                    <dt>Where it stands</dt><dd>${where}${ev.matched_text ? `. Matched text: “${esc(ev.matched_text)}”` : ''}</dd>
                    <dt>Relationship (proposed)</dt><dd>${esc(label(RELATIONSHIP_LABELS, x.proposed_relationship))}</dd>
                    <dt>Method</dt><dd>${esc(label(METHOD_LABELS, x.method))}</dd>
                    ${org}
                    <dt>Source version</dt><dd>${version || 'not recorded'}</dd>
                    <dt>Confidence</dt><dd>${esc(label(CONFIDENCE_LABELS, x.confidence))}${reasons(x.confidence_reasons)}</dd>
                    <dt>Automated validation</dt><dd>${esc(label(VALIDATION_LABELS, x.automated_validation))}${reasons(x.validation_reasons)}</dd>
                    <dt>Study</dt><dd>${study.brief_title ? esc(study.brief_title) : 'title not held'} · lead sponsor ${study.lead_sponsor ? esc(study.lead_sponsor) : 'not held'} · registry status ${study.overall_status ? esc(String(study.overall_status).replace(/_/g, ' ').toLowerCase()) : 'not held'}${study.registry_state && study.registry_state !== 'resolves' ? ` · registry lookup: ${esc(String(study.registry_state).replace(/_/g, ' '))}` : ''} · <a href="${esc(studyURL(x.target.id))}" target="_blank" rel="noopener">clinicaltrials.gov/study/${esc(x.target.id)}</a></dd>
                    <dt>Timing (descriptive only)</dt><dd>Study start ${esc(fmtDate(t.study_start_date))} · primary completion ${esc(fmtDate(t.study_primary_completion_date))} · completion ${esc(fmtDate(t.study_completion_date))} · first posted ${esc(fmtDate(t.study_first_posted_date))}
                        <ul class="dl-reasons">${timingRows}</ul></dd>
                </dl>
                ${reviewHTML(rec, ctx)}
            </article>`;
    }

    // ---------------------------------------------------------------- the detail views

    const closeBtn = '<button type="button" class="dl-btn dl-close" data-dl-close="1">Close</button>';

    function documentsHTML(docs) {
        if (!docs || !docs.length) return '<p class="note">No document address was tried for this submission.</p>';
        const rows = docs.map(d => {
            const held = d.availability === 'retrieved';
            const name = String(d.url || '').split('/').pop() || d.document_id;
            const notes = [
                d.category === 'granting_letter' ? 'Kept as regulatory evidence; not treated as a decision summary or a demographic summary.' : '',
                d.scope === 'parent_submission' ? 'A document of the original submission, not of this supplement.' : '',
                held ? (d.demographic_summary_candidate ? 'Demographic-summary candidate: ' : 'Not a demographic-summary candidate: ') + (d.demographic_summary_reason || 'no reason recorded') : '',
            ].filter(Boolean).map(esc).join(' ');
            return `<tr>
                <th scope="row" data-label="Type">${held ? esc(label(DOCUMENT_LABELS, d.document_type)) : 'Not retrieved'}${d.official_label ? `<span class="dl-sub">FDA's label: ${esc(d.official_label)}</span>` : ''}</th>
                <td data-label="File">${fdaLink(d.url, name)}</td>
                <td data-label="sha256">${held ? `<code title="${esc(d.sha256)}">${esc(String(d.sha256).slice(0, 12))}</code>` : `not held (${esc(String(d.availability).replace(/_/g, ' '))})`}</td>
                <td data-label="Retrieved">${held ? esc(fmtDate(d.retrieved_at)) : '—'}</td>
                <td data-label="Text">${held ? esc(label(TEXT_LABELS, d.text_status)) + (typeof d.n_pages === 'number' ? `<span class="dl-sub">${num(d.n_pages_with_text)} of ${num(d.n_pages)} pages with text</span>` : '') : '—'}</td>
                <td data-label="Notes">${notes || '—'}</td>
            </tr>`;
        }).join('');
        return `<div class="dl-table-wrap"><table class="dl-table dl-documents">
            <thead><tr><th scope="col">Type</th><th scope="col">File at FDA</th><th scope="col">sha256</th><th scope="col">Retrieved</th><th scope="col">Text</th><th scope="col">Notes</th></tr></thead>
            <tbody>${rows}</tbody></table></div>`;
    }

    function recordsBlock(records, file, ctx, emptyText) {
        if (!records.length) return `<p class="note">${esc(emptyText)}</p>`;
        return records.map(rec => recordHTML(rec, file, { ...ctx, index: ctx.counter.n++ })).join('');
    }

    // The evidence part of a detail view: the records of the given sources, then the set-aside
    // records on request. `sources` is [{ id, heading, empty }].
    function evidenceHTML(sources, nSetAside, data, state, drafts, viewing) {
        const d = state.detail;
        if (state.detailError) return `<p class="note" role="alert">Could not load the evidence records (${esc(state.detailError)}).</p>`;
        if (!d) return '<p class="note" role="status">Loading the evidence records and documents…</p>';
        const ctx = { run: data.run, state, drafts, docs: d.docsById, counter: { n: 0 }, viewing };
        const blocks = sources.map(s => `
            <h6 class="dl-sub-h">${esc(s.heading)}</h6>
            ${recordsBlock(d.bySource[s.id] || [], d.evidence, ctx, s.empty)}`).join('');
        let aside;
        if (!nSetAside) aside = '<p class="note">No record was set aside by rule here.</p>';
        else if (state.setAsideError) aside = `<p class="note" role="alert">Could not load the set-aside records (${esc(state.setAsideError)}).</p>`;
        else if (state.setAside && state.showSetAside) {
            const records = sources.flatMap(s => state.setAside.bySource[s.id] || []);
            aside = `<div class="dl-setaside" id="dl-setaside" tabindex="-1">
                <p class="note">These records were kept so that the search hits stay visible. Each failed a stated rule and none is a candidate. A reviewer can still record a decision on one.</p>
                ${recordsBlock(records, state.setAside.file, ctx, 'The set-aside file holds no record for this entry.')}</div>`;
        } else {
            aside = `<button type="button" class="dl-btn" data-dl-setaside="1"${state.setAsideLoading ? ' disabled' : ''}>${state.setAsideLoading ? 'Loading…' : `Show the ${num(nSetAside)} ${nSetAside === 1 ? 'record' : 'records'}`}</button>`;
        }
        return `${blocks}
            <h6 class="dl-sub-h">${esc(SET_ASIDE_LABEL)}</h6>
            ${aside}`;
    }

    function membersHTML(fam, data) {
        const byNumber = new Map(data.submissions.submissions.map(s => [s.submission_number, s]));
        return `<ul class="dl-members">${fam.submission_numbers.map(n => {
            const m = byNumber.get(n);
            return `<li><span class="dl-mono">${esc(n)}</span>${m ? ` · ${esc(m.device_name)} · decision ${esc(fmtDate(m.decision_date))} · ${esc(COVERAGE_LABELS[m.coverage_overall])}` : ''}</li>`;
        }).join('')}</ul>`;
    }
    const cannotTellApart = n => `Name evidence cannot tell these ${num(n)} submissions apart. A study that names the device is a candidate for the family and is not evidence about any one of them.`;
    const familyStatus = fam => (fam.status === 'curated' ? 'Curated family' : 'Candidate family') + ` (${esc(label(GROUPING_LABELS, fam.grouping_reason))})`;

    function submissionDetailHTML(s, data, state, drafts) {
        const file = data.submissions;
        const fam = data.families.families[s.family_id];
        const counts = countsOf(s, file);
        const list = a => (a || []).map(v => `“${esc(v)}”`).join(', ');
        const conflicts = Object.entries(s.conflicts || {}).map(([field, values]) => `<li>${esc(field)}: ${list(values)}</li>`).join('');
        const differs = Object.entries(s.official_differs_from_list || {});
        const official = !s.official_record_available
            ? '<p class="note">No official FDA record was retrieved for this number, so the list was not compared with one.</p>'
            : differs.length
                ? `<ul class="dl-reasons">${differs.map(([field, d]) => `<li>${esc(field.replace(/_/g, ' '))}: the list has ${Array.isArray(d.listed) ? list(d.listed) : `“${esc(d.listed)}”`}; FDA's record has “${esc(d.official)}”</li>`).join('')}</ul><p class="note">Both values are kept. Neither is chosen over the other.</p>`
                : '<p class="note">No difference is recorded between the list and FDA\'s official record in the four fields compared: decision date, product code, applicant and device name.</p>';
        const coverage = coverageOf(s, file).map(c => `<tr>
                <th scope="row" data-label="Route">${esc(data.run.coverage_routes[c.route])}</th>
                <td data-label="State">${esc(COVERAGE_LABELS[c.state])}</td>
                <td data-label="Reason">${esc(c.reason)}</td></tr>`).join('');
        const docs = state.detail ? state.detail.documents.documents[s.submission_number] : null;
        const sources = [{ id: s.submission_number, heading: 'Records for this submission', empty: 'No evidence record names this submission.' },
            { id: s.family_id, heading: 'Records for its candidate family', empty: 'No evidence record names this family.' }];
        return `
            <div class="dl-detail-head">
                <h5><span class="dl-mono">${esc(s.submission_number)}</span> ${esc(s.device_name)}</h5>
                ${closeBtn}
            </div>
            <p class="note">${esc(label(PATHWAY_LABELS, s.pathway))} · decision ${esc(fmtDate(s.decision_date))} · ${esc(s.organization_name)} · panel ${esc(s.panel || 'not listed')} · product code ${esc(s.product_code || 'not listed')}</p>

            <h6 class="dl-sub-h">Rows on FDA's list</h6>
            <p class="note">${num(s.n_source_rows)} ${s.n_source_rows === 1 ? 'row' : 'rows'} (list ${s.n_source_rows === 1 ? 'row' : 'rows'} ${esc((s.source_row_numbers || []).join(', '))})${s.duplicate_class ? ': ' + esc(label(DUPLICATE_LABELS, s.duplicate_class)) : ''}. Company as listed: ${list(s.companies_as_listed)}. Device as listed: ${list(s.device_names_as_listed)}. Decision date as listed: ${list(s.decision_date_as_listed)}.</p>
            ${conflicts ? `<p class="note">Values that differ between the rows:</p><ul class="dl-reasons">${conflicts}</ul>` : ''}

            <h6 class="dl-sub-h">Official record and the list</h6>
            ${official}

            <h6 class="dl-sub-h">Family</h6>
            <p class="note">${familyStatus(fam)}: “${esc(fam.family_name)}”, ${num(fam.submission_numbers.length)} ${fam.submission_numbers.length === 1 ? 'submission' : 'submissions'}.
                ${fam.submission_numbers.length > 1 ? `<strong>${esc(cannotTellApart(fam.submission_numbers.length))}</strong>` : 'This submission is the only member of the family. A name match is still a family-level candidate: it rests on the listed name, not on an identifier in a document of the submission.'}</p>
            ${fam.submission_numbers.length > 1 ? membersHTML(fam, data) : ''}

            <h6 class="dl-sub-h">Documents</h6>
            ${state.detail ? documentsHTML(docs) : state.detailError ? '<p class="note">The documents could not be loaded.</p>' : '<p class="note" role="status">Loading…</p>'}

            <h6 class="dl-sub-h">Coverage, route by route</h6>
            <p class="note">Overall: <strong>${esc(COVERAGE_LABELS[s.coverage_overall])}</strong>${(s.coverage_overall_routes || []).length ? `, from ${esc(s.coverage_overall_routes.map(r => data.run.coverage_routes[r] || r).join('; '))}` : ''}.</p>
            <div class="dl-table-wrap"><table class="dl-table dl-routes">
                <thead><tr><th scope="col">Route</th><th scope="col">State</th><th scope="col">Reason</th></tr></thead>
                <tbody>${coverage}</tbody></table></div>

            <h5 class="dl-evidence-h">Evidence records</h5>
            ${evidenceHTML(sources, counts.set_aside_by_rule, data, state, drafts, { unit: 'submissions', id: s.submission_number })}`;
    }

    function familyDetailHTML(fam, data, state, drafts) {
        const counts = countsOf(fam, data.families);
        const n = fam.submission_numbers.length;
        const sources = [{ id: fam.family_id, heading: 'Records for the family', empty: 'No evidence record names this family.' }]
            .concat(fam.submission_numbers.map(sn => ({ id: sn, heading: `Records for member ${sn}`, empty: `No evidence record names ${sn}.` })));
        return `
            <div class="dl-detail-head">
                <h5>${esc(fam.family_name)}</h5>
                ${closeBtn}
            </div>
            <p class="note">${familyStatus(fam)} · ${esc((fam.organization_names || []).join('; '))}</p>
            <h6 class="dl-sub-h">Member submissions</h6>
            ${membersHTML(fam, data)}
            <p class="note"><strong>${n > 1 ? esc(cannotTellApart(n)) : 'The family has one submission. A name match is still a family-level candidate: it rests on the listed name, not on an identifier in a document of the submission.'}</strong> Documents and route-by-route coverage are listed on each submission.</p>
            <h5 class="dl-evidence-h">Evidence records</h5>
            ${evidenceHTML(sources, counts.set_aside_by_rule, data, state, drafts, { unit: 'families', id: fam.family_id })}`;
    }

    // ---------------------------------------------------------------- drafts, notes, methods

    function draftsHTML(state, run, drafts) {
        const all = drafts.all();
        const ids = Object.keys(all);
        const csv = reviewRowsCSV(all, run);
        const storage = drafts.persisted()
            ? 'Drafts are kept in this browser\'s storage until they are cleared.'
            : 'This browser does not allow storage here, so drafts last only until the page is closed or reloaded.';
        const exported = state.exportOpen ? `
                <div class="dl-export">
                    <p class="note"><strong>${esc(EXPORT_SENTENCE)}</strong></p>
                    <p class="note">${num(csv.n_rows)} ${csv.n_rows === 1 ? 'row' : 'rows'}, in the column order of ${REVIEW_FILE}. The first line is that file's header; leave it out when adding to a file that already has it.${csv.skipped.length ? ` ${num(csv.skipped.length)} incomplete ${csv.skipped.length === 1 ? 'draft is' : 'drafts are'} left out.` : ''}</p>
                    <label class="dl-control-label" for="dl-export-text">Review rows (CSV)</label>
                    <textarea id="dl-export-text" class="dl-export-text" rows="${Math.min(12, csv.n_rows + 2)}" readonly>${esc(csv.text)}</textarea>
                    <div class="dl-review-actions">
                        <button type="button" class="dl-btn" data-dl-copy="1">Copy</button>
                        <button type="button" class="dl-btn" data-dl-download="1">Download as a file</button>
                        <span class="dl-review-msg" role="status">${esc(state.exportMessage || '')}</span>
                    </div>
                </div>` : '';
        const clear = state.confirmClear
            ? `<span class="dl-confirm" role="group" aria-label="Clear drafts">Clear ${num(ids.length)} ${ids.length === 1 ? 'draft' : 'drafts'} from this browser?
                    <button type="button" class="dl-btn" data-dl-clear-yes="1">Clear them</button>
                    <button type="button" class="dl-btn" data-dl-clear-no="1">Keep them</button></span>`
            : `<button type="button" class="dl-btn" data-dl-clear="1"${ids.length ? '' : ' disabled'}>Clear drafts</button>`;
        return `
            <section class="dl-block dl-drafts" aria-labelledby="dl-drafts-h">
                <h4 id="dl-drafts-h" tabindex="-1">Draft reviews</h4>
                <p class="note">Open a row and use “Draft a review of this record” on an evidence record. ${esc(storage)} <span role="status">${ids.length ? `${num(ids.length)} ${ids.length === 1 ? 'draft review' : 'draft reviews'}, not yet recorded.` : 'No draft review in this browser.'}</span> Drafts are never added to the published review status or to any count on this page.</p>
                <div class="dl-review-actions">
                    <button type="button" class="dl-btn" data-dl-export="1" aria-expanded="${Boolean(state.exportOpen)}"${ids.length ? '' : ' disabled'}>Export review rows</button>
                    ${clear}
                </div>
                ${exported}
            </section>`;
    }

    function demographicHTML(run, summary) {
        const n = denominator(summary, 'demographic_extractions');
        const withValue = metric(summary, 'demographic_extractions_with_any_value').numerator;
        const malformed = metric(summary, 'demographic_extractions_malformed').numerator;
        const source = (run.sources || {}).demographic_extractions || {};
        return `
            <section class="dl-block" aria-labelledby="dl-demo-h">
                <h4 id="dl-demo-h">Demographic evidence from FDA documents</h4>
                <p class="note">${num(n)} demographic ${n === 1 ? 'extraction exists' : 'extractions exist'}${typeof source.n_documents === 'number' ? `, made on ${num(source.n_documents)} ${source.n_documents === 1 ? 'document' : 'documents'}` : ''}.
                    ${withValue === 0 ? 'None reports a demographic value' : `${num(withValue)} report at least one demographic value`}; ${num(malformed)} ${malformed === 1 ? 'is' : 'are'} malformed.
                    Each is attached to the document it read, with the population it describes unresolved. <strong>Counts from FDA filings are never added to registry counts</strong>: every extraction is marked as not addable.</p>
            </section>`;
    }

    function methodsHTML(run, summary, open) {
        const s = run.sources || {};
        const window_ = x => (x && x.first_fetched_at ? `${fmtDate(x.first_fetched_at)} to ${fmtDate(x.last_fetched_at)}` : 'window not recorded');
        const curatedCount = metric(summary, 'families_curated').numerator;
        const curated = Object.entries(run.curated || {}).map(([file, n]) => `${esc(file)}: ${num(n)} ${n === 1 ? 'row' : 'rows'}`).join(' · ');
        const defs = (title, map) => `<dl class="dl-fields">${Object.entries(map).map(([k, d]) => `<dt>${esc(title(k))}</dt><dd>${esc(d)}</dd>`).join('')}</dl>`;
        return `
            <details class="dl-methods"${open ? ' open' : ''}><summary data-dl-toggle="methods">Methods, provenance and limitations</summary>
                <h6 class="dl-sub-h">Sources of this build</h6>
                <ul class="dl-reasons">
                    <li>FDA's list: ${esc((s.inventory || {}).file || 'file not recorded')}, ${num((s.inventory || {}).n_rows)} rows${(s.inventory || {}).sha256 ? `, sha256 <code title="${esc(s.inventory.sha256)}">${esc(String(s.inventory.sha256).slice(0, 12))}</code>` : ''}.</li>
                    <li>FDA documents: ${num((s.fda_documents || {}).n_lines)} addresses tried, ${esc(window_(s.fda_documents))}. FDA database pages: ${num((s.fda_database_pages || {}).n_records)} answers, ${esc(window_(s.fda_database_pages))}. openFDA: ${num((s.openfda || {}).n_records)} answers, ${esc(window_(s.openfda))}.</li>
                    <li>Registry: ${esc((s.registry || {}).registry || 'not recorded')}, API ${esc((s.registry || {}).registry_api_version || 'not recorded')}, data timestamp ${esc((s.registry || {}).registry_data_timestamp || 'not recorded')}; ${num((s.registry || {}).n_records)} answers, ${esc(window_(s.registry))}.</li>
                    <li>Text extraction: ${esc((s.text_extraction || {}).extraction_version || 'not recorded')}; ${(s.text_extraction || {}).ocr === false ? 'text layer only, no OCR' : 'OCR setting not recorded'}.</li>
                    <li>Curated files applied: ${curated || 'not recorded'}. Human reviews applied: ${num((run.reviews || {}).n_applied)} of ${num((run.reviews || {}).n_rows)} rows.</li>
                </ul>
                <h6 class="dl-sub-h">Counting units</h6>
                ${defs(k => k.replace(/_/g, ' '), run.counting_units)}
                <h6 class="dl-sub-h">Evidence kinds in the list columns</h6>
                ${defs(k => KIND_SHORT[k] || k, Object.fromEntries(run.vocabularies.evidence_kinds.map(k => [k, run.evidence_kinds[k]])))}
                <h6 class="dl-sub-h">Limitations</h6>
                <ul class="dl-reasons">
                    <li>Text is read from the text layer of each PDF. No OCR is run, so a scanned page is not read and a study number on it is not found.</li>
                    <li>A name search can find only studies whose title or intervention carries the listed device name. A study that never names the device is not found, and a name shared with other products returns studies of those products.</li>
                    <li>${curatedCount === 0 ? 'Candidate families are grouped by rule and none is curated, so the number of families is not a number of products.' : 'Families not marked curated are grouped by rule and are not a count of products.'}</li>
                    <li>This is one retrieval, frozen. FDA and the registry can change what they serve; a later build is a different build with its own id.</li>
                    <li>The evidence columns of the list count a family-level record on every member submission. They describe a row and are not totals.</li>
                    <li>Tests, hash checks and a reproducible build show that the rules were applied as written. They do not show that a link is right. That is a person's review, recorded in ${REVIEW_FILE}.</li>
                </ul>
                <p class="note">Build ${esc(run.run_id)}${run.build_run_id ? ` (engine build ${esc(run.build_run_id)})` : ''} · built ${esc(fmtDate(run.generated_at))} · method ${esc(run.method_version || 'not recorded')} · engine commit ${esc(String((run.producer || {}).commit || 'not recorded').slice(0, 10))}. Built by hand; not refreshed weekly.</p>
            </details>`;
    }

    // ---------------------------------------------------------------- the live view

    const state = { data: null, unit: 'submissions', coverage: '', pathway: '', query: '', page: 0, open: null, opener: null,
                    detail: null, detailError: null, setAside: null, setAsideError: null, setAsideLoading: false, showSetAside: false,
                    working: {}, messages: {}, toggles: {}, exportOpen: false, exportMessage: '', confirmClear: false, request: 0 };
    let head = null;        // the promise of { run, summary, current }, shared with the unit cards
    let store = null;

    // run.json and summary.json, checked. This family is published by hand, so the page's
    // weekly cache key says nothing about it: the manifest is always read past the browser
    // cache, and any other file that names a different build is a cached copy of an earlier
    // one and is read once more past the cache. Rejects when the files are absent or fail the
    // contract; the caller decides what to show instead.
    function loadHead(fetchJSON) {
        if (!head) {
            head = (async () => {
                const run = await fetchJSON(BASE + 'run.json', true);
                const current = async name => {
                    const file = await fetchJSON(BASE + name);
                    return file && run && file.run_id !== run.run_id ? fetchJSON(BASE + name, true) : file;
                };
                const summary = await current('summary.json');
                const problem = dataProblem(run, summary, null);
                if (problem) throw new Error(problem);
                return { run, summary, current };
            })();
            head.catch(() => { head = null; });     // a failed load may be tried again
        }
        return head;
    }

    function indexBySource(file) {
        const by = {};
        for (const rec of file.records) (by[rec.source.id] = by[rec.source.id] || []).push(rec);
        return by;
    }

    function paneHTML(drafts) {
        const { run, summary } = state.data;
        return `
            ${headHTML(run, summary)}
            ${unitsHTML(run, summary)}
            ${coverageHTML(run, summary)}
            ${evidenceSummaryHTML(run, summary)}
            <section class="dl-block dl-browser" aria-labelledby="dl-browser-h">
                <h4 id="dl-browser-h">Submissions and families</h4>
                <p class="note">Filters choose which rows are listed. Open a row to read its source rows, documents, coverage and every evidence record in place; Escape closes it.</p>
                ${controlsHTML(state, run)}
                ${listHTML(state.data, state, drafts)}
            </section>
            ${draftsHTML(state, run, drafts)}
            ${demographicHTML(run, summary)}
            ${methodsHTML(run, summary, state.toggles.methods)}`;
    }

    // deps.fetchJSON(path, reload) -> parsed JSON, throwing 'HTTP <status>' on an HTTP error.
    // deps.storage (optional) stands in for localStorage; deps.today (optional) for the date.
    async function open(el, deps) {
        const fetchJSON = deps.fetchJSON;
        if (!store) {
            let storage = deps.storage;
            if (storage === undefined) { try { storage = root.localStorage; } catch (e) { storage = null; } }
            store = draftStore(storage || null);
        }
        const today = () => (deps.today ? deps.today() : localDate());
        if (!state.data) {
            el.innerHTML = '<p class="note" role="status">Loading the study links and evidence…</p>';
            let loaded;
            try {
                const h = await loadHead(fetchJSON);
                const [submissions, families] = await Promise.all([h.current('submissions.json'), h.current('families.json')]);
                loaded = { run: h.run, summary: h.summary, current: h.current, submissions, families };
            } catch (err) {
                const message = String((err && err.message) || err);
                el.innerHTML = /HTTP 404/.test(message)
                    ? '<div class="panel-hero"><h3>Study links and evidence</h3><p class="note">The study-link data is not available on this site.</p></div>'
                    : `<p class="note" role="alert">The study-link data could not be read: ${esc(message)}.</p>`;
                return;
            }
            const problem = dataProblem(loaded.run, loaded.summary, { submissions: loaded.submissions, families: loaded.families });
            if (problem) { el.innerHTML = `<p class="note" role="alert">The study-link data could not be read: ${esc(problem)}.</p>`; return; }
            state.data = loaded;
        }
        const data = state.data;

        // A draw replaces the pane's markup, and with it whichever control had focus. The
        // caller names the element that should hold focus afterwards, by selector.
        function draw(focus) {
            el.innerHTML = paneHTML(store);
            const target = focus && el.querySelector ? el.querySelector(focus) : null;
            if (target && target.focus) target.focus({ preventScroll: true });
            return target;
        }
        const openerSelector = () => (state.open ? `[data-dl-open="${attr(state.open.id)}"]` : null);

        async function ensureDetail() {
            if (state.detail || state.detailLoading) return;
            state.detailLoading = true; state.detailError = null;
            try {
                const [evidence, documents] = await Promise.all([data.current('evidence.json'), data.current('documents.json')]);
                const problem = dataProblem(data.run, data.summary, { evidence, documents });
                if (problem) throw new Error(problem);
                const docsById = {};
                for (const list of Object.values(documents.documents)) for (const d of list) docsById[d.document_id] = d;
                state.detail = { evidence, documents, docsById, bySource: indexBySource(evidence) };
            } catch (err) { state.detailError = String((err && err.message) || err); }
            state.detailLoading = false;
        }

        async function openRow(id) {
            const request = ++state.request;
            state.open = { unit: state.unit, id };
            state.showSetAside = false;
            draw('#dl-detail');
            if (!state.detail) {
                await ensureDetail();
                // The latest choice wins: a file that arrives after the row was closed, or
                // another opened, redraws nothing.
                if (request !== state.request || !state.open || state.open.id !== id) return;
                draw('#dl-detail');
            }
        }
        function closeRow() {
            const back = openerSelector();
            state.request++;
            state.open = null; state.showSetAside = false;
            draw(back);
        }

        async function showSetAside() {
            const request = state.request;
            if (!state.setAside) {
                state.setAsideLoading = true; state.setAsideError = null;
                draw('[data-dl-setaside]');
                try {
                    const file = await data.current('evidence_set_aside.json');
                    const problem = dataProblem(data.run, data.summary, { setAside: file });
                    if (problem) throw new Error(problem);
                    state.setAside = { file, bySource: indexBySource(file) };
                } catch (err) { state.setAsideError = String((err && err.message) || err); }
                state.setAsideLoading = false;
                if (request !== state.request) return;
            }
            state.showSetAside = true;
            draw('#dl-setaside');
        }

        function saveDraft(id) {
            const w = state.working[id] || store.get(id) || {};
            const draft = { human_review: w.human_review || '', reviewed_relationship: w.reviewed_relationship || '',
                            note: String(w.note || '').trim(), reviewed_on: today(), run_id: data.run.run_id };
            const problem = draftProblem(draft, data.run);
            if (problem) { state.messages[id] = problem; state.working[id] = w; draw(`[data-dl-save="${attr(id)}"]`); return; }
            store.set(id, draft);
            delete state.working[id];
            state.messages[id] = 'Draft saved in this browser. Not yet recorded.';
            state.toggles['review:' + id] = true;
            draw(`[data-dl-save="${attr(id)}"]`);
        }

        function download(text) {
            try {
                const url = root.URL.createObjectURL(new root.Blob([text], { type: 'text/csv' }));
                const a = root.document.createElement('a');
                a.href = url; a.download = `device-review-rows-${today()}.csv`;
                root.document.body.appendChild(a); a.click(); a.remove();
                root.URL.revokeObjectURL(url);
                return 'File saved by the browser.';
            } catch (e) { return 'This browser could not save a file. Copy the text instead.'; }
        }

        el.onclick = ev => {
            const b = ev.target && ev.target.closest ? ev.target.closest('button, summary') : null;
            if (!b || (el.contains && !el.contains(b))) return;
            const d = b.dataset || {};
            if (d.dlToggle) { state.toggles[d.dlToggle] = !(b.parentElement && b.parentElement.open); return; }   // the browser opens it; remember for the next draw
            if (d.dlUnit) { state.unit = d.dlUnit; state.page = 0; state.open = null; state.request++; draw(`[data-dl-unit="${attr(d.dlUnit)}"]`); return; }
            if (d.dlPage !== undefined) {
                // Focus stays on the direction pressed; at the first or last page, where that
                // button is disabled, it moves to the other one.
                const p = Math.max(0, parseInt(d.dlPage, 10) || 0);
                const dir = p >= state.page ? 1 : -1;
                state.page = p; state.open = null; state.request++;
                if (!draw(`[data-dl-page="${p + dir}"]:not([disabled])`)) {
                    const other = el.querySelector ? el.querySelector(`[data-dl-page="${p - dir}"]`) : null;
                    if (other && other.focus) other.focus({ preventScroll: true });
                }
                return;
            }
            if (d.dlOpen) { if (state.open && state.open.id === d.dlOpen && state.open.unit === state.unit) closeRow(); else openRow(d.dlOpen); return; }
            if (d.dlClose) { closeRow(); return; }
            if (d.dlSetaside) { showSetAside(); return; }
            if (d.dlSave) { saveDraft(d.dlSave); return; }
            if (d.dlRemove) { store.remove(d.dlRemove); delete state.working[d.dlRemove]; state.messages[d.dlRemove] = 'Draft removed.'; draw(`[data-dl-save="${attr(d.dlRemove)}"]`); return; }
            if (d.dlExport) { state.exportOpen = !state.exportOpen; state.exportMessage = ''; draw(state.exportOpen ? '#dl-export-text' : '[data-dl-export]'); return; }
            if (d.dlCopy) {
                const text = reviewRowsCSV(store.all(), data.run).text;
                const done = message => { state.exportMessage = message; draw('[data-dl-copy]'); };
                try { root.navigator.clipboard.writeText(text).then(() => done('Copied.'), () => done('This browser did not allow copying. Select the text and copy it.')); }
                catch (e) { done('This browser did not allow copying. Select the text and copy it.'); }
                return;
            }
            if (d.dlDownload) { state.exportMessage = download(reviewRowsCSV(store.all(), data.run).text); draw('[data-dl-download]'); return; }
            if (d.dlClear) { state.confirmClear = true; draw('[data-dl-clear-no]'); return; }
            if (d.dlClearNo) { state.confirmClear = false; draw('[data-dl-clear]'); return; }
            if (d.dlClearYes) { store.clear(); state.confirmClear = false; state.exportOpen = false; state.working = {}; state.messages = {}; draw('#dl-drafts-h'); }
        };
        el.onchange = ev => {
            const t = ev.target || {}; const d = t.dataset || {};
            if (t.id === 'dl-coverage' || t.id === 'dl-pathway') {
                state[t.id === 'dl-coverage' ? 'coverage' : 'pathway'] = t.value; state.page = 0; state.open = null; state.request++;
                draw('#' + t.id); return;
            }
            // Form values are kept as the reader sets them, so a redraw does not lose them.
            const base = id => state.working[id] || { ...(store.get(id) || {}) };
            if (d.dlDecision && t.checked !== false) { state.working[d.dlDecision] = { ...base(d.dlDecision), human_review: t.value }; return; }
            if (d.dlRelationship) { state.working[d.dlRelationship] = { ...base(d.dlRelationship), reviewed_relationship: t.value }; }
        };
        el.oninput = ev => {
            const t = ev.target || {}; const d = t.dataset || {};
            if (d.dlNote) { state.working[d.dlNote] = { ...(state.working[d.dlNote] || store.get(d.dlNote) || {}), note: t.value }; return; }
            if (t.id !== 'dl-search') return;
            state.query = t.value; state.page = 0; state.open = null; state.request++;
            const s = draw('#dl-search');
            if (s && s.setSelectionRange) s.setSelectionRange(s.value.length, s.value.length);
        };
        el.onkeydown = ev => { if (ev.key === 'Escape' && state.open) { if (ev.preventDefault) ev.preventDefault(); closeRow(); } };
        draw();
    }

    root.DeviceLinks = {
        open, loadHead, dataProblem, coverageOf, countsOf, expandRecord, filterSubmissions, filterFamilies,
        draftProblem, reviewRowsCSV, draftStore, localDate, fmtDate,
        unitCardsHTML, headHTML, unitsHTML, coverageHTML, evidenceSummaryHTML, controlsHTML, listHTML, recordHTML,
        submissionDetailHTML, familyDetailHTML, documentsHTML, draftsHTML, demographicHTML, methodsHTML,
        COVERAGE_LABELS, NEGATIVE_FINDING, REVIEW_COLUMNS, EXPORT_SENTENCE, SET_ASIDE_LABEL, FAMILY_MARK, STORAGE_KEY,
    };
})(typeof globalThis !== 'undefined' ? globalThis : this);

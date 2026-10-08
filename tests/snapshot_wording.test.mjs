/**
 * The site no longer keeps "bi-weekly" snapshots.
 *
 * It keeps the latest data plus three complete snapshots about two weeks
 * apart; older months are summary-only archives. The archive toast and the
 * FAQ said filters and the study table need "bi-weekly" data, which reads as
 * a schedule the site does not keep. They now say "the latest data and the
 * complete snapshots", the phrase the archive filter line
 * (ARCHIVE_FILTERS_NOTE) already uses.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const SKIP = new Set(['node_modules', 'data', 'snapshots', 'tests', 'scripts', '.git']);

// Every file the browser loads that carries text: pages, scripts, styles.
function servedTextFiles(dir) {
    const out = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (SKIP.has(entry.name)) continue;
        const path = join(dir, entry.name);
        if (entry.isDirectory()) out.push(...servedTextFiles(path));
        else if (/\.(html|js|jsx|css)$/.test(entry.name)) out.push(path);
    }
    return out;
}

test('no served page or script says bi-weekly', () => {
    const files = servedTextFiles(root);
    assert.ok(files.some(f => relative(root, f) === 'app.js'), 'app.js not scanned');
    assert.ok(files.some(f => relative(root, f) === 'index.html'), 'index.html not scanned');
    for (const file of files) {
        const text = readFileSync(file, 'utf8');
        const hit = text.match(/.{0,60}\bbi-?\s?weekly\b.{0,60}/i);
        assert.equal(hit, null, `${relative(root, file)} says bi-weekly: ${hit && hit[0]}`);
    }
});

test('the archive toast and the FAQ name the latest data and the complete snapshots', () => {
    const app = readFileSync(join(root, 'app.js'), 'utf8');
    const html = readFileSync(join(root, 'index.html'), 'utf8');
    const phrase = 'the latest data and the complete snapshots';
    assert.match(app, new RegExp(`const ARCHIVE_FILTERS_NOTE = '[^']*${phrase}`));
    assert.ok(app.includes(`Filters and the full study table are available on ${phrase}.`),
        'archive toast lost its wording');
    assert.ok(html.includes(`full study-level table are available only on ${phrase}.`),
        'FAQ retention note lost its wording');
});

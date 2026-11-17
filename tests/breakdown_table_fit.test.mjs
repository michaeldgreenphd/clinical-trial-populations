/**
 * The breakdown pop-ups' tables fit a phone (styles.css; issue #291).
 *
 * Two rules floor a breakdown table's first two columns at 150px, for the
 * category and its original label on a wide screen. Applied everywhere, they
 * pushed the phone's three-column table (category, count, percent) 48px past
 * a 369px pop-up, and the five-column desktop table up to 199px past it in a
 * narrowed window: the whole pop-up scrolled sideways, heading and Close
 * button included, with the Percent column cut at its edge.
 *
 * What is pinned: the floors apply only above 768px; on a small screen the
 * cells' side padding and the pop-up's own padding give way. The widths were
 * measured in a served browser (PR notes); this checks the stylesheet keeps
 * the rules that made them fit.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

// Each rule with the @media condition it sits in ('' at the top level).
function rules(text) {
    const out = [];
    const walk = (src, media) => {
        let i = 0;
        while (i < src.length) {
            const open = src.indexOf('{', i);
            if (open < 0) break;
            const head = src.slice(i, open).replace(/\/\*[\s\S]*?\*\//g, '').trim();
            let depth = 1, j = open + 1;
            while (j < src.length && depth) { if (src[j] === '{') depth++; else if (src[j] === '}') depth--; j++; }
            const body = src.slice(open + 1, j - 1);
            if (head.startsWith('@media')) walk(body, head);
            else out.push({ media, selectors: head.split(',').map(s => s.trim()), body });
            i = j;
        }
    };
    walk(text, '');
    return out;
}
const all = rules(css);

test('the 150px column floors apply only on a wide screen', () => {
    const floors = all.filter(r => /min-width:\s*150px/.test(r.body) && r.selectors.some(s => s.startsWith('.breakdown-table')));
    assert.equal(floors.length, 2, 'the two column floors are gone or doubled');
    for (const r of floors) {
        assert.equal(r.media, '@media (min-width: 769px)', `${r.selectors.join(', ')} floors a column at every width again`);
    }
});

test("on a small screen the cells' and the pop-up's padding give way", () => {
    const at = (media, selector) => all.find(r => r.media === media && r.selectors.includes(selector));
    const cells = at('@media (max-width: 480px)', '.breakdown-table td');
    assert.ok(cells && /padding:\s*0\.4rem 0\.25rem/.test(cells.body), 'the cells keep their wide-screen side padding on a phone');
    const box480 = at('@media (max-width: 480px)', '.breakdown-modal');
    assert.ok(box480 && /padding:\s*1rem/.test(box480.body));
    const box400 = at('@media (max-width: 400px)', '.breakdown-modal');
    assert.ok(box400 && /padding:\s*0\.75rem/.test(box400.body), 'the pop-up keeps 1rem padding below 400px, where the five-column table needs the room');
});

/**
 * The Studies tab's column menu stays on screen (app.js placeColumnPicker,
 * initColumnPicker; issue #290).
 *
 * The menu opened right-aligned with its "Add columns" button. Below about
 * 780px the table controls wrap and the button sits at the page's left edge,
 * so the menu opened 193px off the screen, its options untappable. The
 * placement code is app.js's own, run in a vm against stub boxes.
 *
 * What is pinned: the menu keeps its right-aligned place where that fits;
 * otherwise it moves in from the edge it would cross and keeps an 8px margin;
 * it is placed on each opening and on a resize while open, and a closed menu
 * is left alone; and the stylesheet keeps it no wider than the window.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

const fnSource = (sig) => {
    const at = app.indexOf(sig);
    assert.ok(at >= 0, `app.js lost ${sig}`);
    return app.slice(at, app.indexOf('\n}\n', at) + 3);
};
const lineSource = (start) => {
    const at = app.indexOf(start);
    assert.ok(at >= 0, `app.js lost ${start}`);
    return app.slice(at, app.indexOf('\n', at) + 1);
};

// The button's box (the <details>, as wide as its summary) at `left`..`right`
// in a window `view` wide; the menu `width` wide.
function place({ view, left, right, width, open = true }) {
    const picker = { open, getBoundingClientRect: () => ({ left, right }) };
    const menu = { style: { left: 'stale', right: 'stale' }, getBoundingClientRect: () => ({ width }) };
    const ctx = vm.createContext({
        document: {
            documentElement: { clientWidth: view },
            getElementById: (id) => (id === 'column-picker' ? picker : id === 'column-picker-menu' ? menu : null)
        }
    });
    vm.runInContext(lineSource('const COLUMN_PICKER_MARGIN') + fnSource('function placeColumnPicker()'), ctx);
    ctx.placeColumnPicker();
    // Where the menu's left edge lands in the window.
    const at = menu.style.left === 'stale' ? null : left + parseFloat(menu.style.left);
    return { menu, at };
}

test('on a wide window the menu keeps its place, right edges lined up with the button', () => {
    // 1280px: the button at 819..941, as measured in a served browser.
    const { menu, at } = place({ view: 1280, left: 819, right: 941, width: 330 });
    assert.equal(at, 941 - 330);
    assert.equal(menu.style.right, 'auto');
});

test('with the button at the left edge (a wrapped, narrow window) the menu moves in from that edge', () => {
    // 390px: the button at 16..137. Right-aligned, the menu started at -193.
    const { at } = place({ view: 390, left: 16, right: 137, width: 330 });
    assert.equal(at, 8, 'the menu still opens past the left edge of the window');
    assert.ok(at + 330 <= 390 - 8, 'the menu now runs off the right edge');
});

test('a menu that would cross the right edge moves in from it too', () => {
    // A button whose right edge is past where a full menu would end.
    const { at } = place({ view: 600, left: 560, right: 640, width: 330 });
    assert.equal(at, 600 - 8 - 330);
});

test('a closed menu is left alone', () => {
    const { menu } = place({ view: 390, left: 16, right: 137, width: 330, open: false });
    assert.equal(menu.style.left, 'stale');
});

test('the menu is placed on each opening and on a resize, and is never wider than the window', () => {
    const init = fnSource('function initColumnPicker()');
    assert.match(init, /picker\.addEventListener\('toggle', placeColumnPicker\)/, 'opening the menu does not place it');
    assert.match(init, /window\.addEventListener\('resize', placeColumnPicker\)/, 'a resize while open does not place it');
    const rule = css.match(/\.column-picker-menu \{[^}]*\}/)?.[0] || '';
    assert.match(rule, /max-width: calc\(100vw - 16px\);/, 'the menu can be wider than the window');
    assert.match(rule, /box-sizing: border-box;/, 'the max-width does not include the padding and border');
    assert.match(css, /@media \(max-width: 359px\) \{\s*\.column-picker-menu \{ grid-template-columns: 1fr; \}/,
        "the options' two columns do not fit the narrowest screens");
});

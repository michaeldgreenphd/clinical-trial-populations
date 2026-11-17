/**
 * The Studies tab's column menu stays on screen and closes on Escape (app.js
 * placeColumnPicker, columnPickerKeydown, initColumnPicker; issue #290).
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
 *
 * Escape closes the open menu, as it does the nav menus. Focus goes back to
 * the "Add columns" button when it was in the menu or nowhere, and stays put
 * when it was elsewhere on the page. An Escape a pop-up already handled does
 * not also close the menu.
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

// Escape on a page with the column menu `open` or not; focus on `focusAt`
// ('checkbox' inside the menu, 'body', or 'search' elsewhere on the page).
function pressKey({ key = 'Escape', open = true, focusAt = 'checkbox', prevented = false }) {
    const summary = { focused: 0, focus() { this.focused += 1; } };
    const checkbox = {};
    const search = {};
    const body = {};
    const picker = {
        open,
        querySelector: (sel) => (sel === 'summary' ? summary : null),
        contains: (el) => el === summary || el === checkbox
    };
    const active = { checkbox, body, search }[focusAt];
    const ctx = vm.createContext({
        document: {
            body,
            activeElement: active,
            getElementById: (id) => (id === 'column-picker' ? picker : null)
        }
    });
    vm.runInContext(fnSource('function columnPickerKeydown(e)'), ctx);
    const event = { key, defaultPrevented: prevented, prevents: 0, preventDefault() { this.prevents += 1; } };
    ctx.columnPickerKeydown(event);
    return { picker, summary, event };
}

test('Escape closes the open menu and puts focus back on its button', () => {
    for (const focusAt of ['checkbox', 'body']) {
        const { picker, summary, event } = pressKey({ focusAt });
        assert.equal(picker.open, false, `Escape with focus on ${focusAt} left the menu open`);
        assert.equal(summary.focused, 1, `focus on ${focusAt} did not go back to the button`);
        assert.equal(event.prevents, 1, 'the handled Escape was not marked handled');
    }
});

test('Escape leaves focus elsewhere on the page where it is', () => {
    const { picker, summary } = pressKey({ focusAt: 'search' });
    assert.equal(picker.open, false);
    assert.equal(summary.focused, 0, 'Escape pulled focus away from the search box');
});

test('a closed menu, another key, or an Escape a pop-up already handled is left alone', () => {
    const closed = pressKey({ open: false });
    assert.equal(closed.event.prevents, 0, 'an Escape with the menu closed was swallowed');
    assert.equal(closed.summary.focused, 0);
    const other = pressKey({ key: 'Enter' });
    assert.equal(other.picker.open, true, 'a key other than Escape closed the menu');
    const handled = pressKey({ prevented: true });
    assert.equal(handled.picker.open, true, 'one Escape closed both a pop-up and the menu');
    assert.equal(handled.summary.focused, 0);
});

// A nav menu and the column menu both open (reachable from the keyboard): one
// Escape closes one of them, the next the other. app.js's own initNavGroups
// and columnPickerKeydown share one stub document; both listener orders are
// run, so the result does not rest on which one startup wires first.
test('with a nav menu and the column menu both open, each Escape closes one', () => {
    for (const navFirst of [true, false]) {
        const navSummary = { focus() {} };
        const nav = {
            attrs: { open: '' },
            get open() { return 'open' in this.attrs; },
            removeAttribute(n) { delete this.attrs[n]; },
            addEventListener() {},
            querySelector: (sel) => (sel === 'summary' ? navSummary : null)
        };
        const colSummary = { focus() {} };
        const picker = { open: true, querySelector: (sel) => (sel === 'summary' ? colSummary : null), contains: () => false };
        const keydown = [];
        const body = {};
        const ctx = vm.createContext({
            document: {
                body,
                activeElement: body,
                querySelectorAll: (sel) => (sel === '.nav-group' ? [nav] : []),
                querySelector: (sel) => (sel === '.nav-group[open]' ? (nav.open ? nav : null) : null),
                getElementById: (id) => (id === 'column-picker' ? picker : null),
                addEventListener: (type, fn) => { if (type === 'keydown') keydown.push(fn); }
            }
        });
        vm.runInContext([fnSource('function closeNavGroups(except)'), fnSource('function initNavGroups()'),
            fnSource('function columnPickerKeydown(e)')].join('\n'), ctx);
        const wireNav = () => ctx.initNavGroups();
        const wirePicker = () => ctx.document.addEventListener('keydown', ctx.columnPickerKeydown);
        if (navFirst) { wireNav(); wirePicker(); } else { wirePicker(); wireNav(); }
        const press = () => {
            const e = { key: 'Escape', defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
            keydown.forEach((fn) => fn(e));
        };
        const order = navFirst ? 'nav listener first' : 'column listener first';
        press();
        assert.equal(nav.open !== picker.open, true, `${order}: the first Escape closed both menus (or neither)`);
        press();
        assert.equal(nav.open || picker.open, false, `${order}: the second Escape left a menu open`);
    }
});

test('the menu is placed on each opening and on a resize, and is never wider than the window', () => {
    const init = fnSource('function initColumnPicker()');
    assert.match(init, /picker\.addEventListener\('toggle', placeColumnPicker\)/, 'opening the menu does not place it');
    assert.match(init, /window\.addEventListener\('resize', placeColumnPicker\)/, 'a resize while open does not place it');
    assert.match(init, /document\.addEventListener\('keydown', columnPickerKeydown\)/, 'Escape is not wired to close the menu');
    const rule = css.match(/\.column-picker-menu \{[^}]*\}/)?.[0] || '';
    assert.match(rule, /max-width: calc\(100vw - 16px\);/, 'the menu can be wider than the window');
    assert.match(rule, /box-sizing: border-box;/, 'the max-width does not include the padding and border');
    assert.match(css, /@media \(max-width: 359px\) \{\s*\.column-picker-menu \{ grid-template-columns: 1fr; \}/,
        "the options' two columns do not fit the narrowest screens");
});

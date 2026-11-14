/**
 * The breakdown and study-details pop-ups are modal dialogs (app.js
 * drawOverlay, closeOverlay, overlayKeydown; index.html wires the keys on
 * each overlay).
 *
 * The functions are app.js's own, sliced out and evaluated in a vm with a
 * stub document: a small tree built from the markup written to an overlay's
 * innerHTML, enough of the DOM for focus (activeElement, focus, contains,
 * closest, querySelector(All) with simple selectors, tabIndex, disabled,
 * getClientRects, isConnected). Hidden elements have no client rects, and
 * replacing or hiding the markup that holds focus sends focus to the page, as
 * in a browser. It is not a browser: what is pinned is which element gets
 * focus, not how the focus ring looks.
 *
 * What is pinned: opening a pop-up moves focus to the dialog, which is named
 * by its heading; Tab and Shift+Tab go round the dialog's own controls and
 * never reach the page behind; Escape closes it; closing it (Escape, its Close
 * button, a click outside) puts focus back on what opened it, or on the same
 * control after the Studies table redrew; and a redraw in place keeps focus
 * where it was rather than moving it again.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

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

const SOURCES = [
    'let breakdownToken = 0; let studyModalToken = 0;',
    lineSource('const overlayOpeners = '),
    lineSource('let activatingControl = null;'),
    lineSource('const OPENER_SELECTOR = '),
    fnSource('function initOverlayOpeners()'),
    lineSource('const TAB_STOP_SELECTOR = '),
    fnSource('function drawOverlay(id, html, redraw)'),
    fnSource('function markDialog(overlay, id)'),
    fnSource('function openerOf(active)'),
    fnSource('function closeOverlay(id)'),
    fnSource('function onScreen(el)'),
    fnSource('function activeTabControl()'),
    fnSource('function overlayKeydown(event, close)'),
    fnSource('function isTabStop(el)'),
    fnSource('function nextTabStop(dialog, active, back)'),
    fnSource('function controlSignature(el)'),
    fnSource('function findSameControl(overlay, sig)'),
    fnSource('function studiesFocusKey(active, body, pager)'),
    fnSource('function findStudiesControl(key, body, pager)'),
    fnSource('function closeBreakdown()'),
    fnSource('function closeStudyDetails()')
].join('\n');

// ── A stub document built from markup ──

// The vm context each stub document runs in, kept off the document so a node
// never reaches it.
const contexts = new WeakMap();
const contextOf = (doc) => contexts.get(doc);

// Nodes are compared by identity. assert.equal would, on a failure, render a
// diff of two whole stub trees (cyclic, through parent), which runs the test
// process out of memory; this names the element instead.
function label(el) {
    if (!el || !el.tagName) return String(el);
    return `<${el.tagName.toLowerCase()}${el.attrs.id ? `#${el.attrs.id}` : ''}${el.attrs.class ? `.${el.attrs.class.split(' ')[0]}` : ''}>`;
}
function same(actual, expected, message = '') {
    if (actual !== expected) assert.fail(`${message ? `${message}: ` : ''}got ${label(actual)}, expected ${label(expected)}`);
}

const VOID = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'wbr', 'path']);
const NATIVE_STOPS = new Set(['button', 'input', 'select', 'textarea', 'summary']);

function makeDoc() {
    const doc = { activeElement: null, byId: {} };
    doc.getElementById = (id) => doc.byId[id] || null;

    function node(tag, attrs = {}) {
        const n = {
            tagName: tag.toUpperCase(), attrs: { ...attrs }, kids: [], parent: null, style: {}, scrollTop: 0,
            get id() { return n.attrs.id || ''; },
            set id(v) { n.attrs.id = String(v); },
            get children() { return n.kids.filter((k) => typeof k !== 'string'); },
            get firstElementChild() { return n.children[0] || null; },
            get textContent() { return n.kids.map((k) => (typeof k === 'string' ? k : k.textContent)).join(''); },
            get disabled() { return 'disabled' in n.attrs; },
            get open() { return 'open' in n.attrs; },
            get tabIndex() {
                if ('tabindex' in n.attrs) return Number(n.attrs.tabindex);
                if (NATIVE_STOPS.has(tag) || (tag === 'a' && 'href' in n.attrs)) return 0;
                return -1;
            },
            get isConnected() { for (let p = n; p; p = p.parent) if (p === doc.body) return true; return false; },
            get classList() {
                const list = (n.attrs.class || '').split(/\s+/).filter(Boolean);
                const set = (v) => { n.attrs.class = v.join(' '); };
                return Object.assign(list, {
                    contains: (c) => list.includes(c),
                    add: (c) => { if (!list.includes(c)) set([...list, c]); },
                    remove: (c) => set(list.filter((x) => x !== c)),
                    toggle: (c, on) => { const want = on === undefined ? !list.includes(c) : on; set(want ? [...new Set([...list, c])] : list.filter((x) => x !== c)); }
                });
            },
            get innerHTML() { return n.markup || ''; },
            set innerHTML(value) {
                const lost = doc.activeElement !== n && n.contains(doc.activeElement);
                n.kids.forEach((k) => { if (typeof k !== 'string') k.parent = null; });
                n.kids = [];
                n.markup = String(value);
                parseInto(n, n.markup);
                if (lost) doc.activeElement = doc.body;
            },
            getAttribute: (k) => (k in n.attrs ? n.attrs[k] : null),
            setAttribute: (k, v) => { n.attrs[k] = String(v); },
            append(...kids) { for (const k of kids) { k.parent = n; n.kids.push(k); } return n; },
            contains: (x) => { for (let p = x; p; p = p.parent) if (p === n) return true; return false; },
            closest(sel) { for (let p = n; p; p = p.parent) if (matches(p, sel)) return p; return null; },
            querySelectorAll(sel) {
                const out = [];
                const walk = (x) => x.children.forEach((c) => { if (matches(c, sel)) out.push(c); walk(c); });
                walk(n);
                return out;
            },
            querySelector: (sel) => n.querySelectorAll(sel)[0] || null,
            // Laid out unless it, or a box it is in, is hidden or display: none.
            getClientRects() {
                for (let p = n; p; p = p.parent) {
                    if ('hidden' in p.attrs || p.style.display === 'none' || /display:\s*none/.test(p.attrs.style || '')) return [];
                }
                return [{}];
            },
            focus() { doc.activeElement = n; },
            // What a click on the element would run: the inline onclick
            // handler, as the browser runs it (with event and this).
            click(target = n) {
                const code = n.attrs.onclick;
                if (code) vm.runInContext(`(function (event) { ${code} })`, contextOf(doc)).call(n, { target });
            }
        };
        return n;
    }

    // Tags, quoted attributes and text: what app.js's pop-up markup uses.
    function parseInto(root, markup) {
        const tokens = /<!--[\s\S]*?-->|<\/([a-z0-9]+)\s*>|<([a-z0-9]+)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'))?)*)\s*(\/?)>|([^<]+)/gi;
        const stack = [root];
        for (let m; (m = tokens.exec(markup));) {
            const top = stack[stack.length - 1];
            if (m[1]) { if (stack.length > 1) stack.pop(); continue; }
            if (m[5] !== undefined) { top.kids.push(m[5]); continue; }
            if (!m[2]) continue;
            const attrs = {};
            for (const a of (m[3] || '').matchAll(/([^\s=>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'))?/g)) attrs[a[1].toLowerCase()] = a[2] ?? a[3] ?? '';
            const el = node(m[2].toLowerCase(), attrs);
            top.append(el);
            if (!m[4] && !VOID.has(m[2].toLowerCase())) stack.push(el);
        }
    }

    // Simple selectors and lists of them: tag, .class, [attr], [attr="v"],
    // and compounds of these (a[href], .close-btn).
    function matches(el, selector) {
        return selector.split(',').map((s) => s.trim()).some((sel) => {
            const m = /^([a-z0-9]*)((?:\.[\w-]+|\[[\w-]+(?:="[^"]*")?\])*)$/i.exec(sel);
            if (!m) throw new Error(`the stub document cannot read the selector ${sel}`);
            if (m[1] && el.tagName.toLowerCase() !== m[1].toLowerCase()) return false;
            for (const part of m[2].match(/\.[\w-]+|\[[^\]]+\]/g) || []) {
                if (part[0] === '.') { if (!el.classList.includes(part.slice(1))) return false; continue; }
                const a = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(part);
                if (!(a[1] in el.attrs) || (a[2] !== undefined && el.attrs[a[1]] !== a[2])) return false;
            }
            return true;
        });
    }

    doc.node = node;
    doc.body = node('body');
    doc.activeElement = doc.body;
    doc.querySelector = (sel) => doc.body.querySelector(sel);
    // The page: the tab bar as index.html lays it out (Race in the closed
    // Demographics menu, FAQ a top-level tab; Studies active), the Studies
    // section with its table and pager, the Race section, the FAQ section with
    // an unrelated link (the FDAAA FAQ entry link where the defect was seen),
    // and the two overlays as index.html writes them.
    const page = node('div');
    page.innerHTML = '<nav class="tabs"><button class="tab active" data-tab="studies">Studies</button>' +
        '<details class="nav-group" id="nav-demographics"><summary>Demographics</summary><div class="nav-menu">' +
        '<button class="tab" data-tab="race">Race</button></div></details>' +
        '<span class="nav-secondary"><button class="tab" data-tab="faq">FAQ</button></span></nav>' +
        '<section id="studies" class="tab-content active">' + studiesTable(['NCT00416078', 'NCT00000002']) + '</section>' +
        '<section id="race" class="tab-content"></section>' +
        '<section id="faq" class="tab-content"><a id="faq-link" href="#faq">FDAAA FAQ</a></section>' +
        overlayTag('breakdown-overlay') + overlayTag('study-details-overlay');
    doc.body.append(page);
    for (const el of page.querySelectorAll('[id]')) doc.byId[el.id] = el;
    for (const id of ['breakdown-overlay', 'study-details-overlay']) doc.byId[id].style.display = 'none';
    return doc;
}

// index.html's own tag for an overlay.
function overlayTag(id) {
    const m = new RegExp(`<div id="${id}"[^>]*></div>`).exec(html);
    assert.ok(m, `index.html lost #${id}`);
    return m[0];
}

function studiesTable(ids) {
    const row = (id) => `<tr><td><a class="nct-link" href="https://clinicaltrials.gov/study/${id}">${id}</a></td>` +
        `<td><button class="demo-badge" onclick="showBreakdown('${id}', 'race')">✓</button></td>` +
        `<td><button class="details-btn" onclick="showStudyDetails('${id}')">+</button></td></tr>`;
    return '<table id="studies-table" tabindex="-1"><tbody id="studies-table-body">' + ids.map(row).join('') +
        '</tbody></table><div id="pagination"><button class="page-btn" disabled>Prev</button><button class="page-btn">Next</button></div>';
}

// A breakdown shaped as app.js draws them: heading, text, a link, a state line
// that takes focus without being a stop (stateLine), a disabled button, a
// link inside a hidden block, and the Close button at the foot.
const BREAKDOWN = `<div class="breakdown-modal">
    <h4>Race Distribution - NCT00416078</h4>
    <p class="modal-subtitle">Click outside to close</p>
    <a class="pub-link" href="https://pubmed.ncbi.nlm.nih.gov/111/">PMID 111</a>
    <p class="detail-state is-failed" data-state="category labels" tabindex="-1">Did not load. <button type="button" class="detail-action" data-state="category labels">Try again</button></p>
    <button type="button" class="spare" disabled>Unavailable</button>
    <div hidden><a class="hidden-link" href="#x">Hidden</a></div>
    <button class="modal-close-btn" onclick="closeBreakdown()">Close</button>
</div>`;

function harness() {
    const doc = makeDoc();
    // Document listeners (initOverlayOpeners) and timers, run when the test
    // says: a click's handlers finish before its setTimeout callbacks.
    const listeners = [];
    doc.addEventListener = (type, fn, capture) => listeners.push({ type, fn, capture: !!capture });
    const timers = [];
    const context = vm.createContext({ document: doc, window: {}, setTimeout: (fn) => timers.push(fn) });
    contexts.set(doc, context);
    vm.runInContext(SOURCES, context);
    const run = (src) => vm.runInContext(src, context);
    const overlay = (id = 'breakdown-overlay') => doc.getElementById(id);
    const dialog = (id = 'breakdown-overlay') => overlay(id).firstElementChild;
    // A key pressed on what has focus: the keydown reaches the overlay's own
    // inline onkeydown handler (index.html) as it bubbles.
    const press = (key, { shift = false, id = 'breakdown-overlay' } = {}) => {
        const o = overlay(id);
        const event = { key, shiftKey: shift, currentTarget: o, target: doc.activeElement, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
        if (o.contains(doc.activeElement)) vm.runInContext(`(function (event) { ${o.attrs.onkeydown} })`, context).call(o, event);
        return event;
    };
    const name = (el) => (el === doc.body ? 'page' : el.id === 'faq-link' ? 'faq-link' : (el.attrs.class || el.tagName.toLowerCase()).split(' ')[0]);
    // A pointer click on `el` that does not focus it (Safari), whose onclick
    // runs `handler`: the document's capture listeners, then the handler, then
    // the timers the click left.
    const click = (el, handler) => {
        for (const l of listeners) if (l.type === 'click' && l.capture) l.fn({ target: el });
        run(handler);
        timers.splice(0).forEach((fn) => fn());
    };
    return { doc, run, overlay, dialog, press, name, click, active: () => doc.activeElement };
}

// Open the race breakdown from its badge in the first row, as a click does.
function openFromBadge(h, markup = BREAKDOWN) {
    const badge = h.doc.getElementById('studies-table-body').querySelector('.demo-badge');
    badge.focus();
    h.run(`drawOverlay('breakdown-overlay', ${JSON.stringify(markup)}, false)`);
    return badge;
}

test('index.html gives both pop-up overlays the key handler and keeps click outside to close', () => {
    for (const [id, close] of [['breakdown-overlay', 'closeBreakdown'], ['study-details-overlay', 'closeStudyDetails']]) {
        const tag = overlayTag(id);
        assert.match(tag, new RegExp(`onkeydown="overlayKeydown\\(event, ${close}\\)"`), `#${id} has no key handler`);
        assert.match(tag, new RegExp(`onclick="if\\(event\\.target===this\\) ${close}\\(\\)"`), `#${id} lost click outside to close`);
    }
    // Every pop-up goes through drawOverlay, the sex/gender v2 breakdown included,
    // and both close functions go through closeOverlay.
    assert.match(fnSource('function sgShowBreakdown(nctId, field)'), /drawOverlay\('breakdown-overlay', html, false\)/);
    assert.doesNotMatch(fnSource('function sgShowBreakdown(nctId, field)'), /style\.display = 'flex'/);
    assert.match(fnSource('function closeBreakdown()'), /closeOverlay\('breakdown-overlay'\)/);
    assert.match(fnSource('function closeStudyDetails()'), /closeOverlay\('study-details-overlay'\)/);
    assert.match(fnSource('function studyDetailsHtml(fullStudy, states)'), /<button class="close-btn" onclick="closeStudyDetails\(\)" aria-label="Close">/, "the study pop-up's ✕ button has no name");
});

test('opening a pop-up moves focus to the dialog, which is modal and named by its heading', () => {
    const h = harness();
    openFromBadge(h);
    const dialog = h.dialog();
    assert.equal(h.overlay().style.display, 'flex');
    same(h.active(), dialog, `focus stayed on ${h.name(h.active())}, behind the pop-up`);
    assert.equal(dialog.getAttribute('role'), 'dialog');
    assert.equal(dialog.getAttribute('aria-modal'), 'true');
    assert.equal(dialog.getAttribute('tabindex'), '-1', 'the dialog cannot take focus, or became a Tab stop');
    const heading = dialog.querySelector(`[id="${dialog.getAttribute('aria-labelledby')}"]`);
    assert.ok(heading, 'aria-labelledby names no element in the dialog');
    assert.equal(heading.textContent, 'Race Distribution - NCT00416078');
    // The study pop-up's heading is an h3 inside its header.
    h.run(`drawOverlay('study-details-overlay', ${JSON.stringify('<div class="study-details-modal"><div class="modal-header"><h3>A study</h3><button class="close-btn" onclick="closeStudyDetails()" aria-label="Close">✕</button></div></div>')}, false)`);
    assert.equal(h.dialog('study-details-overlay').querySelector('h3').id, h.dialog('study-details-overlay').getAttribute('aria-labelledby'));
    assert.notEqual(h.dialog('study-details-overlay').getAttribute('aria-labelledby'), dialog.getAttribute('aria-labelledby'), 'the two pop-ups share a heading id');
});

test('Tab and Shift+Tab go round the dialog and never reach the page behind it', () => {
    const h = harness();
    openFromBadge(h);
    const forward = [];
    for (let i = 0; i < 7; i++) {
        const e = h.press('Tab');
        assert.ok(e.defaultPrevented, 'Tab was left to the browser, which can leave the pop-up');
        forward.push(h.name(h.active()));
    }
    // From the dialog: the link, the state line's Try again, Close, then round.
    // The state line itself (tabindex -1), the disabled button and the hidden
    // link are not stops.
    assert.deepEqual(forward, ['pub-link', 'detail-action', 'modal-close-btn', 'pub-link', 'detail-action', 'modal-close-btn', 'pub-link']);
    const back = [];
    for (let i = 0; i < 4; i++) {
        assert.ok(h.press('Tab', { shift: true }).defaultPrevented);
        back.push(h.name(h.active()));
    }
    assert.deepEqual(back, ['modal-close-btn', 'detail-action', 'pub-link', 'modal-close-btn'], 'Shift+Tab from the first control did not go round to the last');
    // Shift+Tab from the dialog itself goes to its last control, not the page.
    h.dialog().focus();
    h.press('Tab', { shift: true });
    assert.equal(h.name(h.active()), 'modal-close-btn');
    // From the state line (focused by a redraw, not by Tab): the next and
    // previous stops around it.
    const line = h.dialog().querySelector('.detail-state');
    line.focus();
    h.press('Tab');
    assert.equal(h.name(h.active()), 'detail-action');
    line.focus();
    h.press('Tab', { shift: true });
    assert.equal(h.name(h.active()), 'pub-link');
    // Other keys are the browser's.
    assert.equal(h.press('Enter').defaultPrevented, false);
    assert.equal(h.press('ArrowDown').defaultPrevented, false);
});

test('a dialog with no control keeps focus on itself', () => {
    const h = harness();
    openFromBadge(h, '<div class="breakdown-modal"><h4>Nothing to press</h4><p>Text only.</p></div>');
    h.press('Tab');
    same(h.active(), h.dialog());
    h.press('Tab', { shift: true });
    same(h.active(), h.dialog());
});

test('Escape closes the pop-up and focus goes back to what opened it', () => {
    const h = harness();
    const badge = openFromBadge(h);
    h.press('Tab');
    h.press('Tab');
    const e = h.press('Escape');
    assert.ok(e.defaultPrevented);
    assert.equal(h.overlay().style.display, 'none', 'Escape did not close the pop-up');
    same(h.active(), badge, `focus went to ${h.name(h.active())}, not the badge that opened the pop-up`);
    assert.equal(h.run('breakdownToken'), 1, 'Escape closed the pop-up without its own close function (a waiting redraw would reopen it)');
    // The study pop-up closes with its own function.
    const plus = h.doc.getElementById('studies-table-body').querySelector('.details-btn');
    plus.focus();
    h.run(`drawOverlay('study-details-overlay', '<div class="study-details-modal"><div class="modal-header"><h3>A study</h3><button class="close-btn" onclick="closeStudyDetails()" aria-label="Close">✕</button></div></div>', false)`);
    h.press('Escape', { id: 'study-details-overlay' });
    assert.equal(h.overlay('study-details-overlay').style.display, 'none');
    assert.equal(h.run('studyModalToken'), 1);
    same(h.active(), plus);
});

test('the Close button and a click outside give focus back too', () => {
    const h = harness();
    let badge = openFromBadge(h);
    h.dialog().querySelector('.modal-close-btn').focus();
    h.dialog().querySelector('.modal-close-btn').click();
    assert.equal(h.overlay().style.display, 'none');
    same(h.active(), badge, 'Close did not give focus back to the badge');
    // A click on the backdrop (the overlay itself) closes; one inside the box does not.
    badge = openFromBadge(h);
    h.overlay().click(h.dialog());
    assert.equal(h.overlay().style.display, 'flex', 'a click inside the pop-up closed it');
    h.dialog().focus();   // a click on the box's text focuses the dialog (tabindex -1)
    h.overlay().click(h.overlay());
    assert.equal(h.overlay().style.display, 'none', 'a click outside did not close the pop-up');
    same(h.active(), badge);
});

test('when the Studies table redrew while the pop-up was open, focus goes to the same control in the new row', () => {
    const h = harness();
    const second = h.doc.getElementById('studies-table-body').querySelectorAll('.demo-badge')[1];
    second.focus();
    h.run(`drawOverlay('breakdown-overlay', ${JSON.stringify(BREAKDOWN)}, false)`);
    // The extras land: renderStudiesTable writes the rows again.
    h.doc.getElementById('studies-table-body').innerHTML = studiesTable(['NCT00416078', 'NCT00000002']).match(/<tbody[^>]*>([\s\S]*)<\/tbody>/)[1];
    assert.equal(second.isConnected, false);
    h.press('Escape');
    const now = h.doc.getElementById('studies-table-body').querySelectorAll('.demo-badge')[1];
    same(h.active(), now, `focus went to ${h.name(h.active())}, not the second row's badge`);
    // The row is gone from the page: the table itself.
    const again = h.doc.getElementById('studies-table-body').querySelectorAll('.demo-badge')[1];
    again.focus();
    h.run(`drawOverlay('breakdown-overlay', ${JSON.stringify(BREAKDOWN)}, false)`);
    h.doc.getElementById('studies-table-body').innerHTML = '';
    h.press('Escape');
    same(h.active(), h.doc.getElementById('studies-table'));
});

test('a redraw in place keeps focus where it was, and closing still returns it to the opener', () => {
    const h = harness();
    const badge = openFromBadge(h);
    // Focus on the dialog: the redraw (the extras landing) keeps it on the new dialog.
    h.run(`drawOverlay('breakdown-overlay', ${JSON.stringify(BREAKDOWN)}, true)`);
    same(h.active(), h.dialog());
    // Focus on the link: it stays on the same link, not moved to the dialog again.
    h.press('Tab');
    assert.equal(h.name(h.active()), 'pub-link');
    h.run(`drawOverlay('breakdown-overlay', ${JSON.stringify(BREAKDOWN)}, true)`);
    same(h.active(), h.dialog().querySelector('.pub-link'), `the redraw moved focus to ${h.name(h.active())}`);
    // Try again opens it afresh while it is on screen (redraw false): the same.
    h.run(`drawOverlay('breakdown-overlay', ${JSON.stringify(BREAKDOWN)}, false)`);
    same(h.active(), h.dialog().querySelector('.pub-link'));
    assert.equal(h.dialog().getAttribute('role'), 'dialog', 'a redrawn pop-up is no longer a dialog');
    h.press('Escape');
    same(h.active(), badge, 'the redraws replaced the opener with something inside the pop-up');
});

test('focus that has already left the pop-up for another control is not moved on close', () => {
    const h = harness();
    openFromBadge(h);
    const faq = h.doc.getElementById('faq-link');
    faq.focus();   // e.g. a pointer click on the page behind
    h.run('closeBreakdown()');
    same(h.active(), faq);
    // Closing a pop-up that is not open does nothing to focus.
    h.run('closeBreakdown()');
    same(h.active(), faq);
});

test('when a link in the pop-up switched tabs, closing focuses the tab now on screen, not the hidden opener', () => {
    // The sex/gender v2 breakdown's Methods link (sgOpenMethods) clicks the FAQ
    // tab and leaves the pop-up open. The badge that opened it is still in the
    // page, in the hidden Studies section, where focus() does nothing.
    const h = harness();
    const badge = openFromBadge(h);
    const switchTo = (tab) => {
        for (const t of h.doc.body.querySelectorAll('.tab')) t.classList.toggle('active', t.getAttribute('data-tab') === tab);
        for (const sec of h.doc.body.querySelectorAll('.tab-content')) sec.style.display = sec.id === tab ? '' : 'none';
    };
    switchTo('faq');
    assert.equal(badge.isConnected, true);
    assert.equal(badge.getClientRects().length, 0, 'the stub did not hide the Studies section');
    h.press('Escape');
    same(h.active(), h.doc.body.querySelector('.tab[data-tab="faq"]'), 'focus did not go to the FAQ tab now on screen');
    // A tab inside a closed menu: the menu's summary, which is on screen.
    openFromBadge(h);   // the stub's focus() lands even on a hidden badge; it is recorded as the opener
    switchTo('race');
    h.press('Escape');
    same(h.active(), h.doc.getElementById('nav-demographics').querySelector('summary'), 'focus did not go to the Demographics menu that holds the Race tab');
    // With that menu open, the Race tab button itself.
    h.doc.getElementById('nav-demographics').setAttribute('open', '');
    openFromBadge(h);
    switchTo('race');
    h.press('Escape');
    same(h.active(), h.doc.body.querySelector('.tab[data-tab="race"]'));
    // Back on Studies, the badge itself, as before.
    switchTo('studies');
    const again = openFromBadge(h);
    h.press('Escape');
    same(h.active(), again);
});

test('a clicked badge that the browser did not focus (Safari) still gets focus back', () => {
    // Safari does not focus a button it clicks, so document.activeElement is
    // the page, or whatever had focus before, when the pop-up opens.
    const h = harness();
    h.run('initOverlayOpeners()');
    const badge = h.doc.getElementById('studies-table-body').querySelector('.demo-badge');
    const faq = h.doc.getElementById('faq-link');
    faq.focus();   // focused earlier; the click does not move it
    // The click lands on the badge's check mark, inside the button.
    badge.append(h.doc.node('span', { class: 'demo-badge-check' }));
    h.click(badge.firstElementChild, `drawOverlay('breakdown-overlay', ${JSON.stringify(BREAKDOWN)}, false)`);
    same(h.active(), h.dialog(), 'the pop-up did not take focus');
    h.press('Escape');
    same(h.active(), badge, 'focus went back to the control focused before the click, not the badge clicked');
    // From the page itself (nothing focused), by its Close button.
    h.doc.activeElement = h.doc.body;
    h.click(badge, `drawOverlay('breakdown-overlay', ${JSON.stringify(BREAKDOWN)}, false)`);
    h.dialog().querySelector('.modal-close-btn').click();
    same(h.active(), badge);
    // Once the click is handled it is forgotten: a later opening without a
    // click takes what has focus.
    const plus = h.doc.getElementById('studies-table-body').querySelector('.details-btn');
    plus.focus();
    h.run(`drawOverlay('breakdown-overlay', ${JSON.stringify(BREAKDOWN)}, false)`);
    h.press('Escape');
    same(h.active(), plus, 'a click already handled named the opener of a later pop-up');
    // Wired at startup, beside the nav menus.
    assert.match(app.slice(app.indexOf('async function'), app.indexOf('function initNavGroups()')), /initNavGroups\(\);[\s\S]{0,200}initOverlayOpeners\(\);/, 'initOverlayOpeners is not called at startup');
});

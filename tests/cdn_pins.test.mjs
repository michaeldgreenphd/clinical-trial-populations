/**
 * The scripts index.html loads from another origin at start-up (Chart.js and
 * chartjs-plugin-datalabels today) are pinned to an exact version and file
 * and checked with Subresource Integrity. A new release, a Chart.js 5 say,
 * then reaches visitors only through a reviewed change to index.html, and if
 * the CDN ever served other bytes for that version the browser would refuse
 * them rather than run them.
 *
 * To move a pin, change the version in the URL and recompute the hash from
 * the exact file the URL names, then put "sha384-" in front of the output:
 *
 *   curl -sS https://cdn.jsdelivr.net/npm/chart.js@4.5.1/dist/chart.umd.min.js \
 *     | openssl dgst -sha384 -binary | openssl base64 -A
 *
 * A well-formed but wrong hash passes this test. The browser then blocks the
 * script and the whole dashboard fails to start: the loading screen stays up
 * with "Error: Chart is not defined. Please refresh the page." Merging to main
 * deploys at once, so after moving a pin, serve the page and check that it
 * loads before opening the pull request.
 *
 * Not covered here: the scripts app.js loads lazily (pako, D3, TopoJSON,
 * React, ReactDOM, Babel, Tailwind's Play CDN). They are left to their own
 * change.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
  // A commented-out tag is not loaded, so it is neither checked nor counted.
  .replace(/<!--[\s\S]*?-->/g, '');

function attributes(tag) {
  const attrs = {};
  const body = tag.replace(/^<script\b/i, '').replace(/\/?>$/, '');
  for (const m of body.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
    const name = m[1].toLowerCase();
    // As in the browser, the first of two same-named attributes wins.
    if (!Object.hasOwn(attrs, name)) attrs[name] = m[2] ?? m[3] ?? m[4] ?? '';
  }
  return attrs;
}

// Resolve each src as the browser does. The URL parser drops leading and
// trailing whitespace and reads "\" as "/", so " https://…" and "\\…" name
// another host just as "https://…" and "//…" do. Whatever lands off the
// site's own origin is fetched from elsewhere; geo/…, app.js?v=… are served
// from this repository.
const SITE = new URL('https://civicsample.com/');

// A quoted attribute value may contain ">", so the tag ends at the first ">"
// outside quotes, not at the first ">".
const external = [...html.matchAll(/<script\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi)]
  .map((m) => attributes(m[0]))
  .filter((a) => a.src !== undefined)
  .map((a) => ({ ...a, url: new URL(a.src, SITE) }))
  .filter((a) => a.url.origin !== SITE.origin);

test('index.html still loads Chart.js and the datalabels plugin from a CDN at start-up', () => {
  // Guards the tests below against passing on an empty list.
  const srcs = external.map((a) => a.url.href);
  assert.ok(srcs.some((s) => /\/npm\/chart\.js(?=[@/]|$)/.test(s)), `no Chart.js script tag among ${JSON.stringify(srcs)}`);
  assert.ok(srcs.some((s) => /\/npm\/chartjs-plugin-datalabels(?=[@/]|$)/.test(s)),
    `no chartjs-plugin-datalabels script tag among ${JSON.stringify(srcs)}`);
});

test('every start-up CDN script is pinned to an exact version and file over https', () => {
  for (const { src, url } of external) {
    assert.equal(url.protocol, 'https:', `${src} is not fetched over https`);
    assert.match(url.pathname, /@\d+\.\d+\.\d+\/\S+\.js$/,
      `${src} is not pinned to an exact x.y.z version and a file; a bare package or range URL moves when a new release is published`);
    assert.equal(url.search, '', `${src} carries a query string, so the file it names can change`);
  }
});

test('every start-up CDN script carries a sha384 integrity hash', () => {
  for (const { src, integrity } of external) {
    assert.match(integrity ?? '', /^sha384-[A-Za-z0-9+/]{64}$/,
      `${src} has no single sha384 integrity hash (got ${JSON.stringify(integrity)})`);
  }
});

test('every start-up CDN script is fetched with crossorigin="anonymous"', () => {
  // Without it the fetch is no-cors, the response is opaque, and a browser
  // that cannot read the bytes to check the hash blocks the script.
  for (const { src, crossorigin } of external) {
    assert.equal(crossorigin, 'anonymous', `${src} needs crossorigin="anonymous" for its integrity check`);
  }
});

#!/usr/bin/env node
// Guardrail checker for the Dioptra Pages site.  Run: node tools/check.mjs
//
// The three published pages are self-contained by design, which means the shared
// shell -- palette tokens, layout rules, print block, the inline SVG mark -- is
// copied into each file rather than linked.  The copies have drifted apart before
// (index.html once carried `p, li { color: var(--text) }`, which beat the --muted
// colour inherited from `footer`, so the two pages rendered their footers
// differently).  This script exists to fail on that class of defect.
//
// WHAT IT CANNOT DO.  It reads text; it is not a browser.  It does not know real
// computed styles, which token pair the browser actually composites, how the page
// prints, or whether anything overflows.  The palette check below asserts that the
// declared colours are sound -- not that they are the ones that meet on screen.
// Do not read a pass here as "the pages render correctly".

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PAGES = ['index.html', 'support.html', '404.html'];
const CONTENT_PAGES = ['index.html', 'support.html'];

// Selectors permitted to exist in only one file.  A rule that lives on a single
// page has to be named here, which is the gate `p, li { color: var(--text) }`
// would have had to pass.
const PAGE_SPECIFIC = new Set([
  '.lede', '.lede p',                       // index + 404
  '.contact', '.contact p', '.contact a',   // support
  '.q', 'kbd', 'code',                      // support
  '.none',                                  // index
  'h2', 'h2:first-of-type', 'strong',       // pages that have prose sections
]);

const PALETTE_TOKENS = ['--bg', '--surface', '--text', '--muted', '--rule', '--teal', '--amber', '--amber-ink'];

// Classes styled to look like headings.  Nothing can infer from CSS that a bold,
// block-margined paragraph was meant to be a heading, so the intent is recorded
// here: an element carrying one of these must actually be h1-h6.  The support
// page's six questions were <p class="q"> and so were invisible to heading
// navigation.
const HEADING_CLASSES = ['q'];

// Text-level elements that must not have `color` set on a bare element selector.
// A direct element match beats an inherited value at any specificity, so
// `p { color: var(--text) }` silently defeats the --muted colour set on `footer`
// for every paragraph inside it -- which is exactly what shipped.  Containers
// (body, header, footer) are absent from this list on purpose: setting a colour
// there is how inheritance is meant to be driven.
const NO_BARE_COLOR = new Set([
  'p', 'li', 'ul', 'ol', 'dl', 'dt', 'dd',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'span', 'strong', 'em', 'b', 'i', 'small', 'code', 'kbd', 'td', 'th',
]);

// Bare selectors from the list above that are nonetheless allowed to set a
// colour, because it is a deliberate typographic choice rather than an accident
// of specificity.  Adding an entry here is the point: it has to be argued for.
//   h2 -- section labels are muted on purpose, and no h2 sits inside a
//         colour-scoped container where the override would surprise anyone.
const COLOR_INTENT = new Set(['h2']);

// [foreground, background, minimum ratio, why]
const CONTRAST_PAIRS = [
  ['--text', '--bg', 4.5, 'body copy'],
  ['--text', '--surface', 4.5, '.lede / .contact copy'],
  ['--muted', '--bg', 4.5, 'footer and header subtitle'],
  ['--teal', '--bg', 4.5, 'links'],
  ['--amber-ink', '--bg', 4.5, '.none (24px/600 needs 3.0; rest is headroom)'],
];
// Backgrounds are not printed, so print text lands on white paper regardless.
const PRINT_PAPER = '#ffffff';
const PRINT_MIN = 7.0;

const failures = [];
const fail = (group, message) => failures.push({ group, message });

// ---------------------------------------------------------------- colour ----

function parseHex(hex) {
  const h = hex.trim().replace(/^#/, '');
  const full = h.length === 3 ? [...h].map(c => c + c).join('') : h;
  if (!/^[0-9a-f]{6}$/i.test(full)) return null;
  return [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16));
}

function luminance([r, g, b]) {
  const f = v => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// ------------------------------------------------------------------- css ----

// Brace-matching tokenizer.  A line-anchored regex splits multi-line rules and
// reports selectors like "}\n  .wrap", so this walks the text instead.
// Returns [{ selector, declarations, context }], context being '' for top level
// or the at-rule prelude ('@media print', '@media (prefers-color-scheme: dark)').
function parseCSS(css, context = '') {
  const rules = [];
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf('{', i);
    if (open === -1) break;

    const prelude = css.slice(i, open).trim();

    // Find the matching close brace for this block.
    let depth = 1, j = open + 1;
    while (j < css.length && depth > 0) {
      if (css[j] === '{') depth++;
      else if (css[j] === '}') depth--;
      j++;
    }
    if (depth !== 0) {
      fail('css', `unbalanced braces near "${prelude.slice(0, 40)}"`);
      break;
    }
    const body = css.slice(open + 1, j - 1);

    if (prelude.startsWith('@')) {
      rules.push(...parseCSS(body, prelude.replace(/\s+/g, ' ')));
    } else if (prelude) {
      rules.push({ selector: normalizeSelector(prelude), declarations: parseDeclarations(body), context });
    }
    i = j;
  }
  return rules;
}

const normalizeSelector = s => s.replace(/\s*,\s*/g, ', ').replace(/\s+/g, ' ').trim();

// Declarations as a sorted "prop:value" list, so ordering and whitespace in the
// source cannot masquerade as drift.
function parseDeclarations(body) {
  return body
    .split(';')
    .map(d => d.trim())
    .filter(Boolean)
    .map(d => {
      const k = d.indexOf(':');
      if (k === -1) return d;
      return `${d.slice(0, k).trim()}:${d.slice(k + 1).trim().replace(/\s+/g, ' ')}`;
    })
    .sort()
    .join('; ');
}

// ------------------------------------------------------------------ html ----

const styleOf = html => (html.match(/<style>([\s\S]*?)<\/style>/) || [, ''])[1];
const headOf = html => (html.match(/<head>([\s\S]*?)<\/head>/) || [, ''])[1];

function attr(tag, name) {
  const m = tag.match(new RegExp(`${name}\\s*=\\s*"([^"]*)"|${name}\\s*=\\s*'([^']*)'`, 'i'));
  return m ? (m[1] ?? m[2]) : null;
}

const tagsNamed = (html, name) =>
  html.match(new RegExp(`<${name}\\b[^>]*>`, 'gi')) || [];

// ---------------------------------------------------------------- checks ----

const files = {};
for (const page of PAGES) {
  const path = join(ROOT, page);
  if (!existsSync(path)) { fail('files', `${page} is missing`); continue; }
  const html = readFileSync(path, 'utf8');
  files[page] = { html, css: parseCSS(styleOf(html)), head: headOf(html) };
}
const present = Object.keys(files);

// --- shell drift -------------------------------------------------------------

const byKey = new Map(); // "context|selector" -> [{ page, declarations }]
for (const page of present) {
  for (const rule of files[page].css) {
    const key = `${rule.context}|${rule.selector}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push({ page, declarations: rule.declarations });
  }
}

for (const [key, entries] of byKey) {
  const [context, selector] = key.split('|');
  const where = context ? ` inside ${context}` : '';

  if (entries.length >= 2) {
    const first = entries[0].declarations;
    const differing = entries.filter(e => e.declarations !== first);
    if (differing.length) {
      fail('drift',
        `"${selector}"${where} differs between files:\n` +
        entries.map(e => `        ${e.page.padEnd(14)} ${e.declarations}`).join('\n'));
    }
  } else if (!PAGE_SPECIFIC.has(selector)) {
    fail('drift',
      `"${selector}"${where} is defined only in ${entries[0].page}. ` +
      `A single-page rule must be listed in PAGE_SPECIFIC in this script.`);
  }
}

// A bare element selector setting `color` beats inheritance, so it survives
// being applied to every file identically and the drift check above would not
// see it.  Checked separately.
for (const page of present) {
  for (const rule of files[page].css) {
    if (rule.context.includes('print')) continue; // print resets the palette wholesale
    const parts = rule.selector.split(',').map(s => s.trim());
    for (const part of parts) {
      if (!NO_BARE_COLOR.has(part) || COLOR_INTENT.has(part)) continue;
      if (/(^|;\s*)color\s*:/.test(rule.declarations)) {
        fail('inheritance',
          `${page}: "${part}" sets color directly. A direct element match beats an ` +
          `inherited value, so this overrides the colour set on any ancestor ` +
          `(this is how the footer lost its --muted colour). Style a container or a class instead.`);
      }
    }
  }
}

// The inline mark is the other large duplicated block.
const marks = present.map(page => {
  const m = files[page].html.match(/<svg class="mark"[\s\S]*?<\/svg>/);
  return { page, svg: m ? m[0].replace(/\s+/g, ' ').trim() : null };
});
for (const m of marks) if (!m.svg) fail('drift', `${m.page} has no <svg class="mark">`);
const markRef = marks.find(m => m.svg);
for (const m of marks) {
  if (m.svg && markRef && m.svg !== markRef.svg) {
    fail('drift', `the inline mark in ${m.page} differs from ${markRef.page}`);
  }
}

// --- palette -----------------------------------------------------------------

for (const page of present) {
  const rootRules = files[page].css.filter(r => r.selector === ':root');
  const palettes = {};
  for (const r of rootRules) {
    const label = !r.context ? 'light' : r.context.includes('print') ? 'print' : 'dark';
    palettes[label] = Object.fromEntries(
      r.declarations.split('; ')
        .map(d => { const k = d.indexOf(':'); return [d.slice(0, k).trim(), d.slice(k + 1).trim()]; })
        .filter(([k]) => k.startsWith('--')));
  }

  for (const label of ['light', 'dark', 'print']) {
    if (!palettes[label]) { fail('palette', `${page} has no ${label} :root block`); continue; }

    const missing = PALETTE_TOKENS.filter(t => !(t in palettes[label]));
    if (missing.length) fail('palette', `${page} ${label} palette is missing ${missing.join(', ')}`);

    // Without this the UA keeps light scrollbars and a white overscroll gutter
    // around a dark page.
    if (label === 'light') {
      const declared = rootRules.find(r => !r.context)?.declarations || '';
      if (!/color-scheme:\s*light dark/.test(declared)) {
        fail('palette', `${page} does not declare "color-scheme: light dark" on :root`);
      }
    }

    for (const [fg, bg, min, why] of CONTRAST_PAIRS) {
      const f = palettes[label][fg], b = palettes[label][bg];
      if (!f || !b) continue;
      const [fc, bc] = [parseHex(f), parseHex(b)];
      if (!fc || !bc) { fail('palette', `${page} ${label}: ${fg}=${f} or ${bg}=${b} is not a hex colour`); continue; }
      const ratio = contrast(fc, bc);
      if (ratio < min) {
        fail('contrast',
          `${page} ${label}: ${fg} on ${bg} is ${ratio.toFixed(2)}, needs ${min} (${why})`);
      }
    }
  }

  // Print lands on paper, whatever --bg says.
  if (palettes.print?.['--text']) {
    const c = parseHex(palettes.print['--text']);
    const ratio = c ? contrast(c, parseHex(PRINT_PAPER)) : 0;
    if (ratio < PRINT_MIN) {
      fail('contrast',
        `${page} print: --text on white paper is ${ratio.toFixed(2)}, needs ${PRINT_MIN} ` +
        `(browsers do not print background colours)`);
    }
  }
}

// --- structure ---------------------------------------------------------------

for (const page of present) {
  const { html } = files[page];

  if (!/^<!DOCTYPE html>/i.test(html.trim())) fail('structure', `${page} has no <!DOCTYPE html>`);
  if (!/<html\s[^>]*lang=/i.test(html)) fail('structure', `${page} has no lang attribute on <html>`);

  const h1s = tagsNamed(html, 'h1').length;
  if (h1s !== 1) fail('structure', `${page} has ${h1s} <h1> elements, expected exactly 1`);

  const levels = [...html.matchAll(/<h([1-6])\b/gi)].map(m => +m[1]);
  for (let i = 1; i < levels.length; i++) {
    if (levels[i] > levels[i - 1] + 1) {
      fail('structure',
        `${page} skips a heading level: h${levels[i - 1]} -> h${levels[i]} ` +
        `(a question styled as a heading must be marked up as one)`);
      break;
    }
  }

  for (const cls of HEADING_CLASSES) {
    const re = new RegExp(`<([a-z0-9]+)\\b[^>]*class\\s*=\\s*["'][^"']*\\b${cls}\\b[^"']*["']`, 'gi');
    for (const m of html.matchAll(re)) {
      if (!/^h[1-6]$/i.test(m[1])) {
        fail('structure',
          `${page} has <${m[1].toLowerCase()} class="${cls}">, but "${cls}" is styled as a heading — ` +
          `use h1-h6 so it can be navigated`);
      }
    }
  }

  const mains = tagsNamed(html, 'main').length;
  if (mains !== 1) {
    fail('structure', `${page} has ${mains} <main> elements, expected exactly 1`);
  } else {
    // header and footer must sit outside <main> or they lose banner/contentinfo.
    const mainOpen = html.search(/<main\b/i);
    const mainClose = html.search(/<\/main>/i);
    const headerClose = html.search(/<\/header>/i);
    const footerOpen = html.search(/<footer\b/i);
    if (headerClose > mainOpen) fail('structure', `${page}: <header> is inside <main>, losing its banner role`);
    if (footerOpen !== -1 && footerOpen < mainClose) fail('structure', `${page}: <footer> is inside <main>, losing its contentinfo role`);
  }
}

// --- the "loads nothing" claim ------------------------------------------------

// The pages assert in their own footer that they fetch nothing from anywhere.
// This policy makes the browser enforce it rather than take the page's word:
// default-src 'none' blocks every fetch, img-src data: permits only the inline
// favicon, and style-src 'unsafe-inline' permits the inline <style> without
// permitting a remote one.  frame-ancestors and report-uri are ignored in a
// meta tag, and GitHub Pages cannot set real headers, so they are absent by
// necessity rather than by choice.
const EXPECTED_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'";

for (const page of present) {
  const tag = tagsNamed(files[page].html, 'meta')
    .find(t => (attr(t, 'http-equiv') || '').toLowerCase() === 'content-security-policy');
  if (!tag) {
    fail('csp', `${page} has no Content-Security-Policy meta tag`);
  } else {
    const policy = (attr(tag, 'content') || '').replace(/\s+/g, ' ').trim();
    if (policy !== EXPECTED_CSP) {
      fail('csp', `${page} policy is "${policy}", expected "${EXPECTED_CSP}"`);
    }
  }
}

for (const page of present) {
  const { html, css } = files[page];

  for (const [name, why] of [['script', '<script>'], ['iframe', '<iframe>']]) {
    if (tagsNamed(html, name).length) fail('external', `${page} contains ${why}`);
  }

  for (const tag of tagsNamed(html, 'link')) {
    const rel = (attr(tag, 'rel') || '').toLowerCase();
    if (rel.includes('stylesheet')) fail('external', `${page} links an external stylesheet`);
    // canonical is metadata, not a subresource; icon is a self-contained data: URI.
    if (rel.includes('canonical') || rel.split(/\s+/).includes('icon')) continue;
    const href = attr(tag, 'href') || '';
    if (/^(https?:)?\/\//i.test(href)) fail('external', `${page} has <link rel="${rel}"> to ${href}`);
  }

  // src= is never legitimate on these pages.
  const srcs = [...html.matchAll(/\ssrc\s*=\s*["']([^"']*)["']/gi)].map(m => m[1]);
  for (const s of srcs) fail('external', `${page} has src="${s}"`);

  const styleText = styleOf(html);
  if (/@import/i.test(styleText)) fail('external', `${page} CSS uses @import`);
  const urls = [...styleText.matchAll(/url\(\s*['"]?([^'")]+)/gi)].map(m => m[1]);
  for (const u of urls) fail('external', `${page} CSS references url(${u})`);
  void css;

  // Any remaining absolute URL must be canonical, og:url, an <a> target, or the
  // SVG namespace.  An <a> is navigation the reader has to choose, not a fetch
  // the page performs, so it does not contradict the no-network claim; the
  // referrer it would leak is handled by the rel check further down.
  for (const m of html.matchAll(/(https?:)?\/\/[^\s"'<>)]+/gi)) {
    const url = m[0];
    if (url.startsWith('http://www.w3.org/2000/svg')) continue;
    const around = html.slice(Math.max(0, m.index - 120), m.index);
    if (/<link[^>]*rel=["']canonical["'][^>]*$/i.test(around)) continue;
    if (/<meta[^>]*(og:url|og:site_name)[^>]*$/i.test(around)) continue;
    if (/<a[^>]*$/i.test(around)) continue;
    fail('external', `${page} references ${url.slice(0, 60)} outside canonical/og:url`);
  }
}

// --- head contract ------------------------------------------------------------

for (const page of present) {
  const { html, head } = files[page];
  const is404 = page === '404.html';

  if (!/<meta\s+charset=["']utf-8["']/i.test(head)) fail('head', `${page} has no utf-8 charset`);
  if (!/name=["']viewport["']/i.test(head)) fail('head', `${page} has no viewport meta`);
  if (!/<title>[^<]+<\/title>/i.test(head)) fail('head', `${page} has no non-empty <title>`);

  const themeColors = (head.match(/name=["']theme-color["']/gi) || []).length;
  if (themeColors !== 2) fail('head', `${page} has ${themeColors} theme-color entries, expected 2 (light and dark)`);

  const hasCanonical = /rel=["']canonical["']/i.test(head);
  const hasIcon = /rel=["']icon["']/i.test(head);

  if (is404) {
    if (hasCanonical) fail('head', `404.html must not declare a canonical URL`);
    if (!/name=["']robots["'][^>]*noindex/i.test(head)) fail('head', `404.html has no robots noindex`);
  } else {
    if (!/name=["']description["']/i.test(head)) fail('head', `${page} has no description meta`);
    if (!hasCanonical) fail('head', `${page} has no canonical URL`);
    const og = (head.match(/property=["']og:/gi) || []).length;
    if (og !== 5) fail('head', `${page} has ${og} og:* tags, expected 5`);
  }
  if (!hasIcon) fail('head', `${page} has no favicon link`);
  void html;
}

// --- favicon ------------------------------------------------------------------

const icons = present.map(page => {
  const tag = tagsNamed(files[page].html, 'link').find(t => (attr(t, 'rel') || '').split(/\s+/).includes('icon'));
  return { page, href: tag ? attr(tag, 'href') : null };
}).filter(i => i.href);

const iconRef = icons[0];
for (const icon of icons) {
  if (iconRef && icon.href !== iconRef.href) {
    fail('favicon', `${icon.page} favicon differs from ${iconRef.page}`);
  }
  if (!icon.href.startsWith('data:image/svg+xml,')) {
    fail('favicon', `${icon.page} favicon is not an inline data: URI`);
    continue;
  }
  let svg;
  try {
    svg = decodeURIComponent(icon.href.slice('data:image/svg+xml,'.length));
  } catch {
    fail('favicon', `${icon.page} favicon is not valid percent-encoding`);
    continue;
  }
  if (!svg.trimStart().startsWith('<svg') || !svg.trimEnd().endsWith('</svg>')) {
    fail('favicon', `${icon.page} favicon does not decode to a complete <svg> element`);
  }
}

// --- internal links -----------------------------------------------------------

// The site is published at /dioptra/ on GitHub Pages, so 404.html uses
// root-absolute links: a 404 can be served at any path depth, where relative
// links would resolve against the wrong directory.
const SITE_BASE = '/dioptra/';

for (const page of present) {
  for (const tag of files[page].html.match(/<a\b[^>]*>/gi) || []) {
    const href = attr(tag, 'href');
    if (!href || href.startsWith('mailto:') || href.startsWith('#')) continue;

    // Linking off-site is allowed -- it is navigation, not a fetch -- but a
    // page whose whole claim is that it tells nobody anything about you should
    // not tell the destination which page the reader arrived from.
    if (/^(https?:)?\/\//i.test(href)) {
      const rel = (attr(tag, 'rel') || '').toLowerCase().split(/\s+/);
      if (!rel.includes('noreferrer')) {
        fail('links', `${page} links to ${href} without rel="noreferrer"`);
      }
      continue;
    }

    let target = href;
    if (target.startsWith(SITE_BASE)) target = target.slice(SITE_BASE.length);
    else if (target.startsWith('/')) { fail('links', `${page} links ${href}, which is outside ${SITE_BASE}`); continue; }
    if (target === '' || target.endsWith('/')) target += 'index.html';

    if (!existsSync(join(ROOT, target))) fail('links', `${page} links ${href}, but ${target} does not exist`);
  }
}

// ---------------------------------------------------------------- report ----

if (!failures.length) {
  console.log(`ok  ${present.length} pages checked, no problems found`);
  process.exit(0);
}

const groups = new Map();
for (const f of failures) {
  if (!groups.has(f.group)) groups.set(f.group, []);
  groups.get(f.group).push(f.message);
}
for (const [group, messages] of groups) {
  console.error(`\n${group}`);
  for (const m of messages) console.error(`  - ${m}`);
}
console.error(`\n${failures.length} problem${failures.length === 1 ? '' : 's'} found`);
process.exit(1);

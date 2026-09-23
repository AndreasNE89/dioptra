#!/usr/bin/env node
// Self-test for tools/check.mjs.  Run: node tools/check-selftest.mjs
//
// The checker once passed three defects it exists to catch: a shared rule
// (`footer a`, `a:focus-visible`) deleted from one page, a second <style> block
// bringing back `p { color }`, and it failed a valid `page.html#fragment` link.
// Each case below copies the pages into a temporary directory, breaks (or
// exercises) one thing, and runs the checker against the copy.  No
// dependencies, like the checker itself.

import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = join(ROOT, 'tools', 'check.mjs');
const PAGES = ['index.html', 'support.html', '404.html'];

// Replace exactly one occurrence, and fail the case if it is not there: a
// mutation that silently does nothing would make a "must fail" case pass.
function replaceOnce(text, from, to, where) {
  const at = text.indexOf(from);
  if (at === -1) throw new Error(`${where}: text to replace not found: ${JSON.stringify(from.slice(0, 60))}`);
  if (text.indexOf(from, at + 1) !== -1) throw new Error(`${where}: text to replace occurs more than once`);
  return text.slice(0, at) + to + text.slice(at + from.length);
}

const ANCHOR = '<p id="selftest-anchor">anchor</p>\n</main>';

const CASES = [
  { name: 'the pages as they are', pass: true, edits: [] },

  { name: 'shared rule "footer a" deleted from support.html', pass: false, expect: 'missing from support.html',
    edits: [['support.html', '  footer a { color: var(--muted); }\n', '']] },
  { name: 'shared rule "a:focus-visible" deleted from 404.html', pass: false, expect: 'missing from 404.html',
    edits: [['404.html', '  a:focus-visible { outline: 2px solid var(--teal); outline-offset: 3px; border-radius: 2px; }\n', '']] },
  { name: 'page-specific ".lede p" deleted from 404.html', pass: false, expect: 'missing from 404.html',
    edits: [['404.html', '  .lede p { margin: 0; }\n', '']] },
  { name: 'page-specific ".q" copied onto index.html', pass: false, expect: 'does not list',
    edits: [['index.html', '  strong { font-weight: 600; }\n', '  strong { font-weight: 600; }\n  .q { font-size: 1rem; font-weight: 600; margin: 1.6rem 0 .3rem; }\n']] },

  { name: 'second <style> block reintroducing p { color } in index.html', pass: false, expect: 'sets color directly',
    edits: [['index.html', '</style>\n</head>', '</style>\n<style>\n  p { color: var(--text); }\n</style>\n</head>']] },
  { name: 'style attribute on an element', pass: false, expect: 'style attribute',
    edits: [['support.html', '\n</main>', '\n<p style="color: red">x</p>\n</main>']] },

  { name: 'valid fragment links, same page and cross page, with a query', pass: true,
    edits: [
      ['support.html', '\n</main>', `\n${ANCHOR}`],
      ['support.html', '<p id="selftest-anchor">', '<p><a href="#selftest-anchor">here</a></p>\n<p id="selftest-anchor">'],
      ['index.html', '\n</main>', '\n<p><a href="support.html#selftest-anchor">there</a></p>\n</main>'],
      ['404.html', '\n</main>', '\n<p><a href="/dioptra/support.html?from=404#selftest-anchor">there</a></p>\n</main>'],
    ] },
  { name: 'fragment naming an id that does not exist', pass: false, expect: 'has no id="no-such-id"',
    edits: [['index.html', '\n</main>', '\n<p><a href="support.html#no-such-id">there</a></p>\n</main>']] },
];

let failed = 0;
for (const c of CASES) {
  const dir = mkdtempSync(join(tmpdir(), 'dioptra-pages-'));
  try {
    const text = Object.fromEntries(PAGES.map(p => [p, readFileSync(join(ROOT, p), 'utf8')]));
    for (const [page, from, to] of c.edits) text[page] = replaceOnce(text[page], from, to, `${c.name} (${page})`);
    for (const p of PAGES) writeFileSync(join(dir, p), text[p]);

    const run = spawnSync(process.execPath, [CHECK, dir], { encoding: 'utf8' });
    const output = `${run.stdout}${run.stderr}`;
    const passed = run.status === 0;
    let problem = null;
    if (passed !== c.pass) problem = `expected the checker to ${c.pass ? 'pass' : 'fail'}, it ${passed ? 'passed' : 'failed'}`;
    else if (c.expect && !output.includes(c.expect)) problem = `expected output to mention ${JSON.stringify(c.expect)}`;

    if (problem) {
      failed++;
      console.error(`FAIL  ${c.name}: ${problem}\n${output.replace(/^/gm, '      ')}`);
    } else {
      console.log(`ok    ${c.name}`);
    }
  } catch (error) {
    failed++;
    console.error(`FAIL  ${c.name}: ${error.message}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (failed) {
  console.error(`\n${failed} of ${CASES.length} self-test cases failed`);
  process.exit(1);
}
console.log(`\nall ${CASES.length} self-test cases passed`);

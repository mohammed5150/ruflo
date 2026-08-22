#!/usr/bin/env node
// Runner + ratchet for the repo's node:test-based suites.
//
// These files use `node:test`, which vitest cannot collect — under the root
// vitest suite every one of them was reported as a failed file ("no test
// suite found") even though the tests themselves pass under `node --test`.
// They are therefore excluded from vitest discovery (see vitest.config.ts —
// keep the two lists in sync) and gated here instead, with the same
// monotone-decreasing baseline semantics as scripts/ci-test-ratchet.mjs:
// files listed in scripts/node-test-baseline.txt may fail (known debt), any
// NEW failing file blocks the build, and the baseline may only shrink.
//
// TypeScript files run through tsx (--import tsx), resolved from the root
// node_modules; .mjs/.cjs pass through it untouched.
//
// Usage: node scripts/run-node-tests.mjs [--update-baseline]

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const BASELINE_PATH = join(ROOT, 'scripts/node-test-baseline.txt');

// Directories that hold node:test suites. Keep in sync with the exclude list
// in vitest.config.ts.
const SCAN_DIRS = [
  'tests',
  'v3/__tests__/appliance',
  'v3/@claude-flow/embeddings/__tests__',
  'plugins',
  // Content-filtered: only files importing node:test are picked up, so the
  // vitest-based scripts/__tests__/ci-test-ratchet.test.mjs stays with vitest.
  'scripts/__tests__',
];
const TEST_FILE_RE = /\.test\.(ts|mjs|cjs)$/;
const NODE_TEST_IMPORT_RE = /from\s+['"]node:test['"]|require\(\s*['"]node:test['"]\s*\)/;

function walk(dir, acc = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return acc; }
  for (const name of entries) {
    if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, acc);
    else if (TEST_FILE_RE.test(name)) acc.push(p);
  }
  return acc;
}

const files = SCAN_DIRS
  .flatMap((d) => walk(join(ROOT, d)))
  .filter((p) => NODE_TEST_IMPORT_RE.test(readFileSync(p, 'utf8')))
  .map((p) => relative(ROOT, p))
  .sort();

if (files.length === 0) {
  console.error('run-node-tests: found no node:test files — repo layout drift?');
  process.exit(1);
}

const failing = [];
for (const rel of files) {
  const res = spawnSync(process.execPath, ['--import', 'tsx', '--test', rel], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 180_000,
  });
  const ok = res.status === 0;
  console.log(`${ok ? '✓' : '✗'} ${rel}`);
  if (!ok) failing.push(rel);
}

if (process.argv.includes('--update-baseline')) {
  writeFileSync(BASELINE_PATH, failing.join('\n') + (failing.length ? '\n' : ''));
  console.log(`run-node-tests: baseline written with ${failing.length} entries.`);
  process.exit(0);
}

let baseline = [];
if (existsSync(BASELINE_PATH)) {
  baseline = readFileSync(BASELINE_PATH, 'utf8').split('\n').map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}
const baselineSet = new Set(baseline);
const fresh = failing.filter((f) => !baselineSet.has(f));
const fixed = baseline.filter((f) => !failing.includes(f));

if (fixed.length) {
  console.log(`run-node-tests: ${fixed.length} baseline file(s) now pass — shrink the baseline:`);
  for (const f of fixed) console.log(`  - ${f}`);
}
if (fresh.length) {
  console.error(`run-node-tests: FAILED — ${fresh.length} file(s) failing beyond the baseline:`);
  for (const f of fresh) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log(
  `run-node-tests: PASS — ${files.length} files, ${failing.length}/${baseline.length} known-failing remain.`,
);

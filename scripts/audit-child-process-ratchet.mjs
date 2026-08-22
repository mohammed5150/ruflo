#!/usr/bin/env node
// ADR-078 child_process ratchet.
//
// The security policy (v3/@claude-flow/cli/.eslintrc.json) bans direct
// child_process imports in favor of SafeExecutor / execFileSync, but eslint
// is not wired into the workspace and dozens of files predate the rule.
// Until that debt is paid down, this ratchet holds the line the same way
// scripts/ci-test-ratchet.mjs does for tests: files in the baseline are
// tolerated, any NEW file importing child_process fails the build, and the
// baseline may only shrink. Never add to the baseline to get green — use
// SafeExecutor (@claude-flow/security) or execFileSync with no shell.
//
// Usage: node scripts/audit-child-process-ratchet.mjs [--update-baseline]

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SCAN_DIR = join(ROOT, 'v3/@claude-flow/cli/src');
const BASELINE_PATH = join(ROOT, 'scripts/child-process-baseline.txt');
// Sanctioned by the .eslintrc.json overrides — allowed to use child_process.
const ALLOWED = new Set([
  'v3/@claude-flow/cli/src/commands/daemon.ts',
  'v3/@claude-flow/cli/src/mcp-server.ts',
]);
const IMPORT_RE = /(from\s+['"](node:)?child_process['"])|(require\(\s*['"](node:)?child_process['"]\s*\))/;

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === 'dist') continue;
      walk(p, acc);
    } else if (name.endsWith('.ts') && !name.endsWith('.d.ts')) {
      acc.push(p);
    }
  }
  return acc;
}

const violators = walk(SCAN_DIR)
  .filter((p) => IMPORT_RE.test(readFileSync(p, 'utf8')))
  .map((p) => relative(ROOT, p))
  .filter((rel) => !ALLOWED.has(rel))
  .sort();

if (process.argv.includes('--update-baseline')) {
  writeFileSync(BASELINE_PATH, violators.join('\n') + '\n');
  console.log(`child-process ratchet: baseline written with ${violators.length} entries.`);
  process.exit(0);
}

let baseline = [];
try {
  baseline = readFileSync(BASELINE_PATH, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean);
} catch {
  console.error(`child-process ratchet: missing baseline ${relative(ROOT, BASELINE_PATH)}`);
  console.error('Generate it with: node scripts/audit-child-process-ratchet.mjs --update-baseline');
  process.exit(1);
}
const baselineSet = new Set(baseline);
const fresh = violators.filter((f) => !baselineSet.has(f));
const cleaned = baseline.filter((f) => !violators.includes(f));

if (cleaned.length) {
  console.log(`child-process ratchet: ${cleaned.length} baseline file(s) no longer import child_process — shrink the baseline:`);
  for (const f of cleaned) console.log(`  - ${f}`);
  console.log('Run: node scripts/audit-child-process-ratchet.mjs --update-baseline');
}
if (fresh.length) {
  console.error(`child-process ratchet: ${fresh.length} NEW file(s) import child_process (ADR-078):`);
  for (const f of fresh) console.error(`  ✗ ${f}`);
  console.error('Use SafeExecutor from @claude-flow/security or execFileSync (no shell) instead.');
  process.exit(1);
}
console.log(`child-process ratchet: OK — ${violators.length} tolerated legacy file(s), 0 new.`);

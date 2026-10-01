#!/usr/bin/env node
// ─── Runs every test ──────────────────────────────────────────────
// Exists because "N/N green" kept being quoted from memory and from a hand-
// written loop, and the loop was wrong twice: it passed --import to tests that
// did not need it, and — worse — it never revealed that test/sync-test.mjs was
// FAILING under the flag since c470ae5 while passing without it. A loop that
// only runs the plain invocation cannot see that.
//
// Usage:
//   node test/run-all.mjs              every test
//   node test/run-all.mjs --verbose    show each test's own output
//   node test/run-all.mjs pattern.mjs  only tests whose name matches
//
// Exit code is non-zero if anything failed, so it is usable in a commit hook.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
const filters = args.filter(a => !a.startsWith('--'));

/**
 * Every test is run WITH the harness flag. Passing it to a test that does not
 * need it is harmless — verified against the whole suite, the assertion counts
 * are identical either way for determinism, sync, dynamics and
 * loudness-formula — and it means there is one invocation instead of two and no
 * way to run a test in the wrong mode.
 */
const tests = fs.readdirSync(here)
  .filter(f => f.endsWith('.mjs') || f.endsWith('.js'))
  .filter(f => !['run-all.mjs', 'player-sim.mjs'].includes(f))   // a library, not a test
  .filter(f => filters.length === 0 || filters.some(x => f.includes(x)))
  .sort();

// eval/ scripts are reports, not tests, but lexicon-reconcile exits non-zero on
// a broken import, so it is worth running.
const evals = fs.existsSync(path.join(root, 'eval', 'lexicon-reconcile.mjs'))
  ? ['eval/lexicon-reconcile.mjs'] : [];

const all = [...tests.map(f => 'test/' + f), ...evals];

let passed = 0;
const failed = [];
const results = [];

for (const rel of all) {
  const started = process.hrtime.bigint();
  const r = spawnSync(process.execPath, ['--import', './test/harness/register.mjs', rel], {
    cwd: root, encoding: 'utf8', timeout: 300000,
  });
  const ms = Number((process.hrtime.bigint() - started) / 1000000n);
  const out = (r.stdout || '') + (r.stderr || '');
  const ok = r.status === 0;
  if (ok) passed++; else failed.push({ rel, code: r.status, out });

  // the last non-empty line of output is the test's own verdict
  const verdict = out.split('\n').map(l => l.trim()).filter(Boolean).pop() || '';
  results.push({ rel, ok, ms, verdict: verdict.slice(0, 72), out });
}

// one line per test
for (const { rel, ok, ms, verdict, out } of results) {
  console.log(` ${ok ? ' ok ' : 'FAIL'} ${String(ms).padStart(6)}ms  ${rel.padEnd(34)} ${verdict}`);
  if (!ok && verbose) {
    console.log(out.split('\n').map(l => '        ' + l).join('\n'));
  }
}

console.log(`\n ${passed}/${all.length} passed` + (failed.length ? `, ${failed.length} failed` : ''));
if (failed.length) {
  console.log('\n failed:');
  for (const f of failed) console.log(`   ${f.rel} (exit ${f.code})`);
  if (!verbose) console.log('\n re-run with --verbose for the output');
}
process.exit(failed.length ? 1 : 0);
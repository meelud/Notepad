#!/usr/bin/env node
// ─── Per-layer mix report ─────────────────────────────────────────────────
// Each layer of the piece (ambient bed, word voices, punctuation) rendered ALONE
// through the same master bus and reverb, for the fixed corpus, plus the full mix.
// Answers "how loud is the melody relative to the pad?" and "where does each
// layer put its energy?" with numbers.
//
//   node tools/stem-report.mjs                 # all texts
//   node tools/stem-report.mjs --text "..."    # one text of your own
//
// Needs:  npm install --no-save node-web-audio-api
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TEXTS } from './corpus.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const ti = argv.indexOf('--text');
const texts = ti >= 0 ? [['custom', argv[ti + 1]]] : TEXTS;
const LAYERS = ['ambient', 'voices', 'punctuation', null];
// pass-through knobs for the melody: --comp N --fg-db N --lift-oct N
const pass = [];
for (const k of ['comp', 'fg-db', 'lift-oct']) { const i = argv.indexOf('--' + k); if (i >= 0) pass.push('--' + k, argv[i + 1]); }
const f = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : ' -inf').padStart(6);

function run(text, stem) {
  const args = [path.join(here, 'render-offline.mjs'), '--text', text, '--json', '--max-sec', '150', ...(stem ? ['--stem', stem] : []), ...pass];
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 1 << 26 });
  if (r.status !== 0) throw new Error(`render failed (${r.status}): ${r.stderr || r.stdout}`);
  return JSON.parse(r.stdout.trim().split('\n').pop());
}

console.log('text         layer        peak  stMax  A-max  crest   bass lowMid    mid presence   (stMax = short-term LUFS max, A-max = short-term A-weighted max)');
const gap = [], gapA = [];
for (const [name, text] of texts) {
  const rows = {};
  for (const l of LAYERS) {
    const m = run(text, l); rows[l ?? 'full'] = m;
    console.log(name.padEnd(12) + (l ?? 'full mix').padEnd(12) + f(m.peakDb) + f(m.lufsShortMax) + f(m.aShortMaxDb) + f(m.crestDb) + f(m.bands.bass) + f(m.bands.lowMid) + f(m.bands.mid) + f(m.bands.presence));
  }
  gap.push(rows.voices.lufsShortMax - rows.ambient.lufsShortMax);
  gapA.push(rows.voices.aShortMaxDb - rows.ambient.aShortMaxDb);
  console.log(' '.repeat(12) + `voices − ambient:  LUFS ${f(gap[gap.length - 1])} LU    A-weighted ${f(gapA[gapA.length - 1])} dB`);
}
const mean = a => { const k = a.filter(Number.isFinite); return k.reduce((x, y) => x + y, 0) / k.length; };
console.log('\nmean voices − ambient:  LUFS ' + mean(gap).toFixed(1) + ' LU   A-weighted ' + mean(gapA).toFixed(1) + ' dB   (negative = the melody sits under the bed)');
console.log('range:                 LUFS ' + Math.min(...gap).toFixed(1) + ' … ' + Math.max(...gap).toFixed(1) + '   A-weighted ' + Math.min(...gapA).toFixed(1) + ' … ' + Math.max(...gapA).toFixed(1));

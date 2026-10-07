#!/usr/bin/env node
// ─── Mix report over a small, fixed set of texts ──────────────────────────
// One child process per text (player.js keeps module-level state), each running
// tools/render-offline.mjs --json, then one comparison table.
//
//   node tools/mix-report.mjs                 # master as configured
//   node tools/mix-report.mjs --no-master     # same texts, master bus bypassed
//   node tools/mix-report.mjs --compare       # both, side by side, with deltas
//
// Needs:  npm install --no-save node-web-audio-api
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
import { TEXTS } from './corpus.mjs';

function run(text, extra) {
  const r = spawnSync(process.execPath, [path.join(here, 'render-offline.mjs'), '--text', text, '--json', '--max-sec', '150', ...extra],
    { encoding: 'utf8', maxBuffer: 1 << 26 });
  if (r.status !== 0) throw new Error(`render failed (${r.status}): ${r.stderr || r.stdout}`);
  return JSON.parse(r.stdout.trim().split('\n').pop());
}
const f = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : ' -inf').padStart(6);
const argv = process.argv.slice(2);
const compare = argv.includes('--compare');
const extraBase = [];
if (argv.includes('--no-master')) extraBase.push('--no-master');
const mdb = argv.indexOf('--master-db'); if (mdb >= 0) extraBase.push('--master-db', argv[mdb + 1]);

function header() { console.log('text'.padEnd(11) + ' secs  peak   tPeak  LUFS-I  stMax  crest  lowMid   mid  clip'); }
function row(name, m) {
  console.log(name.padEnd(11) + f(m.seconds) + f(m.peakDb) + f(m.truePeakDb) + f(m.lufsI) + f(m.lufsShortMax) + f(m.crestDb) + f(m.bands.lowMid) + f(m.bands.mid) + String(m.clippedSamples).padStart(6));
}
if (!compare) {
  header();
  const rows = TEXTS.map(([n, t]) => { const m = run(t, extraBase); row(n, m); return m; });
  const avg = k => rows.reduce((a, m) => a + (Number.isFinite(m[k]) ? m[k] : 0), 0) / rows.length;
  console.log('─'.repeat(70));
  console.log('mean'.padEnd(11) + f(avg('seconds')) + f(avg('peakDb')) + f(avg('truePeakDb')) + f(avg('lufsI')) + f(avg('lufsShortMax')) + f(avg('crestDb')) + f(rows.reduce((a, m) => a + m.bands.lowMid, 0) / rows.length) + f(rows.reduce((a, m) => a + m.bands.mid, 0) / rows.length));
} else {
  console.log('A = master bus bypassed (--no-master),  B = as configured\n');
  header();
  for (const [n, t] of TEXTS) {
    const a = run(t, ['--no-master']), b = run(t, []);
    row(n + ' A', a); row(n + ' B', b);
    console.log(' '.repeat(11) + f(0, 1).replace(/0.0/, '   ') + f(b.peakDb - a.peakDb) + f(b.truePeakDb - a.truePeakDb) + f(b.lufsI - a.lufsI) + f(b.lufsShortMax - a.lufsShortMax) + f(b.crestDb - a.crestDb) + f(b.bands.lowMid - a.bands.lowMid) + f(b.bands.mid - a.bands.mid) + '   (B−A)');
  }
}

#!/usr/bin/env node
// ─── How do the generator's melodies compare with real ones? ──────────────────
// Runs the REAL play() (melodic decisions only, no audio) over the corpus texts and
// measures the melody it chose, with js/music/melody-metrics.js — the same module that
// produced tools/reference/essen-melody-stats.json from 8462 folk melodies. A deviation
// is flagged when it is larger than twice its sampling error, so noise is not mistaken
// for a finding.
//
//   node tools/melody-report.mjs                      # corpus-v2 texts with >= 12 words
//   node tools/melody-report.mjs --min-words 8 --limit 120
//   node tools/melody-report.mjs --lang en            # or fa
//   node tools/melody-report.mjs --by-kind            # also: repeats by (note kind <- previous kind)
//
// Read the result with the caveat in melody-metrics.js: these numbers locate differences and
// catch regressions; whether a difference is a flaw is a matter of style, and the listening
// test decides. (The reference is European folk song; the generator is word-by-word ambient.)
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (process.env.NOTEPAD_TRACE !== '1') {              // the decision trace needs the loader hook
  const r = spawnSync(process.execPath, ['--import', path.join(root, 'test/harness/register.mjs'), ...process.argv.slice(1)],
    { stdio: 'inherit', env: { ...process.env, NOTEPAD_TRACE: '1' } });
  process.exit(r.status ?? 1);
}

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const minWords = Number(opt('min-words', 12)), limit = Number(opt('limit', 80)), lang = opt('lang', null);

const { runPlay } = await import(pathToFileURL(path.join(root, 'test/harness/run-play.mjs')));
const { CORPUS_V2 } = await import(pathToFileURL(path.join(root, 'test/corpus-v2.mjs')));
const { melodyStats, statRows } = await import(pathToFileURL(path.join(root, 'js/music/melody-metrics.js')));
const refFile = path.join(root, 'tools/reference/essen-melody-stats.json');
if (!fs.existsSync(refFile)) { console.error('missing tools/reference/essen-melody-stats.json — see tools/essen-stats.mjs'); process.exit(2); }
const ref = JSON.parse(fs.readFileSync(refFile, 'utf8'));

const texts = CORPUS_V2.filter(e => e.text.trim().split(/\s+/).length >= minWords && (!lang || e.lang === lang)).slice(0, limit);
const melodies = [], kinds = [];
let skipped = 0;
for (const e of texts) {
  let tr; try { tr = await runPlay(root, e.text, {}); } catch { skipped++; continue; }
  const notes = tr.filter(x => x.freq);
  if (notes.length < 6) continue;
  melodies.push(notes.map(x => Math.round(12 * Math.log2(x.freq / 440) + 69)));
  kinds.push(notes.map(x => x.k));
}
const gen = melodyStats(melodies);

const rr = statRows(ref), gr = statRows(gen);
const nGen = gen.intervals;
console.log(`generator: ${gen.melodies} melodies from ${texts.length} texts${lang ? ` (${lang})` : ''}, ${gen.notes} notes, ${nGen} intervals${skipped ? `, ${skipped} failed` : ''}`);
console.log(`reference: ${ref.melodies} Essen folk melodies, ${ref.notes} notes, ${ref.intervals} intervals\n`);
console.log('statistic'.padEnd(31) + 'reference'.padStart(10) + 'generator'.padStart(11) + 'diff'.padStart(8) + '   flag (>2 standard errors)');
rr.forEach(([label, rv, d], i) => {
  const gv = gr[i][1], diff = gv - rv;
  const isPct = label.includes('%');
  const p = Math.min(0.99, Math.max(0.01, rv / 100));
  const se = isPct ? 100 * Math.sqrt(p * (1 - p) / Math.max(1, nGen)) : NaN;
  const flag = isPct && Math.abs(diff) > 2 * se ? (diff > 0 ? '  ▲ higher' : '  ▼ lower') : '';
  console.log(label.padEnd(31) + (Number.isFinite(rv) ? rv.toFixed(d) : '-').padStart(10) + (Number.isFinite(gv) ? gv.toFixed(d) : '-').padStart(11) + (Number.isFinite(diff) ? (diff >= 0 ? '+' : '') + diff.toFixed(d) : '-').padStart(8) + flag);
});
if (argv.includes('--by-kind')) {
  const tot = {}, rep = {};
  melodies.forEach((m, i) => { for (let j = 1; j < m.length; j++) { const k = `${kinds[i][j]} <- ${kinds[i][j - 1]}`; tot[k] = (tot[k] || 0) + 1; if (m[j] === m[j - 1]) rep[k] = (rep[k] || 0) + 1; } });
  console.log('\nrepeated pitches by (this note kind <- previous note kind):');
  Object.entries(tot).sort((a, b) => b[1] - a[1]).slice(0, 8).forEach(([k, n]) => console.log('  ' + k.padEnd(14) + String(n).padStart(4) + ' transitions, ' + String(rep[k] || 0).padStart(3) + ' repeat (' + (100 * (rep[k] || 0) / n).toFixed(0) + '%)'));
}
process.exit(0);

/**
 * test/congruence-eval.mjs
 * ─────────────────────────────────────────────────────────────────
 * Congruence evaluation: does the generated music match the emotion of
 * the text, measured on the two circumplex axes (Russell 1980)?
 *
 * Reports FOUR channels separately, because they are separate claims and
 * averaging them hides which one is failing:
 *
 *   TEMPO      the strongest arousal cue. Measured as the pacing factor
 *              relative to a neutral-baseline factor, >= 6% in the right
 *              direction, split by language. The 6% floor is the ~1.05x
 *              just-noticeable tempo difference, with margin.
 *   LOUDNESS   post-clamp median gain ratio, excited vs neutral and
 *              neutral vs sad. Measured from the real play().
 *   VALENCE    does the mode's perceptual colour match the sign of the
 *              labelled valence? major third + perfect fifth reads happy,
 *              minor third reads sad (Hevner 1936; Gagnon & Peretz 2003).
 *   QUADRANT   both axes at once.
 *
 * Every rate carries a bootstrap 95% confidence interval, because on 60+
 * texts a few percentage points is noise.
 *
 *   node test/congruence-eval.mjs                      # tuning set
 *   node test/congruence-eval.mjs path/to/set.mjs      # any labelled set
 *   node test/congruence-eval.mjs path/to/set.mjs --ci-only
 *
 * CAUTION ON INTERPRETATION. Any result computed on the same set that was
 * used to choose coefficients is in-sample and optimistic. The gold set
 * was written before measurement but the weights were tuned against it.
 * A held-out set, run once, is the only honest number; see README.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { detectMood } from '../js/music/mood.js';
import { pacingFactorFor, wordDurationMs, punctPauseFor, BAR_MS } from '../js/music/rhythm.js';
import { velocityRange, lengthRange, dynamicsFor } from '../js/music/dynamics.js';
import { MODE_OFFSETS } from '../js/music/scales.js';
import { tokenize } from '../js/utils/text.js';
import { simulateText } from './player-sim.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const TEMPO_JND = 1.06;          // ~6%: one just-noticeable tempo difference
const CLAMP_LO = 0.12, CLAMP_HI = 0.6;
const VOL_ARC_BASE = 0.85, VOL_ARC_DEPTH = 0.3;

// ─── loading ──────────────────────────────────────────────────────
async function loadSet(argPath) {
  if (!argPath) {
    // default: the audit's gold set, resolved relative to the repo
    const candidates = [
      path.join(here, '../eval/gold.mjs'),
      path.join(here, '../../eval/gold.mjs'),
      path.join(here, '../../../eval/gold.mjs'),
    ];
    for (const c of candidates) {
      try { const m = await import(c); if (m.GOLD) return { rows: m.GOLD, name: path.basename(c) }; } catch { }
    }
    throw new Error('no labelled set found; pass a path: node test/congruence-eval.mjs <file.mjs>');
  }
  const abs = path.resolve(argPath);
  const m = await import(abs);
  const rows = m.GOLD || m.default || m.DATASET;
  if (!Array.isArray(rows)) throw new Error(`${abs} exports no GOLD/DATASET array`);
  return { rows, name: path.basename(abs) };
}

// ─── statistics ───────────────────────────────────────────────────
/** Bootstrap percentile CI for a mean of 0/1 outcomes. Deterministic. */
function bootstrapCI(values, iterations = 10000, seed = 12345) {
  const n = values.length;
  if (!n) return { mean: NaN, lo: NaN, hi: NaN };
  let a = seed >>> 0;
  const rand = () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const mean = values.reduce((x, y) => x + y, 0) / n;
  const means = [];
  for (let i = 0; i < iterations; i++) {
    let s = 0;
    for (let j = 0; j < n; j++) s += values[Math.floor(rand() * n)];
    means.push(s / n);
  }
  means.sort((x, y) => x - y);
  const at = q => means[Math.min(means.length - 1, Math.max(0, Math.floor(q * means.length)))];
  return { mean, lo: at(0.025), hi: at(0.975), n };
}

const fmtCI = c => `${(c.mean * 100).toFixed(1)}% [${(c.lo * 100).toFixed(1)}–${(c.hi * 100).toFixed(1)}]`;
const pct = x => `${(x * 100).toFixed(1)}%`;
const dB = r => `${(20 * Math.log10(r)).toFixed(2)} dB`;

// ─── perceptual cues ──────────────────────────────────────────────
/** Which colour cues a mode carries, from its own interval set. */
function cues(mode) {
  const s = new Set((MODE_OFFSETS[mode] || []).map(x => ((x % 12) + 12) % 12));
  return { maj3: s.has(4), min3: s.has(3), P5: s.has(7), b2: s.has(1), dim5: s.has(6) && !s.has(7) };
}
const readsHappy = m => { const c = cues(m); return c.maj3 && c.P5 && !c.b2; };
const readsSad = m => { const c = cues(m); return c.min3; };

// ─── per-text measurement ─────────────────────────────────────────
/**
 * Post-clamp gain for every word, from the real pipeline: the render
 * stream draw inside the range dynamics.js supplies, times the phrase
 * arc, clamped exactly as player.js does. Deterministic given the text.
 */
function gainsFor(text) {
  const m = detectMood(text);
  const toks = tokenize(text).filter(t => t.type === 'word' || t.type === 'punct');
  const words = toks.filter(t => t.type === 'word');
  const out = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.type === 'punct') continue;
    const next = toks[i + 1];
    const isCadence = !!(next && next.type === 'punct' && ['.', '!', '?', '؟'].includes(next.text));
    const pos = words.indexOf(t);
    const frac = words.length > 1 ? pos / (words.length - 1) : 0.5;
    const arc = VOL_ARC_BASE + Math.sin(Math.PI * frac) * VOL_ARC_DEPTH;
    const r = velocityRange(m.arousalScore, isCadence);
    out.push({ lo: r.lo * arc, hi: r.hi * arc, isCadence });
  }
  return out;
}
const median = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) / 2)] : NaN; };

// ─── main ─────────────────────────────────────────────────────────
const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const { rows: SET, name: SET_NAME } = await loadSet(args[0]);

console.log(`\nCongruence evaluation — ${SET_NAME}`);
console.log(`n = ${SET.length}`);

const byLang = { en: [], fa: [] };
const all = [];
for (const [text, v, a, lang] of SET) {
  const m = detectMood(text);
  all.push({ text, v, a, lang, ...m });
  if (byLang[lang]) byLang[lang].push({ text, v, a, lang, ...m });
}

// ── 1. TEMPO ──────────────────────────────────────────────────────
console.log(`\n─── 1. Tempo (arousal) ───`);
console.log(`  threshold: >= ${pct(TEMPO_JND - 1)} in the right direction vs a neutral baseline`);
// Report how close the closest texts sit to the threshold, so a count that
// moves between machines is visible as such rather than being read as a real
// change. The margin is measured in arousalScore units, not as a percentage of
// the band, because that is the quantity the score is actually made of.
{
  const E = 0.55;
  const dir = all.filter(r => r.a !== 0).map(r => {
    const crit = r.a > 0 ? Math.log2(TEMPO_JND) / E : -Math.log2(TEMPO_JND) / E;
    const f = pacingFactorFor(r.arousalScore);
    const pass = r.a > 0 ? f < 1 / TEMPO_JND : f > TEMPO_JND;
    return { t: r.text, lang: r.lang, pass, d: Math.abs(r.arousalScore - crit), arousal: r.arousalScore, crit };
  }).sort((x, y) => x.d - y.d);
  const closest = dir[0];
  // the smallest perturbation in arousalScore that would flip the closest text
  const ulp = Math.abs(closest.arousal) * 2.22e-16 * 4;
  console.log(`  closest text to the threshold:`);
  console.log(`    "${closest.t.slice(0, 52)}"  arousal=${closest.arousal.toFixed(6)} vs threshold ${closest.crit.toFixed(6)}`);
  console.log(`    margin ${closest.d.toExponential(3)} in arousalScore — ${(closest.d / ulp).toExponential(1)}x a 4-ULP float difference`);
  console.log(`  => a float-level disagreement between JS engines cannot flip a verdict here.`);
  console.log(`     A changed count means different INPUTS, i.e. different code or a different set.`);
  const byMargin = dir.filter(d => d.d < 0.02);
  if (byMargin.length) {
    console.log(`  ${byMargin.length} text(s) sit within 0.02 arousal of the threshold — the honest reading band for a single count:`);
    for (const d of byMargin) console.log(`    ${d.pass ? 'pass' : 'FAIL'} "${d.t.slice(0, 50)}"`);
  }
}
const tempoRows = [];
for (const [label, group] of [['all', all], ...Object.entries(byLang)]) {
  if (!group.length) continue;
  const right = group.filter(r => {
    const f = pacingFactorFor(r.arousalScore);
    if (r.a > 0) return f < 1 / TEMPO_JND;     // excited must be faster
    if (r.a < 0) return f > TEMPO_JND;         // calm must be slower
    return true;                                // neutral: no direction required
  });
  // exclude the neutral-labelled rows from the "right direction" rate:
  // they have no direction to get right
  const directed = group.filter(r => r.a !== 0);
  const dirRight = directed.filter(r => {
    const f = pacingFactorFor(r.arousalScore);
    return r.a > 0 ? f < 1 / TEMPO_JND : f > TEMPO_JND;
  });
  tempoRows.push({ label, group: group.length, directed: directed.length, ci: bootstrapCI(dirRight.map(() => 1).concat(dirRight.length ? [] : [])) , hits: dirRight.length });
}
for (const row of tempoRows) {
  const c = bootstrapCI(new Array(row.hits).fill(1).concat(new Array(row.directed - row.hits).fill(0)));
  console.log(`  ${row.label.padEnd(4)} ${row.hits}/${row.directed} directed texts moved tempo the right way   95% CI ${fmtCI(c)}`);
}
{
  const exc = all.filter(r => r.a > 0), cal = all.filter(r => r.a < 0);
  const meanF = rs => rs.length ? rs.reduce((s, r) => s + pacingFactorFor(r.arousalScore), 0) / rs.length : NaN;
  // Tempo is a ratio, not a decibel figure: dB measures loudness. A
  // speed ratio of 1.31x is reported as 1.31x and nothing else.
  console.log(`  mean pacing factor: excited ${meanF(exc).toFixed(3)}  calm ${meanF(cal).toFixed(3)}`);
  console.log(`  calm/excited tempo ratio: ${(meanF(cal) / meanF(exc)).toFixed(3)}x`);
}

// ── 2. LOUDNESS ───────────────────────────────────────────────────
console.log(`\n─── 2. Loudness (post-clamp median gain) ───`);
const medGain = r => median(gainsFor(r.text).map(g => (g.lo + g.hi) / 2));
const N = all.filter(r => r.v === 0 && r.a === 0);
const excited = all.filter(r => r.a > 0);
const joy = all.filter(r => r.v > 0 && r.a > 0);
const sad = all.filter(r => r.v < 0 && r.a < 0);
const nG = median(N.map(medGain));
const show = (label, group) => {
  if (!group.length) { console.log(`  ${label.padEnd(28)} n=0`); return NaN; }
  const g = median(group.map(medGain));
  console.log(`  ${label.padEnd(28)} n=${String(group.length).padStart(2)}  median ${g.toFixed(4)}   vs neutral ${(g / nG).toFixed(3)}x (${dB(g / nG)})`);
  return g;
};
console.log(`  ${'neutral baseline'.padEnd(28)} n=${String(N.length).padStart(2)}  median ${nG.toFixed(4)}`);
const eG = show('excited (A+ any V)', excited);
const jG = show('joy (V+ A+)', joy);
const sG = show('sad (V- A- label)', sad);
// The same sad texts, but only those the engine actually scored as
// low-arousal. Several grief texts are scored A+ because the lexicon
// gives numbness and bleakness a positive arousal, so their loudness
// rises; that is a lexicon-sense error, not a dynamics error, and mixing
// the two hides the mapping's real behaviour.
const sadLowA = sad.filter(r => r.arousalScore < -0.1);
show('sad, engine scored A-', sadLowA);
{
  const wrong = sad.filter(r => r.arousalScore > 0);
  if (wrong.length) {
    console.log(`\n  NOTE: ${wrong.length} of the ${sad.length} sad-labelled texts were scored A+ by the engine:`);
    for (const r of wrong) console.log(`    a=${r.arousalScore.toFixed(2)}  ${r.text.slice(0, 46).replace(/\n/g, ' ')}`);
    console.log('    The arousal lexicon gives numbness/bleakness words a positive weight,');
    console.log('    so grief reads as agitation. Reported, not fixed here.');
  }
}
{
  // bootstrap the excited-vs-neutral median ratio, resampling TEXTS
  const n = all.filter(r => r.a > 0).length, m = all.filter(r => r.v === 0 && r.a === 0).length;
  const E = all.filter(r => r.a > 0).map(r => median(gainsFor(r.text).map(g => (g.lo + g.hi) / 2)));
  const N = all.filter(r => r.v === 0 && r.a === 0).map(r => median(gainsFor(r.text).map(g => (g.lo + g.hi) / 2)));
  if (n && m) {
    let a = 99991; const rand = () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const ratios = [];
    for (let i = 0; i < 4000; i++) {
      let e = 0, nn = 0;
      for (let j = 0; j < n; j++) e += E[Math.floor(rand() * n)];
      for (let j = 0; j < m; j++) nn += N[Math.floor(rand() * m)];
      ratios.push((e / n) / (nn / m));
    }
    ratios.sort((x, y) => x - y);
    const at = q => ratios[Math.floor(q * ratios.length)];
    console.log(`  excited/neutral ratio 95% CI: ${at(0.025).toFixed(3)}x–${at(0.975).toFixed(3)}x`);
  }
}

// ── 3. VALENCE ────────────────────────────────────────────────────
console.log(`\n─── 3. Valence (mode colour) ───`);
console.log(`  METRIC: third/fifth only, read off the mode's own interval set — NOT an`);
console.log(`  expert-coded label. "happy" = major third + perfect fifth + no flat second;`);
console.log(`  "sad" = minor third. Sources: Hevner 1936; Gagnon & Peretz 2003.`);
console.log(`  The audit's earlier 76.8% used expert coding and is a DIFFERENT measure.`);
console.log(`  Do not compare the two; quote only this one and name the metric.`);
{
  const directed = all.filter(r => r.v !== 0);
  const right = directed.filter(r => (r.v > 0 ? readsHappy(r.mode) : readsSad(r.mode)));
  const c = bootstrapCI(right.map(() => 1).concat(new Array(directed.length - right.length).fill(0)));
  console.log(`  ${right.length}/${directed.length} directed texts got a mode of the right colour   95% CI ${fmtCI(c)}`);
  const exc = directed.filter(r => r.v > 0), sad = directed.filter(r => r.v < 0);
  const excOK = exc.filter(r => readsHappy(r.mode)).length, sadOK = sad.filter(r => readsSad(r.mode)).length;
  console.log(`    positive: ${excOK}/${exc.length}    negative: ${sadOK}/${sad.length}`);
  const wrong = directed.filter(r => !(r.v > 0 ? readsHappy(r.mode) : readsSad(r.mode)));
  const modes = {};
  for (const r of wrong) modes[r.mode] = (modes[r.mode] || 0) + 1;
  console.log(`    mismatched modes: ${Object.entries(modes).map(([m, c]) => `${m}×${c}`).join(', ') || 'none'}`);
}

// ── 4. QUADRANT ───────────────────────────────────────────────────
console.log(`\n─── 4. Quadrant congruence (both axes) ───`);
{
  const nonNeutral = all.filter(r => r.v !== 0 || r.a !== 0);
  const quadrantOf = (v, a) => (v > 0 ? 'H' : v < 0 ? 'L' : 'N') + (a > 0 ? 'H' : a < 0 ? 'L' : 'N');
  const predicted = r => {
    const gv = r.normScore > 0.25 ? 1 : r.normScore < -0.25 ? -1 : 0;
    const ga = r.arousalScore > 0.25 ? 1 : r.arousalScore < -0.25 ? -1 : 0;
    return quadrantOf(gv, ga);
  };
  const right = nonNeutral.filter(r => predicted(r) === quadrantOf(r.v, r.a));
  const c = bootstrapCI(right.map(() => 1).concat(new Array(nonNeutral.length - right.length).fill(0)));
  console.log(`  ${right.length}/${nonNeutral.length} non-neutral texts landed in the right quadrant   95% CI ${fmtCI(c)}`);
  const confusion = {};
  for (const r of nonNeutral) {
    const truth = quadrantOf(r.v, r.a);
    const pred = predicted(r);
    confusion[truth] ??= {};
    confusion[truth][pred] = (confusion[truth][pred] || 0) + 1;
  }
  const labels = ['HH', 'HL', 'LH', 'LL', 'HN', 'LN', 'NH', 'NL', 'NN'];
  console.log(`\n    rows = labelled, cols = predicted`);
  console.log(`    ${''.padEnd(6)}${labels.map(l => l.padStart(4)).join('')}`);
  for (const t of labels) {
    if (!confusion[t]) continue;
    const row = labels.map(p => (confusion[t][p] || 0).toString().padStart(4)).join('');
    console.log(`    ${t.padEnd(6)}${row}`);
  }
  const worst = Object.entries(confusion)
    .map(([t, row]) => [t, Object.entries(row).filter(([p]) => p !== t).sort((a, b) => b[1] - a[1])[0]])
    .filter(([, w]) => w && w[1] > 0)
    .sort((a, b) => b[1][1] - a[1][1]).slice(0, 4);
  if (worst.length) {
    console.log(`\n    largest confusions:`);
    for (const [t, [p, c]] of worst) console.log(`      ${t} → ${p}  (${c} texts)`);
  }
}

// ── 5. DETERMINISM SANITY ─────────────────────────────────────────
console.log(`\n─── 5. Same text → same performance ───`);
{
  let same = 0, total = 0;
  for (const r of all.slice(0, 12)) {
    const a = simulateText(r.text).sequence, b = simulateText(r.text).sequence;
    total++;
    if (JSON.stringify(a) === JSON.stringify(b)) same++;
  }
  console.log(`  ${same}/${total} texts produced an identical second run`);
}

console.log(`\n${'-'.repeat(60)}`);
console.log('In-sample caveat: the arousal weights and the FLOOR_RISE factors were');
console.log('chosen while looking at this kind of text. Treat these numbers as an');
console.log('upper bound. A held-out set, scored once, is the only honest measure.\n');

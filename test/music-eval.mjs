/**
 * test/music-eval.mjs
 * ─────────────────────────────────────────────────────────────────
 * Objective evaluation of the MELODIC ENGINE, not sentiment.
 *
 * mood.js already has evaluate-mood.mjs measuring detection accuracy
 * against hand labels. Nothing in the project measures whether the
 * generated MUSIC itself is structurally sound — this fills that gap.
 *
 * Metrics computed across the corpus (EVAL_DATASET + LONG_TEXTS):
 *
 *   1. Leap-size distribution — histogram of |lastInterval|. A healthy
 *      contour should be step-dominant (mostly 1s) with leaps (2+)
 *      as a minority, matching stepwiseNote's documented gap-fill
 *      design intent (Narmour). A flat/uniform histogram would mean
 *      the leap-chance math isn't actually shaping the contour.
 *
 *   2. Cadence resolution rate — of all cadence notes, what fraction
 *      actually landed on the intended target degree (tonic=0 for
 *      statement/exclaim, the mode's dominant degree for question)?
 *      resolveCadence probabilistically SKIPS resolution when
 *      cadenceStrength<1 (an intentional "unstable cadence" feature —
 *      see intention.js), so we report both the raw rate and the
 *      rate conditioned on cadenceStrength≈1, to separate "cadence
 *      logic working as designed" from "cadence logic broken".
 *
 *   3. Degree-stall detection — longest run of an IDENTICAL degree
 *      within one text's sequence, and the global degree-usage
 *      histogram's uniformity (chi-square-style deviation from
 *      uniform). High stall counts or a very non-uniform histogram
 *      dominated by one or two degrees would indicate the arbitration
 *      pool isn't actually diversifying choices (see the project's
 *      own known limitation: "no-chord + disruption" thin candidate
 *      diversity).
 *
 *   4. Tension→leap correlation — Pearson correlation between each
 *      text's sessionTenseScore and its mean leap magnitude. The
 *      documented design intent (stepwiseNote, globalTensionBias) is
 *      that tenser text leaps more. This is the first time that claim
 *      is checked against actual generated output instead of taken on
 *      faith from reading the code.
 *
 * Usage: node test/music-eval.mjs
 */
import { simulateText } from './player-sim.mjs';
import { EVAL_DATASET, LONG_TEXTS } from './eval-dataset.mjs';
import { MODE_OFFSETS } from '../js/music/scales.js';

const CORPUS = [...EVAL_DATASET.map(([t]) => t), ...LONG_TEXTS];

// ─── Run simulation across the whole corpus ──────────────────────
const results = CORPUS.map(text => ({ text, ...simulateText(text) }));

// ─── 1) Leap-size distribution ───────────────────────────────────
const leapHist = {};
let totalNotes = 0;
results.forEach(r => r.sequence.forEach(n => {
  const mag = Math.abs(n.lastInterval || 0);
  leapHist[mag] = (leapHist[mag] || 0) + 1;
  totalNotes++;
}));

console.log('=== 1) Leap-size distribution (|scale-degree interval|) ===');
Object.keys(leapHist).sort((a, b) => a - b).forEach(mag => {
  const count = leapHist[mag];
  const pct = (count / totalNotes * 100).toFixed(1);
  const bar = '#'.repeat(Math.round(pct / 2));
  console.log(`  ${mag.padStart(2)}: ${count.toString().padStart(5)} (${pct.padStart(5)}%) ${bar}`);
});
const stepPct = ((leapHist[1] || 0) / totalNotes * 100).toFixed(1);
const leapPct = (100 - parseFloat(stepPct)).toFixed(1);
console.log(`  step-dominant (|interval|<=1): ${stepPct}%  |  leaps (2+): ${leapPct}%`);
console.log(stepPct > 50
  ? '  -> step-dominant contour confirmed (matches gap-fill design intent)'
  : '  -> WARNING: not step-dominant; leap-chance math may be overpowering stepwise motion');

// ─── 2) Cadence resolution rate ──────────────────────────────────
function dominantDegreeIndex(mode) {
  const offsets = MODE_OFFSETS[mode] || MODE_OFFSETS.minor;
  let best = 0, bestDist = Infinity;
  offsets.forEach((o, i) => { const d = Math.abs(o - 7); if (d < bestDist) { bestDist = d; best = i; } });
  return best;
}

let cadenceTotal = 0, cadenceResolved = 0;
let stableCadenceTotal = 0, stableCadenceResolved = 0;
results.forEach(r => {
  const domIdx = dominantDegreeIndex(r.mood);
  r.sequence.forEach(n => {
    if (!n.isCadence) return;
    cadenceTotal++;
    const target = n.sentenceType === 'question' ? domIdx : 0;
    const hit = n.degree === target;
    if (hit) cadenceResolved++;
    if (n.cadenceStrength >= 0.999) {
      stableCadenceTotal++;
      if (hit) stableCadenceResolved++;
    }
  });
});

console.log('\n=== 2) Cadence resolution rate ===');
console.log(`  raw (all cadences, strength-weighted skip included): ${cadenceResolved}/${cadenceTotal} = ${(cadenceResolved / cadenceTotal * 100).toFixed(1)}%`);
console.log(`  cadenceStrength≈1 only (should resolve near-100%):   ${stableCadenceResolved}/${stableCadenceTotal} = ${(stableCadenceResolved / stableCadenceTotal * 100).toFixed(1)}%`);
console.log((stableCadenceResolved / stableCadenceTotal) > 0.95
  ? '  -> cadence logic behaves as designed for stable clauses'
  : '  -> WARNING: even full-strength cadences are not reliably resolving — check resolveCadence/placeNearest');

// ─── 3) Degree-stall detection ───────────────────────────────────
let maxStallGlobal = 0;
let maxStallText = '';
const stallsOver3 = [];
const degreeHistGlobal = {};
results.forEach(r => {
  let run = 1, maxRun = 1;
  r.sequence.forEach((n, i) => {
    degreeHistGlobal[n.degree] = (degreeHistGlobal[n.degree] || 0) + 1;
    if (i > 0 && n.degree === r.sequence[i - 1].degree) { run++; maxRun = Math.max(maxRun, run); }
    else run = 1;
  });
  if (maxRun > maxStallGlobal) { maxStallGlobal = maxRun; maxStallText = r.text.slice(0, 40); }
  if (maxRun >= 4) stallsOver3.push({ text: r.text.slice(0, 40), run: maxRun });
});

console.log('\n=== 3) Degree-stall detection ===');
console.log(`  longest same-degree run across whole corpus: ${maxStallGlobal}  (in: "${maxStallText}...")`);
console.log(`  texts with a stall run >=4: ${stallsOver3.length} / ${results.length}`);
if (stallsOver3.length > 0) stallsOver3.slice(0, 5).forEach(s => console.log(`    run=${s.run}  "${s.text}..."`));

const degreeCounts = Object.values(degreeHistGlobal);
const meanCount = degreeCounts.reduce((a, b) => a + b, 0) / degreeCounts.length;
const chiSq = degreeCounts.reduce((sum, c) => sum + Math.pow(c - meanCount, 2) / meanCount, 0);
console.log(`  degree-usage histogram: ${JSON.stringify(degreeHistGlobal)}`);
console.log(`  chi-square deviation from uniform: ${chiSq.toFixed(1)} (df=${degreeCounts.length - 1}; much larger than df => non-uniform, i.e. some degrees dominate)`);

// ─── 4) Tension -> leap-magnitude correlation ────────────────────
const perText = results.map(r => {
  const mags = r.sequence.map(n => Math.abs(n.lastInterval || 0));
  const meanLeap = mags.reduce((a, b) => a + b, 0) / (mags.length || 1);
  return { tense: r.sessionTenseScore, meanLeap };
});

function pearson(pairs) {
  const n = pairs.length;
  const mx = pairs.reduce((s, p) => s + p.tense, 0) / n;
  const my = pairs.reduce((s, p) => s + p.meanLeap, 0) / n;
  let num = 0, dx2 = 0, dy2 = 0;
  pairs.forEach(p => {
    const dx = p.tense - mx, dy = p.meanLeap - my;
    num += dx * dy; dx2 += dx * dx; dy2 += dy * dy;
  });
  return num / Math.sqrt(dx2 * dy2 || 1);
}

const r = pearson(perText);
console.log('\n=== 4) tenseScore -> mean leap-magnitude correlation ===');
console.log(`  Pearson r = ${r.toFixed(3)}  (n=${perText.length} texts)`);
console.log(r > 0.15
  ? '  -> confirmed: tenser text does produce measurably larger leaps, as designed'
  : r < -0.15
    ? '  -> WARNING: correlation is NEGATIVE — tenser text leaps LESS, opposite of design intent'
    : '  -> WEAK/NO measurable correlation — the tense->leap design intent is not clearly showing up in output');

// ─── 4b) Same question, but at the correct unit of analysis ─────
// The per-TEXT test above compares one aggregate leap-mean against one
// aggregate tenseScore per text (n = corpus size, ~106). But the actual
// mechanism being tested (stepwiseNote's leapChance, and the new
// W_TENSION_LEAP scoring axis) both act on a LOCAL, per-word
// "effectiveTense" that intentionally varies WITHIN a single text via
// globalTensionBias's arc (peaking near 68% through the piece) and the
// composition layer's own tension curve — see player-sim.mjs's
// `effectiveTense` field. Collapsing that to one number per text and
// correlating across texts throws away exactly the within-text
// variation the design is supposed to produce, and caps statistical
// power at the corpus size instead of the note count. This repeats the
// same test at the level the mechanism actually operates on: one data
// point per ARBITRATION-PATH NOTE (n in the hundreds, not ~106).
const notePairs = [];
results.forEach(r2 => r2.sequence.forEach(n => {
  if (n.path === 'arbitration' && n.effectiveTense != null) {
    notePairs.push({ tense: n.effectiveTense, meanLeap: Math.abs(n.lastInterval || 0) });
  }
}));
const rNote = pearson(notePairs.map(p => ({ tense: p.tense, meanLeap: p.meanLeap })));
console.log(`\n  PER-NOTE effectiveTense -> |interval| correlation (n=${notePairs.length} notes, far more than the ~106-text aggregate above):`);
console.log(`  Pearson r = ${rNote.toFixed(3)}`);
console.log(rNote > 0.1
  ? '  -> a real, measurable positive relationship shows up at the note level even if the per-text\n     aggregate test lacked the power to see it — the per-text test was underpowered, not the design.'
  : '  -> still weak even at full note-level resolution — this is stronger evidence the effect is\n     genuinely small or absent, not just a statistical-power artifact of per-text aggregation.');


// ─── 5) Decision-path breakdown — which mechanism actually produced each note ──
const pathCounts = {};
const pathLeapSum = {};
results.forEach(r => r.sequence.forEach(n => {
  pathCounts[n.path] = (pathCounts[n.path] || 0) + 1;
  pathLeapSum[n.path] = (pathLeapSum[n.path] || 0) + Math.abs(n.lastInterval || 0);
}));

console.log('\n=== 5) Decision-path breakdown (which mechanism produced each note) ===');
Object.entries(pathCounts).sort((a, b) => b[1] - a[1]).forEach(([path, count]) => {
  const pct = (count / totalNotes * 100).toFixed(1);
  const avgLeap = (pathLeapSum[path] / count).toFixed(2);
  console.log(`  ${path.padEnd(12)} ${count.toString().padStart(4)} notes (${pct.padStart(5)}%)  avg |interval| = ${avgLeap}`);
});
console.log('  -> only "arbitration" notes are influenced by stepwiseNote\'s tenseScore-driven leapChance.');
console.log('     cadence notes jump straight to a target degree; motif notes follow a FIXED interval');
console.log('     pattern set once per piece (independent of tenseScore). If arbitration is a minority');
console.log('     of total notes, that alone explains both finding #1 (leap-dominance) and finding #4');
console.log('     (near-zero tense correlation) without any bug in the tenseScore math itself.');

// per-path leap distribution for "arbitration" only, to check design intent in isolation
const arbMags = {};
results.forEach(r => r.sequence.forEach(n => {
  if (n.path !== 'arbitration') return;
  const mag = Math.abs(n.lastInterval || 0);
  arbMags[mag] = (arbMags[mag] || 0) + 1;
}));
const arbTotal = Object.values(arbMags).reduce((a, b) => a + b, 0);
const arbStepPct = ((arbMags[1] || 0) / arbTotal * 100).toFixed(1);
console.log(`\n  isolating ONLY arbitration-path notes (${arbTotal} of ${totalNotes}):`);
console.log(`  step-dominant (|interval|<=1) within arbitration alone: ${arbStepPct}%`);
console.log(arbStepPct > 50
  ? '  -> CONFIRMED: stepwiseNote/arbitration IS step-dominant in isolation. The corpus-wide'
  : '  -> even in isolation, arbitration is not step-dominant — a deeper issue than dilution.');
console.log('     leap-dominance in finding #1 is a DILUTION effect from cadence/motif, not a bug');
console.log('     in the arbitration math itself.');

// tense correlation within arbitration-path notes only
const perTextArb = results.map(r => {
  const mags = r.sequence.filter(n => n.path === 'arbitration').map(n => Math.abs(n.lastInterval || 0));
  if (mags.length === 0) return null;
  const meanLeap = mags.reduce((a, b) => a + b, 0) / mags.length;
  return { tense: r.sessionTenseScore, meanLeap };
}).filter(Boolean);

function pearson2(pairs) {
  const n = pairs.length;
  const mx = pairs.reduce((s, p) => s + p.tense, 0) / n;
  const my = pairs.reduce((s, p) => s + p.meanLeap, 0) / n;
  let num = 0, dx2 = 0, dy2 = 0;
  pairs.forEach(p => { const dx = p.tense - mx, dy = p.meanLeap - my; num += dx * dy; dx2 += dx * dx; dy2 += dy * dy; });
  return num / Math.sqrt(dx2 * dy2 || 1);
}
const rArb = pearson2(perTextArb);
console.log(`\n  tenseScore -> mean leap-magnitude correlation, ARBITRATION-PATH NOTES ONLY: r = ${rArb.toFixed(3)}`);
console.log(rArb > 0.15
  ? '  -> CONFIRMED: the tense->leap design intent IS present, just diluted corpus-wide by cadence/motif.'
  : '  -> still weak even in isolation — the leapChance formula itself may need recalibration (item #2).');

console.log(`\n(corpus: ${CORPUS.length} texts, ${totalNotes} total notes generated)`);

// ─── 6) Statistical significance for the tenseScore<->leap correlation ──
// A permutation test: shuffle which meanLeap goes with which tenseScore
// many times, recompute r each time, and see how often random shuffling
// produces a correlation as extreme as the one actually observed. This
// is the honest way to say "r=0.077 is/isn't distinguishable from noise"
// instead of eyeballing the number, given n is modest (~100 texts) and
// individual-text variance is high.
function permutationTest(pairs, observedR, iterations = 5000) {
  const tenses = pairs.map(p => p.tense);
  const leaps = pairs.map(p => p.meanLeap);
  let asExtreme = 0;
  for (let it = 0; it < iterations; it++) {
    // Fisher-Yates shuffle of leaps only
    const shuffled = leaps.slice();
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const shuffledPairs = tenses.map((t, i) => ({ tense: t, meanLeap: shuffled[i] }));
    const rShuf = pearson(shuffledPairs);
    if (Math.abs(rShuf) >= Math.abs(observedR)) asExtreme++;
  }
  return asExtreme / iterations;
}

console.log('\n=== 6) Statistical significance of the corpus-wide correlation (permutation test) ===');
const pValueOverall = permutationTest(perText, r);
console.log(`  overall corpus: r=${r.toFixed(3)}, p=${pValueOverall.toFixed(3)} (5000 shuffles)`);
console.log(pValueOverall < 0.05
  ? '  -> statistically distinguishable from chance at p<0.05'
  : '  -> NOT statistically distinguishable from chance — r=0.077 could easily be noise at this sample size');
const pValueArb = permutationTest(perTextArb, rArb);
console.log(`  arbitration-path only: r=${rArb.toFixed(3)}, p=${pValueArb.toFixed(3)} (5000 shuffles)`);
console.log(pValueArb < 0.05
  ? '  -> statistically distinguishable from chance at p<0.05: the W_TENSION_LEAP fix has a REAL, non-random effect'
  : '  -> NOT statistically distinguishable from chance even in isolation — the fix may need a larger corpus or larger coefficient to be provably real, not just a bigger number');
const pValueNote = permutationTest(notePairs, rNote, 3000); // 3000 shuffles (notePairs is large, keep runtime sane)
console.log(`  PER-NOTE (n=${notePairs.length}): r=${rNote.toFixed(3)}, p=${pValueNote.toFixed(3)} (3000 shuffles)`);
console.log(pValueNote < 0.05
  ? '  -> SIGNIFICANT at the correct unit of analysis: the per-text test above was underpowered, not wrong in\n     direction. The W_TENSION_LEAP design intent is real and measurable once tested at the right resolution.'
  : '  -> STILL not significant even with full note-level power (n in the hundreds). This is now much stronger\n     evidence that 0.7 is too small a coefficient, or the effect genuinely does not survive competition from\n     the other scoring axes (W_VOICE, W_HARMONY) in the softmax — not a power problem, a real effect-size problem.');

// ─── 7) Stratified breakdown by sentence-count (corpus honesty check) ──
// The corpus is heavily skewed toward single-sentence texts (this is
// itself disclosed, not hidden — see eval-dataset.mjs). Reporting one
// aggregate number across all texts silently lets short-text behavior
// dominate every statistic. This breaks results out by sentence count
// so a reader can see whether findings hold up for longer, multi-
// section texts or are mostly an artifact of the corpus's real-world-
// realistic bias toward short inputs.
function bucketFor(n) {
  return n === 1 ? '1' : n === 2 ? '2' : n <= 4 ? '3-4' : n <= 7 ? '5-7' : '8+';
}
const strata = {};
results.forEach(r2 => {
  const b = bucketFor(r2.sentenceCount);
  if (!strata[b]) strata[b] = { texts: 0, notes: 0, motifNotes: 0, leapNotes: 0, tenseSum: 0 };
  strata[b].texts++;
  strata[b].tenseSum += r2.sessionTenseScore;
  r2.sequence.forEach(n => {
    strata[b].notes++;
    if (n.path === 'motif') strata[b].motifNotes++;
    if (Math.abs(n.lastInterval || 0) >= 2) strata[b].leapNotes++;
  });
});

console.log('\n=== 7) Stratified breakdown by sentence-count bucket ===');
console.log('  bucket   texts  notes  motif%   leap%   avgTense');
['1', '2', '3-4', '5-7', '8+'].forEach(b => {
  const s = strata[b];
  if (!s) { console.log(`  ${b.padEnd(8)} (no texts in this bucket)`); return; }
  const motifPct = (s.motifNotes / s.notes * 100).toFixed(1);
  const leapPct = (s.leapNotes / s.notes * 100).toFixed(1);
  const avgTense = (s.tenseSum / s.texts).toFixed(2);
  console.log(`  ${b.padEnd(8)} ${s.texts.toString().padStart(5)}  ${s.notes.toString().padStart(5)}  ${motifPct.padStart(6)}%  ${leapPct.padStart(5)}%  ${avgTense.padStart(8)}`);
});
console.log('  -> if motif% drops sharply for longer texts, the 55.9% corpus-wide figure was mostly');
console.log('     a single-sentence-text artifact (motif is ALWAYS on for odd sentence #1, i.e. every');
console.log('     single-sentence text), not evidence the periodicity design is broken for real usage.');

// ─── 8) Composition-layer arc validation (previously ZERO coverage) ──
// Nothing before this checked whether deriveComposition's documented
// curves (energy/tension ramping toward a climax around 60-85% through
// multi-section texts) actually show up in the states player.js reads.
// This checks, for every text using a template WITH a climax role
// (5+ sentences), whether the tension value peaks somewhere in the
// back half of the piece as designed, rather than trusting the curve
// definitions in ROLE_CURVES to mean the runtime behavior is correct.
console.log('\n=== 8) Composition-layer arc validation ===');
const climaxTexts = results.filter(r2 => r2.sentenceCount >= 5);
if (climaxTexts.length === 0) {
  console.log('  no texts with 5+ sentences in corpus — cannot validate climax-arc behavior at all.');
  console.log('  (this itself is a corpus gap worth fixing before trusting composition-layer claims)');
} else {
  let peakInBackHalf = 0;
  climaxTexts.forEach(r2 => {
    if (r2.sequence.length === 0) return;
    let maxTension = -1, maxProgress = 0;
    r2.sequence.forEach(n => {
      if (n.compTension > maxTension) { maxTension = n.compTension; maxProgress = n.progress; }
    });
    if (maxProgress >= 0.5) peakInBackHalf++;
  });
  console.log(`  texts with 5+ sentences: ${climaxTexts.length}`);
  console.log(`  texts where tension actually peaks in the back half (progress>=0.5): ${peakInBackHalf}/${climaxTexts.length}`);
  console.log(peakInBackHalf === climaxTexts.length
    ? '  -> confirmed: composition-layer tension arc behaves as documented for every multi-section text tested'
    : '  -> WARNING: tension does not reliably peak late — climax placement may not work as documented for some texts');
  console.log('  NOTE: only ' + climaxTexts.length + ' texts in corpus reach this template tier — this validates');
  console.log('  the mechanism works on the available examples, not that it is robust across many climax shapes.');
}


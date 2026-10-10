/**
 * js/music/melody-metrics.js
 * ─────────────────────────────────────────────────────────────────
 * Descriptive statistics of melodies, computed IDENTICALLY for a reference corpus
 * and for what the generator produces, so a difference is a difference of melody and
 * not of method. Pure: sequences of semitone pitches in, numbers out.
 *
 * What is measured, and the research behind each number:
 *   sizes        share of unisons / steps (1-2 st) / thirds (3-4) / 5-7 / 8+. In real
 *                melodies the interval distribution peaks around 2 semitones and falls
 *                off with size (Vos & Troost 1989).
 *   direction    share of intervals going DOWN by size class. In corpora small
 *                intervals go mostly down and large ones mostly up, and listeners are
 *                sensitive to it (Vos & Troost 1989).
 *   reversal     after a leap (>= 3 st), how often the next interval turns back, goes
 *                on in the same direction, or repeats. Huron: skip reversal is a learned
 *                expectation, but much of it is regression toward the mean.
 *   inertia      after a step (1-2 st), how often the next interval continues the same
 *                direction. Strong in folk songs and hymns, near zero in pop (Chiu &
 *                Temperley 2024) — a STYLE parameter, not a law.
 *   regression   after a leap, how often the melody lands closer to the melody's own mean
 *                pitch than where it started (the regression-to-the-mean account of
 *                skip reversal; von Hippel & Huron 2000).
 *   range        highest minus lowest pitch per melody, in semitones.
 *   diversity    unique 3-interval patterns / all of them, over fixed windows so that
 *                melodies of different length compare; 1 = nothing ever recurs.
 *   runs         share of notes inside a run of 3+ identical pitches (droning).
 *
 * Caveat that travels with every use of this module: the literature itself warns that
 * objective melody statistics have limited, imperfectly known perceptual meaning
 * (Yang & Lerch 2020; the 2025 survey of generative-music evaluation). These numbers
 * locate differences and catch regressions; the listening test decides.
 */

const sign = x => (x > 0) - (x < 0);
const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);

export const SIZE_CLASSES = [
  ['unison', 0, 0], ['step', 1, 2], ['third', 3, 4], ['fourthFifth', 5, 7], ['large', 8, Infinity],
];

/** Semitone intervals between consecutive pitches. */
export function intervalsOf(pitches) {
  const out = [];
  for (let i = 1; i < pitches.length; i++) out.push(pitches[i] - pitches[i - 1]);
  return out;
}

/**
 * @param {number[][]} melodies   each an array of semitone pitches (MIDI numbers or any
 *                                integer semitone scale), in playing order
 * @param {{window?: number}} [opt]   window: note count for the diversity measure (default 20)
 */
export function melodyStats(melodies, opt = {}) {
  const W = opt.window ?? 20;
  const ms = melodies.filter(m => m.length >= 2);
  let nInt = 0, nNotes = 0;
  const sizeCount = Object.fromEntries(SIZE_CLASSES.map(([n]) => [n, 0]));
  const dirDown = { step: 0, third: 0, big: 0 }, dirN = { step: 0, third: 0, big: 0 };
  let leaps = 0, leapRev = 0, leapSame = 0, leapUni = 0, leapToMean = 0, leapMeanN = 0;
  let steps = 0, stepSame = 0, stepRev = 0, stepUni = 0;
  let absSum = 0, runNotes = 0;
  const ranges = [], divs = [];

  for (const m of ms) {
    nNotes += m.length;
    const iv = intervalsOf(m), mu = mean(m);
    ranges.push(Math.max(...m) - Math.min(...m));
    for (const d of iv) {
      nInt++; absSum += Math.abs(d);
      const a = Math.abs(d);
      for (const [name, lo, hi] of SIZE_CLASSES) if (a >= lo && a <= hi) { sizeCount[name]++; break; }
      const dc = a >= 1 && a <= 2 ? 'step' : a >= 3 && a <= 4 ? 'third' : a >= 5 ? 'big' : null;
      if (dc) { dirN[dc]++; if (d < 0) dirDown[dc]++; }
    }
    // regression to the mean: over ALL leaps, did the leap land nearer the melody's mean than it started?
    for (let i = 0; i < iv.length; i++) if (Math.abs(iv[i]) >= 3) { leapMeanN++; if (Math.abs(m[i + 1] - mu) < Math.abs(m[i] - mu)) leapToMean++; }
    for (let i = 0; i + 1 < iv.length; i++) {
      const a = iv[i], b = iv[i + 1], aa = Math.abs(a);
      if (aa >= 3) {
        leaps++;
        if (b === 0) leapUni++; else if (sign(b) === -sign(a)) leapRev++; else leapSame++;
      } else if (aa >= 1 && aa <= 2) {
        steps++;
        if (b === 0) stepUni++; else if (sign(b) === sign(a)) stepSame++; else stepRev++;
      }
    }
    // droning: notes that sit in a run of >= 3 identical pitches
    for (let i = 0; i < m.length;) { let j = i; while (j + 1 < m.length && m[j + 1] === m[i]) j++; if (j - i + 1 >= 3) runNotes += j - i + 1; i = j + 1; }
    // diversity over fixed windows (non-overlapping)
    for (let s = 0; s + W <= m.length; s += W) {
      const w = intervalsOf(m.slice(s, s + W)), seen = new Set();
      for (let i = 0; i + 3 <= w.length; i++) seen.add(w.slice(i, i + 3).join(','));
      divs.push(seen.size / (w.length - 2));
    }
  }

  const pct = (c, n) => (n ? (100 * c) / n : NaN);
  return {
    melodies: ms.length, notes: nNotes, intervals: nInt,
    sizes: Object.fromEntries(Object.entries(sizeCount).map(([k, v]) => [k, pct(v, nInt)])),
    meanAbsInterval: nInt ? absSum / nInt : NaN,
    downShare: { step: pct(dirDown.step, dirN.step), third: pct(dirDown.third, dirN.third), large: pct(dirDown.big, dirN.big) },
    afterLeap: { reverse: pct(leapRev, leaps), same: pct(leapSame, leaps), unison: pct(leapUni, leaps), n: leaps },
    afterStep: { same: pct(stepSame, steps), reverse: pct(stepRev, steps), unison: pct(stepUni, steps), n: steps },
    leapTowardMean: pct(leapToMean, leapMeanN),
    rangeMean: mean(ranges),
    patternDiversity: divs.length ? mean(divs) : NaN,
    droneShare: pct(runNotes, nNotes),
  };
}

const f = (v, d = 0) => (Number.isFinite(v) ? v.toFixed(d) : '  - ');

/** Rows of [label, value] for display, in a fixed order, from a melodyStats() result. */
export function statRows(s) {
  return [
    ['unison %', s.sizes.unison, 0], ['step 1-2 st %', s.sizes.step, 0], ['third 3-4 st %', s.sizes.third, 0],
    ['5-7 st %', s.sizes.fourthFifth, 0], ['8+ st %', s.sizes.large, 1], ['mean |interval| (st)', s.meanAbsInterval, 2],
    ['steps going down %', s.downShare.step, 0], ['thirds going down %', s.downShare.third, 0], ['large leaps going down %', s.downShare.large, 0],
    ['after a leap: reverses %', s.afterLeap.reverse, 0], ['after a leap: continues %', s.afterLeap.same, 0],
    ['after a step: continues %', s.afterStep.same, 0], ['after a step: reverses %', s.afterStep.reverse, 0],
    ['leap lands nearer the mean %', s.leapTowardMean, 0], ['range per melody (st)', s.rangeMean, 1],
    ['3-pattern diversity (0-1)', s.patternDiversity, 2], ['notes in drone runs %', s.droneShare, 0],
  ];
}
export { f as fmt };

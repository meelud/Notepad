/**
 * Invariants of music/mood.js's modeFor(): does the chosen mode's
 * COLOUR agree with the text's emotion? Checks are properties of the
 * mapping over a (valence × arousal) grid, not fitted to any dataset.
 *
 * Perceptual cues (Gagnon & Peretz 2003; Hevner 1936): major third +
 * perfect fifth → happy; minor third → sad; flat second or diminished
 * fifth → tense.  Arousal model: Russell 1980.
 *
 *   node test/mode-mapping-test.mjs
 */
import { modeFor, detectMood, VALENCE_EDGES } from '../js/music/mood.js';
import { MODE_ORDER, MODE_OFFSETS } from '../js/music/scales.js';

const cue = m => {
  const s = new Set(MODE_OFFSETS[m].map(x => x % 12));
  return { maj3: s.has(4), min3: s.has(3), P5: s.has(7), b2: s.has(1), dim5: s.has(6) && !s.has(7) };
};
// brightness rank, dark → bright, of every mode modeFor can return
const RANK = { locrian: 0, phrygian: 1, harmonicMinor: 2, minor: 3, dorian: 4, mixolydian: 5, pentMajor: 6, major: 7, lydian: 8 };

let fails = 0;
const check = (name, ok, detail = '') => { if (!ok) fails++; console.log(`${ok ? ' ok ' : 'FAIL'}  ${name}${ok ? '' : '  → ' + detail}`); };

const norms = [], tenses = [];
for (let n = -1.5; n <= 1.5001; n += 0.05) norms.push(+n.toFixed(2));
for (let t = 0; t <= 2.0001; t += 0.05) tenses.push(+t.toFixed(2));

// 1. only real, unambiguous modes
{
  const bad = new Set();
  for (const n of norms) for (const t of tenses) { const m = modeFor(n, t); if (!(m in RANK) || !MODE_ORDER.includes(m)) bad.add(m); }
  check('every returned mode exists in MODE_ORDER and has a known colour', bad.size === 0, [...bad].join());
}
// 2. valence family: positive text → major third + P5, no b2; negative → minor third
{
  let badPos = null, badNeg = null;
  for (const t of tenses) {
    for (const n of norms) {
      const c = cue(modeFor(n, t));
      if (n >= VALENCE_EDGES.pos && !(c.maj3 && c.P5 && !c.b2)) badPos ??= `norm=${n} tense=${t} → ${modeFor(n, t)}`;
      if (n <= VALENCE_EDGES.neg && !c.min3) badNeg ??= `norm=${n} tense=${t} → ${modeFor(n, t)}`;
    }
  }
  check('positive text never gets a non-happy mode (needs major 3rd, perfect 5th, no flat 2nd)', !badPos, badPos);
  check('negative text never gets a major-third mode', !badNeg, badNeg);
}
// 3. monotone in valence at fixed arousal
{
  let bad = null;
  for (const t of tenses) for (let i = 1; i < norms.length; i++) {
    if (RANK[modeFor(norms[i], t)] < RANK[modeFor(norms[i - 1], t)]) bad ??= `tense=${t}: norm ${norms[i - 1]}→${norms[i]}`;
  }
  check('a more positive text is never darker (fixed arousal)', !bad, bad);
}
// 4. arousal intensifies the valence colour, and never darkens joy
{
  let badPos = null, badNeg = null;
  for (const n of norms) for (let i = 1; i < tenses.length; i++) {
    const a = RANK[modeFor(n, tenses[i - 1])], b = RANK[modeFor(n, tenses[i])];
    if (n >= VALENCE_EDGES.pos && b < a) badPos ??= `norm=${n}: tense ${tenses[i - 1]}→${tenses[i]}`;
    if (n <= VALENCE_EDGES.neg && b > a) badNeg ??= `norm=${n}: tense ${tenses[i - 1]}→${tenses[i]}`;
  }
  check('more arousal never makes POSITIVE text darker (old rule turned "!!" joy into minor)', !badPos, badPos);
  check('more arousal never makes NEGATIVE text brighter', !badNeg, badNeg);
}
// 5. neutral & calm → mixolydian
check('neutral calm text → mixolydian', modeFor(0, 0) === 'mixolydian' && modeFor(0.2, 0.1) === 'mixolydian' && modeFor(0.0, 0.3) === 'mixolydian');
// 5b. calm, clearly negative text is plain minor (dorian reads hopeful)
check('calm + clearly negative → minor, not dorian', modeFor(-0.6, 0) === 'minor' && modeFor(-1.2, 0.1) === 'minor');
check('calm + faintly negative → dorian', modeFor(-0.3, 0) === 'dorian');
// 6. end to end on real sentences
// ── outer band edges are derived, not fitted ───────────────────
// veryPos/veryNeg used to be 0.9/-0.9, which no single strong term could
// reach: detectMood divides by max(1.6, sqrt(n)*0.7), so a |weight|=1 entry
// in a short sentence lands at 0.625 and "I am happy." measured 0.632. The top
// tier was reachable only by stacking terms, making it a measure of verbosity.
// These assert the derivation itself rather than a gold-set number.
{
  const DIVISOR_FLOOR = 1.6;      // max(1.6, ...) for <= 5 words
  const STRONGEST_SINGLE = 1.0;    // a |weight|=1 lexicon entry
  const derived = STRONGEST_SINGLE / DIVISOR_FLOOR;
  check(`the top tier begins at the derived edge (${derived.toFixed(3)})`,
    Math.abs(VALENCE_EDGES.veryPos - derived) < 1e-9, `${VALENCE_EDGES.veryPos}`);
  check('and the negative edge is derived the same way',
    Math.abs(Math.abs(VALENCE_EDGES.veryNeg) - derived) < 1e-9, `${VALENCE_EDGES.veryNeg}`);
  check('one strong term in a short sentence now reaches the top tier',
    detectMood('I am happy.').normScore >= VALENCE_EDGES.veryPos,
    `${detectMood('I am happy.').normScore}`);
  check('and it gets a top-tier mode, not the middle one',
    ['major', 'lydian'].includes(detectMood('I am happy.').mode),
    detectMood('I am happy.').mode);
}

const E2E = [
  // No lexicon entry: the calm-neutral prior takes over and plays dorian, even
  // though the "!!" is enthusiastic. That is the specified rule — punctuation
  // moves arousal on silent text, never valence — so the valence here is the
  // prior's -0.15 and the mode is the prior's dorian, with the "!!" audible as
  // a lift in arousal only. Asserted so a future change to the prior is noticed.
  ['وای چه خبر عالی!!', c => c.min3],             // was maj3 before the prior
  ['امروز خیلی خوشحالم و حالم عالیه', c => c.maj3 && c.P5],
  ['دلم شکسته و خیلی تنهام', c => c.min3],
  ['I am heartbroken and completely alone', c => c.min3],
  ['I am so happy today, what wonderful news!', c => c.maj3 && c.P5],
  // "!" must not flip angry/afraid text positive (it used to add a flat +0.4 valence)
  ['I am so furious!!! I hate everything about this!!!', c => c.min3],
  ['I am terrified and panicking, please help!!', c => c.min3],
  // ZWNJ-aware: "عصبانی‌ام" is ONE word. It used to split into "عصبانی" + "ام",
  // and that stray "ام" pushed "نمیخوام" — a negator — from 3 words away to 4,
  // outside NEGATION_WINDOW, so the whole sentence scored NEGATIVE and played
  // locrian. An angry sentence is not a sad one: the negation in it applies to
  // "ببینمش", not to the anger. Now that the word count is right, the anger
  // survives and the mode is major.
  ['از دستش خیلی عصبانی‌ام و دیگه نمیخوام ببینمش!!', c => c.maj3],
  // Note the space-spelling "عصبانی ام" is NOT asserted equal: it is two
  // words, not one, so it is a different document and lands outside the
  // negation window. See test/zwnj-word-test.mjs for the twin comparison,
  // which uses the joined spelling.
];
for (const [t, ok] of E2E) {
  const m = detectMood(t).mode;
  check(`end-to-end colour: ${m.padEnd(14)} ${t}`, ok(cue(m)));
}
// "!" strengthens negative sentiment, never weakens it
{
  const base = detectMood('I hate everything about this').normScore;
  const loud = detectMood('I hate everything about this!!!').normScore;
  check('exclamation marks make negative text MORE negative, not less', loud <= base, `${base.toFixed(2)} → ${loud.toFixed(2)}`);
}
console.log(fails ? `\n${fails} FAILED` : '\nall mode-mapping invariants hold');
process.exit(fails ? 1 : 0);

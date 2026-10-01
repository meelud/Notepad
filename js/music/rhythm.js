/**
 * music/rhythm.js — the piece's DETERMINISTIC timeline.
 * ─────────────────────────────────────────────────────────────────
 * Pure module (no DOM, no AudioContext, no wall clock, no shared rng)
 * so player.js, audio/ambient.js and test/player-sim.mjs all import the
 * SAME definitions and cannot drift apart.
 *
 * WHY THIS EXISTS. Melodic decisions (which words sit on a strong beat,
 * which chord tone they are pulled toward, which way the chord just
 * moved) used to be read from the LIVE audio clock: performance.now()
 * for the bar phase, and a chord chosen inside ambient.js's setTimeout
 * chain using the shared seeded rnd(). Both depend on real timing (GC,
 * audio-queue stalls, device speed), so the same text could yield a
 * different note sequence on every play — breaking the documented
 * "same text always produces the same performance" guarantee (see
 * hashText()). Measured with test/determinism-test.mjs.
 *
 * THE MODEL. Every word and punctuation mark has a planned duration
 * that is a pure function of the text (wordDurationMs / punctPauseMs).
 * Summing them gives a VIRTUAL time for each word's onset, and every
 * musical decision is a pure function of that virtual time:
 *
 *     bar index  = floor(virtualMs / BAR_MS)
 *     bar phase  = (virtualMs % BAR_MS) / BAR_MS
 *     chord      = chordClock.degreeAtBar(bar index)   (seeded by text)
 *
 * The audible side is then made to FOLLOW that timeline instead of
 * defining it: ambient.js plays chordClock's chords on drift-corrected
 * absolute bar boundaries, and player.js schedules each word at
 * (ambient start + virtualMs). Real jitter can shift when a sound is
 * heard by a few ms; it can never change which note is chosen.
 */

export const BEAT_SEC = 1.15;               // seconds per beat (~52 BPM)
export const BAR_BEATS = 4;                 // beats per bar (4/4)
export const BEAT_MS = BEAT_SEC * 1000;
export const BAR_MS = BEAT_MS * BAR_BEATS;

// A word starting within this fraction of a bar boundary (either side)
// counts as a strong beat → 30% of each bar.
export const STRONG_BEAT_WINDOW = 0.15;

export function barIndexAt(virtualMs) { return Math.floor(virtualMs / BAR_MS); }
export function barPhaseAt(virtualMs) { return (virtualMs % BAR_MS) / BAR_MS; }
export function isStrongBeatAt(virtualMs) {
  const p = barPhaseAt(virtualMs);
  return p < STRONG_BEAT_WINDOW || p >= 1 - STRONG_BEAT_WINDOW;
}

// ─── Planned durations (pure functions of the text) ──────────────
/**
 * Pause after a punctuation token, in ms, at neutral tempo.
 * Multiply by pacingFactorFor(sessionArousal) to get the pause the piece
 * will actually take — see punctPauseFor.
 */
export function punctPauseMs(ch) {
  return (ch === '.') ? 420
       : (ch === '?' || ch === '؟') ? 380
       : (ch === '!') ? 340
       : (ch === ',' || ch === '،') ? 200
       : 150;
}

/**
 * Planned pause in ms, scaled by the same tempo law as word durations.
 *
 * Rests belong to the tempo. A speaker who speeds up shortens their
 * silences too, and a piece whose rests never move reads as mechanical
 * next to one whose rests breathe. Scaling with the same
 * pacingFactorFor that wordDurationMs uses keeps a bar the same
 * perceptual shape at any arousal, and leaves neutral text untouched
 * (pacingFactorFor(0) === 1).
 *
 * The scaling is clamped to half-length at the slow end: at the deepest
 * calm, word durations stretch 1.26x, but a rest more than 2x its
 * nominal length stops reading as a pause and starts reading as a fault.
 */
export const PAUSE_SCALING_FLOOR = 0.5;

export function punctPauseFor(ch, sessionArousal) {
  return punctPauseMs(ch) * Math.max(PAUSE_SCALING_FLOOR, pacingFactorFor(sessionArousal));
}

/**
 * Tempo law: how much faster/slower a piece plays for a given arousal.
 * Tempo is the strongest single arousal cue in music (Juslin & Laukka
 * 2003), and perceived speed is logarithmic, so the law is exponential:
 *
 *     s(a)     = a >= 0 ? tanh(a) : max(a, -0.6)
 *     pacing   = 2^(-0.55 * s(a))
 *
 *     arousal  1.0 (fury, elation)  → words 25% shorter  (1.34x faster)
 *     arousal  0.0 (neutral)        → unchanged
 *     arousal -0.6 (calm, grief)    → words 26% longer   (0.79x)
 *
 * WHY SATURATE. The previous law hard-clipped arousal at 1.0, so every
 * value above it collapsed to the same tempo: on a 6-letter word,
 * arousal 1.13 and arousal 2.90 both planned 451.7 ms. Real text
 * reaches well past 1 — repeated "!" accumulates +0.313 per mark with
 * no diminishing return, and a four-"!!!" sentence scored 2.90 — so
 * the loudest, fastest texts were exactly the ones the law could not
 * distinguish from moderately excited ones.
 *
 * Simply raising the clip is not the fix: at 2.9 that would be 3x the
 * speed, which is not what an excited person sounds like. tanh keeps
 * the original slope near neutral, stays strictly monotone over the
 * whole real range, and asymptotes at 2^0.55 = 1.46x — the same
 * ceiling the old law had, so the loudest text still cannot run away.
 * The negative side keeps its hard floor at -0.6: calm and grief read
 * as the same slowness, which is what that bound was already doing.
 *
 * The old law before all this was linear, capped at +/-15% (a 1.05x gap
 * between excited and sad text, about one just-noticeable difference).
 */
export const TEMPO_EXPONENT = 0.55;
export const TEMPO_CEILING = Math.pow(2, TEMPO_EXPONENT); // 1.4641x, never exceeded
export const TEMPO_FLOOR_AROUSAL = -0.6;

/** Saturating arousal → tempo mapping. Strictly monotone; see above. */
export function saturateArousal(a) {
  if (a >= 0) return Math.tanh(a);
  return Math.max(a, TEMPO_FLOOR_AROUSAL);
}

export function pacingFactorFor(sessionArousal) {
  return Math.pow(2, -TEMPO_EXPONENT * saturateArousal(sessionArousal));
}

/**
 * Planned duration of a word, in ms: 380ms + 42ms/letter, scaled by the
 * text's arousal (pacingFactorFor), cadence words 20% longer. The +20 is
 * the midpoint of the +/-jitter playback used to add (rnd(-20,60)); the
 * random part is no longer part of the timeline - it is applied on top
 * of each word's ONSET by player.js as a non-accumulating humanising
 * offset, so it can no longer affect any decision.
 */
export function wordDurationMs(wordLetterCount, sessionArousal, isCadence) {
  const base = (380 + wordLetterCount * 42) * pacingFactorFor(sessionArousal);
  return (isCadence ? base * 1.2 : base) + 20;
}

// ─── Chord clock ─────────────────────────────────────────────────
/**
 * The degrees available as chord roots, per mode.
 *
 * The previous constant was [0, 2, 4, 6] for EVERY mode, which in a 7-note
 * major scale is I, iii, V, vii-dim. Two consequences, both audible:
 *
 *   IV and vi never occur at all. Those are the subdominant and submediant —
 *   the two warmest functional chords there are — and neither was reachable.
 *   vii-dim, the darkest chord in the scale, had a flat 25% of all roots.
 *
 * So a cheerful piece was built out of I, iii, V and a diminished triad, and
 * a sad one out of exactly the same four. The harmony could not tell the modes
 * apart even though the melody could.
 *
 * Now derived from each mode's own intervals rather than hard-coded: for every
 * scale degree the triad is stacked and CLASSIFIED from its actual semitones,
 * so vii is found to be diminished in major, iii in mixolydian, #iv in lydian
 * and v in phrygian without any of those being named here. See
 * chordRootsForMode().
 *
 * Functional weighting follows standard practice (Piston, "Harmony";
 * Kostka & Payne, "Tonal Harmony"): tonic is the most stable root, the
 * dominant side pulls, the subdominant and submediant push gently forward.
 *
 * NEUTRAL modes keep the old list verbatim, so dorian and the exotic scales
 * are bit-identical to before this change.
 */
const CHORD_DEGREES = [0, 2, 4, 6]; // neutral modes: unchanged from before

/** Modes whose harmony should be bright: major/minor triads only. */
const BRIGHT_MODES = new Set(['major', 'lydian', 'mixolydian', 'pentMajor']);
/** Modes whose harmony should be dark: i, iv, v/V, bVI, bVII and no dim. */
const DARK_MODES = new Set(['minor', 'harmonicMinor', 'phrygian', 'pentMinor', 'locrian']);

function mulberry(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

import { MODE_OFFSETS } from './scales.js';
import { PENT_PARENT, PENT_PARENT_TRIADS, pentTriadsInParent } from './pent-parent.js';

/**
 * The (d + k)th scale degree of a scale given as semitone offsets, as an
 * absolute semitone count — so degree 7 of a 7-note scale is an octave up,
 * not a wrap back to the root.
 */
function degreeSemitone(offsets, d) {
  const n = offsets.length;
  return offsets[((d % n) + n) % n] + 12 * Math.floor(d / n);
}

/**
 * Classifies a stacked triad from its actual intervals. Nothing here knows
 * that vii is diminished in major — it reads the three pitches and decides.
 */
export function triadQuality(root, third, fifth) {
  const a = ((third - root) % 12 + 12) % 12;
  const b = ((fifth - root) % 12 + 12) % 12;
  if (a === 4 && b === 7) return 'major';
  if (a === 3 && b === 7) return 'minor';
  if (a === 3 && b === 6) return 'diminished';
  if (a === 4 && b === 8) return 'augmented';
  return 'other';
}

/** Pentatonics are the only 5-note modes in MODE_ORDER. */
const isPentatonic = mode => Object.prototype.hasOwnProperty.call(PENT_PARENT, mode);

/** Triad quality on every scale degree of a mode — computed, not assumed. */
export function triadsForMode(offsets) {
  return offsets.map((_, d) => triadQuality(
    degreeSemitone(offsets, d),
    degreeSemitone(offsets, d + 2),
    degreeSemitone(offsets, d + 4),
  ));
}

/**
 * Which scale degrees may carry a chord root in this mode, with functional
 * weights. Returns the legacy [0,2,4,6] with equal weights for any mode not
 * in BRIGHT_MODES or DARK_MODES, so neutral modes are bit-identical.
 *
 * @param {number[]} offsets — the mode's semitone offsets
 * @param {string} mode
 * @returns {Array<{degree:number, weight:number}>}
 */
export function chordRootsForMode(offsets, mode) {
  const legacy = CHORD_DEGREES.map(degree => ({ degree, weight: 1 }));

  // A pentatonic mode has no thirds of its own: stacking inside 5 notes
  // skips pitches. Its triads come from the PARENT heptatonic scale via
  // PENT_PARENT (commit 2), and are read from PENT_PARENT_TRIADS below.
  if (isPentatonic(mode)) {
    const parent = PENT_PARENT[mode];
    const quads = parent ? pentTriadsInParent(mode, offsets) : null;
    if (!quads) return legacy;
    const keep = quads.map((q, i) => ({ i, q }))
      .filter(x => x.q === 'major' || x.q === 'minor');
    if (!keep.length) return legacy;
    return [
      { degree: 0, weight: 3.0 },
      ...keep.filter(x => x.i !== 0).map(x => ({ degree: x.i, weight: 1 })),
    ];
  }

  // ---- bright: major and minor triads only, no diminished, no augmented ----
  if (BRIGHT_MODES.has(mode)) {
    const q = triadsForMode(offsets);
    const func = { 0: 3.0, 3: 1.5, 4: 1.5, 5: 1.0 }; // tonic, subdom, dom, submed
    const out = [];
    q.forEach((quality, d) => {
      if (quality !== 'major' && quality !== 'minor') return;
      const weight = func[d];
      if (weight !== undefined) out.push({ degree: d, weight });
      else if (mode === 'lydian' && d === 3) out.push({ degree: d, weight: 0.5 }); // #iv, dim in lydian is excluded
    });
    return out.length ? out : legacy;
  }

  // ---- dark: i, iv, v/V, bVI, bVII ----
  if (DARK_MODES.has(mode)) {
    const q = triadsForMode(offsets);
    // LOCRIAN EXCEPTION: its own tonic triad is diminished, so excluding the
    // diminished quality would delete the tonic and leave the piece with no
    // anchor. The tonic is therefore allowed to be diminished there, and
    // nowhere else. Every other diminished root is excluded.
    const isLocrian = mode === 'locrian';
    const func = { 0: 3.0, 3: 1.2, 4: 1.4, 5: 1.1, 6: 1.3 }; // i, iv, v/V, bVI, bVII
    const out = [];
    q.forEach((quality, d) => {
      const weight = func[d];
      if (weight === undefined) return;
      if (quality === 'augmented') return;
      if (quality === 'diminished' && !(isLocrian && d === 0)) return;
      out.push({ degree: d, weight });
    });
    return out.length ? out : legacy;
  }

  return legacy;
}

/**
 * Smoother-than-random chord motion: never repeats the previous root, and
 * weights nearer roots more heavily, on top of the mode's functional weights.
 */
function pickNextDegree(prev, rand, roots) {
  if (prev === null) {
    const total = roots.reduce((a, r) => a + r.weight, 0);
    let r = rand() * total;
    for (const root of roots) {
      r -= root.weight;
      if (r <= 0) return root.degree;
    }
    return roots[roots.length - 1].degree;
  }
  const weighted = roots.map(root => ({
    degree: root.degree,
    weight: root.degree === prev ? 0 : root.weight / (Math.abs(root.degree - prev) + 0.5),
  }));
  const total = weighted.reduce((a, b) => a + b.weight, 0);
  let r = rand() * total;
  for (const w of weighted) {
    r -= w.weight;
    if (r <= 0) return w.degree;
  }
  return weighted[weighted.length - 1].degree;
}

/**
 * The piece's chord progression as a pure function of (seed, mode, bar index).
 * Lazily extended and memoised, with its own private PRNG, so it is
 * independent of every other random stream and of call order/timing.
 *
 * `mode` selects the root set: the same seed in major and in minor now gives
 * genuinely different harmony, which is the whole point. Passing no mode keeps
 * the previous behaviour exactly, which is what the neutral-mode tests rely on.
 *
 * Bar 0 is always the tonic for the modes whose roots were just computed from
 * function — a piece should state its key before it wanders. Neutral modes keep
 * their previous bar-0 behaviour, which was random, so that they stay
 * bit-identical.
 *
 * @param {number} seed — hashText(text)
 * @param {string} [mode] — a key of MODE_OFFSETS
 */
export function createChordClock(seed, mode = null) {
  const rand = mulberry((seed ^ 0xC0DEC0DE) >>> 0);
  const seq = [];
  let roots = CHORD_DEGREES.map(degree => ({ degree, weight: 1 }));
  let tonicFirst = false;
  if (mode && MODE_OFFSETS[mode]) {
    roots = chordRootsForMode(MODE_OFFSETS[mode], mode);
    tonicFirst = BRIGHT_MODES.has(mode) || DARK_MODES.has(mode);
  }
  const degreeAtBar = bar => {
    const k = Math.max(0, bar | 0);
    while (seq.length <= k) {
      seq.push(tonicFirst && seq.length === 0
        ? roots.find(r => r.degree === 0)?.degree ?? roots[0].degree
        : pickNextDegree(seq.length ? seq[seq.length - 1] : null, rand, roots));
    }
    return seq[k];
  };
  return {
    degreeAtBar,
    /** -1 / 0 / +1: which way the chord root moved INTO this bar (0 for bar 0). */
    directionAtBar: bar => bar <= 0 ? 0 : Math.sign(degreeAtBar(bar) - degreeAtBar(bar - 1)),
  };
}

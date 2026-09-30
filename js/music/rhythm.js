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
       : (ch === ',') ? 200
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
const CHORD_DEGREES = [0, 2, 4, 6]; // scale degrees available for chord roots

function mulberry(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Smoother-than-random chord motion (unchanged design): never repeats
 * the previous root, weights nearer roots more heavily.
 */
function pickNextDegree(prev, rand) {
  if (prev === null) return CHORD_DEGREES[Math.floor(rand() * CHORD_DEGREES.length)];
  const weights = CHORD_DEGREES.map(d => d === prev ? 0 : 1 / (Math.abs(d - prev) + 0.5));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rand() * total;
  for (let i = 0; i < CHORD_DEGREES.length; i++) {
    r -= weights[i];
    if (r <= 0) return CHORD_DEGREES[i];
  }
  return CHORD_DEGREES[CHORD_DEGREES.length - 1];
}

/**
 * The piece's chord progression as a pure function of (seed, bar index).
 * Lazily extended and memoised, with its own private PRNG, so it is
 * independent of every other random stream and of call order/timing.
 * @param {number} seed — hashText(text)
 */
export function createChordClock(seed) {
  const rand = mulberry((seed ^ 0xC0DEC0DE) >>> 0);
  const seq = [];
  const degreeAtBar = bar => {
    const k = Math.max(0, bar | 0);
    while (seq.length <= k) seq.push(pickNextDegree(seq.length ? seq[seq.length - 1] : null, rand));
    return seq[k];
  };
  return {
    degreeAtBar,
    /** -1 / 0 / +1: which way the chord root moved INTO this bar (0 for bar 0). */
    directionAtBar: bar => bar <= 0 ? 0 : Math.sign(degreeAtBar(bar) - degreeAtBar(bar - 1)),
  };
}

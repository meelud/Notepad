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
/** Pause after a punctuation token, in ms. */
export function punctPauseMs(ch) {
  return (ch === '.') ? 420
       : (ch === '?' || ch === '؟') ? 380
       : (ch === '!') ? 340
       : (ch === ',' || ch === '،') ? 200
       : 150;
}

/**
 * Planned duration of a word, in ms: 380ms + 42ms/letter, tense text
 * reading up to 15% faster, cadence words 20% longer. The +20 is the
 * midpoint of the ±jitter playback used to add (rnd(-20,60)); the
 * random part is no longer part of the timeline — it is applied on top
 * of each word's ONSET by player.js as a non-accumulating humanising
 * offset, so it can no longer affect any decision.
 */
export function wordDurationMs(wordLetterCount, sessionTenseScore, isCadence) {
  const clampedTense = Math.max(-0.5, Math.min(1.0, sessionTenseScore));
  const pacingFactor = 1 - clampedTense * 0.15;
  const base = (380 + wordLetterCount * 42) * pacingFactor;
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

import { MODE_ORDER, buildScale } from './scales.js';
import { detectMood } from './mood.js';
import { rnd } from '../utils/rng.js';

// ─── State ──────────────────────────────────────────────────────
export let currentScale = buildScale(110.00, 'minor');
export let currentMood = 'minor';

// ─── Root candidates ────────────────────────────────────────────
function noteFreq(semisFromA2) { return 110.00 * Math.pow(2, semisFromA2 / 12); }

const ROOT_CANDIDATES_LOW = Array.from({ length: 12 }, (_, i) => noteFreq(i - 12));
const ROOT_CANDIDATES_MID = Array.from({ length: 12 }, (_, i) => noteFreq(i));

// ─── Hashing ────────────────────────────────────────────────────
/**
 * Simple deterministic hash — used to seed the RNG so the same text
 * always produces the same sequence of notes.
 * @param {string} text
 * @returns {number} unsigned 32-bit hash
 */
export function hashText(text) {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0;
  return h;
}

// ─── Harmony derivation ─────────────────────────────────────────
/**
 * Analyzes text mood and derives a musical key + scale.
 * Darker modes (diminished…phrygian) use lower root candidates;
 * brighter modes (dorian…major) use mid-range roots.
 *
 * @param {string} text — input text (EN/FA)
 * @returns {{ mood: string, root: number, scale: number[], normScore: number, tenseScore: number }}
 */
export function deriveTextHarmony(text) {
  const { mode, normScore, tenseScore } = detectMood(text);
  const h = hashText(text);

  const modeIdx = MODE_ORDER.indexOf(mode);
  const candidates = modeIdx <= 5 ? ROOT_CANDIDATES_LOW : ROOT_CANDIDATES_MID;

  const baseIdx = h % candidates.length;
  const bias = Math.round((1 - Math.max(0, Math.min(1, (normScore + 1.5) / 3.0))) * 4);
  const rootIdx = Math.max(0, baseIdx - bias) % candidates.length;
  const root = candidates[rootIdx];

  currentMood = mode;
  currentScale = buildScale(root, mode);

  return { mood: mode, root, scale: currentScale, normScore, tenseScore };
}

// ─── Note scale for words ───────────────────────────────────────
/**
 * Builds a palette of note frequencies (across multiple octaves)
 * based on the current mood/scale. Darker modes get fewer octaves.
 * @returns {number[]}
 */
export function wordNoteScale() {
  const out = [];
  const modeIdx = MODE_ORDER.indexOf(currentMood);
  let octaves;
  if (modeIdx <= 4)       octaves = [0.5, 1, 2];
  else if (modeIdx <= 8)  octaves = [0.5, 1, 2, 3];
  else if (modeIdx <= 12) octaves = [1, 2, 3, 4];
  else                    octaves = [1, 2, 3, 4, 6];
  octaves.forEach(oct => currentScale.forEach(f => out.push(f * oct)));
  return out;
}

// ─── Melodic contour ──────────────────────────────────────────────
/**
 * Picks the next melody note as a step FROM the previous scale degree,
 * instead of an independent random pick — this is what gives the line
 * an actual contour instead of a random walk. Degree and octave are
 * tracked separately (not as one flattened array index) so a "step"
 * is always a real scale step, never an accidental octave jump.
 *
 * @param {{degree:number, octave:number}|null} prev — null starts a
 *   new phrase (lands near the root, mid octave).
 * @param {boolean} isCadence — true for a sentence's last word: pulls
 *   motion stepwise back toward the root degree (a real resolution).
 * @param {number} tenseScore — wider leaps when text reads more tense.
 * @returns {{freq:number, degree:number, octave:number}}
 */
export function nextMelodyNote(prev, isCadence, tenseScore = 0) {
  const len = currentScale.length;
  const modeIdx = MODE_ORDER.indexOf(currentMood);
  const octRange = modeIdx <= 4 ? [0.5, 1, 2] : modeIdx <= 8 ? [0.5, 1, 2, 3]
                  : modeIdx <= 12 ? [1, 2, 3, 4] : [1, 2, 3, 4, 6];

  if (!prev) {
    return { degree: 0, octave: octRange[Math.floor(octRange.length / 2)], freq: currentScale[0] * octRange[Math.floor(octRange.length / 2)] };
  }

  let degree = prev.degree;
  let octave = prev.octave;

  if (isCadence) {
    // resolve stepwise toward the root degree (0) — a real cadence,
    // not a random landing
    degree += degree > 0 ? -1 : (degree < 0 ? 1 : 0);
  } else {
    // mostly stepwise motion (±1), occasional leap (±2..3) scaled by
    // tension — tense text leaps more, calm text stays closer together
    const leapChance = 0.15 + Math.max(0, Math.min(1, tenseScore)) * 0.25;
    const isLeap = rnd(0, 1) < leapChance;
    const stepSize = isLeap ? (1 + Math.floor(rnd(0, 2))) + 1 : 1;
    degree += rnd(0, 1) < 0.5 ? -stepSize : stepSize;
  }

  // wrap degree into an octave shift rather than clamping — keeps the
  // contour continuous instead of hitting a hard ceiling/floor
  while (degree >= len) { degree -= len; octave = octRange[Math.min(octRange.length - 1, octRange.indexOf(octave) + 1)]; }
  while (degree < 0)    { degree += len; octave = octRange[Math.max(0, octRange.indexOf(octave) - 1)]; }

  return { degree, octave, freq: currentScale[degree] * octave };
}


/**
 * Builds a 4-note chord (root, 3rd, 5th, 7th) from a scale,
 * wrapping into higher octaves as the degree index exceeds the
 * scale's length. Works for scales of any length (5-note pentatonics,
 * 6-note whole-tone, 7-note modes, etc.) — the octave multiplier is
 * 2^floor(degree / len), not a flat ×2, since a degree can wrap past
 * the scale's end more than once on shorter scales (e.g. degree 6 on
 * a 5-note scale wraps twice, not once).
 * @param {number[]} scale — scale frequencies
 * @param {number} degreeRoot — degree index (0-based)
 * @returns {number[]}
 */
export function chordFromScale(scale, degreeRoot) {
  const len = scale.length;
  const noteAt = (degree) => {
    const octaveMult = Math.pow(2, Math.floor(degree / len));
    return scale[degree % len] * octaveMult;
  };
  const root    = noteAt(degreeRoot);
  const third   = noteAt(degreeRoot + 2);
  const fifth   = noteAt(degreeRoot + 4);
  const seventh = noteAt(degreeRoot + 6);
  return [root, third, fifth, seventh];
}

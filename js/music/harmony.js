import { MODE_ORDER, buildScale } from './scales.js';
import { detectMood } from './mood.js';

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

// ─── Chord construction ─────────────────────────────────────────
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

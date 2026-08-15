import { MODE_ORDER, buildScale, MODE_OFFSETS } from './scales.js';
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

// ─── Melody helpers (shared internals) ─────────────────────────────
function octaveRangeForCurrentMood() {
  const modeIdx = MODE_ORDER.indexOf(currentMood);
  return modeIdx <= 4 ? [0.5, 1, 2] : modeIdx <= 8 ? [0.5, 1, 2, 3]
       : modeIdx <= 12 ? [1, 2, 3, 4] : [1, 2, 3, 4, 6];
}

/**
 * Places a target scale degree (any integer, wrapped mod scale length)
 * at whichever octave in range minimizes perceptual distance (log2 of
 * the frequency ratio) from the previous note — the "nearest chord
 * tone" voice-leading principle from four-part harmony pedagogy
 * (Aldwell & Schachter, "Harmony and Voice Leading"): a deliberate
 * landing (cadence, motif restatement) should take the smallest
 * available leap, not jump register arbitrarily.
 * @param {number} targetDegree
 * @param {{degree:number, octave:number}|null} prev
 */
function placeNearest(targetDegree, prev) {
  const len = currentScale.length;
  const octRange = octaveRangeForCurrentMood();
  const baseDegree = ((targetDegree % len) + len) % len;
  if (!prev) {
    const oct = octRange[Math.floor(octRange.length / 2)];
    return { degree: baseDegree, octave: oct, freq: currentScale[baseDegree] * oct, lastInterval: 0 };
  }
  const prevFreq = currentScale[prev.degree] * prev.octave;
  let bestOct = octRange[0], bestDist = Infinity;
  octRange.forEach(oct => {
    const f = currentScale[baseDegree] * oct;
    const dist = Math.abs(Math.log2(f / prevFreq));
    if (dist < bestDist) { bestDist = dist; bestOct = oct; }
  });
  return {
    degree: baseDegree, octave: bestOct, freq: currentScale[baseDegree] * bestOct,
    lastInterval: baseDegree - prev.degree,
  };
}

/**
 * The scale degree nearest a perfect fifth (7 semitones) above the
 * root, for whatever mode is active — used as the "dominant" landing
 * point for a half cadence. Falls back gracefully on modes with no
 * exact fifth (whole-tone, diminished) by taking the closest available
 * step, same as real modal harmony has to do.
 */
function dominantDegreeIndex() {
  const offsets = MODE_OFFSETS[currentMood] || MODE_OFFSETS.minor;
  let best = 0, bestDist = Infinity;
  offsets.forEach((o, i) => {
    const d = Math.abs(o - 7);
    if (d < bestDist) { bestDist = d; best = i; }
  });
  return best;
}

/**
 * Resolves a cadence to its target degree using nearest-tone voice
 * leading. sentenceType 'question' resolves to the dominant (a half
 * cadence — the harmonic equivalent of "left hanging", matching a
 * question's open-ended feel); statement/exclaim resolve to the tonic
 * (an authentic cadence — full close).
 * @param {{degree:number, octave:number}|null} prev
 * @param {string} sentenceType
 */
export function resolveCadence(prev, sentenceType) {
  const target = sentenceType === 'question' ? dominantDegreeIndex() : 0;
  return placeNearest(target, prev);
}

/**
 * Free stepwise melodic motion (conjunct motion, occasional leaps).
 * Implements leap recovery: after a leap of 2+ scale steps, the next
 * motion is biased strongly toward a single step in the OPPOSITE
 * direction — this is the "gap-fill" principle from Narmour's
 * Implication-Realization model (Narmour, "The Analysis and Cognition
 * of Basic Melodic Structures", 1990) and standard tonal counterpoint
 * pedagogy: a leap creates a melodic "gap" that the ear expects to be
 * at least partially filled by stepwise motion back into it. Without
 * this, a contour built purely from independent random steps/leaps
 * reads as aimless rather than shaped.
 * @param {{degree:number, octave:number, lastInterval?:number}|null} prev
 * @param {number} tenseScore
 */
export function stepwiseNote(prev, tenseScore = 0) {
  const len = currentScale.length;
  const octRange = octaveRangeForCurrentMood();

  if (!prev) {
    const oct = octRange[Math.floor(octRange.length / 2)];
    return { degree: 0, octave: oct, freq: currentScale[0] * oct, lastInterval: 0 };
  }

  let degree = prev.degree, octave = prev.octave;
  const prevWasLeap = Math.abs(prev.lastInterval || 0) >= 2;

  let interval;
  if (prevWasLeap) {
    // gap-fill: step back in the opposite direction most of the time,
    // occasionally break the rule (30%) so it doesn't read mechanically
    const recover = rnd(0, 1) >= 0.3;
    const dir = prev.lastInterval > 0 ? -1 : 1;
    interval = recover ? dir : (rnd(0, 1) < 0.5 ? -1 : 1);
  } else {
    const leapChance = 0.15 + Math.max(0, Math.min(1, tenseScore)) * 0.25;
    const isLeap = rnd(0, 1) < leapChance;
    const stepSize = isLeap ? (1 + Math.floor(rnd(0, 2))) + 1 : 1;
    interval = (rnd(0, 1) < 0.5 ? -1 : 1) * stepSize;
  }

  degree += interval;
  while (degree >= len) { degree -= len; octave = octRange[Math.min(octRange.length - 1, octRange.indexOf(octave) + 1)]; }
  while (degree < 0)    { degree += len; octave = octRange[Math.max(0, octRange.indexOf(octave) - 1)]; }

  return { degree, octave, freq: currentScale[degree] * octave, lastInterval: interval };
}

// ─── Motif ──────────────────────────────────────────────────────
// Local, isolated seeded RNG for motif generation only — mirrors the
// pattern in audio/reverb-math.js (mulberry32). Motif generation must
// NOT draw from the shared playback rnd() in utils/rng.js: that stream
// is seeded via seedRng(hashText(text)) in player.js at a point that
// isn't guaranteed to run before generateMotif() is called, so using
// it here would make the motif depend on leftover RNG state from
// whatever played previously — breaking the "same text always
// produces the same performance" guarantee documented on hashText().
function motifRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Generates a short (3-step) interval motif once per piece — the
 * seed of a genuine "melody grammar" rather than independent per-word
 * choices. Interval magnitude biases toward wider leaps on tenser
 * text, same weighting as stepwiseNote for consistency of character.
 * @param {number} seed — deterministic seed for THIS text (e.g. hashText(text)); isolated from the shared playback RNG.
 * @param {number} tenseScore
 * @returns {{intervals:number[]}}
 */
export function generateMotif(seed, tenseScore = 0) {
  const mrnd = motifRng((seed >>> 0) ^ 0x5eed5eed);
  const leapChance = 0.2 + Math.max(0, Math.min(1, tenseScore)) * 0.3;
  const intervals = [];
  for (let i = 0; i < 3; i++) {
    const isLeap = mrnd() < leapChance;
    const size = isLeap ? 2 : 1;
    intervals.push((mrnd() < 0.5 ? -1 : 1) * size);
  }
  return { intervals };
}

/**
 * Rising-sequence starting degree for the Nth motif restatement — a
 * "sequence" is the standard Baroque/Classical device of repeating a
 * motif at successively higher (or lower) pitch levels while keeping
 * its interval pattern intact (Schoenberg, "Fundamentals of Musical
 * Composition"; Réti, "The Thematic Process in Music"). Rises by a
 * third (2 scale steps) per restatement, wrapping within the scale.
 * @param {number} occurrenceIdx — 0 for the first motif statement, 1 for the second, etc.
 */
export function motifSequenceStartDegree(occurrenceIdx) {
  const len = currentScale.length;
  return (occurrenceIdx * 2) % len;
}

/**
 * Places the word at position `wordIdx` (0-based) within a sentence
 * that is restating the motif: wordIdx 0 lands on the sequence's start
 * degree; each subsequent word applies the motif's next interval,
 * cumulatively. Uses nearest-tone placement so entering/leaving the
 * motif doesn't create an arbitrary register jump.
 * @param {{intervals:number[]}} motif
 * @param {number} startDegree
 * @param {number} wordIdx
 * @param {{degree:number, octave:number}|null} prev
 */
export function motifNote(motif, startDegree, wordIdx, prev) {
  let degree = startDegree;
  for (let i = 0; i < wordIdx && i < motif.intervals.length; i++) degree += motif.intervals[i];
  return placeNearest(degree, prev);
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

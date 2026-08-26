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
/**
 * Nearest-tone voice leading: places `targetDegree` in whichever
 * octave (from the current mood's octave range) is closest in pitch
 * to `prev` — the standard voice-leading economy principle (smallest
 * possible melodic leap when resolving to a specific scale degree).
 *
 * Optional `registerBias` (-1..1, from a clause's Musical Intention —
 * see music/intention.js's contourBias): a soft lean toward a HIGHER
 * octave candidate (positive bias) or LOWER (negative), applied only
 * as a small penalty/bonus on top of the real distance metric — so it
 * can tip a close call, not force a large leap. This is intentionally
 * scoped to placeNearest's callers (resolveCadence, harmonizeNote,
 * motifNote — the melody's structural "anchor" points) rather than
 * every free passing-tone note, so a clause's emotional intensity can
 * audibly lift/lower the melody's register at its landing points
 * without making the whole line jumpy. registerBias=0 (default)
 * reproduces the exact prior nearest-octave selection.
 * @param {number} targetDegree
 * @param {{degree:number, octave:number}|null} prev
 * @param {number} [registerBias=0]
 */
function placeNearest(targetDegree, prev, registerBias = 0) {
  const len = currentScale.length;
  const octRange = octaveRangeForCurrentMood();
  const baseDegree = ((targetDegree % len) + len) % len;
  if (!prev) {
    const oct = octRange[Math.floor(octRange.length / 2)];
    return { degree: baseDegree, octave: oct, freq: currentScale[baseDegree] * oct, lastInterval: 0 };
  }
  const prevFreq = currentScale[prev.degree] * prev.octave;
  const bias = Math.max(-1, Math.min(1, registerBias));
  let bestOct = octRange[0], bestScore = Infinity;
  octRange.forEach((oct, idx) => {
    const f = currentScale[baseDegree] * oct;
    const dist = Math.abs(Math.log2(f / prevFreq));
    // higher-index octaves get a small bonus when bias>0 (and vice
    // versa) — scaled by octRange position so it only ever tips a
    // genuinely close call, never overrides a clearly-nearer octave
    const normIdx = octRange.length > 1 ? idx / (octRange.length - 1) : 0.5;
    const score = dist - bias * (normIdx - 0.5) * 0.6;
    if (score < bestScore) { bestScore = score; bestOct = oct; }
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
 *
 * Optional `strength` (from music/intention.js's cadenceStrength):
 * when a clause's meaning doesn't cleanly resolve (e.g. an ambiguous
 * or contradictory ending), forcing a full harmonic resolution would
 * be dishonest to the text — so at low strength, resolution is
 * probabilistically skipped in favor of ordinary stepwise motion,
 * leaving the phrase genuinely "unresolved" (an unstable cadence).
 * strength=1 (default) always resolves — identical to prior behavior.
 *
 * Optional `registerBias` (from intention.js's contourBias): see
 * placeNearest — a soft octave lean at this cadence landing point.
 * @param {{degree:number, octave:number}|null} prev
 * @param {string} sentenceType
 * @param {number} [strength=1] — 0..1, probability of a full resolution
 * @param {number} [registerBias=0] — -1..1, soft octave lean
 */
export function resolveCadence(prev, sentenceType, strength = 1, registerBias = 0) {
  if (strength < 1 && rnd(0, 1) > Math.max(0, Math.min(1, strength))) {
    return stepwiseNote(prev, 0.3);
  }
  const target = sentenceType === 'question' ? dominantDegreeIndex() : 0;
  return placeNearest(target, prev, registerBias);
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
 *
 * Optional semantic layer (clause-level Musical Intention — see
 * music/intention.js): `directionBias` skews the up/down coin flip
 * toward a clause's local sentiment trajectory (e.g. an improving
 * clause leans the melody upward); `forceLeap` guarantees a leap on
 * this note specifically, for a semantic "disruption" event (a
 * contrast word like "but"/"ولی" triggering audible phrase
 * disruption). Both are probabilistic/optional — 0 bias or
 * forceLeap=false reproduce the exact prior behavior, and neither
 * touches the gap-fill branch above, which stays authoritative right
 * after a real leap regardless of semantic bias.
 * @param {{degree:number, octave:number, lastInterval?:number}|null} prev
 * @param {number} tenseScore
 * @param {number} [directionBias=0] — -1..1, skews step direction
 * @param {boolean} [forceLeap=false] — force this note to be a leap
 */
export function stepwiseNote(prev, tenseScore = 0, directionBias = 0, forceLeap = false) {
  const len = currentScale.length;
  const octRange = octaveRangeForCurrentMood();

  if (!prev) {
    const oct = octRange[Math.floor(octRange.length / 2)];
    return { degree: 0, octave: oct, freq: currentScale[0] * oct, lastInterval: 0 };
  }

  let degree = prev.degree, octave = prev.octave;
  const prevWasLeap = Math.abs(prev.lastInterval || 0) >= 2;
  const bias = Math.max(-1, Math.min(1, directionBias));
  const upProb = 0.5 + bias * 0.35; // capped skew (15%..85%) — never fully deterministic

  let interval;
  if (prevWasLeap) {
    // gap-fill takes priority over semantic bias — an actual leap's
    // psychoacoustic pull back is stronger than a clause-level lean
    const recover = rnd(0, 1) >= 0.3;
    const dir = prev.lastInterval > 0 ? -1 : 1;
    interval = recover ? dir : (rnd(0, 1) < 0.5 ? -1 : 1);
  } else {
    const leapChance = 0.15 + Math.max(0, Math.min(1, tenseScore)) * 0.25;
    const isLeap = forceLeap || rnd(0, 1) < leapChance;
    const stepSize = isLeap ? (1 + Math.floor(rnd(0, 2))) + 1 : 1;
    interval = (rnd(0, 1) < upProb ? 1 : -1) * stepSize;
  }

  degree += interval;
  while (degree >= len) { degree -= len; octave = octRange[Math.min(octRange.length - 1, octRange.indexOf(octave) + 1)]; }
  while (degree < 0)    { degree += len; octave = octRange[Math.max(0, octRange.indexOf(octave) - 1)]; }

  return { degree, octave, freq: currentScale[degree] * octave, lastInterval: interval };
}

/**
 * Global tension profile (Herremans & Chew, "MorpheuS: generating
 * structured music with constrained patterns and tension", 2017): a
 * long-term arc shaping leap-likelihood across the WHOLE piece, not
 * just within each sentence — the standard fix for algorithmic melody
 * generation that sounds locally coherent but has no large-scale
 * direction. Returns a 0..amplitude bias to ADD to a local tenseScore;
 * it never replaces it, so sentence-level character is preserved and
 * this simply leans the whole piece toward its climax.
 *
 * Uses a two-sided smoothstep envelope (not a symmetric sine) so the
 * peak sits at `peak` exactly and both slopes are C1-continuous —
 * peak defaults to 0.68 (68% through the piece), matching the classic
 * narrative-arc convention of climax arriving around 60-75% through a
 * piece's total duration rather than dead-center.
 * @param {number} progress — the current word's position in the WHOLE
 *   text, 0 (first word) to 1 (last word).
 * @param {number} [amplitude=0.4] — max bias added at the peak.
 * @param {number} [peak=0.68] — where in [0,1] the arc climaxes.
 * @returns {number} 0..amplitude
 */
export function globalTensionBias(progress, amplitude = 0.4, peak = 0.68) {
  const x = Math.max(0, Math.min(1, progress));
  const smoothstep = (t) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
  const shape = x <= peak
    ? smoothstep(peak === 0 ? 1 : x / peak)
    : smoothstep(peak === 1 ? 1 : (1 - x) / (1 - peak));
  return shape * amplitude;
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
 * Harmonic awareness: places the note on the nearest tone of the
 * chord currently sounding in ambient.js (root/3rd/5th/7th, built the
 * same way chordFromScale builds the audible chord — degrees rootDeg,
 * rootDeg+2, rootDeg+4, rootDeg+6), using the same nearest-tone voice
 * leading as placeNearest. Tries all four chord tones and keeps
 * whichever is the smallest leap from prev — this is what keeps a
 * "strong beat" note consonant with the harmony instead of landing on
 * an arbitrary scale degree that may clash with the chord underneath.
 * Returns null if there's no live chord to harmonize against yet (the
 * caller should fall back to plain stepwiseNote in that case).
 *
 * Optional contrary-motion bias (first-species counterpoint's leading
 * principle — Fux, "Gradus ad Parnassum", 1725; Aldwell & Schachter):
 * when `chordDirection` shows the chord itself just moved up or down,
 * this probabilistically (not absolutely) prefers whichever chord-tone
 * candidate moves the melody the OPPOSITE way — this is what keeps a
 * melody line independent from its accompaniment instead of doubling
 * its motion. It's a lean among the already-computed candidates, not a
 * replacement for nearest-tone voice leading: if no contrary-moving
 * candidate exists (or chordDirection is 0/omitted), behavior is
 * identical to before this parameter existed.
 * @param {{degree:number, octave:number}|null} prev
 * @param {number|null} chordRootDegree — from ambient.js's getCurrentChordDegree()
 * @param {number} [chordDirection=0] — from ambient.js's getChordDirection(): -1, 0, or 1
 * @param {number} [registerBias=0] — -1..1, soft octave lean (see placeNearest)
 */
/**
/**
 * Softmax-weighted selection over scored candidates — the sampling
 * primitive for Tier 2 arbitration (see buildCandidatePool/
 * scoreCandidate below). Deliberately separates TWO independent
 * concerns that a plain "weight = probability" scheme conflates:
 *   - `score`  is a musical PREFERENCE (can be any real number,
 *     negative included — e.g. a large voice-leading cost legitimately
 *     makes a candidate worse, not just "less likely by some amount")
 *   - `temperature` controls how much randomness is allowed around
 *     that preference (low = near-deterministic best-pick, high = more
 *     exploratory) — a musically meaningful, independently-tunable
 *     axis that a raw weight cannot represent on its own.
 * Deterministic via the shared seeded rnd().
 * @param {Array<{note:Object, score:number}>} candidates — at least one
 * @param {number} [temperature=0.4]
 * @returns {Object} the chosen note
 */
function arbitrate(candidates, temperature = 0.4) {
  if (candidates.length === 1) return candidates[0].note;
  const t = Math.max(0.05, temperature); // guard against div-by-zero / degenerate softmax
  const maxScore = Math.max(...candidates.map(c => c.score));
  const expScores = candidates.map(c => Math.exp((c.score - maxScore) / t)); // subtract max for numerical stability
  const total = expScores.reduce((a, b) => a + b, 0);
  let r = rnd(0, total);
  for (let i = 0; i < candidates.length; i++) {
    r -= expScores[i];
    if (r <= 0) return candidates[i].note;
  }
  return candidates[candidates.length - 1].note;
}
export { arbitrate };

/**
 * Builds the Tier 2 candidate pool: up to 4 chord tones (if a live
 * chord is available) plus a small set of stepwise alternatives —
 * genuine competing options, not two pre-decided "winners" from
 * harmonizeNote/stepwiseNote. The gap-fill-aware stepwise candidate
 * (identical to what stepwiseNote alone would have produced) is
 * always included, preserving that already-validated behavior as one
 * option among several rather than silently discarding it.
 * @param {{degree:number, octave:number, lastInterval?:number}|null} prev
 * @param {number|null} chordRootDegree
 * @param {number} tenseScore
 * @param {number} contourBias
 * @param {boolean} forceLeap
 * @param {number} registerBias
 * @returns {Array<{note:Object, isChordTone:boolean}>}
 */
function buildCandidatePool(prev, chordRootDegree, tenseScore, contourBias, forceLeap, registerBias) {
  const pool = [];
  if (chordRootDegree !== null && chordRootDegree !== undefined) {
    const len = currentScale.length;
    const tones = [...new Set(
      [chordRootDegree, chordRootDegree + 2, chordRootDegree + 4, chordRootDegree + 6]
        .map(d => ((d % len) + len) % len)
    )];
    tones.forEach(t => pool.push({ note: placeNearest(t, prev, registerBias), isChordTone: true }));
  }
  // the fully gap-fill/leap-chance-aware candidate — same procedure
  // stepwiseNote has always used, kept intact as one pool member
  pool.push({ note: stepwiseNote(prev, tenseScore, contourBias, forceLeap), isChordTone: false });
  // two plain neighbor-step alternatives, giving arbitration real
  // options beyond the two previously-hardcoded "winners"
  if (prev) {
    const len = currentScale.length;
    [1, -1].forEach(step => {
      let degree = prev.degree + step, octave = prev.octave;
      const octRange = octaveRangeForCurrentMood();
      while (degree >= len) { degree -= len; octave = octRange[Math.min(octRange.length - 1, octRange.indexOf(octave) + 1)]; }
      while (degree < 0)    { degree += len; octave = octRange[Math.max(0, octRange.indexOf(octave) - 1)]; }
      pool.push({ note: { degree, octave, freq: currentScale[degree] * octave, lastInterval: step }, isChordTone: false });
    });
  }
  return pool;
}

/**
 * Scores one candidate on three independent, context-weighted axes —
 * this is what makes Tier 2 arbitration a real trade-off instead of a
 * single ad hoc number:
 *   - voiceLeading: SMALLER leap from prev is always better (basic
 *     counterpoint economy) — this axis is never zero-weighted, voice
 *     leading always matters at least somewhat, regardless of context.
 *   - harmonicFit: is this candidate a tone of the live chord — weighted
 *     up on strong beats (harmony matters more there), down on weak
 *     beats, matching the musical intuition the old hard rule encoded,
 *     but now as a soft, comparable preference instead of a filter.
 *   - semanticAlignment: does this candidate's direction agree with
 *     the clause's contourBias, and — if this is a genuine disruption
 *     event — does it register as a real leap in the disruption's
 *     implied direction. Scaled by |contourBias| and a bounded
 *     disruption bonus, so it competes on the same footing as the
 *     other two axes instead of a separate ad hoc override.
 * @param {{note:Object, isChordTone:boolean}} candidate
 * @param {{degree:number, octave:number}|null} prev
 * @param {{isStrongBeat:boolean, contourBias:number, isDisruption:boolean}} context
 */
function scoreCandidate(candidate, prev, context) {
  const { note, isChordTone } = candidate;
  const W_VOICE = 1.0;
  const W_HARMONY = context.isStrongBeat ? 1.1 : 0.35;
  const W_SEMANTIC = 0.3 + Math.abs(context.contourBias) * 0.5 + (context.isDisruption ? 0.5 : 0);
  const W_CONTRARY = context.chordDirection !== 0 ? 0.4 : 0;

  let voiceLeadingCost = 0;
  let prevFreq = null;
  if (prev) {
    prevFreq = currentScale[prev.degree] * prev.octave;
    voiceLeadingCost = Math.abs(Math.log2(note.freq / prevFreq));
  }
  const harmonicFit = isChordTone ? 1 : 0;

  // Direction is judged by actual PITCH (frequency), not raw scale-degree
  // difference — near an octave-wrap boundary a smaller degree number can
  // still be a HIGHER pitch (different octave), so degree-diff sign can
  // disagree with the real audible direction. Confirmed empirically: ~17%
  // mismatch rate using degree-diff on realistic candidate sequences.
  const pitchMoveSign = (prev && prevFreq) ? Math.sign(Math.log2(note.freq / prevFreq)) : 0;

  // semanticAlignment is bounded to the same rough [-0.5, 1] range as the
  // other axes by taking the STRONGER of its two sub-signals rather than
  // summing them — summing let a disruption-leap-on-a-biased-direction
  // reach up to +2 raw, giving this axis disproportionate real influence
  // no matter what W_SEMANTIC's nominal weight said (previously up to
  // ~2.6 total contribution vs. harmony's max of 1.1).
  let semanticAlignment = 0;
  if (prev && context.contourBias !== 0) {
    const biasSign = Math.sign(context.contourBias);
    semanticAlignment = pitchMoveSign === biasSign ? 1 : (pitchMoveSign === 0 ? 0 : -0.5);
  }
  if (context.isDisruption && Math.abs(note.lastInterval || 0) >= 2) {
    semanticAlignment = Math.max(semanticAlignment, 1);
  }

  // Contrary motion (first-species counterpoint — Fux, 1725): when the
  // chord itself just moved a clear direction, prefer the melody
  // moving the OPPOSITE way (or staying put) — restores what
  // harmonizeNote's chordDirection bias used to do, now as one more
  // scored axis instead of a separate filter-then-pick step. Also
  // judged by actual pitch direction, same fix as above.
  let contraryAlignment = 0;
  if (prev && context.chordDirection !== 0) {
    contraryAlignment = pitchMoveSign === 0 ? 0.5 : (pitchMoveSign === -context.chordDirection ? 1 : -0.5);
  }

  return -W_VOICE * voiceLeadingCost + W_HARMONY * harmonicFit + W_SEMANTIC * semanticAlignment + W_CONTRARY * contraryAlignment;
}

/**
 * Tier 2 arbitration entry point: builds the candidate pool, scores
 * every candidate on the three axes above, and samples via
 * temperature-controlled softmax. Replaces the old two-candidate
 * hard-fallback/weighted-random scheme with genuine multi-candidate,
 * multi-axis competition. Tier 1 (resolveCadence, motifNote) is
 * entirely separate and untouched by this function.
 * @param {{degree:number, octave:number, lastInterval?:number}|null} prev
 * @param {number|null} chordRootDegree
 * @param {number} tenseScore
 * @param {number} contourBias
 * @param {boolean} isDisruption
 * @param {boolean} isStrongBeat
 * @param {number} [chordDirection=0] — -1, 0, or 1, from ambient.js's getChordDirection()
 * @param {number} [registerBias=0]
 * @param {number} [temperature=0.4]
 */
export function arbitrateMelodyNote(prev, chordRootDegree, tenseScore, contourBias, isDisruption, isStrongBeat, chordDirection = 0, registerBias = 0, temperature = 0.4) {
  const pool = buildCandidatePool(prev, chordRootDegree, tenseScore, contourBias, isDisruption, registerBias);
  const scored = pool.map(c => ({ note: c.note, score: scoreCandidate(c, prev, { isStrongBeat, contourBias, isDisruption, chordDirection }) }));
  return arbitrate(scored, temperature);
}

export function harmonizeNote(prev, chordRootDegree, chordDirection = 0, registerBias = 0) {


  if (chordRootDegree === null || chordRootDegree === undefined) return null;
  const len = currentScale.length;
  const tones = [...new Set(
    [chordRootDegree, chordRootDegree + 2, chordRootDegree + 4, chordRootDegree + 6]
      .map(d => ((d % len) + len) % len)
  )];
  if (!prev) return placeNearest(tones[0], null);
  const prevFreq = currentScale[prev.degree] * prev.octave;
  const candidates = tones.map(t => {
    const candidate = placeNearest(t, prev, registerBias);
    const dist = Math.abs(Math.log2(candidate.freq / prevFreq));
    return { candidate, dist };
  });
  candidates.sort((a, b) => a.dist - b.dist);
  // Anti-stall guard: if the nearest candidate is a unison (dist===0)
  // and a non-unison alternative exists, skip the unison most of the
  // time — otherwise, once the melody lands on a degree that happens
  // to be a common tone of every chord (mathematically guaranteed here
  // for degree 6 across all four CHORD_DEGREES on a 7-note scale), it
  // stays there permanently since zero distance always wins.
  let pool = candidates;
  if (candidates[0].dist === 0 && candidates.length > 1 && rnd(0, 1) < 0.8) {
    pool = candidates.slice(1);
  }
  const best = pool[0].candidate;

  if (chordDirection === 0) return best; // unchanged behavior when direction is unknown/flat

  const CONTRARY_BIAS = 0.65; // probabilistic, not absolute — see docstring
  const contrary = pool.filter(c =>
    c.candidate.degree === prev.degree || Math.sign(c.candidate.degree - prev.degree) === -chordDirection
  );
  if (contrary.length > 0 && rnd(0, 1) < CONTRARY_BIAS) return contrary[0].candidate;
  return best;
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

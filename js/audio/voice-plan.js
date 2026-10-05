/**
 * js/audio/voice-plan.js
 * ─────────────────────────────────────────────────────────────────
 * Which voice sounds on which word. Pure: no Web Audio, no DOM, no module
 * state; the render-stream functions arrive as arguments, so the same inputs
 * and the same stream always give the same voice.
 *
 * What the old rule did (player.js, kept below the flag as the fallback): a
 * 40% coin per word re-picked the voice from sentenceType ∩ mood ∩ attack
 * family. Measured on the real tables and simulated over mixed text:
 *   - a voice changed about every 3 words, and the sentence-type/mood rules
 *     only took effect when the coin happened to land, so ~10% of words
 *     sounded in the wrong group and 12–16% in the wrong family;
 *   - the pools collapsed: statement+bright had 2 voices, question+dark 1,
 *     exclaim+dark 1 (and that one was the Synth brass, which is not dark);
 *   - 5 voices sound an octave (or two) away from the note they are given,
 *     so any change to or from one of them is a pitch jump the melody never
 *     wrote — 56% of voice changes in dark text were such a jump.
 *
 * This planner:
 *   1. holds a voice for a PHRASE. It is re-picked only at a phrase start
 *      (new sentence, the word after a half cadence, a change of section in
 *      music/composition.js), or when the held voice is not allowed for this
 *      sentence type or is not audible at this pitch. The old coin is still
 *      drawn every word (the render stream advances exactly as before) and
 *      now only allows a rare MID-phrase change, restricted to the same
 *      attack family and the same octave class, so it can never move the
 *      sounding pitch;
 *   2. gives repeated text the voice of its first occurrence (the melody
 *      already repeats; the timbre now does too);
 *   3. ties the cadence to music/intention.js: a CLEAN cadence
 *      (cadenceStrength ≥ 0.75) may settle from a struck voice into a sustained,
 *      un-displaced one; an UNSTABLE cadence keeps the voice, so it stays open;
 *   4. widens the pools that collapsed (GROUP_EXTRA) with voices that already
 *      belong to the right mood and family, so that no body pool is below 3;
 *   5. treats the two accent voices (14 Sub thump, 21 Deep gong) as one-shots:
 *      repeated per word they stop being an accent and become a wash; and
 *      keeps 14 off notes where its fundamental (0.18–0.25 × the note) would sit
 *      under ~70 Hz and be inaudible on ordinary speakers.
 *
 * Sentences with NO lexicon evidence still go through the old warm-subset
 * picker (`legacyPick`), unchanged — only the holding rules apply to them.
 */
export const VOICE_PLAN_ENABLED = true;

/** Octaves each voice SOUNDS away from the pitch it is given (read from voices.js). */
export const OCT_SHIFT = { 11: 1, 19: 1, 14: -2, 16: -1, 21: -1 };
export const octClass = v => OCT_SHIFT[v] || 0;

/** One-shot accent voices: never held for a second word. */
export const ACCENT_VOICES = [14, 21];

/** Lowest note (Hz) at which a voice is audible; absent = always. */
export const MIN_AUDIBLE_HZ = { 14: 390 };
export const audibleAt = (v, freq) => !(v in MIN_AUDIBLE_HZ) || freq >= MIN_AUDIBLE_HZ[v];

/**
 * Voices ADDED to a sentence type's pool by the planner (player.js's own
 * VOICE_GROUPS is untouched). Every one already sits in the right mood set and
 * attack family for the cell it repairs:
 *   statement: Marimba, Kalimba      → statement+bright (was only Piano, Vibraphone)
 *   question : Breath, Choir pad     → question+dark    (was only Ghost chord)
 *   exclaim  : Choir pad, Cello, Gong → exclaim+dark    (was nothing; fell back to Brass)
 */
export const GROUP_EXTRA = {
  statement: [8, 17],
  question:  [2, 12],
  exclaim:   [12, 16, 21],
};

/** Strong enough that the cadence may settle (cadenceStrength from intention.js). */
export const CLEAN_CADENCE = 0.75;
/** Chance per word of a mid-phrase change (the same coin the old code drew). */
export const MID_PHRASE_CHANGE = 0.06;
/** Chance a clean cadence settles into a sustained voice (the old 0.4). */
export const SETTLE_CHANCE = 0.4;

/** The voices a sentence type may use under the planner. */
export function groupFor(sentenceType, tables) {
  const base = tables.VOICE_GROUPS[sentenceType] || tables.VOICE_GROUPS.statement;
  const extra = GROUP_EXTRA[sentenceType] || (tables.VOICE_GROUPS[sentenceType] ? [] : GROUP_EXTRA.statement);
  return [...new Set([...base, ...extra])];
}

function moodSetFor(normScore, tables) {
  return normScore <= -0.15 ? tables.DARK_VOICES : normScore >= 0.15 ? tables.BRIGHT_VOICES : null;
}

/**
 * mood∩family → family → mood → group, the old fallback order, over a pool
 * already limited to audible, allowed voices. `how` names the step that
 * produced the list ('mood+family' is the only one that honours both).
 */
function candidates(pool, moodSet, family) {
  let c = pool.filter(v => family.includes(v) && (!moodSet || moodSet.includes(v)));
  if (c.length) return { list: c, how: 'mood+family' };
  c = pool.filter(v => family.includes(v));
  if (c.length) return { list: c, how: 'family' };
  c = pool.filter(v => !moodSet || moodSet.includes(v));
  if (c.length) return { list: c, how: 'mood' };
  return { list: pool, how: 'group' };
}
function choose(pool, moodSet, family, pick) { return pick(candidates(pool, moodSet, family).list); }

/** The pool a readable sentence draws from (exported for test/voice-plan.mjs). */
export function poolCell(sentenceType, normScore, family, freq, tables) {
  const pool = groupFor(sentenceType, tables).filter(v => audibleAt(v, freq));
  return candidates(pool, moodSetFor(normScore, tables), family);
}

/**
 * @param {object} s
 * @param {number|null} s.prevVoice     voice sounding on the previous word (null at the start)
 * @param {boolean} s.isPhraseStart     new sentence, word after a half cadence, or new section
 * @param {boolean} s.isCadence         last word of a sentence / of the text
 * @param {number}  s.cadenceStrength   0..1 from intention.js
 * @param {string}  s.sentenceType      'statement' | 'question' | 'exclaim'
 * @param {number}  s.normScore         session mood
 * @param {number}  s.lexiconHits       0 = text the lexicon cannot read
 * @param {number[]} s.family           this sentence's attack family (PERCUSSIVE or RAMPED table)
 * @param {number}  s.freq              Hz of THIS word's note
 * @param {number}  s.roll              the per-word draw in [0,1) (caller draws it every word)
 * @param {number|undefined} s.repeatVoice  voice of the first occurrence if this word repeats earlier text
 * @param {object}  tables              {VOICE_GROUPS, DARK_VOICES, BRIGHT_VOICES, PERCUSSIVE_VOICES, RAMPED_VOICES, WARM_VOICES}
 * @param {Function} pick               render-stream rpick
 * @param {Function} legacyPick         player.js's pickOrchestVoice (used for unreadable text)
 * @returns {number} voice index
 */
export function planVoice(s, tables, pick, legacyPick) {
  const readable = s.lexiconHits > 0;
  let allowedGroup;
  if (readable) {
    allowedGroup = groupFor(s.sentenceType, tables);
  } else {
    // text the lexicon cannot read: the sentence type's voices that are warm,
    // or all of WARM_VOICES when that intersection is empty (the old picker's
    // own fallback) — and that SAME set is what "allowed" means for a held
    // voice, otherwise the held voice is never allowed and changes every word
    const g = tables.VOICE_GROUPS[s.sentenceType] || tables.VOICE_GROUPS.statement;
    const warm = g.filter(v => tables.WARM_VOICES.includes(v));
    allowedGroup = warm.length ? warm : tables.WARM_VOICES;
  }
  const pool = allowedGroup.filter(v => audibleAt(v, s.freq));
  const moodSet = readable ? moodSetFor(s.normScore, tables) : null;
  const pickFrom = (family, extraFilter) => {
    const p = extraFilter ? pool.filter(extraFilter) : pool;
    if (!readable) {
      return legacyPick(p, s.normScore, family, s.lexiconHits);
    }
    return choose(p.length ? p : pool, moodSet, family, pick);
  };

  // 2. repeated text keeps its first voice
  if (s.repeatVoice !== undefined && pool.includes(s.repeatVoice)) return s.repeatVoice;

  const prev = s.prevVoice;
  const heldOk = prev !== null && prev !== undefined && pool.includes(prev) && !ACCENT_VOICES.includes(prev);

  // 1. a phrase start, an unusable held voice, or an accent voice forces a fresh pick
  if (!heldOk || s.isPhraseStart) return pickFrom(s.family);

  // 3. cadence
  if (s.isCadence) {
    const prevStruck = tables.PERCUSSIVE_VOICES.includes(prev);
    if (s.cadenceStrength >= CLEAN_CADENCE && prevStruck && s.roll < SETTLE_CHANCE) {
      const settle = v => tables.RAMPED_VOICES.includes(v) && octClass(v) === octClass(prev)
        && v !== 14 && v !== 18 && v !== 20 && v !== 21;
      const p = pool.filter(settle);
      if (p.length) return choose(p, moodSet, tables.RAMPED_VOICES, pick);
    }
    return prev;
  }

  // mid-phrase change: rare, same family, same octave class (never moves the sounding pitch)
  if (s.roll < MID_PHRASE_CHANGE) {
    const same = v => v !== prev && octClass(v) === octClass(prev)
      && s.family.includes(v) && !ACCENT_VOICES.includes(v);
    const p = pool.filter(same);
    if (p.length) return pickFrom(s.family, same);
  }
  return prev;
}

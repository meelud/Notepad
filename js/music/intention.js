/**
 * js/music/intention.js
 * ─────────────────────────────────────────────────────────────────
 * Semantic Event Detection → Musical Intention layer.
 *
 * Bridges the gap between whole-sentence mood scoring (mood.js) and
 * per-word pitch decisions (harmony.js): splits text into CLAUSES
 * (sentence + comma + contrast-word boundaries — "but"/"ولی") and
 * derives, for each clause, a small deterministic intention vector:
 *
 *   - contourBias      (-1..1)  local sentiment trajectory vs. the
 *                                previous clause — "is this clause
 *                                more positive or more negative than
 *                                what came right before it"
 *   - isDisruption      (bool)   this clause was split off BY a
 *                                contrast word ("but"/"ولی") — a
 *                                genuine semantic pivot point
 *   - cadenceStrength   (0..1)   how cleanly this clause's sentiment
 *                                agrees with itself — a clause whose
 *                                trajectory just reversed hard resolves
 *                                more weakly (an "unstable cadence")
 *
 * Deliberately NOT a pitch mapper: nothing here decides a note. It
 * only produces a musical-intention signal that harmony.js's existing
 * functions (stepwiseNote, resolveCadence) consume as an OPTIONAL
 * bias — see their directionBias/forceLeap/strength parameters. This
 * keeps the semantic layer swappable/toggleable without touching the
 * melodic grammar itself.
 *
 * Fully deterministic: pure function of the input text, no RNG at all.
 */
import { CONTRAST_WORDS, wordSentimentSign } from './mood.js';
import { NEGATORS, EMPHASIS_ONLY, NEGATION_WINDOW } from './negators.js';

const WORD_RE = /[a-zA-Zا-ی]+/g;

/**
 * Splits text into clause ranges (character offsets), breaking at
 * sentence-ending punctuation, commas, and contrast words. A contrast
 * word starts its OWN new clause (and is excluded from the clause's
 * own text so it doesn't score itself).
 * @param {string} text
 * @returns {Array<{start:number, end:number, isDisruption:boolean, isSentenceEnd:boolean}>}
 */
function splitClauses(text) {
  const clauses = [];
  let clauseStart = 0;
  let pendingDisruption = false;

  const pushClause = (end, isSentenceEnd) => {
    if (end > clauseStart) {
      clauses.push({ start: clauseStart, end, isDisruption: pendingDisruption, isSentenceEnd });
    }
    pendingDisruption = false;
  };

  // word-by-word scan so contrast words can be detected as whole words
  // (not substrings) while still tracking character offsets precisely
  let m;
  WORD_RE.lastIndex = 0;
  let lastWordEnd = 0;
  while ((m = WORD_RE.exec(text))) {
    const word = m[0].toLowerCase();
    lastWordEnd = m.index + m[0].length;
    if (CONTRAST_WORDS.has(word)) {
      pushClause(m.index, false);
      clauseStart = m.index; // contrast word itself starts the new clause's range
      pendingDisruption = true;
    }
  }

  // comma and sentence-ending punctuation also break clauses
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === ',' || ch === '،') {
      if (i >= clauseStart) { pushClause(i, false); clauseStart = i + 1; }
    } else if ('.!?؟'.includes(ch)) {
      if (i >= clauseStart) { pushClause(i, true); clauseStart = i + 1; }
    }
  }
  pushClause(text.length, true); // trailing clause with no terminal punctuation

  return clauses.filter(c => WORD_RE.test(text.slice(c.start, c.end)));
}

/**
 * Sums signed lexicon sentiment over a clause's words, WITH negation
 * awareness — "I am not happy" must NOT score the same as "I am
 * happy". Uses the same NEGATION_WINDOW proximity rule as mood.js's
 * sentence-level scoring (a negator within a small word-distance flips
 * the sign), just applied at clause granularity. Intentionally lighter
 * than mood.js otherwise: no intensifier/diminisher/contrast weighting
 * here — those already shape the clause boundaries themselves (see
 * splitClauses), so re-applying them here would double-count.
 * @param {string} clauseText
 */
/**
 * Sums signed lexicon sentiment over a clause's words, WITH negation
 * awareness — "I am not happy" must NOT score the same as "I am
 * happy". Uses the same NEGATION_WINDOW proximity rule as mood.js's
 * sentence-level scoring (a negator within a small word-distance flips
 * the sign), just applied at clause granularity. Intentionally lighter
 * than mood.js otherwise: no intensifier/diminisher/contrast weighting
 * here — those already shape the clause boundaries themselves (see
 * splitClauses), so re-applying them here would double-count.
 *
 * Also normalizes English contractions (n't -> not) BEFORE extracting
 * words, mirroring mood.js's detectMood exactly. Without this,
 * "don't"/"isn't"/"can't" etc. get split by WORD_RE into meaningless
 * fragments ("don","t") that never match NEGATORS — silently
 * disabling negation for nearly all English contractions. Confirmed
 * bug: "I don't feel happy" produced contourBias=0 while the
 * semantically identical "I do not feel happy" correctly produced -1.
 * @param {string} clauseText
 */
function clauseSentiment(clauseText) {
  const normalized = clauseText.toLowerCase().replace(/n['’]t\b/g, ' not');
  const words = normalized.match(WORD_RE) || [];
  const negatorPositions = [];
  words.forEach((w, i) => { if (NEGATORS.has(w) && !EMPHASIS_ONLY.has(w)) negatorPositions.push(i); });
  const isNegated = (i) => negatorPositions.some(p => p !== i && Math.abs(p - i) <= NEGATION_WINDOW);

  let sum = 0;
  words.forEach((w, i) => {
    const raw = wordSentimentSign(w);
    sum += isNegated(i) ? -raw * 0.85 : raw;
  });
  return sum;
}

/**
 * Derives the full Musical Intention sequence for a text.
 * @param {string} text
 * @returns {Array<{start:number, end:number, contourBias:number, isDisruption:boolean, cadenceStrength:number, isSentenceEnd:boolean}>}
 */
export function deriveIntentions(text) {
  const ranges = splitClauses(text);
  if (ranges.length === 0) return [];

  const scores = ranges.map(r => clauseSentiment(text.slice(r.start, r.end)));
  const NORM = 2.0; // typical single-word lexicon weight magnitude ~1.0-1.5; this keeps bias in a sane range before clamping

  return ranges.map((r, i) => {
    const prevScore = i === 0 ? scores[i] : scores[i - 1];
    const rawBias = (scores[i] - prevScore) / NORM;
    const contourBias = Math.max(-1, Math.min(1, rawBias));
    const cadenceStrength = r.isSentenceEnd ? Math.max(0, 1 - Math.abs(contourBias)) : 1;
    return {
      start: r.start,
      end: r.end,
      contourBias,
      isDisruption: r.isDisruption,
      cadenceStrength,
      isSentenceEnd: r.isSentenceEnd,
    };
  });
}

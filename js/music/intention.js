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
 *
 * FIXED BUG: this used to be TWO separate loops run one after the
 * other — first a full word-by-word scan for contrast words, THEN a
 * full character scan for comma/sentence-end punctuation. Because the
 * first loop ran to completion (advancing clauseStart as it went)
 * BEFORE the second loop ever started, any sentence-end punctuation
 * that occurred earlier in the text than a LATER contrast word got
 * silently skipped: by the time the punctuation loop reached that
 * position, clauseStart had already been pushed past it by the
 * contrast-word loop, failing the `i >= clauseStart` guard. Example:
 * "I love this city. It has great food. But then I got sick." — the
 * two real sentence boundaries (after "city" and after "food") were
 * both dropped, silently merging two independent sentences into one
 * clause with a single contourBias/cadenceStrength, and neither
 * boundary was ever marked isSentenceEnd.
 *
 * Fix: collect every boundary event (contrast word, comma, sentence-
 * end punctuation) as {index, type} into one list, sort it by
 * position, and process it in a single left-to-right pass so ordering
 * is always correct regardless of which event type occurs first.
 * @param {string} text
 * @returns {Array<{start:number, end:number, isDisruption:boolean, isSentenceEnd:boolean}>}
 */
function splitClauses(text) {
  const events = [];

  // word-by-word scan so contrast words are detected as whole words
  // (not substrings) while still tracking precise character offsets
  let m;
  WORD_RE.lastIndex = 0;
  while ((m = WORD_RE.exec(text))) {
    const word = m[0].toLowerCase();
    if (CONTRAST_WORDS.has(word)) {
      events.push({ index: m.index, type: 'contrast' });
    }
  }

  // comma and sentence-ending punctuation also break clauses
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === ',' || ch === '،') {
      events.push({ index: i, type: 'comma' });
    } else if ('.!?؟'.includes(ch)) {
      events.push({ index: i, type: 'sentenceEnd' });
    }
  }

  // single left-to-right pass over ALL boundary events in true text
  // order — this is what guarantees a sentence-end occurring before a
  // later contrast word is never skipped
  events.sort((a, b) => a.index - b.index);

  const clauses = [];
  let clauseStart = 0;
  let pendingDisruption = false;

  const pushClause = (end, isSentenceEnd) => {
    if (end > clauseStart) {
      clauses.push({ start: clauseStart, end, isDisruption: pendingDisruption, isSentenceEnd });
    }
    pendingDisruption = false;
  };

  for (const ev of events) {
    if (ev.type === 'contrast') {
      if (ev.index >= clauseStart) {
        pushClause(ev.index, false);
        clauseStart = ev.index; // contrast word itself starts the new clause's range
        pendingDisruption = true;
      }
    } else if (ev.type === 'comma') {
      if (ev.index >= clauseStart) {
        pushClause(ev.index, false);
        clauseStart = ev.index + 1;
      }
    } else { // sentenceEnd
      if (ev.index >= clauseStart) {
        pushClause(ev.index, true);
        clauseStart = ev.index + 1;
      }
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

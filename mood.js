import { MODE_ORDER } from './scales.js';
import { EMOTION_LEXICON } from './lexicon-en.js';
import { FA_LEXICON_COLLOQUIAL } from './lexicon-fa-colloquial.js';
import { NEGATORS, EMPHASIS_ONLY, NEGATION_WINDOW } from './negators.js';

export { EMOTION_LEXICON };

// ─── Persian merge ─────────────────────────────────────────────
// Merge the Persian colloquial/slang extension into EMOTION_LEXICON —
// same weight/tense per category, words appended and de-duped.
(function mergeColloquialLexicon() {
  for (const [category, words] of Object.entries(FA_LEXICON_COLLOQUIAL)) {
    if (!EMOTION_LEXICON[category]) continue;
    const existing = new Set(EMOTION_LEXICON[category].words);
    for (const w of words) {
      if (!existing.has(w)) {
        EMOTION_LEXICON[category].words.push(w);
        existing.add(w);
      }
    }
  }
})();

// ─── Word lookup table ─────────────────────────────────────────
const WORD_LOOKUP = (() => {
  const map = {};
  Object.values(EMOTION_LEXICON).forEach(({ weight, tense, words }) => {
    words.forEach(w => { map[w] = { weight, tense }; });
  });
  return map;
})();

// ─── Mood detection ────────────────────────────────────────────
/**
 * Detects the emotional mood of text and returns a musical mode.
 * Uses a bilingual (EN/FA) lexicon with negation handling.
 *
 * Punctuation adjustments:
 *   !  → +0.4 score, +0.5 tense
 *   ?  → -0.25 score
 *   …  → -0.3 score
 *
 * @param {string} text — input text (EN/FA)
 * @returns {{ mode: string, normScore: number, tenseScore: number }}
 */
export function detectMood(text) {
  const lower = text.toLowerCase();
  const words = lower.match(/[a-zA-Zا-ی]+/g) || [];
  let score = 0, tense = 0;

  // ── negator positions ────────────────────────────────────────
  // find true-negator positions (excluding emphasis-only particles unless
  // they co-occur with a real negator, which the window check handles
  // naturally since we only flip when a genuine negator is in range)
  const negatorPositions = [];
  words.forEach((w, i) => {
    if (NEGATORS.has(w) && !EMPHASIS_ONLY.has(w)) negatorPositions.push(i);
  });

  function isNegated(i) {
    return negatorPositions.some(p => Math.abs(p - i) <= NEGATION_WINDOW && p !== i);
  }

  // ── word scoring ─────────────────────────────────────────────
  words.forEach((w, i) => {
    const hit = WORD_LOOKUP[w];
    if (!hit) return;
    if (isNegated(i)) {
      // flip and dampen (a negated emotion isn't the full opposite,
      // and it reads as slightly more unsettled/ambiguous)
      score += -hit.weight * 0.85;
      tense += Math.abs(hit.tense) * 0.5 + 0.15;
    } else {
      score += hit.weight;
      tense += hit.tense;
    }
  });

  // ── punctuation adjustments ──────────────────────────────────
  const exclaim  = (text.match(/!/g) || []).length;
  const question = (text.match(/\?/g) || []).length;
  const ellipsis = (text.match(/\.\.\./g) || []).length;
  score += exclaim * 0.4;
  score -= question * 0.25;
  score -= ellipsis * 0.3;
  tense += exclaim * 0.5;

  // ── normalize & map to mode ──────────────────────────────────
  const norm = score / Math.max(3, Math.sqrt(words.length));
  const tenseNorm = tense / Math.max(3, Math.sqrt(words.length));

  const clamped = Math.max(-1.5, Math.min(1.5, norm));
  let idx = Math.round(((clamped + 1.5) / 3.0) * (MODE_ORDER.length - 1));

  // high tension pushes toward darker modes
  if (tenseNorm > 0.5 && idx > 3) idx = Math.max(1, idx - 4);
  idx = Math.max(0, Math.min(MODE_ORDER.length - 1, idx));

  return { mode: MODE_ORDER[idx], normScore: norm, tenseScore: tenseNorm };
}

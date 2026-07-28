import { TIERS } from './scales.js';
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

// ─── Phrase lookup table ────────────────────────────────────────
// Lexicon entries range from single words to multi-word phrases
// ("giddy up", "بهترین حس دنیارو دارم"). To make phrases matchable
// against tokenized input, each phrase key is normalized through the
// same word-extraction regex used on input text — so contractions/
// hyphenated words ("can't wait" → "can t wait") line up on both sides.
function normalizePhrase(str) {
  return (str.toLowerCase().match(/[a-zA-Zا-ی]+/g) || []).join(' ');
}

let MAX_PHRASE_LEN = 1;
const PHRASE_LOOKUP = (() => {
  const map = {};
  Object.values(EMOTION_LEXICON).forEach(({ weight, tense, words }) => {
    words.forEach(w => {
      const key = normalizePhrase(w);
      if (!key) return;
      map[key] = { weight, tense };
      const len = key.split(' ').length;
      if (len > MAX_PHRASE_LEN) MAX_PHRASE_LEN = len;
    });
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

  // ── phrase scoring ───────────────────────────────────────────
  // Greedy longest-match-first scan: at each position, try the longest
  // possible phrase span first and fall back to shorter spans (down to
  // a single word) before advancing. This lets multi-word lexicon
  // entries win over any shorter/overlapping single-word coincidence.
  let i = 0;
  while (i < words.length) {
    let matchedLen = 0;
    const maxLen = Math.min(MAX_PHRASE_LEN, words.length - i);
    for (let len = maxLen; len >= 1; len--) {
      const span = words.slice(i, i + len).join(' ');
      const hit = PHRASE_LOOKUP[span];
      if (hit) {
        if (isNegated(i)) {
          // flip and dampen (a negated emotion isn't the full opposite,
          // and it reads as slightly more unsettled/ambiguous)
          score += -hit.weight * 0.85;
          tense += Math.abs(hit.tense) * 0.5 + 0.15;
        } else {
          score += hit.weight;
          tense += hit.tense;
        }
        matchedLen = len;
        break;
      }
    }
    i += matchedLen || 1;
  }

  // ── punctuation adjustments ──────────────────────────────────
  const exclaim  = (text.match(/!/g) || []).length;
  const question = (text.match(/[?؟]/g) || []).length;
  const ellipsis = (text.match(/\.\.\.|…/g) || []).length;
  score += exclaim * 0.4;
  score -= question * 0.25;
  score -= ellipsis * 0.3;
  tense += exclaim * 0.5;

  // ── normalize & map to tier (16 dark→bright levels, same
  // resolution/contrast as the original palette) ──────────────
  const norm = score / Math.max(3, Math.sqrt(words.length));
  const tenseNorm = tense / Math.max(3, Math.sqrt(words.length));

  const clamped = Math.max(-1.5, Math.min(1.5, norm));
  let idx = Math.round(((clamped + 1.5) / 3.0) * (TIERS.length - 1));

  // high tension nudges toward darker tiers — ramped smoothly instead
  // of the old hard cutoff (which could snap a mildly positive text
  // straight into an exotic/dissonant mode from a few exclamation
  // marks alone), but keeping the same original max strength (~4
  // tiers) now that we're back to the original 16-tier resolution.
  if (tenseNorm > 0.3) {
    const tensionPush = Math.min((tenseNorm - 0.3) * 8, 4);
    idx = Math.max(0, idx - Math.round(tensionPush));
  }
  idx = Math.max(0, Math.min(TIERS.length - 1, idx));

  // pick a specific mode within that tier — a small, independent,
  // deterministic per-text hash so the same text always gets the same
  // color, and multi-mode tiers add variety without touching contrast
  let tinyHash = 0;
  for (let k = 0; k < text.length; k++) tinyHash = (tinyHash * 31 + text.charCodeAt(k)) >>> 0;
  const tier = TIERS[idx];
  const mode = tier[tinyHash % tier.length];

  return { mode, normScore: norm, tenseScore: tenseNorm };
}

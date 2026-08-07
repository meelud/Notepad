import { MODE_ORDER } from './scales.js';
import { EMOTION_LEXICON } from './lexicon-en.js';
import { FA_LEXICON_COLLOQUIAL } from './lexicon-fa-colloquial.js';
import { NEGATORS, EMPHASIS_ONLY, NEGATION_WINDOW } from './negators.js';

export { EMOTION_LEXICON };

// ─── Intensity & contrast modifiers ─────────────────────────────
// Words that scale a nearby emotion phrase's weight up/down, and
// conjunctions after which the "real" sentiment usually lives
// ("it was fun, but I'm exhausted" → exhaustion is what matters).
const INTENSIFIERS = new Set([
  'خیلی','کاملا','کاملاً','فوق','شدیدا','شدیداً','واقعا','واقعاً',
  'حسابی','دقیقا','دقیقاً','قطعا','قطعاً','بی‌نهایت','بینهایت',
  'extremely','very','totally','completely','absolutely','so',
  'really','incredibly','utterly','super',
]);
const DIMINISHERS = new Set([
  'یکم','کمی','نسبتا','نسبتاً','تقریبا','تقریباً',
  'slightly','somewhat','fairly','rather','kinda','sorta',
]);
const CONTRAST_WORDS = new Set([
  'اما','ولی','هرچند','گرچه',
  'but','however','yet','though','although',
]);

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
  // Normalize English contractions before tokenizing — "don't"/"isn't"/
  // "can't" etc. would otherwise split into meaningless fragments
  // ("don","t") that never match the NEGATORS set, silently disabling
  // negation for almost all English contractions.
  const lower = text.toLowerCase().replace(/n['’]t\b/g, ' not');
  const totalWords = (lower.match(/[a-zA-Zا-ی]+/g) || []).length;
  let score = 0, tense = 0;

  // Split into sentences so contrast weighting doesn't bleed across
  // unrelated sentences. Punctuation itself isn't scored here (that
  // happens separately below on the full text).
  const sentences = lower.split(/[.!?؟]+/);

  for (const sentence of sentences) {
    const words = sentence.match(/[a-zA-Zا-ی]+/g) || [];
    if (words.length === 0) continue;

    // ── negator positions (scoped to this sentence) ──────────────
    const negatorPositions = [];
    words.forEach((w, i) => {
      if (NEGATORS.has(w) && !EMPHASIS_ONLY.has(w)) negatorPositions.push(i);
    });
    function isNegated(i) {
      return negatorPositions.some(p => Math.abs(p - i) <= NEGATION_WINDOW && p !== i);
    }

    // ── position multipliers: contrast + intensity ───────────────
    // Everything before the *last* contrast word ("but"/"ولی") in the
    // sentence is dampened; everything after is boosted — the part
    // after "but" is usually what the person actually means.
    const mult = new Array(words.length).fill(1);
    let lastContrastIdx = -1;
    words.forEach((w, i) => { if (CONTRAST_WORDS.has(w)) lastContrastIdx = i; });
    if (lastContrastIdx >= 0) {
      for (let i = 0; i < words.length; i++) {
        mult[i] *= i < lastContrastIdx ? 0.6 : (i > lastContrastIdx ? 1.5 : 1);
      }
    }
    // intensifiers/diminishers scale the word(s) right after them
    words.forEach((w, i) => {
      if (INTENSIFIERS.has(w)) {
        if (mult[i + 1] !== undefined) mult[i + 1] *= 1.6;
        if (mult[i + 2] !== undefined) mult[i + 2] *= 1.3;
      } else if (DIMINISHERS.has(w)) {
        if (mult[i + 1] !== undefined) mult[i + 1] *= 0.6;
        if (mult[i + 2] !== undefined) mult[i + 2] *= 0.75;
      }
    });

    // ── phrase scoring ────────────────────────────────────────────
    // Greedy longest-match-first scan: at each position, try the
    // longest possible phrase span first and fall back to shorter
    // spans (down to a single word) before advancing. This lets
    // multi-word lexicon entries win over shorter overlapping matches.
    let i = 0;
    while (i < words.length) {
      let matchedLen = 0;
      const maxLen = Math.min(MAX_PHRASE_LEN, words.length - i);
      for (let len = maxLen; len >= 1; len--) {
        const span = words.slice(i, i + len).join(' ');
        const hit = PHRASE_LOOKUP[span];
        if (hit) {
          const m = mult[i];
          if (isNegated(i)) {
            // flip and dampen (a negated emotion isn't the full opposite,
            // and it reads as slightly more unsettled/ambiguous)
            score += -hit.weight * 0.85 * m;
            tense += (Math.abs(hit.tense) * 0.5 + 0.15) * m;
          } else {
            score += hit.weight * m;
            tense += hit.tense * m;
          }
          matchedLen = len;
          break;
        }
      }

      // conservative fallback: a single word that didn't match
      // directly might carry a common Persian suffix (امیدی → امید).
      // Try stripping one, dampened confidence since it's a fuzzy
      // match rather than exact — only when nothing exact matched.
      if (matchedLen === 0 && words[i].length >= 3) {
        const SUFFIXES = ['های', 'یم', 'ید', 'ند', 'ها', 'ام', 'ات', 'اش', 'ی', 'م', 'ت', 'ش', 'ه'];
        for (const suf of SUFFIXES) {
          if (words[i].endsWith(suf) && words[i].length - suf.length >= 2) {
            const stem = words[i].slice(0, -suf.length);
            const hit = PHRASE_LOOKUP[stem];
            if (hit) {
              const m = mult[i];
              if (isNegated(i)) {
                score += -hit.weight * 0.85 * 0.85 * m;
                tense += (Math.abs(hit.tense) * 0.5 + 0.15) * 0.85 * m;
              } else {
                score += hit.weight * 0.85 * m;
                tense += hit.tense * 0.85 * m;
              }
              matchedLen = 1;
              break;
            }
          }
        }
      }

      i += matchedLen || 1;
    }
  }

  // ── punctuation adjustments ──────────────────────────────────
  const exclaim  = (text.match(/!/g) || []).length;
  const question = (text.match(/[?؟]/g) || []).length;
  const ellipsis = (text.match(/\.\.\.|…/g) || []).length;
  score += exclaim * 0.4;
  score -= question * 0.25;
  score -= ellipsis * 0.3;
  tense += exclaim * 0.5;

  // ── normalize & map to mode ──────────────────────────────────
  // Previously: Math.max(3, sqrt(words.length)) — too conservative,
  // so almost all everyday text (even strongly emotional sentences)
  // compressed into a narrow band around normScore≈0, landing only
  // on the middle few modes (dorian/minor/melodicMinor) regardless
  // of content. This gentler denominator lets genuinely emotional
  // text reach the colorful/extreme modes, while truly neutral text
  // still lands at normScore≈0 as it should.
  const norm = score / Math.max(1.6, Math.sqrt(totalWords) * 0.7);
  const tenseNorm = tense / Math.max(1.6, Math.sqrt(totalWords) * 0.7);

  const clamped = Math.max(-1.5, Math.min(1.5, norm));
  let idx = Math.round(((clamped + 1.5) / 3.0) * (MODE_ORDER.length - 1));

  // high tension pushes toward darker modes
  if (tenseNorm > 0.5 && idx > 3) idx = Math.max(1, idx - 4);
  idx = Math.max(0, Math.min(MODE_ORDER.length - 1, idx));

  return { mode: MODE_ORDER[idx], normScore: norm, tenseScore: tenseNorm };
}

import { MODE_ORDER } from './scales.js';
import { EMOTION_LEXICON } from './lexicon-en.js';
import { FA_LEXICON_COLLOQUIAL } from './lexicon-fa-colloquial.js';
import { NEGATORS, EMPHASIS_ONLY, NEGATION_WINDOW } from './negators.js';

export { EMOTION_LEXICON };

// ─── Intensity & contrast modifiers ─────────────────────────────
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
export { CONTRAST_WORDS };

// ─── Persian merge ─────────────────────────────────────────────
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

const SUFFIXES = ['های', 'یم', 'ید', 'ند', 'ها', 'ام', 'ات', 'اش', 'ی', 'م', 'ت', 'ش', 'ه'];

/**
 * Lightweight per-word semantic weight — how strongly THIS single word
 * matches the emotion lexicon, independent of sentence-level scoring.
 * Used by player.js (item #1, GTTM structural weighting) to bias
 * melody stability: strongly-matched words lean toward chord tones,
 * unmatched/function words stay free. Reuses the same PHRASE_LOOKUP
 * table detectMood builds — no separate lexicon pass, no negation or
 * intensifier logic (this is a cheap per-word approximation for
 * melodic bias, not a mood score).
 * @param {string} word — a single token's text (e.g. tok.text)
 * @returns {number} 0 (no match) upward — roughly 0.2 to 1.1+
 */
export function wordEmotionWeight(word) {
  const key = normalizePhrase(word);
  if (!key) return 0;
  const hit = PHRASE_LOOKUP[key];
  if (hit) return Math.abs(hit.weight);
  if (key.length >= 3) {
    for (const suf of SUFFIXES) {
      if (key.endsWith(suf) && key.length - suf.length >= 2) {
        const stemHit = PHRASE_LOOKUP[key.slice(0, -suf.length)];
        if (stemHit) return Math.abs(stemHit.weight) * 0.85;
      }
    }
  }
  return 0;
}

/**
 * Signed sibling of wordEmotionWeight — same lookup, but preserves the
 * lexicon's sign (positive/negative) instead of taking the absolute
 * value. Used by intention.js to compute a clause's local sentiment
 * DIRECTION (needed for contourBias), not just its intensity.
 * @param {string} word
 * @returns {number} signed weight, 0 if no match
 */
export function wordSentimentSign(word) {
  const key = normalizePhrase(word);
  if (!key) return 0;
  const hit = PHRASE_LOOKUP[key];
  if (hit) return hit.weight;
  if (key.length >= 3) {
    for (const suf of SUFFIXES) {
      if (key.endsWith(suf) && key.length - suf.length >= 2) {
        const stemHit = PHRASE_LOOKUP[key.slice(0, -suf.length)];
        if (stemHit) return stemHit.weight * 0.85;
      }
    }
  }
  return 0;
}

// ─── Mood detection ────────────────────────────────────────────
export function detectMood(text) {
  const lower = text.toLowerCase().replace(/n['’]t\b/g, ' not');
  const totalWords = (lower.match(/[a-zA-Zا-ی]+/g) || []).length;
  let score = 0, tense = 0;

  const sentences = lower.split(/[.!?؟]+/);

  for (const sentence of sentences) {
    const words = sentence.match(/[a-zA-Zا-ی]+/g) || [];
    if (words.length === 0) continue;

    const negatorPositions = [];
    words.forEach((w, i) => {
      if (NEGATORS.has(w) && !EMPHASIS_ONLY.has(w)) negatorPositions.push(i);
    });
    function isNegated(i, spanLen = 1) {
      return negatorPositions.some(p => (p < i || p >= i + spanLen) && Math.abs(p - i) <= NEGATION_WINDOW);
    }

    const mult = new Array(words.length).fill(1);
    let lastContrastIdx = -1;
    words.forEach((w, i) => { if (CONTRAST_WORDS.has(w)) lastContrastIdx = i; });
    if (lastContrastIdx >= 0) {
      for (let i = 0; i < words.length; i++) {
        mult[i] *= i < lastContrastIdx ? 0.6 : (i > lastContrastIdx ? 1.5 : 1);
      }
    }
    words.forEach((w, i) => {
      if (INTENSIFIERS.has(w)) {
        if (mult[i + 1] !== undefined) mult[i + 1] *= 1.6;
        if (mult[i + 2] !== undefined) mult[i + 2] *= 1.3;
      } else if (DIMINISHERS.has(w)) {
        if (mult[i + 1] !== undefined) mult[i + 1] *= 0.6;
        if (mult[i + 2] !== undefined) mult[i + 2] *= 0.75;
      }
    });

    let i = 0;
    while (i < words.length) {
      let matchedLen = 0;
      const maxLen = Math.min(MAX_PHRASE_LEN, words.length - i);
      for (let len = maxLen; len >= 1; len--) {
        const span = words.slice(i, i + len).join(' ');
        let hit = PHRASE_LOOKUP[span];
        let consumedLen = len;

        if (!hit && len >= 3 && i + len < words.length) {
          const window = words.slice(i, i + len + 1);
          for (let skip = 0; skip < window.length; skip++) {
            const candidate = window.slice(0, skip).concat(window.slice(skip + 1)).join(' ');
            const looseHit = PHRASE_LOOKUP[candidate];
            if (looseHit) { hit = looseHit; consumedLen = len + 1; break; }
          }
        }

        if (hit) {
          const m = mult[i];
          if (isNegated(i, consumedLen)) {
            score += -hit.weight * 0.85 * m;
            tense += (Math.abs(hit.tense) * 0.5 + 0.15) * m;
          } else {
            score += hit.weight * m;
            tense += hit.tense * m;
          }
          matchedLen = consumedLen;
          break;
        }
      }

      if (matchedLen === 0 && words[i].length >= 3) {
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

  const exclaim  = (text.match(/!/g) || []).length;
  const question = (text.match(/[?؟]/g) || []).length;
  const ellipsis = (text.match(/\.\.\.|…/g) || []).length;
  score += exclaim * 0.4;
  score -= question * 0.25;
  score -= ellipsis * 0.3;
  tense += exclaim * 0.5;

  const norm = score / Math.max(1.6, Math.sqrt(totalWords) * 0.7);
  const tenseNorm = tense / Math.max(1.6, Math.sqrt(totalWords) * 0.7);

  const clamped = Math.max(-1.5, Math.min(1.5, norm));
  let idx = Math.round(((clamped + 1.5) / 3.0) * (MODE_ORDER.length - 1));

  if (tenseNorm > 0.5 && idx > 3) idx = Math.max(1, idx - 4);
  idx = Math.max(0, Math.min(MODE_ORDER.length - 1, idx));

  return { mode: MODE_ORDER[idx], normScore: norm, tenseScore: tenseNorm };
}

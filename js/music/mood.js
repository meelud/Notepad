import { MODE_ORDER } from './scales.js';
import { EMOTION_LEXICON } from './lexicon-en.js';
import { FA_LEXICON_COLLOQUIAL } from './lexicon-fa-colloquial.js';
import { NEGATORS, EMPHASIS_ONLY, NEGATION_WINDOW } from './negators.js';

export { EMOTION_LEXICON };

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

/**
 * Scans an array of already-tokenized words (via the same
 * /[a-zA-Zا-ی]+/g extraction detectMood uses) for lexicon PHRASE
 * matches, using the identical greedy-longest-match-first strategy
 * (plus the same one-word "loose" skip fallback for 3+ word phrases)
 * that detectMood's inner loop uses on full sentences.
 *
 * Why this exists: wordSentimentSign/wordEmotionWeight above only ever
 * receive ONE word at a time, so they can only ever match the 38.6% of
 * the lexicon that is single-word entries — the other 61.4% (1029 of
 * 1675 entries, e.g. "on top of the world today", "دلم برات تنگ شده
 * بود") is entirely invisible to any caller that scores word-by-word.
 * Measured impact before this fix: intention.js's clause-level
 * contourBias was EXACTLY ZERO for 75% of clauses across the project's
 * eval corpus, and composition.js's harmonicStability sat at its
 * maximum (1.0, meaning "zero sentiment detected") for 36% of
 * sections — including sections of texts that are clearly emotional
 * by sentence-level detectMood's own scoring. The gap wasn't a matter
 * of degree, it was most of the signal simply not being visible.
 *
 * This intentionally does NOT replicate detectMood's negation,
 * intensifier/diminisher, or contrast-word weighting — callers here
 * (intention.js, composition.js) either already apply their own
 * lighter-weight negation handling at the clause level (to avoid
 * double-counting what already shapes clause BOUNDARIES — see
 * intention.js's own docstring on this) or intentionally want raw
 * magnitude only (composition.js's harmonicStability). Matching only,
 * not full scoring, is the deliberate scope here.
 *
 * Deliberately NOT wired into detectMood's own inner loop, even though
 * the matching logic is identical: detectMood is covered by
 * test/snapshot.mjs's stored baseline, and refactoring its live loop
 * to call out to a shared function risks subtly changing floating-
 * point iteration order or edge-case behavior in ways a snapshot diff
 * might not clearly explain. Two copies of the same simple matching
 * loop is an acceptable, explicitly-documented tradeoff against that
 * risk — if the matching strategy ever changes, both this function and
 * detectMood's inner loop must be updated together (there is no way to
 * enforce this automatically without merging them; a future refactor
 * that does so safely, verified against the full snapshot suite, would
 * be welcome).
 *
 * @param {string[]} words — already-lowercased, pre-extracted word tokens (e.g. `sentence.match(/[a-zA-Zا-ی]+/g) || []`)
 * @returns {Array<{index:number, length:number, weight:number, tense:number}>}
 *   one entry per match; `length` is how many words (1 or more) the
 *   match consumed starting at `index`, matching detectMood's own
 *   `consumedLen` semantics exactly.
 */
export function scanPhraseMatches(words) {
  const matches = [];
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
        matches.push({ index: i, length: consumedLen, weight: hit.weight, tense: hit.tense });
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
            matches.push({ index: i, length: 1, weight: hit.weight * 0.85, tense: hit.tense * 0.85 });
            matchedLen = 1;
            break;
          }
        }
      }
    }

    i += matchedLen || 1;
  }
  return matches;
}

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

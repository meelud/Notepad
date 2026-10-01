import { EMOTION_LEXICON, AROUSAL_OVERRIDES } from './lexicon-en.js';
import { foldPersian, extractWords, stripZeroWidth } from '../utils/text.js';
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

/**
 * Lower-case a lexicon entry and collapse it to space-separated word tokens, so
 * lookup is insensitive to case and punctuation.
 *
 * Delegates entirely to extractWords() in utils/text.js: lower-case, the
 * Arabic yeh/kaf folded, the zero-width characters dropped, and the letter
 * range taken from WORD_RE rather than kept here.
 *
 * That last part is the whole point. This function used to carry a PRIVATE
 * copy of the letter range, over U+0621-U+06CC, while the text extractors used
 * ا-ی. Six letters below U+0627 — آ ء أ إ ؤ ئ — were therefore dropped from
 * text but kept in the lexicon, so 119 entries could never be matched by any
 * text spelling them as Persian does. Sharing WORD_RE makes the divergence
 * impossible rather than merely fixed once; test/lexicon-round-trip-test.mjs
 * proves the two agree for every entry.
 *
 * The zero-width characters are NOT dropped in tokenize(), whose offsets index
 * the string buildRender() is handed.
 *
 * Arabic yeh/kaf are folded by foldPersian() on the TEXT side instead, at the
 * top of tokenize(), detectMood(), hashText() and scanPhraseMatches():
 * normalizePhrase only ever sees lexicon entries, which are all written in
 * Persian codepoints, so folding them here alone would fix the lookup while
 * leaving the typed text, the RNG seed and the token offsets on a different
 * spelling.
 */
function normalizePhrase(str) {
  return extractWords(str).join(' ');
}

let MAX_PHRASE_LEN = 1;
const PHRASE_LOOKUP = (() => {
  const map = {};
  // Overrides are keyed by the lexicon entry, but lookups go through
  // normalizePhrase, which can alter a string (ZWNJ, punctuation), so the
  // override tables are normalized once here too. An override that matches
  // nothing is reported rather than silently ignored.
  const normTable = table => {
    const out = {};
    for (const [w, v] of Object.entries(table || {})) out[normalizePhrase(w)] = v;
    return out;
  };
  const normOverrides = {};
  for (const [k, v] of Object.entries(AROUSAL_OVERRIDES)) normOverrides[k] = normTable(v);
  const unmatched = [];

  Object.entries(EMOTION_LEXICON).forEach(([cat, { weight, tense, arousal = 0, words }]) => {
    // mergeColloquialLexicon() above has already folded the Persian word lists
    // into these same categories, so one pass covers both languages. A
    // 'fa:<cat>' override is the specific one and wins for a Persian entry; the
    // plain '<cat>' table is the English/unspecified fallback.
    const overrides = { ...(normOverrides[cat] || {}), ...(normOverrides['fa:' + cat] || {}) };
    words.forEach(w => {
      const key = normalizePhrase(w);
      if (!key) return;
      map[key] = { weight, tense, arousal: overrides[key] ?? arousal };
      // only count as used once the entry has actually been seen, so a typo in
      // an override key is reported rather than ignored
      if (key in overrides) delete overrides[key];
      const len = key.split(' ').length;
      if (len > MAX_PHRASE_LEN) MAX_PHRASE_LEN = len;
    });
    for (const left of Object.keys(overrides)) unmatched.push(`${cat}/${left}`);
  });

  if (unmatched.length) {
    console.warn(`arousal: ${unmatched.length} override(s) matched no lexicon entry: ${unmatched.join(', ')}`);
  }
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
 * extractWords() the same one detectMood uses) for lexicon PHRASE
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
 * @param {string[]} words — pre-extracted, lower-cased, folded, ZWNJ-stripped
 *   word tokens (e.g. `extractWords(sentence)`)
 * @returns {Array<{index:number, length:number, weight:number, tense:number}>}
 *   one entry per match; `length` is how many words (1 or more) the
 *   match consumed starting at `index`, matching detectMood's own
 *   `consumedLen` semantics exactly.
 */

/**
 * The one-word "loose" fallback: an entry may be written with a filler word the
 * text does not have, so a window of `len` words plus one extra is tried with
 * each word in turn removed, looking for the entry underneath.
 *
 * Two rules, both learned from what the unrestricted version did:
 *
 * The skipped word must be INTERIOR. Removing the first or the last word turns
 * the fallback into a way of deleting any word you like. "how are you" is a
 * casual entry of weight 0, so "darling how are you" matched it with the
 * leading "darling" removed, consumed all four words, and returned 0.00 — the
 * same as the phrase on its own. "sad how are you", "furious how are you" and
 * "happy how are you" all measured 0.00 for the same reason, while "how are
 * you darling" gave 0.63 because there was nothing to swallow. An emotion word
 * at either edge must never be deleted by a filler-word heuristic.
 *
 * The skipped word must carry no lexicon weight of its own. Even in the middle,
 * deleting a word that means something trades a real signal for a speculative
 * one. A weight-0 hit is not a licence to discard whatever is adjacent to it.
 *
 * Both layers call this, so the mood and the contour cannot disagree about
 * which words a phrase consumed.
 *
 * @param {string[]} words — the caller's word array (already normalized)
 * @param {number} i — window start
 * @param {number} len — window length, before the extra word
 * @returns {{hit: object}|null}
 */
function looseMatch(words, i, len) {
  const window = words.slice(i, i + len + 1);
  // interior positions only: index 0 and window.length-1 are excluded
  for (let skip = 1; skip < window.length - 1; skip++) {
    const skipped = PHRASE_LOOKUP[window[skip]];
    if (skipped && skipped.weight !== 0) continue;
    const candidate = window.slice(0, skip).concat(window.slice(skip + 1)).join(' ');
    const looseHit = PHRASE_LOOKUP[candidate];
    if (looseHit) return { hit: looseHit };
  }
  return null;
}

export function scanPhraseMatches(words) {
  // Normalize here as well as in tokenize()/detectMood(). This function is the
  // single entry point to the lexicon, and three modules call it with words
  // they extracted themselves (intention.js's clauseSentiment and
  // deriveSemanticSpans, composition.js's sectionSentimentMagnitude), so
  // normalizing only at their callers would mean one of them being forgotten —
  // which is exactly how a ZWNJ-joined prefix matched in the mood layer and
  // not in the contour layer.
  //
  // Only the FOLD is applied here, not re-extraction. The caller's word
  // boundaries are authoritative: they came from WORD_RE, which is the same
  // regex extractWords() uses, so re-running the extractor over each word
  // would be a no-op at best — and would silently change the character range
  // the moment one caller passed words from a different source. An earlier
  // version of this line re-extracted per word and made "آرامش" resolve in the
  // span layer while detectMood() still read it as "رامش", moving three gold
  // texts in one layer only.
  //
  // The index arithmetic below is unaffected: this maps a COPY of the array,
  // and foldPersian() is 1:1 in length. Stripping the ZWNJ does shorten the
  // copy's strings, but they are only ever used as lookup keys, and the
  // lexicon keys were stripped the same way in normalizePhrase().
  words = words.map(w => stripZeroWidth(foldPersian(w)));
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
          const loose = looseMatch(words, i, len);
          if (loose) { hit = loose.hit; consumedLen = len + 1; }
        }

        if (hit) {
          matches.push({ index: i, length: consumedLen, weight: hit.weight, tense: hit.tense, arousal: hit.arousal });
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
            matches.push({ index: i, length: 1, weight: hit.weight * 0.85, tense: hit.tense * 0.85, arousal: hit.arousal * 0.85 });
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

// ─── Valence × arousal → mode ────────────────────────────────────
// Band edges are the SAME five sentiment buckets test/evaluate-mood.mjs
// uses to score detectMood(), so "what counts as very positive" means
// one thing across the project.
export const VALENCE_EDGES = { veryNeg: -0.9, neg: -0.25, pos: 0.25, veryPos: 0.9 };
// Inside the 'neg' bucket, above this only faint negativity remains.
const MILD_NEG = -0.4;

// arousalScore ≥ this counts as "high arousal".
const HIGH_AROUSAL = 0.5;
const INTENSE_AROUSAL = 1.0;

/**
 * Chooses the mode from the two numbers detectMood() measures, following
 * Russell's (1980) circumplex model of affect: VALENCE (normScore) picks
 * the family — minor-third modes for negative, major-third modes for
 * positive — and AROUSAL (arousalScore) sets how far along it the piece
 * goes: high arousal INTENSIFIES the valence's colour.
 *
 *   negative + calm     → sadness      → minor (dorian only if faint)
 *   negative + aroused  → anger, dread → harmonic minor → phrygian → locrian
 *   positive + calm     → contentment  → pentatonic major
 *   positive + aroused  → elation      → major → lydian
 *   neutral             → mixolydian (major third, flat seventh: bright
 *                         but unresolved — reads as neutral, not sad)
 *
 * Only modes whose third/fifth make their colour unambiguous are used
 * (Gagnon & Peretz 2003; Hevner 1936): major third + perfect fifth reads
 * happy, minor third reads sad, flat second / diminished fifth reads
 * tense. The ambiguous exotic scales (wholeTone, enigmatic, doubleHarmonic,
 * melodicMinor, phrygianDominant, diminished) stay in MODE_ORDER but are
 * not reachable from here: on the old dark→bright ladder they sat between
 * dorian and mixolydian, so mildly positive text landed on them and
 * sounded eerie instead of happy.
 *
 * The previous rule darkened ANY text with tenseScore > 0.5 by four modes,
 * which turned excited joy ("!!") into minor. Arousal now never moves
 * positive text toward the dark side.
 *
 * Pure function of (normScore, tenseScore): deterministic, no rng.
 * @param {number} norm   sentiment, roughly -1.5..1.5
 * @param {number} tense  ACTIVATION (detectMood's arousalScore, not its tenseScore); the parameter keeps its old name so callers/tests stay valid
 * @returns {string} a key of MODE_OFFSETS
 */
export function modeFor(norm, tense) {
  const e = VALENCE_EDGES;
  const aroused = tense >= HIGH_AROUSAL;
  const intense = tense >= INTENSE_AROUSAL;
  const moderate = tense >= 0.25;

  if (norm <= e.veryNeg) {
    return intense ? 'locrian' : aroused ? 'phrygian' : moderate ? 'harmonicMinor' : 'minor';
  }
  if (norm <= e.neg) {
    // Calm, clearly negative text (grief, emptiness, exhaustion) is the
    // circumplex's low-arousal / negative corner: it needs a plain minor
    // colour. Dorian's raised sixth reads wistful-but-hopeful, so it is
    // kept only for the faintest negativity (MILD_NEG).
    if (intense) return 'phrygian';
    if (aroused) return 'harmonicMinor';
    if (moderate) return 'minor';
    return norm > MILD_NEG ? 'dorian' : 'minor';
  }
  if (norm < e.pos) {
    return intense ? 'minor' : aroused ? 'dorian' : 'mixolydian';
  }
  if (norm < e.veryPos) {
    return aroused ? 'major' : 'pentMajor';
  }
  return aroused ? 'lydian' : 'major';
}

export function detectMood(text) {
  // foldPersian() first, so a text typed with Arabic yeh/kaf scores identically
  // to its Persian spelling — in the mood, and in the notes derived from it.
  const lower = foldPersian(text).toLowerCase().replace(/n['’]t\b/g, ' not');
  const totalWords = extractWords(lower).length;
  let score = 0, tense = 0, arousal = 0;

  const sentences = lower.split(/[.!?؟]+/);

  for (const sentence of sentences) {
    const words = extractWords(sentence);
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
          const loose = looseMatch(words, i, len);
          if (loose) { hit = loose.hit; consumedLen = len + 1; }
        }

        if (hit) {
          const m = mult[i];
          if (isNegated(i, consumedLen)) {
            score += -hit.weight * 0.85 * m;
            tense += (Math.abs(hit.tense) * 0.5 + 0.15) * m;
          } else {
            score += hit.weight * m;
            tense += hit.tense * m;
            // A negated emotion is denied, so it is no evidence of its
            // activation level either way ("not angry" is not calm).
            arousal += hit.arousal * m;
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
                arousal += hit.arousal * 0.85 * m;
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
  // An exclamation mark says HOW MUCH the writer feels, not WHICH way. It
  // used to add a flat +0.4 to the valence even when the words were
  // negative, so "I hate everything about this!!!" read as positive and an
  // angry text was pushed toward a major mode. Now it amplifies negative
  // sentiment the words already carry. With no negative evidence it keeps
  // its earlier meaning — mild enthusiasm ("وای چه خبر عالی!!" has no
  // lexicon hit for the good news itself, only the "!!" gives it away).
  score += (score < 0 ? -1 : 1) * exclaim * 0.4;
  score -= question * 0.25;
  score -= ellipsis * 0.3;
  tense += exclaim * 0.5;
  // Punctuation is a direct activation cue: '!' energises, a trailing-off
  // ellipsis deflates.
  arousal += exclaim * 0.5 - ellipsis * 0.3;

  const norm = score / Math.max(1.6, Math.sqrt(totalWords) * 0.7);
  const tenseNorm = tense / Math.max(1.6, Math.sqrt(totalWords) * 0.7);
  const arousalNorm = arousal / Math.max(1.6, Math.sqrt(totalWords) * 0.7);

  return { mode: modeFor(norm, arousalNorm), normScore: norm, tenseScore: tenseNorm, arousalScore: arousalNorm };
}

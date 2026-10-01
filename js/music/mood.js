import { EMOTION_LEXICON, AROUSAL_OVERRIDES } from './lexicon-en.js';
import { foldPersian, extractWords, stripZeroWidth, stripMadda } from '../utils/text.js';
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
// ─── Polysemous slang ─────────────────────────────────────────────
// A few slang phrases are positive about a PERSON and negative about a
// THING. "The building is on fire" is a disaster; "you are on fire!" is
// praise. The lexicon cannot express that with a bare entry, because
// "on fire" as a joy entry at +1.1 scored a burning building at lydian — the
// single worst error found in this audit.
//
// The rule: the slang reading needs a PERSON subject. Without one, the literal
// reading wins, which means these phrases simply do not match and the text
// falls through to whatever else it says.
//
// This is a closed list of exactly the phrases that were MEASURED
// mis-scoring. 'killing it' was on it and was removed again: it is not a
// lexicon entry, so the gate had nothing to allow and the code was dead. The
// list is not a pattern — it is a record of what broke.
const PERSON_SUBJECT_SLANG = new Set(['on fire']);

/**
 * A person subject immediately before the phrase: "I am on fire", "you are on
 * fire", "he's on fire", "we're on fire". Checked as copula + subject rather
 * than as a fixed list of full phrases, so "you", "your", "him", "her", "us",
 * "them" and the contractions all work without being enumerated.
 */
const PERSON_SUBJECTS = new Set([
  'i', 'you', 'he', 'she', 'it', 'we', 'they', 'im', 'youre', 'hes', 'shes',
  'were', 'theyre', 'ive', 'youve', 'hed', 'shed', 'wed', 'theyd', 'u', 'me',
  'him', 'her', 'us', 'them', 'one', 'somebody', 'someone', 'everybody',
]);
// "you're" arrives as two tokens — you + re — because the tokenizer splits on
// the apostrophe like any other boundary, and "n\'t" is rewritten to " not"
// separately. So the copula that survives tokenisation is the bare form.
const COPULAS = new Set(['am', 'is', 'are', 'was', 'were', 'be', 'being', 'been', 're', 'm', 's', 'll', 've', 'd']);

/**
 * Is there a person subject immediately before position `i`?
 * @param {string[]} words — the already-normalized word array
 * @param {number} i — index where the slang phrase starts
 */
export function hasPersonSubjectBefore(words, i) {
  // "on fire" is two words, so the copula can sit before it: "you are on fire"
  // (are, on, fire) or be attached: "you're on fire" tokenises as you + re.
  for (const back of [1, 2]) {
    const j = i - back;
    if (j < 0) continue;
    if (COPULAS.has(words[j]) && j - 1 >= 0 && PERSON_SUBJECTS.has(words[j - 1])) return true;
  }
  return false;
}

export { CONTRAST_WORDS, PERSON_SUBJECT_SLANG };

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
/**
 * Lexicon entries that the madda-less lookup fold merged, as { key, kept,
 * dropped }. Populated once during the PHRASE_LOOKUP build below. Exported so
 * the collision count can be asserted in a test rather than read off a console
 * warning nobody sees.
 */
export let MADDA_COLLISIONS = [];

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
  // entries whose spelling differs from an earlier one only by آ-vs-ا, which
  // the lookup fold now makes the same key. Recorded rather than resolved: the
  // later entry wins in `map`, and whoever writes the lexicon should know.
  const maddaCollisions = [];

  Object.entries(EMOTION_LEXICON).forEach(([cat, { weight, tense, arousal = 0, words }]) => {
    // mergeColloquialLexicon() above has already folded the Persian word lists
    // into these same categories, so one pass covers both languages. A
    // 'fa:<cat>' override is the specific one and wins for a Persian entry; the
    // plain '<cat>' table is the English/unspecified fallback.
    const overrides = { ...(normOverrides[cat] || {}), ...(normOverrides['fa:' + cat] || {}) };
    words.forEach(w => {
      const key = normalizePhrase(w);
      if (!key) return;
      // a collision needs both entries to spell the same key AND to be written
      // differently — if they are the same string there is nothing to report
      if (key in map && map[key].spelling !== w) {
        maddaCollisions.push({ key, kept: map[key], dropped: { cat, w, weight } });
      }
      map[key] = { weight, tense, arousal: overrides[key] ?? arousal, spelling: w, cat };
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
  MADDA_COLLISIONS = maddaCollisions;
  // No console output here. This runs on every import, so anyone opening the
  // app in a browser got four lines of developer bookkeeping before they saw
  // anything. The collisions are still reported — by test/madda-fold-test.mjs,
  // which prints them, and by eval/lexicon-reconcile.mjs. The data itself is
  // exported as MADDA_COLLISIONS, so nothing was lost by not logging it.
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
  // stripMadda() is here as well as in extractWords(): this function is called
  // with words from WORD_RE as well as from extractWords(), and deriveSemanticSpans
  // uses the former so it can keep character offsets. Those words still carry
  // their madda, so without this the span layer built keys with آ while the mood
  // layer built them with ا, and "صبح آرومیه و دلم پر از آرامشه." matched in one
  // layer and not the other.
  words = words.map(w => stripMadda(stripZeroWidth(foldPersian(w))));
  const matches = [];
  let i = 0;
  while (i < words.length) {
    let matchedLen = 0;
    const maxLen = Math.min(MAX_PHRASE_LEN, words.length - i);
    for (let len = maxLen; len >= 1; len--) {
      const span = words.slice(i, i + len).join(' ');
      let hit = PHRASE_LOOKUP[span];
      let consumedLen = len;
      // Polysemous slang needs a person subject. Without one the literal
      // reading wins, which means NO match — the text falls through to
      // whatever else it says rather than being told it is joyful.
      if (hit && PERSON_SUBJECT_SLANG.has(span) && !hasPersonSubjectBefore(words, i)) {
        hit = null;
      }

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
//
// DERIVATION of the outer edges, from the lexicon's own numbers rather than
// from the gold set:
//
//   detectMood divides the summed lexicon weights by
//       divisor = max(1.6, sqrt(wordCount) * 0.7)
//   which is 1.6 for any text of five words or fewer. The strongest single
//   entry the lexicon holds at |weight| = 1 therefore lands at
//       1.0 / 1.6 = 0.625
//   in a short sentence, however emphatic that sentence is.
//
// veryPos was 0.9, so a single maximally strong term could not reach the top
// tier at all — "I am happy." measured 0.632 and stayed pentMajor. The top
// tier was reachable only by stacking several terms, which made it a measure of
// verbosity as much as of feeling. 0.625 is that same number: the top tier now
// begins exactly where one unambiguous strong term puts it, so a reader who
// says one strong thing is heard as fully as a reader who says several weak
// ones.
//
// veryNeg is derived the same way and for the same reason. The asymmetry is
// real and comes from the lexicon rather than from these constants: its
// strongest positive entry is joy at 1.1 and its strongest negative is sadness
// at 1.0, so a single joy word overshoots the positive edge by 0.06 and a
// single sad word lands exactly on the negative one.
export const VALENCE_EDGES = { veryNeg: -0.625, neg: -0.25, pos: 0.25, veryPos: 0.625 };
// Inside the 'neg' bucket, above this only faint negativity remains.
const MILD_NEG = -0.4;

// arousalScore ≥ this counts as "high arousal".
const HIGH_AROUSAL = 0.5;
const INTENSE_AROUSAL = 1.0;

// ── The calm-neutral prior ──────────────────────────────────────────
// What to play when a text says nothing we can read. See the long comment at
// the end of detectMood(); these are the numbers it uses.
//
// PRIOR_MODE is dorian: a minor third with a raised sixth. Neither a major
// third (which asserts happiness) nor a flat seventh (mixolydian, which asserts
// unresolved brightness) nor a plain minor (which asserts sadness). Dorian is
// the mode that asserts nothing about the writer's feelings.
//
// PRIOR_VALENCE and PRIOR_AROUSAL are both -0.15: faintly wistful, and calm
// enough to play slower and softer than exactly neutral.
//
// PRIOR_STRENGTH is the evidence count at which the text's own reading is worth
// half as much as the prior. conf = hits/(hits+STRENGTH), so 1 hit gives 0.333
// and 2 hits gives 0.5.
//
// The prior's influence is additionally capped at PRIOR_MAX_PULL, because
// conf alone pulls far too hard. A single joy hit over six words has a raw
// normScore of 0.64; blending that with -0.15 at conf 1/3 gives 0.11, which is
// not a slight nudge — it is a 82% loss of the sentiment from one real word.
// Blending a score that has ALREADY been divided by sqrt(words) compounds two
// dilutions.
//
// So the blend is:
//
//     pull     = min(1, conf) * PRIOR_MAX_PULL
//     valence' = valence * (1 - pull) + PRIOR_VALENCE * pull
//
// which is the specified shrinkage with the strength bounded. At one hit the
// pull is 0.2, so 0.64 becomes 0.53 — a nudge, not a reversal — and a text with
// no hits gets the full pull and lands exactly on the prior. What the cap buys
// is that the prior can never be the reason a readable text is misread.
export const PRIOR_MODE = 'dorian';
export const PRIOR_VALENCE = -0.15;
export const PRIOR_AROUSAL = -0.15;
export const PRIOR_STRENGTH = 2;
export const PRIOR_MAX_PULL = 0.2;

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
export function modeFor(norm, tense, priorMode) {
  const e = VALENCE_EDGES;
  const aroused = tense >= HIGH_AROUSAL;
  const intense = tense >= INTENSE_AROUSAL;
  const moderate = tense >= 0.25;

  // No lexicon evidence at all: the caller's calm-neutral prior, which is
  // dorian. Reached by passing priorMode, so the decision is visible here
  // rather than hidden in detectMood's arithmetic.
  if (priorMode) return priorMode;

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
  // how many lexicon entries the text actually hit. This is the evidence the
  // calm-neutral prior is weighed against, so it counts HITS and not words:
  // one long entry like "دلم برات تمومی نداره" is as much evidence as three
  // short ones, and a 40-word text with one adjective in it is not better read
  // than a 3-word text with one.
  let hits = 0;

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
        if (hit && PERSON_SUBJECT_SLANG.has(span) && !hasPersonSubjectBefore(words, i)) {
          hit = null;
        }

        if (!hit && len >= 3 && i + len < words.length) {
          const loose = looseMatch(words, i, len);
          if (loose) { hit = loose.hit; consumedLen = len + 1; }
        }

        if (hit) {
          const m = mult[i];
          hits++;
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
              hits++;
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

  const divisor = Math.max(1.6, Math.sqrt(totalWords) * 0.7);
  const norm = score / divisor;
  const tenseNorm = tense / divisor;
  let arousalNorm = arousal / divisor;

  // ── Calm-neutral prior ────────────────────────────────────────────
  // A text we cannot read should not be played as neither-happy-nor-sad. It
  // should be played as slightly wistful and calm, because that is the choice
  // that produces the FEWEST wrong feelings for text whose meaning is unknown.
  // A bright unresolved mode asserts "fine"; a dark one asserts "sad". Dorian
  // asserts neither: a minor third with a raised sixth, which is the sound of
  // thinking rather than of feeling.
  //
  // Applied as soft shrinkage toward the prior rather than as an override,
  // weighted by how much evidence there actually is:
  //
  //     conf     = hits / (hits + PRIOR_STRENGTH)
  //     valence' = valence * conf + PRIOR_VALENCE * (1 - conf)
  //
  // With zero lexicon hits conf is 0 and the prior stands alone. With many,
  // conf approaches 1 and the prior vanishes. So a clear sentence plays exactly
  // as before, and an unreadable one is gently tinted rather than overridden —
  // the distinction being that shrinkage cannot invert a strong reading, while
  // an override would.
  //
  // The prior's valence is small and NEGATIVE (-0.15): unknown text leans very
  // slightly wistful, which is the mode dorian already encodes. Its arousal is
  // the same -0.15, so unreadable text also plays slower and softer than neutral
  // rather than at exactly 1.0x.
  //
  // Punctuation is EXCLUDED from the evidence count, and deliberately. '!' and
  // '...' are activation cues that arrive whether or not the words meant
  // anything, so letting them shrink the prior would let "ok!" argue itself out
  // of calm on punctuation alone. They still move arousal (below), which is the
  // one thing they are good evidence for.
  const conf = hits / (hits + PRIOR_STRENGTH);
  // valence: shrunk toward the prior, with the pull bounded — see PRIOR_MAX_PULL.
  // The prior is small (-0.15) and the pull is at most PRIOR_MAX_PULL, so this
  // can never invert a reading: a confident -1.0 moves to at most -0.83. What it
  // does is stop an unreadable text asserting no feeling at all.
  // conf==0 means NO evidence at all, and there the prior must stand in full,
  // not at 20%: an unreadable text should be exactly the prior. The blend is
  // therefore scaled by conf and capped, so it is 0 when there is no evidence
  // to soften and never more than PRIOR_MAX_PULL.
  const pull = Math.min(1, conf) * PRIOR_MAX_PULL;
  const shrunk = norm * (1 - pull) + PRIOR_VALENCE * pull;
  // …but with zero hits the reading IS zero and no blend can move it, because
  // 0 * (1-pull) + prior*pull is only -0.03. So the prior applies outright when
  // there is nothing to shrink: this is the one place it overrides rather than
  // softens, and it is safe precisely because nothing was being read.
  const finalNorm = hits === 0 ? PRIOR_VALENCE : shrunk;

  // arousal: '!' and '...' move it whether or not any word meant anything, so
  // punctuation alone must not count as evidence about the FEELING. The prior's
  // arousal is applied only when there are no lexicon hits at all; once a word
  // has actually said something, its activation stands, with the punctuation
  // cue already added to it. This is the one asymmetry, and it exists so that
  // "ok!!!" plays livelier than "ok" rather than being argued back to calm by a
  // prior that has no opinion about exclamation marks.
  const usePriorArousal = hits === 0;
  const finalArousal = usePriorArousal
    ? PRIOR_AROUSAL + arousalNorm * 0.25
    : arousalNorm;

  return {
    // with no lexicon hits the prior's mode stands outright; with hits, the
    // shrunk valence and real arousal choose it as usual
    mode: modeFor(finalNorm, finalArousal, hits === 0 ? PRIOR_MODE : null),
    normScore: finalNorm,
    tenseScore: tenseNorm,
    arousalScore: finalArousal,
    // exposed so tests can assert the shrinkage rather than infer it
    lexiconHits: hits,
    priorConfidence: conf,
  };
}

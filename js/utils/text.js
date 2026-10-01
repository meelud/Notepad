// ─── Arabic-script letter folding ───────────────────────────────
/**
 * Folds the Arabic yeh/kaf variants onto their Persian forms, U+064A -> U+06CC
 * (also U+0649) and U+0643 -> U+06A9.
 *
 * These are four DIFFERENT codepoints that look identical on screen. Persian is
 * routinely typed with the Arabic ones — Arabic keyboard layouts, older
 * Iranian keyboards, and text pasted from Arabic sources all produce them — and
 * a lexicon entry written with U+06CC never matches a token carrying U+064A.
 * That is a whole-word mismatch, not a small score difference: measured on
 * "هیچی که میگم درست نیست", folding drops tenseScore from 0.094 to 0 and the
 * first played note from 523.8Hz to 330Hz, because the word stops being
 * recognized at all.
 *
 * Folding is done at the START of tokenize() and at the top of detectMood(),
 * so both the mood lookup and the playback path see identical tokens. Folding
 * later, inside the lexicon, would fix only the lookup and leave the note
 * sequence, the RNG seed (hashText) and the word lengths derived from the raw
 * tokens still keyed on the Arabic spelling — the two would then disagree.
 *
 * @param {string} s
 * @returns {string}
 */
export function foldPersian(s) {
  return s
    .replace(/[\u064A\u0649]/g, '\u06CC')
    .replace(/\u0643/g, '\u06A9');
}

// ─── Word extraction ────────────────────────────────────────────
/**
 * The one word extractor. Matches a Latin letter, an Arabic-script letter, or
 * a ZWNJ, and nothing else.
 *
 * U+200C (ZWNJ) is what Persian orthography puts between the two halves of a
 * prefix: بی‌حس, دل‌تنگ, خسته‌ام, می‌خواهم, نمی‌دانم. It renders as nothing,
 * which is exactly why a regex of letters only reads it as a word boundary —
 * "بی‌حس" came out as ["بی", "حس"] and then matched nothing, because the
 * lexicon entry is written with the ZWNJ in it. Measured on "بی‌حس شدم":
 * normScore 0.00 with the ZWNJ, -0.50 without. On "دل‌تنگ شدم": 0.00 vs
 * -0.63. Both are ordinary negative Persian sentences that scored as neutral
 * and played a neutral mode, purely because of an invisible character.
 *
 * Every extractor in the codebase has to agree on this, because they feed
 * different parts of the same decision — mood.js scores the mood,
 * intention.js shapes the contour, composition.js sets harmonicStability —
 * and a split word in only one of them makes the layers disagree about what
 * the text says. Four separate copies of this regex is how the ZWNJ bug and
 * then the Arabic yeh/kaf bug got in. So: one regex, exported, used
 * everywhere.
 *
 * ZWNJ is matched but NOT stripped, deliberately. It is a zero-width
 * character, but removing it changes string length, and token offsets index
 * the string buildRender() is handed — stripping would slide the highlight
 * off the word it belongs to. normalizePhrase() strips it for its own lookup,
 * on a copy.
 *
 * @param {string} text
 * @returns {string[]}
 */
/**
 * The letter range is U+0621-U+06CC, the SAME range the lexicon is keyed over,
 * plus U+200C. It was ا-ی (U+0627-U+06CC), which silently dropped six letters
 * that sit below it:
 *
 *   ء U+0621  أ U+0623  إ U+0625  ؤ U+0624  ئ U+0626  آ U+0622
 *
 * The damage was total, not partial. "آرامش" split into "رامش" and matched
 * nothing, while the lexicon entry is written "آرامش" — so every Persian word
 * spelled with آ was invisible: آرام, آرامش, آروم, آسمون, آواز, آرزو. Measured
 * on "همه چی آرومه", "آرامش دارم" and "حس آرامش می‌کنم": all three scored
 * 0.00, i.e. neutral, which for calm-positive text means the valence is lost
 * too. 119 of the 3675 lexicon entries were unreachable from any text that
 * spelled them the way Persian actually spells them.
 *
 * This is the same bug as the ZWNJ one, one character up, and it survived that
 * fix precisely because nobody checked the ranges against each other. So the
 * range is now stated once, here, and normalizePhrase() reads this same
 * pattern instead of keeping a private copy of the old one — see
 * test/lexicon-round-trip-test.mjs, which proves the two agree for all 3675
 * entries.
 *
 * The hamza carriers (ء أ إ ؤ ئ) are included on purpose even though they are
 * not Persian letter forms. Persian borrows them freely — مؤثر, مسئله,
 * سؤال — and excluding them split those words mid-token. A narrower range
 * here is not "more correct Persian", it is fewer words found.
 */
export const WORD_RE = /[a-zA-Z\u0621-\u06CC\u200C]+/g;

/**
 * Strips the zero-width characters (ZWNJ, RLM, LRM). See normalizePhrase()
 * in mood.js.
 *
 * @param {string} s
 * @returns {string}
 */
export function stripZeroWidth(s) {
  return s.replace(/[‌‏‎]/g, '');
}

/**
 * The words of `text`, keyed exactly as the lexicon is keyed: lower-cased,
 * Arabic yeh/kaf folded, zero-width characters stripped.
 *
 * Stripping the ZWNJ HERE is safe even though it is not safe in tokenize():
 * these words are only ever used for lookup, never sliced back out of the
 * original string. The callers that need character offsets (intention.js's
 * deriveSemanticSpans) take them from their own scan of the raw text, so
 * removing a character from the word copy cannot move them.
 *
 * This is the point of the shared helper: "بی‌حس شدم" and "بیحس شدم" must
 * reduce to the same two lookup keys, and both halves of that — the fold and
 * the strip — have to happen in the same place in every module, or the mood
 * layer and the contour layer read different sentences.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function extractWords(text) {
  return extractWordsKeepZwnj(text).map(stripZeroWidth).map(stripMadda);
}

/**
 * Folds آ (U+0622) onto ا (U+0627) — LOOKUP ONLY.
 *
 * Persian speakers routinely write آ as ا because they type faster than they
 * hold the modifier key, and older Iranian keyboards and phone IMEs did not
 * have it at all. So "ارامش" and "آرامش" are the same word to a reader, and the
 * lexicon only knows the spelled-with-madda one. Before this fold:
 *
 *   wordEmotionWeight("آرامش") = 0.7      wordEmotionWeight("ارامش") = 0
 *   detectMood("آرامش دارم")  = 0.4375    detectMood("ارامش دارم")  = 0
 *
 * Both are scored from the PHRASE_LOOKUP key, so the fold belongs on the key
 * and nowhere else.
 *
 * It must NOT reach tokenize(), hashText() or any offset arithmetic. A madda
 * is a real character in the displayed text, and folding it there would change
 * the string length, break the offsets buildRender() is handed, and change the
 * RNG seed — so the same sentence would both render differently and play a
 * different piece depending on which path looked at it. foldPersian() is
 * 1:1 and leaves آ alone for exactly that reason; this one is not, and is
 * deliberately confined to extractWords().
 *
 * Collisions are reported at load time rather than silently resolved: see
 * reportMaddaCollisions() in mood.js, which prints any two entries that differ
 * only by آ-vs-ا.
 *
 * @param {string} s
 * @returns {string}
 */
export function stripMadda(s) {
  return s.replace(/\u0622/g, '\u0627');
}

/**
 * As extractWords(), but keeps the ZWNJ so the caller can still see where a
 * word was split. For the rare caller that needs to know the difference.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function extractWordsKeepZwnj(text) {
  return (text.toLowerCase().match(WORD_RE) || []).map(foldPersian);
}

// ─── Tokenizer ──────────────────────────────────────────────────
/**
 * Splits text into tokens (words, spaces, punctuation).
 * Each word token gets:
 *   - sentenceType: 'statement' | 'question' | 'exclaim'
 *   - paraPos: 'start' | 'middle' | 'end' (based on word position)
 *
 * The text is folded with foldPersian() first, so a word typed with Arabic
 * yeh/kaf produces the same token as its Persian spelling. Both the word's
 * lexicon lookup and the note length derived from it then agree.
 *
 * Note: token offsets are indexes into the FOLDED text. buildRender() and
 * playPunctuation() are given the same folded text by the caller, so the
 * highlight still lines up; see test/arabic-fold-test.mjs.
 *
 * @param {string} text
 * @returns {Array<{type: string, start: number, end: number, text: string, sentenceType?: string, paraPos?: string}>}
 */
export function tokenize(text) {
  text = foldPersian(text);
  const tokens = [];
  let i = 0;

  while (i < text.length) {
    const ch = text[i];
    if (ch === ' ' || ch === '\n') {
      tokens.push({ type: 'space', start: i, end: i + 1, text: ch });
      i++;
    } else if ('.!?,;:؟،؛'.includes(ch)) {
      tokens.push({ type: 'punct', start: i, end: i + 1, text: ch });
      i++;
    } else {
      let j = i;
      while (j < text.length && text[j] !== ' ' && text[j] !== '\n' && !'.!?,;:؟،؛'.includes(text[j])) j++;
      tokens.push({ type: 'word', start: i, end: j, text: text.slice(i, j) });
      i = j;
    }
  }

  const totalWords = tokens.filter(t => t.type === 'word').length;
  let wordIdx = 0;

  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k];
    if (t.type === 'word') {
      let endType = 'statement';
      for (let m = k + 1; m < tokens.length; m++) {
        if (tokens[m].type === 'punct') {
          if (tokens[m].text === '?' || tokens[m].text === '؟') { endType = 'question'; break; }
          if (tokens[m].text === '!') { endType = 'exclaim'; break; }
          if (tokens[m].text === '.') { endType = 'statement'; break; }
        }
      }
      t.sentenceType = endType;
      wordIdx++;
      // first 18% = start, last 18% = end, rest = middle
      t.paraPos = wordIdx < totalWords * 0.18 ? 'start'
                : wordIdx > totalWords * 0.82 ? 'end'
                : 'middle';
    }
  }

  return tokens;
}

// ─── HTML escaping ──────────────────────────────────────────────
/** Escapes &, <, > for safe innerHTML insertion. */
export function esc(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '\n');
}

// ─── Render builder ─────────────────────────────────────────────
/**
 * Wraps the active word (indices a..b) in a <span class="w-active">.
 * Used during playback to highlight the current word.
 * @param {string} text — full text
 * @param {number} a — start index of active word
 * @param {number} b — end index of active word
 * @returns {string} HTML string
 */
export function buildRender(text, a, b) {
  if (a >= b) return esc(text);
  return esc(text.slice(0, a))
    + `<span class="w-active">${esc(text.slice(a, b))}</span>`
    + esc(text.slice(b));
}

// ─── Sleep ──────────────────────────────────────────────────────
/** Promise-based setTimeout wrapper. */
export function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

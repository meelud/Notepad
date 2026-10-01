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

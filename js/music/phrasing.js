/**
 * js/music/phrasing.js
 *
 * Phrase structure read off the TEXT, shared by player.js and
 * test/player-sim.mjs so the two cannot drift apart (they have before).
 * Pure functions of the token stream. No RNG, no clock, no audio.
 *
 * Two things live here:
 *
 * 1. CADENCE HIERARCHY. Until now only sentence-final punctuation (. ! ?)
 *    and the last word of the text were cadence points. A comma was a
 *    clause boundary for the intention layer but not for the pitch line,
 *    so "I love you, baby" was one undifferentiated run of notes. In
 *    phrase theory a period is built from an antecedent that ends OPEN
 *    (half cadence, on the dominant) and a consequent that ends CLOSED
 *    (authentic cadence, on the tonic) (Caplin, "Classical Form", 1998;
 *    Schoenberg, "Fundamentals of Musical Composition"). So:
 *      . ! ? and end of text  -> 'full'   (existing behaviour, untouched)
 *      , ; : (and the Persian equivalents) -> 'half'
 *    A half cadence needs a phrase to close, so it is only placed when at
 *    least MIN_PHRASE_WORDS words have sounded since the previous boundary
 *    (a one-note phrase has no motion to arrive from).
 *
 * 2. REPETITION. When the text repeats itself on purpose ("I love you ...
 *    I love you", "never, never", "I want X. I want Y.") the melody should
 *    repeat too: the same scale degrees, placed in the nearest register.
 *    Repetition of a basic idea is how a listener hears "this was meant"
 *    (Schoenberg's presentation phrase). The LAST note of a repeated span
 *    is not copied when it is a cadence point, so the second statement can
 *    end differently from the first, the classic varied repeat.
 *
 *    Incidental repeats ("of the ... of the") must NOT trigger this, or a
 *    long text would be stamped with copied melody. A repeat qualifies only
 *    if it is structurally intentional:
 *      - 3+ words long, or
 *      - 2 words that open both occurrences' clauses (anaphora), close both
 *        clauses (epistrophe), or repeat back-to-back (A B A B), or
 *      - 1 word repeated back-to-back, punctuation allowed between
 *        ("never, never, never").
 */

export const MIN_PHRASE_WORDS = 2;

const PHRASE_END_FULL = new Set(['.', '!', '?', '\u061f']);
const PHRASE_END_HALF = new Set([',', ';', ':', '\u060c', '\u061b']);

const norm = w => w.toLowerCase().replace(/\u200c/g, '');

/**
 * @param {Array<{type:string,text:string}>} playable word/punct tokens in order
 * @returns {{cadenceKind:(i:number)=>('full'|'half'|null), repetitionAt:(wordOrdinal:number)=>({src:number,pos:number,len:number}|null), spans:Array}}
 */
export function derivePhrasing(playable) {
  // word ordinal <-> playable index
  const wordIdx = [];           // ordinal -> index into playable
  playable.forEach((t, i) => { if (t.type === 'word') wordIdx.push(i); });
  const n = wordIdx.length;
  const w = wordIdx.map(i => norm(playable[i].text));

  // boundary BEFORE each word ordinal (clause start) and AFTER it (clause end),
  // and the kind of punctuation that closes the word's phrase, if any
  const clauseStart = new Array(n).fill(false);
  const clauseEnd = new Array(n).fill(false);
  const closing = new Array(n).fill(null); // 'full' | 'half' | null
  if (n) clauseStart[0] = true;
  clauseEnd[n - 1] = true;
  let ord = -1;
  playable.forEach(t => {
    if (t.type === 'word') { ord++; return; }
    if (ord < 0) return;
    const kind = PHRASE_END_FULL.has(t.text) ? 'full' : PHRASE_END_HALF.has(t.text) ? 'half' : null;
    if (!kind) return;
    clauseEnd[ord] = true;
    if (ord + 1 < n) clauseStart[ord + 1] = true;
    // the strongest punctuation after a word wins ("word,." is a full stop)
    if (closing[ord] !== 'full') closing[ord] = kind;
  });

  // ── cadence kinds, indexed by PLAYABLE index ──
  const kinds = new Array(playable.length).fill(null);
  let wordsSinceBoundary = 0;
  wordIdx.forEach((pi, o) => {
    wordsSinceBoundary++;
    if (closing[o] === 'full') {
      kinds[pi] = 'full';
      wordsSinceBoundary = 0;
    } else if (closing[o] === 'half') {
      if (wordsSinceBoundary >= MIN_PHRASE_WORDS) kinds[pi] = 'half';
      wordsSinceBoundary = 0;
    }
  });
  if (n) kinds[wordIdx[n - 1]] = 'full'; // the end of the text is a full cadence

  // ── repetition ──
  const link = new Array(n).fill(null);
  const spans = [];
  const eq = (i, j, L) => { for (let k = 0; k < L; k++) if (w[i + k] !== w[j + k]) return false; return true; };
  let j = 1;
  while (j < n) {
    if (link[j]) { j++; continue; }
    // earliest earlier occurrence that gives the LONGEST match at j
    let bestI = -1, bestL = 0;
    for (let i = 0; i < j; i++) {
      if (w[i] !== w[j]) continue;
      let L = 0;
      // non-overlapping, except a run of one repeated word (A A A)
      while (j + L < n && i + L < j && w[i + L] === w[j + L]) L++;
      if (L === 0 && i === j - 1) L = 1; // a lone word repeated right after itself
      if (L > bestL) { bestL = L; bestI = i; }
    }
    if (bestL === 0) { j++; continue; }
    const L = bestL, i = bestI;
    // back-to-back: the L words just before j are the same L words (A A, A B A B)
    const back2back = j - L >= 0 && eq(j - L, j, L);
    let ok = false;
    if (L >= 3) ok = true;
    else if (L === 2) ok = (clauseStart[i] && clauseStart[j]) || (clauseEnd[i + 1] && clauseEnd[j + 1]) || back2back;
    else if (L === 1) ok = back2back;
    if (ok) {
      for (let k = 0; k < L; k++) link[j + k] = { src: i + k, pos: k, len: L };
      spans.push({ src: i, at: j, len: L });
      j += L;
    } else j++;
  }

  return {
    cadenceKind: i => kinds[i] ?? null,
    repetitionAt: o => link[o] ?? null,
    spans,
  };
}

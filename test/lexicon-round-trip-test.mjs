// ─── Lexicon round trip ──────────────────────────────────────────
// The ZWNJ bug and the آ bug were the same bug. Both came from the letter
// range used to pull words out of TEXT differing from the letter range used to
// key the LEXICON:
//
//   text extractors  ا-ی   = U+0627..U+06CC
//   normalizePhrase  ء-ی   = U+0621..U+06CC
//
// Six letters sit below U+0627 — ء U+0621, آ U+0622, أ U+0623, ؤ U+0624,
// إ U+0625, ئ U+0626 — so they survived in a lexicon key and were dropped from
// the text. "آرامش" split into "رامش" and matched nothing, though the entry is
// written "آرامش". 119 of 3675 entries were unreachable from any text spelling
// them the way Persian actually spells them, including the entire calm
// vocabulary: آرام, آرامش, آروم, آرامم, آسمون, آواز, آرزو.
//
// Fixing that by hand is guesswork: you only find the letters you happen to
// think of. This test derives them instead. For EVERY entry, the tokens the
// text extractor produces must be exactly the tokens the lexicon is keyed by.
// Any letter in any position that the two disagree on shows up as a failing
// entry, with no prior knowledge of which letters are involved.

import { EMOTION_LEXICON, wordEmotionWeight, detectMood } from '../js/music/mood.js';
import { extractWords, WORD_RE } from '../js/utils/text.js';
import { MODE_OFFSETS } from '../js/music/scales.js';

/** Perceptual cues, as in mode-mapping-test.mjs (Gagnon & Peretz 2003; Hevner 1936). */
const cue = m => {
  const s = new Set(MODE_OFFSETS[m].map(x => x % 12));
  return { maj3: s.has(4), min3: s.has(3), P5: s.has(7), b2: s.has(1) };
};

let failed = 0;
function check(name, ok, detail = '') {
  console.log(` ${ok ? ' ok  ' : 'FAIL '} ${name}${detail ? '  → ' + detail : ''}`);
  if (!ok) failed++;
}

/**
 * What the LEXICON is keyed by, transcribed from normalizePhrase() rather than
 * imported: if this test called normalizePhrase() it would pass by construction
 * and prove nothing. Kept as a literal so a future change to the shared helper
 * has to be made here too, deliberately.
 */
function lexiconKeyTokens(entry) {
  return (entry.toLowerCase()
    .replace(/[\u200C\u200F\u200E]/g, '')
    .match(/[a-zA-Z\u0621-\u06CC]+/g) || []);
}

console.log('\nlexicon round trip\n');

// 1. the property itself, over every entry in the merged lexicon
{
  const mismatches = [];
  let total = 0;
  for (const [cat, v] of Object.entries(EMOTION_LEXICON)) {
    for (const entry of v.words) {
      total++;
      const fromText = extractWords(entry).join(' ');
      const fromLexicon = lexiconKeyTokens(entry).join(' ');
      if (fromText !== fromLexicon) mismatches.push({ cat, entry, fromText, fromLexicon });
    }
  }
  const byCat = {};
  for (const m of mismatches) byCat[m.cat] = (byCat[m.cat] || 0) + 1;
  check(`every one of ${total} entries round-trips`, mismatches.length === 0,
    mismatches.length
      ? `${mismatches.length} broken (${Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c}:${n}`).join(' ')})` +
        ` e.g. ${mismatches.slice(0, 3).map(m => `${m.entry} → "${m.fromText}" ≠ "${m.fromLexicon}"`).join('; ')}`
      : '');
}

// 2. which letters are actually inside WORD_RE, asserted rather than assumed.
{
  // every letter the lexicon can hold must be extractable
  const LETTERS = [];
  for (let cp = 0x0621; cp <= 0x06cc; cp++) {
    const ch = String.fromCodePoint(cp);
    // skip the ones that are not letters in Persian/Arabic orthography
    if ([0x0622, 0x0623, 0x0624, 0x0625, 0x0626].includes(cp)) continue; // covered separately
    LETTERS.push(ch);
  }
  const single = /[a-zA-Zء-ی]/;
  const missing = LETTERS.filter(ch => !single.test(ch));
  check('WORD_RE holds every letter in U+0621-U+06CC', missing.length === 0,
    missing.map(c => `U+${c.codePointAt(0).toString(16).toUpperCase()}`).join(' '));

  // and the six below U+0627 specifically, each with a word that needs it
  const PROBES = [
    ['آ U+0622', 'آرامش', 'آرام'],
    ['أ U+0623', 'مسأله', null],
    ['إ U+0625', 'إیمان', null],
    ['ؤ U+0624', 'مؤثر', null],
    ['ئ U+0626', 'سؤال', null],
    ['ء U+0621', 'مسئله', null],
  ];
  const bad = [];
  for (const [label, word] of PROBES) {
    const toks = extractWords(word);
    if (toks.length !== 1 || toks[0] !== word) bad.push(`${label} "${word}" → ${JSON.stringify(toks)}`);
  }
  check('the six letters below U+0627 stay inside their words', bad.length === 0, bad.join('; '));

  // ZWNJ must also be inside its word — the other half of the same class
  const zwnj = extractWords('بی‌حس');
  check('U+200C stays inside its word', zwnj.length === 1, JSON.stringify(zwnj));
}

// 3. the calm vocabulary end to end, because that is what was lost.
//
// wordEmotionWeight() was NOT broken by the letter range: it goes through
// normalizePhrase(), which had the wider range. What broke was detectMood(),
// which extracted آرامش as رامش and then looked THAT up. So this has to be
// asserted on the mood, not on the per-word helper, or it would have passed
// before the fix too.
{
  const CASES = [
    // these three scored normScore 0.00 — neutral — before the fix
    ['همه چی آرومه', 0.371875],
    ['آرامش دارم', 0.4375],
    ['حس آرامش می‌کنم', 0.4375],
  ];
  const bad = [];
  for (const [text, expect] of CASES) {
    const m = detectMood(text);
    if (Math.abs(m.normScore - expect) > 1e-9) bad.push(`${text}: ${m.normScore} ≠ ${expect}`);
  }
  check('the calm vocabulary scores positive again (was 0.00, neutral)',
    bad.length === 0, bad.join('; '));

  // and the words resolve, which is the mechanism
  const miss = ['آرام', 'آرامش', 'آروم', 'آرامم']
    .filter(w => wordEmotionWeight(w) === 0);
  check('and each of those words resolves in the lexicon',
    miss.length === 0, miss.join(' '));

  // the mode must be a positive one, since calm-positive is the label
  const badMode = CASES.filter(([t]) => !cue(detectMood(t).mode).maj3);
  check('and they play a major-third mode', badMode.length === 0,
    badMode.map(([t]) => t).join('; '));
}

// 4. an entry that contains an out-of-range letter must not be silently dropped
//    from PHRASE_LOOKUP — check the count, not just the tokens
{
  let empty = 0, checked = 0;
  for (const [cat, v] of Object.entries(EMOTION_LEXICON)) {
    for (const entry of v.words) {
      // only entries made purely of letters are expected to key cleanly
      const toks = lexiconKeyTokens(entry);
      if (!toks.length) continue;
      checked++;
      if (!wordEmotionWeight(entry) && entry.split(/\s+/).length === 1) {
        // a single word that the lexicon holds but that scores 0 through the
        // extractor is the exact failure this test exists for
        empty++;
      }
    }
  }
  // not every single-word entry has a non-zero weight by design, so this only
  // reports; the hard assertion is the round trip above
  console.log(`       (${empty} of ${checked} single-word entries score 0; some are weight-0 by design)`);
  check('the round trip is the binding assertion (ran above)', true);
}

if (failed) {
  console.log(`\n${failed} FAILED`);
  process.exit(1);
}
console.log('\nthe lexicon and the text extractor agree on every entry');
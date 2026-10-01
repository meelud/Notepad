// ─── Arabic yeh/kaf folding ─────────────────────────────────────
// Persian is routinely typed with the ARABIC yeh (U+064A) and kaf (U+0643),
// and U+0649/U+0643 look identical to U+06CC/U+06A9 on screen. A lexicon entry
// written one way therefore never matched a token written the other — a
// whole-word miss, not a small score difference.
//
// These tests pin the requirement that the two spellings are
// indistinguishable end to end: same mood, same mode, same RNG seed, and the
// same played note sequence. Folding only inside the lexicon would pass a
// mood-only check while leaving hashText(), the word lengths derived from the
// raw tokens, and the note sequence keyed on the Arabic spelling.

import { foldPersian, tokenize } from '../js/utils/text.js';
import { detectMood } from '../js/music/mood.js';
import { deriveTextHarmony, hashText } from '../js/music/harmony.js';
import { wordEmotionWeight } from '../js/music/mood.js';
import { simulateText } from './player-sim.mjs';

let failed = 0;
function check(name, ok, detail = '') {
  console.log(` ${ok ? ' ok  ' : 'FAIL '} ${name}${detail ? '  → ' + detail : ''}`);
  if (!ok) failed++;
}

/**
 * Rewrite a string as its Arabic-spelled twin: Persian yeh/kaf become
 * U+064A/U+0643, and the zero-width non-joiner becomes the Arabic comma's
 * cousin U+200D? No — U+200C stays as it is and is simply part of the fold's
 * input, so the twin is defined purely by yeh/kaf.
 */
const toArabic = s => s.replace(/ک/g, '\u0643').replace(/ی/g, '\u064A');

// Sentences chosen for what they must survive: real multi-word lexicon
// entries carrying yeh/kaf, a mood either side of zero, and punctuation so the
// tokenizer's other path is exercised too. The first three embed a whole
// lexicon entry ("هیچی کم ندارم الان", "دلم میخواد جیغ بزنم از خوشحالی",
// "تو تاریکی گیر کردم"), which is what makes the lexicon checks below
// non-vacuous — function words alone would all score 0 in both spellings.
const PERSIAN = [
  'هیچی کم ندارم الان، حالم خیلی خوبه',
  'دلم میخواد جیغ بزنم از خوشحالی',
  'تو تاریکی گیر کردم و کسی نیست',
  'هیچی که میگم درست نیست',
  'خیلی خسته‌ام و دیگه توان ادامه دادن ندارم',
  'یکی بیا کمک کنه گیر کردم',
  'دلم برای خونه تنگ شده بود',
];

console.log('\nArabic yeh/kaf folding\n');

// 1. the fold itself is a pure, idempotent mapping
{
  // Compare against foldPersian(fa), not fa: the fold also drops the ZWNJ, and
  // the Persian samples above contain one (خسته‌ام), so fa itself is not a
  // fixed point of the fold.
  let maps = true, idem = true;
  for (const fa of PERSIAN) {
    const ar = toArabic(fa);
    if (foldPersian(ar) !== foldPersian(fa)) maps = false;
    if (foldPersian(foldPersian(ar)) !== foldPersian(ar)) idem = false;
  }
  check('foldPersian maps the Arabic spelling onto the Persian one', maps);
  check('foldPersian is idempotent', idem);

  // The fold must be strictly 1:1 in length: token start/end offsets index
  // into the folded text that play() hands buildRender(), so a fold that
  // removed or added a character would slide the highlight. This is why the
  // zero-width characters are NOT dropped here — normalizePhrase() drops them
  // for its own lookup, but the tokenizer's offsets must survive.
  const only = 'کیف کردیم یکدیگر را نمی‌دانیم چگونه‌اند';
  check('the fold preserves string length exactly', foldPersian(toArabic(only)).length === only.length);
}

// 2. mood detection is identical
{
  let bad = [];
  for (const fa of PERSIAN) {
    const ar = toArabic(fa);
    if (JSON.stringify(detectMood(fa)) !== JSON.stringify(detectMood(ar)))
      bad.push(fa);
  }
  check('detectMood agrees across codepoints', bad.length === 0, bad.join(' | '));
}

// 3. the note-relevant hashes agree — hashText seeds the RNG, the mode, the
//    motif and the chord clock, so a difference here means a different piece
{
  let bad = [];
  for (const fa of PERSIAN) {
    const ar = toArabic(fa);
    if (hashText(fa) !== hashText(ar)) bad.push(`${fa} (${hashText(fa)} vs ${hashText(ar)})`);
    const A = deriveTextHarmony(fa), B = deriveTextHarmony(ar);
    if (JSON.stringify(A) !== JSON.stringify(B)) bad.push(`${fa} [harmony]`);
  }
  check('hashText and deriveTextHarmony agree across codepoints', bad.length === 0, bad.join(' | '));
}

// 4. per-word lexicon weight agrees between the two spellings. Some tokens
//    legitimately score 0 (function words like «یکی» or «را» are not lexicon
//    entries), so the check is agreement, not a nonzero count — but at least
//    one sample word must actually resolve, or the check would pass vacuously.
{
  let bad = [], hits = 0;
  for (const fa of PERSIAN) {
    const A = tokenize(fa).filter(t => t.type === 'word').map(t => wordEmotionWeight(t.text));
    const B = tokenize(toArabic(fa)).filter(t => t.type === 'word').map(t => wordEmotionWeight(t.text));
    hits += A.filter(w => w !== 0).length;
    if (JSON.stringify(A) !== JSON.stringify(B)) bad.push(fa);
  }
  check('wordEmotionWeight agrees across codepoints', bad.length === 0, bad.join(' | '));
  check('the samples really do hit the lexicon (guard against a vacuous pass)', hits > 0, `${hits} hit(s)`);
}

// 5. tokenize produces the identical token stream
{
  let bad = [];
  for (const fa of PERSIAN) {
    const A = tokenize(fa).map(t => [t.type, t.text, t.sentenceType, t.paraPos]);
    const B = tokenize(toArabic(fa)).map(t => [t.type, t.text, t.sentenceType, t.paraPos]);
    if (JSON.stringify(A) !== JSON.stringify(B)) bad.push(fa);
  }
  check('tokenize agrees across codepoints', bad.length === 0, bad.join(' | '));
}

// 6. the played note sequence agrees — the actual requirement
{
  let bad = [];
  for (const fa of PERSIAN) {
    const A = simulateText(fa), B = simulateText(toArabic(fa));
    if (JSON.stringify(A.sequence) !== JSON.stringify(B.sequence)) bad.push(fa);
    else if (A.sequence.length === 0) bad.push(`${fa} (no notes produced)`);
  }
  check('the played note sequence agrees across codepoints', bad.length === 0, bad.join(' | '));
}

// 7. offsets stay aligned, which is what lets buildRender() highlight the
//    right slice of the FOLDED text that play() now passes it
{
  const fa = 'یکی بیا کمک کنه گیر کردم';
  const ar = toArabic(fa);
  const A = tokenize(fa).filter(t => t.type === 'word');
  const B = tokenize(ar).filter(t => t.type === 'word');
  check('word count is unchanged by folding', A.length === B.length);
  const folded = foldPersian(ar);
  check('each token offset slices its own word out of the folded text',
    B.every(t => folded.slice(t.start, t.end) === t.text));
  check('the folded tokens are the Persian tokens, in order',
    JSON.stringify(A.map(t => t.text)) === JSON.stringify(B.map(t => t.text)));
  check('the two token streams are identical',
    JSON.stringify(A) === JSON.stringify(B));
}

if (failed) {
  console.log(`\n${failed} FAILED`);
  process.exit(1);
}
console.log('\nthe Arabic fold holds across the whole path');
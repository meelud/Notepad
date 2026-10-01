// ─── ZWNJ-aware word extraction ─────────────────────────────────
// U+200C (ZWNJ) is what Persian orthography puts between the two halves of a
// prefix: بی‌حس, دل‌تنگ, خسته‌ام, می‌خواهم. It renders as nothing, so a regex of
// letters only reads it as a word boundary — "بی‌حس" came out as ["بی", "حس"]
// and then matched nothing, because the lexicon entry is written WITH the
// ZWNJ. Before this fix "بی‌حس شدم" scored normScore 0.00 where "بیحس شدم"
// scored -0.50: an ordinary negative Persian sentence that the engine heard as
// neutral, and played in a neutral mode, over an invisible character.
//
// The tests below pin three separate claims, because they are separate bugs if
// any of them regresses:
//   1. the two spellings are indistinguishable, for every extractor
//   2. the fix is confined to texts that actually contain a ZWNJ
//   3. character offsets still index the original string

import { WORD_RE, extractWords, extractWordsKeepZwnj, foldPersian, tokenize } from '../js/utils/text.js';
import { detectMood, scanPhraseMatches, wordEmotionWeight } from '../js/music/mood.js';
import { deriveIntentions, deriveSemanticSpans } from '../js/music/intention.js';
import { deriveComposition } from '../js/music/composition.js';
import { hashText } from '../js/music/harmony.js';
import { simulateText } from './player-sim.mjs';

let failed = 0;
function check(name, ok, detail = '') {
  console.log(` ${ok ? ' ok  ' : 'FAIL '} ${name}${detail ? '  → ' + detail : ''}`);
  if (!ok) failed++;
}

const ZWNJ = '\u200C';
/** Strip every ZWNJ, giving the twin spelling. */
const noZwnj = s => s.split(ZWNJ).join('');

// Words whose ZWNJ join is Persian orthography, not noise: prefixes (بی, دل,
// خسته, می, نمی) plus the clitics that attach the same way. Includes two
// inflected forms, خسته‌ام and می‌خوام, so the SUFFIXES stem-matching path is
// covered rather than only the exact-match path.
const TWINS = [
  'بی‌حس شدم',
  'دل‌تنگ شدم',
  'خسته‌ام',
  'می‌خوام برم خونه',
  'نمی‌دونم چی شد',
  'بی‌فایده‌ست',
  'دل‌گرفته‌ام و خسته‌ام',
  'همه‌چیز خراب شد',
  'می‌ترسم از تاریکی',
  'نفس‌تنگ می‌کشم',
];

// Texts with no ZWNJ anywhere: these must be bit-identical before and after.
// Nothing about this fix may touch them.
const NO_ZWNJ = [
  'I am so tired of this',
  'خیلی خسته ام و دیگه رمقی ندارم',
  'هیچی برام مهم نیست',
  'وای چه خبر عالی!!',
  'هیچی که میگم درست نیست',
  'The room without windows felt heavy',
];

console.log('\nZWNJ-aware word extraction\n');

// ── 1. the extractor itself ────────────────────────────────────
{
  check('WORD_RE keeps a ZWNJ-joined prefix as one word',
    JSON.stringify('بی‌حس'.match(WORD_RE)) === JSON.stringify(['بی‌حس']));
  check('WORD_RE still splits on spaces and punctuation',
    JSON.stringify('بی‌حس، دل‌تنگم. می‌خوام!'.match(WORD_RE))
      === JSON.stringify(['بی‌حس', 'دل‌تنگم', 'می‌خوام']));
  check('WORD_RE leaves a Latin apostrophe split, as before',
    JSON.stringify("don't stop".match(WORD_RE)) === JSON.stringify(['don', 't', 'stop']));

  // every match must slice its own word back out of the string it came from,
  // or the offsets intent tracking depends on would be wrong
  let offsetsOk = true;
  for (const t of [...TWINS, ...NO_ZWNJ, 'بی‌حس شدم، دل‌تنگم. می‌خوام! نَه؟']) {
    WORD_RE.lastIndex = 0;
    let m;
    while ((m = WORD_RE.exec(t))) {
      if (t.slice(m.index, m.index + m[0].length) !== m[0]) offsetsOk = false;
    }
  }
  check('every WORD_RE match slices back to itself (offsets are valid)', offsetsOk);

  check('extractWords strips the ZWNJ for lookup',
    JSON.stringify(extractWords('بی‌حس دل‌تنگ')) === JSON.stringify(['بیحس', 'دلتنگ']));
  check('extractWordsKeepZwnj keeps it',
    JSON.stringify(extractWordsKeepZwnj('بی‌حس')) === JSON.stringify(['بی‌حس']));
}

// ── 2. the twins are indistinguishable ──────────────────────────
{
  let moodBad = [], lexBad = [];
  for (const z of TWINS) {
    const plain = noZwnj(z);
    if (JSON.stringify(detectMood(z)) !== JSON.stringify(detectMood(plain))) moodBad.push(z);
    const A = extractWords(z).map(wordEmotionWeight);
    const B = extractWords(plain).map(wordEmotionWeight);
    if (JSON.stringify(A) !== JSON.stringify(B)) lexBad.push(z);
  }
  check('detectMood agrees with and without the ZWNJ', moodBad.length === 0, moodBad.join(' | '));
  check('wordEmotionWeight agrees with and without the ZWNJ', lexBad.length === 0, lexBad.join(' | '));

  // and the arousalScore specifically, since that is the axis this whole branch
  // of work is about
  let aBad = [];
  for (const z of TWINS) {
    const a = detectMood(z), b = detectMood(noZwnj(z));
    if (a.arousalScore !== b.arousalScore) aBad.push(`${z}: ${a.arousalScore} vs ${b.arousalScore}`);
  }
  check('arousalScore agrees exactly', aBad.length === 0, aBad.join(' | '));

  // The other two layers extract words on their own, so they need their own
  // check. Their outputs carry CHARACTER OFFSETS into the text they were
  // given, and the twin is one character shorter — so the offsets must differ
  // and only the musical content may be compared. Comparing the whole object
  // would be wrong; comparing nothing would be vacuous.
  const dropOffsets = o => JSON.stringify(o).replace(/"(?:start|end)":\d+/g, '');
  let iBad = [], cBad = [], sBad = [];
  for (const z of TWINS) {
    const plain = noZwnj(z);
    if (dropOffsets(deriveIntentions(z)) !== dropOffsets(deriveIntentions(plain))) iBad.push(z);
    if (dropOffsets(deriveSemanticSpans(z)) !== dropOffsets(deriveSemanticSpans(plain))) sBad.push(z);
    const ca = deriveComposition(z), cb = deriveComposition(plain);
    if (JSON.stringify(ca.sections) !== JSON.stringify(cb.sections)) cBad.push(z);
  }
  check('deriveIntentions agrees (musical fields; offsets differ by 1 char)',
    iBad.length === 0, iBad.join(' | '));
  check('deriveSemanticSpans agrees (musical fields)', sBad.length === 0, sBad.join(' | '));
  check('deriveComposition agrees', cBad.length === 0, cBad.join(' | '));

  // and the offsets really do track each text's own length, which is what
  // makes the comparison above legitimate
  let offOk = true;
  for (const z of TWINS) {
    const A = deriveSemanticSpans(z), B = deriveSemanticSpans(noZwnj(z));
    if (A.length !== B.length) offOk = false;
    if (A.length && Math.max(...A.map(s => s.end)) > z.length) offOk = false;
  }
  check('span offsets stay inside the text they came from', offOk);
}

// ── 3. the specific words that were silently lost now hit ──────
{
  // these two are the measured regressions from the bug report; both must
  // now score negative rather than zero
  for (const w of ['بی‌حس شدم', 'دل‌تنگ شدم']) {
    const m = detectMood(w);
    check(`"${w}" is no longer neutral`, m.normScore < 0, `normScore=${m.normScore}`);
  }

  // The lexicon hit itself, not just the aggregate. "بی‌حس شدم" is a real
  // two-word entry, so the fix has to recover it as ONE two-word match — the
  // split version found nothing at all.
  const scan = t => scanPhraseMatches(extractWords(t)).map(x => ({ i: x.index, len: x.length, w: x.weight, a: x.arousal }));
  check('"بی‌حس شدم" resolves as one 2-word match',
    JSON.stringify(scan('بی‌حس شدم')) === JSON.stringify([{ i: 0, len: 2, w: -0.8, a: -0.35 }]),
    JSON.stringify(scan('بی‌حس شدم')));
  check('and identically without the ZWNJ',
    JSON.stringify(scan('بی‌حس شدم')) === JSON.stringify(scan('بیحس شدم')));
  check('the split fragments hit nothing (this was the bug)',
    scan('بی حس').length === 0, JSON.stringify(scan('بی حس')));
}

// ── 4. the SUFFIXES path is covered ─────────────────────────────
{
  // خسته‌ام -> strip "ام" -> خسته must resolve, exercising the stem fallback in
  // both wordEmotionWeight and scanPhraseMatches
  const w = wordEmotionWeight('خسته‌ام');
  const stem = wordEmotionWeight('خسته');
  check('the inflected form resolves via its stem', w > 0, `خسته‌ام=${w}`);
  check('and it is a stem match, not an exact entry', w !== stem, `${w} vs stem ${stem}`);
  check('the stem fallback is discounted to 0.85', Math.abs(w - stem * 0.85) < 1e-9, `${w} == ${stem}*0.85`);

  // only forms the lexicon can actually resolve: خسته‌ایم is not an entry and
  // has no stem that is, so it is deliberately not in this list
  let bad = [];
  for (const z of ['خسته‌ام', 'خسته‌ات', 'خسته‌اش', 'خسته‌یم']) {
    const p = noZwnj(z);
    if (wordEmotionWeight(z) !== wordEmotionWeight(p)) bad.push(z);
    if (wordEmotionWeight(z) === 0) bad.push(`${z} (no hit)`);
  }
  check('every ZWNJ inflected form resolves and matches its twin', bad.length === 0, bad.join(' | '));

  // می‌خوام is a prefix split with no lexicon stem; the twins must still agree
  check('"می‌خوام" and "میخوام" agree even with no stem to fall back on',
    wordEmotionWeight('می‌خوام') === wordEmotionWeight('میخوام'));
}

// ── 5. the fix is confined to ZWNJ texts ────────────────────────
{
  // stored results for texts with no ZWNJ, which must not move
  // captured from HEAD before this change, by running the same probe there
  const EXPECT = [
    ['I am so tired of this', 'mixolydian', 0, 0, 0],
    ['خیلی خسته ام و دیگه رمقی ندارم', 'minor', -0.8639, 0.0864, -0.3456],
    ['هیچی برام مهم نیست', 'mixolydian', 0, 0, 0],
    ['وای چه خبر عالی!!', 'major', 0.5, 0.625, 0.625],
    ['هیچی که میگم درست نیست', 'mixolydian', 0, 0.0937, 0],
    ['The room without windows felt heavy', 'minor', -0.5832, 0.0583, -0.2333],
  ];
  let bad = [];
  for (const [t, mode, n, tn, a] of EXPECT) {
    const m = detectMood(t);
    const got = [m.mode, +m.normScore.toFixed(4), +m.tenseScore.toFixed(4), +m.arousalScore.toFixed(4)];
    if (JSON.stringify(got) !== JSON.stringify([mode, n, tn, a])) bad.push(`${t}: ${JSON.stringify(got)}`);
  }
  check('a ZWNJ-free Persian text scores exactly as before', bad.length === 0, bad.join(' | '));

  // and no ZWNJ-free text may contain a ZWNJ after folding
  for (const t of NO_ZWNJ) {
    if (extractWordsKeepZwnj(t).some(w => w.includes(ZWNJ))) { check('NO_ZWNJ corpus is clean', false, t); break; }
  }
  check('the no-ZWNJ control corpus really has no ZWNJ',
    NO_ZWNJ.every(t => !t.includes(ZWNJ)));

  // آ (U+0622) and the other hamza carriers below U+0627 are now inside
  // words too. That was a separate bug, one character below this one, and
  // fixing it is why this block no longer asserts the opposite. See
  // test/lexicon-round-trip-test.mjs, which derives every such letter
  // instead of listing them.
  // extractWords folds آ onto ا for the lookup key (see stripMadda and
  // test/madda-fold-test.mjs), so the key is "ارامش" here. What matters for
  // this file is that it is ONE word and that it is not "رامش" — the madda bug
  // — and that tokenize() still shows the character the user typed.
  check('آ is part of a word (one token, and not "رامش")',
    JSON.stringify(extractWords('آرامش')) === JSON.stringify(['ارامش'])
    && extractWords('آرامش').length === 1,
    JSON.stringify(extractWords('آرامش')));
  check('and tokenize() keeps the madda the user typed',
    tokenize('صبح آرامشه').filter(t => t.type === 'word').map(t => t.text).join(' ') === 'صبح آرامشه');

  // the gold text that carried آ now scores positive, and every layer agrees
  {
    const t = 'صبح آرومیه و دلم پر از آرامشه.';
    const m = detectMood(t);
    check('a ZWNJ-free text containing آ is positive now (was 0.000)',
      Math.abs(m.normScore - 0.3212698020578431) < 1e-9, `norm=${m.normScore}`);
    check('every layer agrees on the آ text',
      scanPhraseMatches(extractWords(t)).length === 1
      && deriveSemanticSpans(t).length === 1,
      `scan=${scanPhraseMatches(extractWords(t)).length} spans=${deriveSemanticSpans(t).length}`);
  }
}

// ── 6. offsets and the rendered text still line up ──────────────
{
  // tokenize() must NOT strip the ZWNJ: its offsets index the string
  // buildRender() is handed, so stripping would slide the highlight.
  const t = 'بی‌حس شدم';
  const toks = tokenize(t).filter(x => x.type === 'word');
  check('tokenize keeps the ZWNJ inside the word token',
    toks[0].text === 'بی‌حس' && toks[0].start === 0 && toks[0].end === 5);
  check('tokenize offsets still slice the folded text correctly',
    toks.every(x => foldPersian(t).slice(x.start, x.end) === x.text));
  // every character must be covered by exactly one token, space included
  const covered = new Array(t.length).fill(0);
  for (const x of tokenize(t)) for (let i = x.start; i < x.end; i++) covered[i]++;
  check('tokenize covers every character exactly once',
    covered.every(c => c === 1), covered.join(''));
}

// ── 7. end to end: the played notes match ───────────────────────
{
  // The note sequence CANNOT be identical here, and must not be made so.
  // hashText() hashes the string's characters, so a text one ZWNJ longer is a
  // different piece of music — different mode index, different motif, different
  // chord clock. That is correct: the two spellings are different documents.
  // What must match is the SHAPE — same mood, same word count, same timing
  // skeleton, same number of notes. Forcing byte equality would mean stripping
  // the ZWNJ before hashing, which would slide every token offset.
  let shapeBad = [], moodBad2 = [];
  for (const z of TWINS) {
    const A = simulateText(z), B = simulateText(noZwnj(z));
    if (A.mood !== B.mood) moodBad2.push(`${z}: ${A.mood} vs ${B.mood}`);
    if (A.sequence.length !== B.sequence.length) shapeBad.push(`${z}: ${A.sequence.length} vs ${B.sequence.length} notes`);
    else {
      const skel = s => s.sequence.map(n => [n.wordIdx, n.sentenceType, +n.startMs.toFixed(1)].join(':')).join('|');
      if (skel(A) !== skel(B)) shapeBad.push(`${z} (timing skeleton)`);
    }
  }
  check('the mode agrees', moodBad2.length === 0, moodBad2.join(' | '));
  check('note count and word/timing skeleton agree', shapeBad.length === 0, shapeBad.join(' | '));

  // and confirm the hash really is what differs, so the above is a decision
  // rather than a failure to compare
  check('hashText differs (why byte equality is not expected)',
    hashText('بی‌حس شدم') !== hashText('بیحس شدم'));

  // and the fix is not vacuous: the ZWNJ form must actually produce notes
  const n = simulateText('بی‌حس شدم').sequence.length;
  check('"بی‌حس شدم" really plays notes (guard against a vacuous pass)', n > 0, `${n} note(s)`);
}

if (failed) {
  console.log(`\n${failed} FAILED`);
  process.exit(1);
}
console.log('\nthe ZWNJ is part of the word, not a word break');
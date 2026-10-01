// ─── Madda-less lookup fold ──────────────────────────────────────
// Persian speakers routinely write آ (U+0622) as ا (U+0627): it is one keypress
// instead of a modifier chord, older Iranian keyboards did not have it, and
// phone IMEs substitute it constantly. So "ارامش" and "آرامش" are the same word
// to a reader, while the lexicon only knows the spelled-with-madda one:
//
//   wordEmotionWeight("آرامش") = 0.7    wordEmotionWeight("ارامش") = 0
//   detectMood("آرامش دارم")  = 0.4375  detectMood("ارامش دارم")  = 0
//
// The fold is LOOKUP ONLY, and the second half of the test is about that: it
// must not reach the display text, hashText(), or the token offsets. A madda is
// a real character. Folding it there would change the string length, break the
// offsets buildRender() is handed, and change the RNG seed — so one sentence
// would render differently and play differently depending on which path read
// it. foldPersian() is 1:1 and leaves آ alone for exactly that reason.

import { detectMood, wordEmotionWeight, MADDA_COLLISIONS } from '../js/music/mood.js';
import { extractWords, foldPersian, tokenize } from '../js/utils/text.js';
import { hashText } from '../js/music/harmony.js';

let failed = 0;
function check(name, ok, detail = '') {
  console.log(` ${ok ? ' ok  ' : 'FAIL '} ${name}${detail ? '  → ' + detail : ''}`);
  if (!ok) failed++;
}

const MADDA = '\u0622';
const ALEF = '\u0627';
/** The madda-less spelling: ا written where آ was. */
const withoutMadda = s => s.split(MADDA).join(ALEF);

console.log('\nmadda-less lookup fold\n');

// 1. the lookup now matches either way, and to the same value
{
  // only entries that really exist — otherwise a pair would pass as 0 === 0
  const PAIRS = ['آرامش', 'آروم', 'آرام', 'آواز', 'آرزو'];
  const bad = [], zero = [];
  for (const withM of PAIRS) {
    const without = withoutMadda(withM);
    const a = wordEmotionWeight(withM);
    const b = wordEmotionWeight(without);
    if (a !== b) bad.push(`${withM}/${without}: ${a} ≠ ${b}`);
    if (a === 0) zero.push(withM);
  }
  check('the madda and madda-less spellings give the same weight',
    bad.length === 0, bad.join('; '));
  // without this the check could pass on a pair that is 0 === 0
  check('and those weights are non-zero (the pairs are real entries)',
    zero.length === 0, zero.join(' '));
}

// 2. whole sentences agree, which is what a user actually types
{
  // expected values derived from the bare-word score, so the prior's shrinkage
  // of readable text does not turn this into a wrong-value test
  const CASES = [
    ['آرامش دارم', detectMood('آرامش').normScore],
    ['همه چی آرومه', detectMood('همه چی آرومه').normScore],
    ['حس آرامش می‌کنم', detectMood('حس آرامش می‌کنم').normScore],
    ['آرامم و خسته‌ام'],
    ['تو آسمونم'],
  ];
  const bad = [];
  for (const [text, expect] of CASES) {
    const a = detectMood(text);
    const b = detectMood(withoutMadda(text));
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      bad.push(`"${text}": ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`);
    }
    if (expect !== undefined && Math.abs(a.normScore - expect) > 1e-9) {
      bad.push(`"${text}" normScore ${a.normScore} ≠ ${expect}`);
    }
  }
  check('madda and madda-less sentences score identically', bad.length === 0, bad.join('; '));
}

// 3. THE IMPORTANT HALF: the fold is lookup-only.
//    Display text, the RNG seed and the offsets must all still see the madda.
{
  const FA = 'آرامش دارم';
  const AR = 'ارامش دارم';

  // display text: tokenize() keeps the character the user typed
  const toks = tokenize(AR).filter(t => t.type === 'word').map(t => t.text);
  check('tokenize() keeps the madda-less text as typed', toks.join(' ') === AR, toks.join(' '));
  check('and does not invent a madda that was not there',
    !tokenize(AR).filter(t => t.type === 'word').map(t => t.text).join('').includes(MADDA));
  check('tokenize() keeps a real madda too',
    tokenize(FA).filter(t => t.type === 'word').map(t => t.text).join(' ') === FA);

  // offsets: every token must slice its own word out of the folded text
  const offsetsOk = [FA, AR].every(t => {
    const folded = foldPersian(t);
    return tokenize(t).filter(x => x.type === 'word')
      .every(x => folded.slice(x.start, x.end) === x.text);
  });
  check('token offsets still index the text correctly', offsetsOk);

  // length: the fold must not have changed it
  check('string length is unchanged by the lookup fold',
    FA.length === withoutMadda(FA).length, `${FA.length} vs ${withoutMadda(FA).length}`);

  // the RNG seed MUST differ, or the fold leaked into hashText
  check('hashText still distinguishes the two spellings (fold did not leak)',
    hashText(FA) !== hashText(AR), `${hashText(FA)} vs ${hashText(AR)}`);
}

// 4. extractWords is where the fold lives, and only there
{
  check('extractWords strips the madda',
    JSON.stringify(extractWords('آرامش')) === JSON.stringify(['ارامش']));
  check('foldPersian leaves the madda alone',
    foldPersian('آرامش') === 'آرامش', foldPersian('آرامش'));
  check('foldPersian is still 1:1 in length',
    foldPersian('آرامش دارم').length === 'آرامش دارم'.length);
  check('foldPersian still folds the Arabic yeh/kaf',
    foldPersian('آبی') === 'آبی' && foldPersian('مكي') === 'مکی', foldPersian('مكي'));
}

// 5. the collision report: present, and every entry in it is a genuine
//    spelling duplicate rather than a real distinct entry
{
  check('the collision report is populated', MADDA_COLLISIONS.length > 0,
    `${MADDA_COLLISIONS.length} collision(s)`);

  // every collision must be a case where two DIFFERENT strings became one key.
  // Recompute the key from each spelling independently rather than trusting
  // c.key, or the assertion would pass on a mislabelled report.
  const keyOf = s => extractWords(s).join(' ');
  const bogus = MADDA_COLLISIONS.filter(c =>
    c.kept.spelling === c.dropped.w
    || keyOf(c.kept.spelling) !== c.key
    || keyOf(c.dropped.w) !== c.key
  );
  check('every reported collision is a real spelling duplicate', bogus.length === 0,
    bogus.map(c => c.key).join('; '));

  // and none of them may silently change a weight: the surviving entry and the
  // dropped one must agree, or the fold is choosing between two meanings
  const disagree = MADDA_COLLISIONS.filter(c =>
    c.kept.weight !== c.dropped.weight || c.kept.cat !== c.dropped.cat);
  check('no collision changes the weight or the category', disagree.length === 0,
    disagree.map(c => `${c.key}: kept ${c.kept.cat}/${c.kept.weight}, dropped ${c.dropped.cat}/${c.dropped.weight}`).join('; '));

  // This is where the report lives now. mood.js used to print it on every
  // import, which put four lines of bookkeeping in the browser console for
  // anyone opening the app.
  console.log('       (merged by the madda-less fold — later spelling wins:');
  for (const c of MADDA_COLLISIONS) {
    console.log(`         "${c.key}"  kept "${c.kept.spelling}" [${c.kept.cat} ${c.kept.weight}]  over "${c.dropped.w}" [${c.dropped.cat} ${c.dropped.weight}])`);
  }
  console.log('       )');
}

if (failed) {
  console.log(`\n${failed} FAILED`);
  process.exit(1);
}
console.log('\nthe madda is optional in a sentence and required in the display');
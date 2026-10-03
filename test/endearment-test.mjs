// ─── Endearments ─────────────────────────────────────────────────
// A term of address is not a statement of feeling. "Darling, are you okay?"
// is a person speaking to someone they care about; the sentence around it
// carries the actual emotion. Scoring an endearment like "love" (+1.0) or like
// excitement (arousal positive) would make "dear, listen to me" play fast and
// loud, which is the wrong feeling entirely.
//
// Two categories, from the meaning rather than from a frequency count:
//
//   endearment       +0.7  tense -0.1  arousal -0.1
//                   darling, my love, sweetheart, honey, عزیزم, عشقم, جانم,
//                   قربونت, عزیز دلم, جان دلم
//   endearment_soft  +0.35 tense -0.1  arousal -0.1
//                   baby, dear, babe
//
// The arousal is slightly NEGATIVE in both. Speaking to someone you love is a
// settled, quiet state; it lowers urgency rather than raising it.
//
// "baby" is in the soft set and NOT in love, because "the baby is crying" and
// "my baby is sick" are about a child. A word that appears in both readings
// cannot be filed under either.

import { EMOTION_LEXICON, detectMood, wordEmotionWeight } from '../js/music/mood.js';

let failed = 0;
function check(name, ok, detail = '') {
  console.log(` ${ok ? ' ok  ' : 'FAIL '} ${name}${detail ? '  → ' + detail : ''}`);
  if (!ok) failed++;
}

/** Which categories hold this entry, and at what weight. */
const owners = w => {
  const out = [];
  for (const [c, v] of Object.entries(EMOTION_LEXICON)) {
    if (v.words.includes(w)) out.push({ cat: c, weight: v.weight, tense: v.tense, arousal: v.arousal });
  }
  return out;
};

console.log('\nendearments\n');

// 1. the categories exist with the specified numbers
{
  const e = EMOTION_LEXICON.endearment;
  check('the endearment category exists', !!e);
  if (e) {
    check('weight +0.7', Math.abs(e.weight - 0.7) < 1e-9, `${e.weight}`);
    check('tense -0.1', Math.abs(e.tense + 0.1) < 1e-9, `${e.tense}`);
    check('arousal -0.1 (warm, not excited)', Math.abs(e.arousal + 0.1) < 1e-9, `${e.arousal}`);
  }
  const s = EMOTION_LEXICON.endearment_soft;
  check('the endearment_soft category exists', !!s);
  if (s) {
    check('weight +0.35 (ambiguous, half)', Math.abs(s.weight - 0.35) < 1e-9, `${s.weight}`);
    check('tense -0.1', Math.abs(s.tense + 0.1) < 1e-9, `${s.tense}`);
    check('arousal -0.1', Math.abs(s.arousal + 0.1) < 1e-9, `${s.arousal}`);
  }
}

// 2. every unambiguous term resolves to the strong category and nothing else
{
  const STRONG = ['darling', 'my love', 'sweetheart', 'honey', 'عزیزم', 'عشقم', 'جانم', 'قربونت', 'عزیز دلم', 'جان دلم'];
  const bad = [], missing = [];
  for (const w of STRONG) {
    const o = owners(w);
    if (!o.length) { missing.push(w); continue; }
    // must be in endearment, and MUST NOT also be in love — a duplicate means
    // the two definitions are racing and the later one silently wins
    const cats = o.map(x => x.cat);
    if (!cats.includes('endearment')) bad.push(`${w}: not in endearment (${cats.join(',')})`);
    if (cats.includes('love')) bad.push(`${w}: still duplicated in love — the lookup would take whichever is last`);
  }
  check('every strong term is present', missing.length === 0, missing.join(' '));
  check('every strong term resolves only to endearment', bad.length === 0, bad.join('; '));
}

// 3. the ambiguous ones
{
  const SOFT = ['baby', 'dear', 'babe'];
  const bad = [];
  for (const w of SOFT) {
    const o = owners(w);
    const cats = o.map(x => x.cat);
    if (!cats.includes('endearment_soft')) bad.push(`${w}: ${cats.join(',') || 'absent'}`);
    if (cats.includes('love')) bad.push(`${w}: must not be in love`);
  }
  check('baby, dear and babe resolve to endearment_soft only', bad.length === 0, bad.join('; '));
}

// 4. the warm-not-excited behaviour, which is the point of the weights
{
  const m = detectMood('darling');
  check('an endearment on its own is positive but modest', m.normScore > 0 && m.normScore < 0.7,
    `${m.normScore}`);
  check('and it LOWERS arousal rather than raising it', m.arousalScore < 0, `${m.arousalScore}`);
  check('love is still stronger than an endearment',
    detectMood('love').normScore > detectMood('darling').normScore,
    `${detectMood('love').normScore} vs ${detectMood('darling').normScore}`);
  check('love is still the more aroused of the two',
    detectMood('love').arousalScore > detectMood('darling').arousalScore,
    `${detectMood('love').arousalScore} vs ${detectMood('darling').arousalScore}`);
}

// 5. THE GUARDS. These are the ones that would be easy to break by adding a
//    word later, and they are why دلم is not in any endearment list.
{
  // a bare دلم means "my heart" and carries no sentiment at all — what follows
  // it decides. Adding it as an endearment would make every sentence with a
  // دلم positive, which would be a large and very audible regression.
  const o = owners('دلم');
  check('bare دلم is not an entry in any category', o.length === 0,
    o.map(x => x.cat).join(','));

  check('"دلم گرفته" stays negative', detectMood('دلم گرفته').normScore < -0.3,
    `${detectMood('دلم گرفته').normScore}`);
  check('"دلم شکسته" stays negative', detectMood('دلم شکسته').normScore < -0.3,
    `${detectMood('دلم شکسته').normScore}`);
  check('"دلم خرابه" stays negative', detectMood('دلم خرابه').normScore < -0.3,
    `${detectMood('دلم خرابه').normScore}`);

  // and the same word in a longing phrase must stay longing, not turn negative
  check('"دلم برات تنگ شده بود" stays longing/positive', detectMood('دلم برات تنگ شده بود').normScore > 0.3,
    `${detectMood('دلم برات تنگ شده بود').normScore}`);
  check('"دلم برات یه ذره شده" stays positive', detectMood('دلم برات یه ذره شده').normScore > 0.3,
    `${detectMood('دلم برات یه ذره شده').normScore}`);
  check('"دلم پر از عشقه" stays positive', detectMood('دلم پر از عشقه').normScore > 0.3,
    `${detectMood('دلم پر از عشقه').normScore}`);

  // the soft FA words I added must not be captured hearts either
  for (const w of ['عزیز', 'جان', 'بابا']) {
    const cats = owners(w).map(x => x.cat);
    check(`"${w}" is owned by exactly one category`, cats.length === 1, cats.join(','));
    check(`"${w}" is owned by endearment_soft`, cats[0] === 'endearment_soft', cats.join(','));
  }
}

// 6. "the baby is crying" must stay negative — the reason baby is soft
{
  const m = detectMood('the baby is crying');
  check('"the baby is crying" is negative', m.normScore < 0, `${m.normScore}`);
  check('and not made positive by the word baby', m.normScore < detectMood('baby').normScore,
    `${m.normScore} vs baby alone ${detectMood('baby').normScore}`);
  // "sick" is not a lexicon entry, so this sentence is baby-and-nothing-else
  // and scores the bare soft weight. That is the honest ceiling for a soft
  // word and is why the guard above uses a sentence with real evidence in it.
  check('"my baby is sick" is not made positive beyond the soft weight',
    Math.abs(detectMood('my baby is sick').normScore - detectMood('baby').normScore) < 1e-9,
    `${detectMood('my baby is sick').normScore} vs baby ${detectMood('baby').normScore}`);
}

// 7. no duplicate entries anywhere in the new categories — the build is
//    last-writer-wins, so a duplicate is a silent way to pick the wrong one
{
  const report = [];
  for (const cat of ['endearment', 'endearment_soft']) {
    const words = EMOTION_LEXICON[cat].words;
    const seen = new Map();
    for (const w of words) {
      if (seen.has(w)) report.push(`${cat}: "${w}" appears twice`);
      seen.set(w, true);
    }
    const others = Object.keys(EMOTION_LEXICON)
      .filter(c => c !== cat)
      .filter(c => EMOTION_LEXICON[c].words.some(w => seen.has(w)));
    for (const c of others) {
      const shared = words.filter(w => EMOTION_LEXICON[c].words.includes(w));
      report.push(`${cat} ∩ ${c}: ${shared.join(', ')}`);
    }
  }
  check('no word is owned twice', report.length === 0, report.join('; '));
}

// 8. love keeps its own entries
{
  const lost = ['love', 'adore', 'affection', 'crush', 'smitten', 'infatuated', 'kiss', 'embrace'];
  const gone = lost.filter(w => !EMOTION_LEXICON.love.words.includes(w));
  check('love keeps its own vocabulary', gone.length === 0, gone.join(' '));
  check('love still outranks an endearment',
    EMOTION_LEXICON.love.weight > EMOTION_LEXICON.endearment.weight);
}

// A greeting + "baby/babe/dear" is a person being addressed, not a child and
// not a feeling, so it is scored as a full endearment ("hey baby" reads like
// "hey darling"). The bare word stays soft: "the baby is crying" is a child.
{
  console.log('\nvocative greeting + endearment\n');
  const norm = t => detectMood(t).normScore;
  check('"hey baby" is a full endearment, same as "hey darling"',
    Math.abs(norm('hey baby') - norm('hey darling')) < 0.1, `${norm('hey baby').toFixed(2)} vs ${norm('hey darling').toFixed(2)}`);
  check('"hello dear" and "hi baby" match too',
    norm('hello dear') >= 0.35 && norm('hi baby') >= 0.35);
  check('bare "baby" stays soft', norm('baby') < 0.3, `${norm('baby').toFixed(2)}`);
  check('"the baby is crying" does not become an endearment', norm('the baby is crying') < 0);
}

if (failed) {
  console.log(`\n${failed} FAILED`);
  process.exit(1);
}
console.log('\nan endearment is a word for a person, not a claim about a feeling');
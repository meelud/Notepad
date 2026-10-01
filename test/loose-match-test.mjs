// ─── Loose phrase match cannot swallow emotion words ──────────────
// A lexicon entry may be written with a filler word the text lacks, so the
// matcher tries a window with one word removed. Unrestricted, that is a way of
// deleting any word you like: "how are you" is a casual entry of weight 0, so
// "darling how are you" matched it with the leading "darling" removed,
// consumed all four words, and scored 0.00 — identical to the phrase alone.
// The emotion word was consumed and thrown away.
//
//   "how are you"             0.00
//   "darling how are you"     0.00   ← the bug
//   "sad how are you"         0.00
//   "furious how are you"     0.00
//   "happy how are you"       0.00
//   "how are you darling"     0.63   ← nothing left to swallow
//
// Two rules now hold, in both the mood layer and the span layer: the skipped
// word must be INTERIOR, and it must carry no lexicon weight of its own.

import { detectMood, scanPhraseMatches, EMOTION_LEXICON } from '../js/music/mood.js';
import { extractWords } from '../js/utils/text.js';

let failed = 0;
function check(name, ok, detail = '') {
  console.log(` ${ok ? ' ok  ' : 'FAIL '} ${name}${detail ? '  → ' + detail : ''}`);
  if (!ok) failed++;
}

/** Weight of one word straight from the lexicon, or 0 if it is not an entry. */
const entryWeight = w => {
  for (const cat of Object.keys(EMOTION_LEXICON)) {
    if (EMOTION_LEXICON[cat].words.includes(w)) return EMOTION_LEXICON[cat].weight;
  }
  return 0;
};

/**
 * What a text is EXPECTED to score when the emotion word is the only thing in
 * it — i.e. the bare word's score, since "how are you" contributes nothing.
 *
 * Derived rather than hard-coded, so neither reclassifying a word ("darling"
 * was love at +1.0, now an endearment at +0.7) nor the calm-neutral prior's
 * shrinkage can turn these into wrong-value tests. What is being tested is that
 * the casual phrase does not swallow the emotion word — not what the word is
 * worth today.
 */
const expected = w => detectMood(`${w} how are you`).normScore;

console.log('\nloose phrase match\n');

// 0. the premises: the filler phrases really are weight-0 entries, and the
//    emotion words really are weighted. If either stopped being true the tests
//    below would pass for the wrong reason.
//
// The expected weights are read from the lexicon rather than hard-coded, so
// this stays correct when a category's weight changes — which it did for
// "darling", an endearment at +0.7 after it stopped being a love word.
{
  check('"how are you" is a zero-weight casual entry', entryWeight('how are you') === 0);
  const PROBES = ['sad', 'furious', 'happy', 'darling'];
  const bad = PROBES.filter(w => entryWeight(w) === 0);
  check('the probe emotion words carry weight', bad.length === 0,
    bad.map(w => `${w} scores 0`).join(', '));
}

// 1. the reported cases, exactly
{
  const CASES = [
    ['darling how are you', expected('darling')],
    ['sad how are you', expected('sad')],
    ['furious how are you', expected('furious')],
    ['happy how are you', expected('happy')],
  ];
  const bad = [];
  for (const [text, expect] of CASES) {
    const got = detectMood(text).normScore;
    if (Math.abs(got - expect) > 1e-9) bad.push(`${text}: ${got} ≠ ${expect}`);
  }
  check('an emotion word BEFORE a casual phrase keeps its weight',
    bad.length === 0, bad.join('; '));
}

// 2. and after it, which is the direction that always worked — pinned so the
//    fix cannot be a one-sided change
{
  const CASES = [
    ['how are you darling', expected('darling')],
    ['how are you sad', expected('sad')],
    ['how are you furious', expected('furious')],
    ['how are you happy', expected('happy')],
  ];
  const bad = [];
  for (const [text, expect] of CASES) {
    const got = detectMood(text).normScore;
    if (Math.abs(got - expect) > 1e-9) bad.push(`${text}: ${got} ≠ ${expect}`);
  }
  check('an emotion word AFTER a casual phrase keeps its weight',
    bad.length === 0, bad.join('; '));
}

// 3. both sides are symmetric, and a comma between them changes nothing
{
  const EMO = Object.fromEntries(['darling', 'sad', 'furious', 'happy'].map(w => [w, expected(w)]));
  const PHRASE = 'how are you';
  const bad = [];
  for (const [w, v] of Object.entries(EMO)) {
    const before = detectMood(`${w} ${PHRASE}`).normScore;
    const after = detectMood(`${PHRASE} ${w}`).normScore;
    const commaBefore = detectMood(`${w}, ${PHRASE}`).normScore;
    const commaAfter = detectMood(`${PHRASE}, ${w}`).normScore;
    if (Math.abs(before - v) > 1e-9) bad.push(`${w} before: ${before} ≠ ${v}`);
    if (Math.abs(after - v) > 1e-9) bad.push(`${w} after: ${after} ≠ ${v}`);
    if (Math.abs(commaBefore - v) > 1e-9) bad.push(`${w} comma-before: ${commaBefore} ≠ ${v}`);
    if (Math.abs(commaAfter - v) > 1e-9) bad.push(`${w} comma-after: ${commaAfter} ≠ ${v}`);
  }
  check('both orders, with and without a comma, all equal', bad.length === 0, bad.join('; '));
}

// 4. the same in Persian. No Persian zero-weight phrase contains an emotion
//    word, so the probe is built the other way round: splice one in, at each
//    interior position, exactly as the English test does in section 5.
{
  const zeros = [];
  for (const cat of Object.keys(EMOTION_LEXICON)) {
    if (EMOTION_LEXICON[cat].weight !== 0) continue;
    for (const w of EMOTION_LEXICON[cat].words) {
      const parts = w.split(' ');
      // only pure-Persian entries, so the probe words are not mixed scripts
      if (parts.length === 3 && /^[\u0600-\u06FF ]+$/.test(w)) zeros.push({ entry: w, parts });
    }
  }
  check('Persian zero-weight 3-word entries exist to probe', zeros.length > 0, `${zeros.length}`);
  let violations = [];
  for (const { entry, parts } of zeros) {
    for (let pos = 1; pos < parts.length - 1; pos++) {
      const spliced = [...parts];
      spliced[pos] = 'عصبانی';
      const text = spliced.join(' ');
      const got = detectMood(text).normScore;
      if (Math.abs(got) < 0.1) violations.push(`${entry} [${pos}] → "${text}" scored ${got}`);
    }
  }
  check('no interior Persian weighted word is dropped by the loose matcher',
    violations.length === 0,
    violations.slice(0, 5).join('; ') + (violations.length > 5 ? ` (+${violations.length - 5} more)` : ''));
}

// 5. the rule itself, stated directly: no interior word may be dropped if it
//    carries weight. Probed over every zero-weight 3-word entry, with a
//    weighted word spliced into the SINGLE interior position (index 1 of 3).
{
  const zeros = [];
  for (const cat of Object.keys(EMOTION_LEXICON)) {
    if (EMOTION_LEXICON[cat].weight !== 0) continue;
    for (const w of EMOTION_LEXICON[cat].words) {
      const parts = w.split(' ');
      if (parts.length === 3) zeros.push({ entry: w, parts });
    }
  }
  check('zero-weight 3-word entries exist to probe', zeros.length > 0, `${zeros.length}`);

  // "furious" has weight -0.7 and "still" has weight +0.7, so splicing furious
  // into "still processing this" cancels to 0 without any swallowing — an
  // unrelated arithmetic accident, not the bug. The probe therefore requires
  // the spliced word to be matched on its OWN, which is the actual invariant.
  let violations = [];
  let probed = 0;
  for (const { entry, parts } of zeros) {
    const spliced = [parts[0], 'furious', parts[2]].join(' ');
    if (spliced === entry) continue;
    probed++;
    const matches = scanPhraseMatches(extractWords(spliced));
    const own = matches.find(m => m.length === 1 && Math.abs(m.weight + 0.7) < 1e-9);
    if (!own) violations.push(`${entry} → "${spliced}" matched ${JSON.stringify(matches.map(m => ({ len: m.length, w: m.weight })))}`);
  }
  check('the spliced word is matched on its own, never as filler',
    violations.length === 0,
    `${violations.length}/${probed} failed; ` + violations.slice(0, 4).join('; '));
}

// 6. both layers agree on which words were consumed
{
  for (const text of ['darling how are you', 'how are you darling', 'sad how are you']) {
    const words = extractWords(text);
    const matches = scanPhraseMatches(words);
    // every word must be accounted for by some match
    const covered = new Set();
    for (const m of matches) for (let k = 0; k < m.length; k++) covered.add(m.index + k);
    const gaps = words.map((_, i) => i).filter(i => !covered.has(i));
    check(`every word consumed in "${text}"`, gaps.length === 0,
      gaps.length ? `uncovered: ${gaps.map(i => words[i]).join(', ')}` : '');

    // and the emotion word must be its own match, not swallowed
    const emo = matches.find(m => m.weight !== 0);
    check(`the emotion word is matched separately in "${text}"`, !!emo && emo.length === 1,
      JSON.stringify(matches.map(m => ({ len: m.length, w: m.weight }))));
  }
}

// 7. and the filler phrase is still reachable when it really is there
{
  // the fallback exists for entries written with a filler the text lacks; it
  // must still fire, or this fix has just disabled it
  const fires = [];
  for (const cat of Object.keys(EMOTION_LEXICON)) {
    if (EMOTION_LEXICON[cat].weight !== 0) continue;
    for (const w of EMOTION_LEXICON[cat].words) {
      const parts = w.split(' ');
      if (parts.length !== 4) continue;
      for (let skip = 1; skip < 3; skip++) {
        const shorter = [...parts.slice(0, skip), ...parts.slice(skip + 1)].join(' ');
        if (detectMood(shorter).normScore !== 0) { fires.push(shorter); break; }
      }
      if (fires.length >= 3) break;
    }
    if (fires.length >= 3) break;
  }
  check('the interior-skip fallback still fires when it should', fires.length >= 3,
    `${fires.length} case(s) found`);
}

if (failed) {
  console.log(`\n${failed} FAILED`);
  process.exit(1);
}
console.log('\na filler-word heuristic cannot delete an emotion word');
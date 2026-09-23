/**
 * test/phrase-fix-stratified.mjs
 * ─────────────────────────────────────────────────────────────────
 * Re-runs the phrase-awareness before/after comparison (the fix to
 * intention.js's clauseSentiment, composition.js's
 * sectionSentimentMagnitude, and player.js's semantic-span lookup)
 * against CORPUS_V2 — the deliberately idiom-density-stratified
 * corpus — instead of EVAL_DATASET/LONG_TEXTS. This is the test that
 * was missing: EVAL_DATASET showed only a ~1% aggregate effect
 * because it wasn't idiom-rich; this breaks results out BY density
 * bucket so "does the fix matter" gets a real, honest, per-bucket
 * answer instead of one diluted average.
 */
import { CORPUS_V2 } from './corpus-v2.mjs';
import { wordSentimentSign, scanPhraseMatches } from '../js/music/mood.js';
import { deriveSemanticSpans } from '../js/music/intention.js';
import { tokenize } from '../js/utils/text.js';

const WORD_RE = /[a-zA-Zا-ی]+/g;
const THRESHOLD = 0.5;

// ─── 1) Raw clause-level sentiment magnitude: old (single-word) vs new (phrase-aware) ──
function oldSum(words) { return words.reduce((s, w) => s + wordSentimentSign(w), 0); }
function newSum(words) { return scanPhraseMatches(words).reduce((s, m) => s + m.weight, 0); }

console.log('=== 1) Clause-level sentiment magnitude, stratified by idiom density ===');
const densityBuckets = ['pure-word', 'pure-idiom', 'mixed'];
densityBuckets.forEach(density => {
  const subset = CORPUS_V2.filter(c => c.density === density);
  let oldZero = 0, newZero = 0, oldAbsSum = 0, newAbsSum = 0;
  let signCorrectOld = 0, signCorrectNew = 0;
  subset.forEach(({ text, expectedSign }) => {
    const words = (text.toLowerCase().match(WORD_RE) || []);
    const o = oldSum(words), n = newSum(words);
    if (o === 0) oldZero++;
    if (n === 0) newZero++;
    oldAbsSum += Math.abs(o);
    newAbsSum += Math.abs(n);
    if (Math.sign(o) === expectedSign || (o === 0 && expectedSign === 0)) signCorrectOld++;
    if (Math.sign(n) === expectedSign || (n === 0 && expectedSign === 0)) signCorrectNew++;
  });
  console.log(`\n  density=${density} (n=${subset.length}):`);
  console.log(`    zero-signal rate:      old=${(oldZero/subset.length*100).toFixed(1)}%  new=${(newZero/subset.length*100).toFixed(1)}%`);
  console.log(`    mean |magnitude|:       old=${(oldAbsSum/subset.length).toFixed(3)}  new=${(newAbsSum/subset.length).toFixed(3)}`);
  console.log(`    correct-sign rate:      old=${(signCorrectOld/subset.length*100).toFixed(1)}%  new=${(signCorrectNew/subset.length*100).toFixed(1)}%`);
});

// ─── 2) player.js's live per-word chord-tone-pull decision, stratified ──
console.log('\n\n=== 2) Per-word chord-tone-pull rate (player.js semantic stability), stratified ===');
densityBuckets.forEach(density => {
  const subset = CORPUS_V2.filter(c => c.density === density);
  let totalWords = 0, oldStable = 0, newStable = 0;
  subset.forEach(({ text }) => {
    const spans = deriveSemanticSpans(text);
    const tokens = tokenize(text).filter(t => t.type === 'word');
    let cursor = 0;
    tokens.forEach(tok => {
      totalWords++;
      const oldWeight = wordSentimentSign(tok.text); // wordEmotionWeight uses abs() internally; sign-agnostic here is fine for a >= THRESHOLD check
      const oldW = Math.abs(oldWeight);
      while (cursor < spans.length && tok.start >= spans[cursor].end) cursor++;
      const spanWeight = spans[cursor] && tok.start >= spans[cursor].start && tok.start < spans[cursor].end
        ? spans[cursor].weight : 0;
      const newW = Math.max(oldW, spanWeight);
      if (oldW >= THRESHOLD) oldStable++;
      if (newW >= THRESHOLD) newStable++;
    });
  });
  console.log(`  density=${density}: words=${totalWords}  old-stable-rate=${(oldStable/totalWords*100).toFixed(1)}%  new-stable-rate=${(newStable/totalWords*100).toFixed(1)}%  relative-change=${((newStable/oldStable - 1)*100).toFixed(0)}%`);
});

// ─── 3) Length-bucket cross-check: does the fix matter more for longer texts? ──
console.log('\n\n=== 3) Cross-tabulation: length bucket x density (mean |magnitude|, NEW method only) ===');
const lengthBuckets = ['1', '2', '3-4', '5-7', '8+'];
console.log('  length    ' + densityBuckets.map(d => d.padStart(12)).join(''));
lengthBuckets.forEach(lb => {
  const row = densityBuckets.map(density => {
    const subset = CORPUS_V2.filter(c => c.lengthBucket === lb && c.density === density);
    if (subset.length === 0) return 'n/a'.padStart(12);
    const mags = subset.map(({ text }) => {
      const words = (text.toLowerCase().match(WORD_RE) || []);
      return Math.abs(newSum(words)) / Math.max(1, words.length);
    });
    const mean = mags.reduce((a,b)=>a+b,0) / mags.length;
    return mean.toFixed(3).padStart(12);
  });
  console.log(`  ${lb.padEnd(9)} ${row.join('')}`);
});

console.log(`\n(corpus: ${CORPUS_V2.length} deliberately-stratified texts)`);

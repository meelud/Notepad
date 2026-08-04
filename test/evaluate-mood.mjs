/**
 * test/evaluate-mood.mjs
 * ─────────────────────────────────────────────────────────────────
 * Measures how well detectMood()'s normScore agrees with the
 * hand-labeled sentiment in eval-dataset.mjs. This is an evaluation
 * tool, not a training tool — it doesn't change the algorithm, it
 * just reports a real number instead of "it feels right."
 *
 * Usage: node test/evaluate-mood.mjs
 */
import { detectMood } from '../js/music/mood.js';
import { EVAL_DATASET } from './eval-dataset.mjs';

// normScore (roughly -1.5..1.5 after clamping) → same -2..2 label
// scale as the hand-labels. Thresholds are a deliberate, stated
// methodological choice — not tuned against this dataset.
function bucket(normScore) {
  if (normScore <= -0.9) return -2;
  if (normScore <= -0.25) return -1;
  if (normScore < 0.25) return 0;
  if (normScore < 0.9) return 1;
  return 2;
}

const LABELS = [-2, -1, 0, 1, 2];
const confusion = {};
LABELS.forEach(t => { confusion[t] = {}; LABELS.forEach(p => { confusion[t][p] = 0; }); });

let exact = 0;
let withinOne = 0;
const misses = [];

for (const [text, trueLabel] of EVAL_DATASET) {
  const { normScore } = detectMood(text);
  const predicted = bucket(normScore);
  confusion[trueLabel][predicted]++;

  if (predicted === trueLabel) exact++;
  if (Math.abs(predicted - trueLabel) <= 1) withinOne++;
  else misses.push({ text, trueLabel, predicted, normScore });
}

const n = EVAL_DATASET.length;
const exactAcc = (exact / n * 100).toFixed(1);
const withinOneAcc = (withinOne / n * 100).toFixed(1);

console.log(`\n=== Mood Detection Evaluation (n=${n}) ===\n`);
console.log(`Exact-match accuracy:      ${exactAcc}%  (${exact}/${n})`);
console.log(`Within-1-bucket accuracy:  ${withinOneAcc}%  (${withinOne}/${n})\n`);

console.log('Confusion matrix (rows = true label, cols = predicted):');
console.log('        ' + LABELS.map(l => String(l).padStart(5)).join(''));
LABELS.forEach(t => {
  console.log(String(t).padStart(6) + '  ' + LABELS.map(p => String(confusion[t][p]).padStart(5)).join(''));
});

console.log(`\nBig misses (off by 2+, ${misses.length} of them):`);
misses.forEach(m => {
  console.log(`  true=${m.trueLabel} pred=${m.predicted} (norm=${m.normScore.toFixed(2)})  "${m.text}"`);
});
console.log();

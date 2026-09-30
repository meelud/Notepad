/**
 * Invariants of the AROUSAL channel (Russell 1980 circumplex, second axis):
 * detectMood().arousalScore -> rhythm.js pacingFactorFor / wordDurationMs.
 * Properties of the mapping, not fitted to a dataset.
 *
 *   node test/arousal-test.mjs
 */
import { detectMood } from '../js/music/mood.js';
import { pacingFactorFor, wordDurationMs } from '../js/music/rhythm.js';

let fails = 0;
const check = (name, ok, detail = '') => { if (!ok) fails++; console.log(`${ok ? ' ok ' : 'FAIL'}  ${name}${ok ? '' : '  → ' + detail}`); };
const A = t => detectMood(t).arousalScore;

// 1. pacing law: neutral is unchanged, monotone, bounded, wide enough to hear
check('neutral arousal leaves tempo unchanged', pacingFactorFor(0) === 1);
{
  let bad = null, prev = Infinity;
  for (let a = -1.5; a <= 2.5001; a += 0.05) { const f = pacingFactorFor(a); if (f > prev + 1e-12) bad ??= a.toFixed(2); prev = f; }
  check('more arousal never slows the piece', !bad, `at arousal ${bad}`);
}
{
  const fast = 1 / pacingFactorFor(1e9), slow = 1 / pacingFactorFor(-1e9);
  check('tempo range is clamped (no runaway on extreme scores)', fast <= 1.6 && slow >= 0.75, `${slow.toFixed(2)}x..${fast.toFixed(2)}x`);
  check('extremes differ by > 1.5x, well above the ~1.1x tempo JND', fast / slow > 1.5, (fast / slow).toFixed(2));
}
check('a high-arousal word is planned shorter than a low-arousal one', wordDurationMs(6, 1, false) < wordDurationMs(6, -0.5, false));
check('cadence words stay longer at every arousal', [-0.5, 0, 1].every(a => wordDurationMs(6, a, true) > wordDurationMs(6, a, false)));

// 2. ordering of emotions on the arousal axis
const anger = A('I am furious and enraged'), joy = A('I am so happy and excited'), neutral = A('The meeting is at three o clock'),
      sad = A('I am sad and lonely'), calm = A('I feel calm and peaceful');
check('anger > joy > neutral', anger > joy && joy > neutral, `${anger.toFixed(2)} ${joy.toFixed(2)} ${neutral.toFixed(2)}`);
check('neutral > sadness and neutral > calm', neutral > sad && neutral > calm, `${neutral.toFixed(2)} ${sad.toFixed(2)} ${calm.toFixed(2)}`);
check('neutral text has zero arousal', neutral === 0);

// 3. punctuation cues and negation
check('"!" raises arousal', A('I am so happy!!') > A('I am so happy'));
check('trailing ellipsis lowers arousal', A('I am so tired...') < A('I am so tired'));
check('a negated emotion is no evidence of its activation ("not furious" is not calm)', A('I am not furious') <= 0 + 1e-9 && A('I am not furious') > A('I feel calm and peaceful'));

// 4. end to end: sad text plays slower than excited text
const dur = t => wordDurationMs(6, A(t), false);
check('sad text plans longer words than joyful text', dur('I am sad and lonely') > dur('I am so happy and excited!!'));

console.log(fails ? `\n${fails} FAILED` : '\nall arousal invariants hold');
process.exit(fails ? 1 : 0);

/**
 * Invariants of the AROUSAL channel (Russell 1980 circumplex, second axis):
 * detectMood().arousalScore -> rhythm.js pacingFactorFor / wordDurationMs.
 * Properties of the mapping, not fitted to a dataset.
 *
 *   node test/arousal-test.mjs
 */
import { detectMood } from '../js/music/mood.js';
import { pacingFactorFor, saturateArousal, wordDurationMs, TEMPO_CEILING } from '../js/music/rhythm.js';
import { tokenize } from '../js/utils/text.js';

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

// 1b. the saturating law: strictly monotone, bounded, and still audible
//     at the top. The old law hard-clipped at arousal 1.0, so 1.13 and
//     2.90 planned the identical 451.7 ms for a 6-letter word.
{
  let bad = null, prev = Infinity;
  for (let a = 0; a <= 3.0001; a += 0.001) { const f = pacingFactorFor(a); if (f > prev + 1e-12) { bad = a.toFixed(3); break; } prev = f; }
  check('strictly monotone across the whole real range [0, 3]', bad === null, `rises again at ${bad}`);
}
check('pacing(2.9) < pacing(1.13) — the clip no longer flattens real scores', pacingFactorFor(2.9) < pacingFactorFor(1.13),
  `${pacingFactorFor(1.13).toFixed(4)} vs ${pacingFactorFor(2.9).toFixed(4)}`);
check('the difference is audible, not just sign-correct (>= 1% on a 6-letter word)',
  (wordDurationMs(6, 1.13, false) - wordDurationMs(6, 2.9, false)) / wordDurationMs(6, 1.13, false) >= 0.01,
  `${((wordDurationMs(6, 2.9, false) / wordDurationMs(6, 1.13, false) - 1) * 100).toFixed(1)}%`);
{
  let over = null;
  for (let a = 0; a <= 20; a += 0.01) if (1 / pacingFactorFor(a) > TEMPO_CEILING + 1e-12) { over = a; break; }
  check(`tempo never exceeds the 2^0.55 = ${TEMPO_CEILING.toFixed(2)}x ceiling, however extreme`, over === null, `exceeded at a=${over}`);
}
check('the law asymptotes rather than growing without bound', Math.abs(1 / pacingFactorFor(1e9) - TEMPO_CEILING) < 1e-9,
  (1 / pacingFactorFor(1e9)).toFixed(4));
{
  // slope near neutral is what makes small arousal differences audible
  const slope0 = Math.abs((pacingFactorFor(0.01) - pacingFactorFor(0)) / 0.01);
  check('tempo still responds near neutral (no dead zone at a=0)', slope0 > 0.1, slope0.toFixed(3));
}
check('calm side keeps its floor: grief and deeper calm plan the same length',
  wordDurationMs(6, -0.6, false) === wordDurationMs(6, -3, false) && saturateArousal(-3) === -0.6);

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

// 4b. length-controlled end to end. Raw ms/word is confounded by word
//     length and by punctuation pauses, which is what made a naive
//     measurement claim excited text was SLOWER than angry text. Hold
//     the letter count fixed and compare only the pacing factor's effect.
{
  // same words, same length; only the arousal differs
  // Same 12 words, same 40 letters. "furious!!!!" is 7 letters against
  // "calm" at 4, so the calm variant swaps "okay" (4) for "totally" (7)
  // — arousal is then the only difference between the two texts.
  const angry = 'I am furious!!!! and I hate this so much right now okay';
  const calm = 'I am calm, and I hate this so much right now totally';
  const angA = A(angry), calmA = A(calm);
  const angW = tokenize(angry).filter(t => t.type === 'word');
  const calmW = tokenize(calm).filter(t => t.type === 'word');
  const letters = w => w.reduce((a, t) => a + (t.text.match(/[\p{L}\p{N}]/gu) || []).length, 0);
  check('the two control texts really do have equal word count', angW.length === calmW.length, `${angW.length} vs ${calmW.length}`);
  check('they also have equal total letters, so only arousal differs', letters(angW) === letters(calmW), `${letters(angW)} vs ${letters(calmW)}`);
  check('the shouted text does score higher arousal', angA > calmA, `${angA.toFixed(2)} vs ${calmA.toFixed(2)}`);
  check('so at equal length the shouted text plans a shorter word', wordDurationMs(6, angA, false) < wordDurationMs(6, calmA, false),
    `${wordDurationMs(6, angA, false).toFixed(1)}ms vs ${wordDurationMs(6, calmA, false).toFixed(1)}ms`);
  // and the same holds for the virtual timeline the player actually uses
  const totalMs = (text, a) => tokenize(text).filter(t => t.type === 'word')
    .reduce((s, t) => s + wordDurationMs((t.text.match(/[\p{L}\p{N}]/gu) || []).length || 1, a, false), 0);
  check('total planned word time is shorter for the same text shouted',
    totalMs(angry, angA) < totalMs(angry, calmA),
    `${totalMs(angry, angA).toFixed(0)}ms vs ${totalMs(angry, calmA).toFixed(0)}ms`);
}

console.log(fails ? `\n${fails} FAILED` : '\nall arousal invariants hold');
process.exit(fails ? 1 : 0);

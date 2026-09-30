/**
 * The arousal value must actually reach the timeline in the REAL pipeline.
 *
 * The sim-vs-play parity test cannot catch this: player-sim.mjs and
 * player.js both call wordDurationMs(), so if player.js passed a stale or
 * zero sessionArousalScore, both would agree with each other and the
 * parity test would stay green while every piece played at the wrong
 * tempo.
 *
 * So compare the real play()'s word onsets against the formula computed
 * independently from rhythm.js. Playback adds a documented non-
 * accumulating humanising offset of rnd(-28, 28) per onset, so a word's
 * onset may sit up to 28 ms either side of its plan; anything beyond that
 * is a real divergence.
 *
 *   node --import ./test/harness/register.mjs test/timeline-formula-test.mjs
 */
import { runPlay } from './harness/run-play.mjs';
import { detectMood } from '../js/music/mood.js';
import { tokenize } from '../js/utils/text.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The tempo and dynamics laws are re-implemented here from their
// specifications rather than imported. Importing wordDurationMs /
// pacingFactorFor / velocityRange from js/ would make this test
// tautological: if player.js passed the wrong score, and this file
// computed its expectation from the same helpers, both would move
// together and the assertion would still pass. The constants below are
// transcribed from each module's documented law and are the only thing
// in this file allowed to define the expected values.
const TEMPO_EXPONENT = 0.55;
const CALM_FLOOR = -0.6;
const PAUSE_FLOOR = 0.5;
const DYNAMICS_EXPONENT = 0.62;
const DYNAMICS_CALM_SATURATION = -0.42;
// FLOOR_RISE per window, from dynamics.js
const FLOOR_RISE_WORD = 0.4557;
const FLOOR_RISE_CADENCE = 0.6640;
const NEUTRAL_WORD = [0.18, 0.52];
const NEUTRAL_CADENCE = [0.20, 0.40];

function expectedPacingFactor(arousal) {
  const s = arousal >= 0 ? Math.tanh(arousal) : Math.max(arousal, CALM_FLOOR);
  return Math.pow(2, -TEMPO_EXPONENT * s);
}
function expectedWordMs(letters, arousal, isCadence) {
  const base = (380 + letters * 42) * expectedPacingFactor(arousal);
  return (isCadence ? base * 1.2 : base) + 20;
}
const NOMINAL_PAUSE = { '.': 420, '?': 380, '؟': 380, '!': 340, ',': 200, '،': 200 };
function expectedPauseMs(ch, arousal) {
  const nominal = NOMINAL_PAUSE[ch] ?? 150;
  return nominal * Math.max(PAUSE_FLOOR, expectedPacingFactor(arousal));
}

/** gain window player.js will draw its loudness from */
function expectedVelocityRange(arousal, isCadence) {
  const [lo, hi] = isCadence ? NEUTRAL_CADENCE : NEUTRAL_WORD;
  if (arousal > 0) {
    const k = isCadence ? FLOOR_RISE_CADENCE : FLOOR_RISE_WORD;
    return { lo: lo + (hi - lo) * k * Math.tanh(arousal), hi };
  }
  if (arousal < 0) {
    const s = Math.max(arousal, DYNAMICS_CALM_SATURATION);
    const k = Math.pow(2, DYNAMICS_EXPONENT * s);
    return { lo: lo * k, hi: hi * k };
  }
  return { lo, hi };
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HUMANISE_MS = 28;   // player.js: rnd(-28, 28) on each onset
const TOL = HUMANISE_MS + 0.5;

/** Word onsets the formula predicts, from the text alone. */
function plannedOnsets(text, arousal) {
  const toks = tokenize(text).filter(t => t.type === 'word' || t.type === 'punct');
  const onsets = [];
  let ms = 0;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.type === 'punct') { ms += expectedPauseMs(t.text, arousal); continue; }
    onsets.push(ms);
    const letters = (t.text.match(/[\p{L}\p{N}]/gu) || []).length || 1;
    const next = toks[i + 1];
    const isCadence = !!(next && next.type === 'punct' && ['.', '!', '?', '؟'].includes(next.text));
    ms += expectedWordMs(letters, arousal, isCadence);
  }
  return onsets;
}

// A pair that differs ONLY in arousal: 12 words, 40 letters each, so any
// difference in timing has to come from the arousal term and nothing else.
const CASES = [
  ['shouted', 'I am furious!!!! and I hate this so much right now okay'],
  ['calm', 'I am calm, and I hate this so much right now totally'],
  ['plain', 'The meeting is at three o clock and it starts on time'],
];

let fails = 0;
const check = (name, ok, detail = '') => { if (!ok) fails++; console.log(`${ok ? ' ok ' : 'FAIL'}  ${name}${ok ? '' : '  → ' + detail}`); };

for (const [label, text] of CASES) {
  const arousal = detectMood(text).arousalScore;
  const expected = plannedOnsets(text, arousal);
  const trace = await runPlay(root, text, { jitterSeed: 3, jitterMax: 0 });

  check(`${label}: play() produced one decision per word`, trace.length === expected.length,
    `play=${trace.length} formula=${expected.length}`);
  if (trace.length !== expected.length) continue;

  // the trace records absolute fake-clock time; the first note is the
  // origin, so compare relative to it
  const t0 = trace[0].t;
  let maxDev = 0, worst = -1;
  for (let i = 0; i < trace.length; i++) {
    const dev = (trace[i].t - t0) - expected[i];
    if (Math.abs(dev) > Math.abs(maxDev)) { maxDev = dev; worst = i; }
  }
  check(`${label}: real play() onsets track the formula (arousal=${arousal.toFixed(3)}, factor=${expectedPacingFactor(arousal).toFixed(3)})`,
    Math.abs(maxDev) <= TOL,
    `worst word #${worst} off by ${maxDev.toFixed(1)}ms (>${TOL})`);

  // Guard the specific failure mode: a stale or zeroed arousal would make
  // playback ignore the arousal term entirely and run at the neutral
  // factor. Compare the played span with what each hypothesis predicts,
  // allowing for the humanising offset on the final onset — and only when
  // the two hypotheses are further apart than that noise, since at low
  // arousal the gap is smaller than the jitter and the sign is meaningless.
  const last = trace[trace.length - 1].t - t0;
  const atThisArousal = expected.at(-1);
  const atNeutral = plannedOnsets(text, 0).at(-1);
  const gap = Math.abs(atThisArousal - atNeutral);
  const noise = 2 * HUMANISE_MS;

  if (gap > noise) {
    const correct = arousal > 0 ? last < atNeutral : last > atNeutral;
    check(`${label}: played at arousal ${arousal.toFixed(2)}, not at neutral (gap ${(gap / 1000).toFixed(2)}s > ${(noise / 1000).toFixed(2)}s noise)`,
      correct, `played ${last.toFixed(0)}ms, neutral ${atNeutral.toFixed(0)}ms, own-arousal ${atThisArousal.toFixed(0)}ms`);
  } else {
    console.log(`      skipped neutral-vs-arousal sign check: gap ${gap.toFixed(0)}ms is within the ${noise}ms onset noise`);
  }
  console.log(`      planned end ${atThisArousal.toFixed(0)}ms, played end ${last.toFixed(0)}ms, max|dev| ${maxDev.toFixed(1)}ms`);
}

console.log(fails ? `\n${fails} FAILED` : '\nreal play() timeline matches the arousal formula');
process.exit(fails ? 1 : 0);

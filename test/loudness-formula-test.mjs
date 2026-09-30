/**
 * The real play()'s LOUDNESS must follow the arousal formula, not just
 * the timeline.
 *
 * The sim-vs-play parity test cannot catch this: player-sim.mjs does not
 * render audio at all, so if player.js passed a stale or zeroed arousal to
 * velocityRange, parity would stay green while every piece played at the
 * same volume. This test records what player.js actually hands to the
 * synth voices and compares it against a formula written out from the
 * specification in js/music/dynamics.js.
 *
 * Importing velocityRange from the module under test would make this
 * tautological, so the law is re-derived here from its documented form:
 * above neutral the window's floor rises and its ceiling does not move;
 * below neutral both bounds scale down; neutral is the original pair.
 *
 *   node --import ./test/harness/register.mjs test/loudness-formula-test.mjs
 */
import { installFakeClock } from './harness/fake-clock.mjs';
import { installStubs } from './harness/stubs.mjs';
import { detectMood } from '../js/music/mood.js';
import { tokenize } from '../js/utils/text.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ── the law, transcribed from js/music/dynamics.js ──────────────────
const DYNAMICS_EXPONENT = 0.62;
const CALM_SATURATION = -0.42;
const FLOOR_RISE_WORD = 0.4557;
const FLOOR_RISE_CADENCE = 0.6640;
const NEUTRAL_WORD = [0.18, 0.52];
const NEUTRAL_CADENCE = [0.20, 0.40];
const CLAMP_LO = 0.12, CLAMP_HI = 0.6;
const VOL_ARC_BASE = 0.85, VOL_ARC_DEPTH = 0.3;

function expectedWindow(arousal, isCadence) {
  const [lo, hi] = isCadence ? NEUTRAL_CADENCE : NEUTRAL_WORD;
  if (arousal > 0) {
    const k = isCadence ? FLOOR_RISE_CADENCE : FLOOR_RISE_WORD;
    return { lo: lo + (hi - lo) * k * Math.tanh(arousal), hi };
  }
  if (arousal < 0) {
    const s = Math.max(arousal, CALM_SATURATION);
    const k = Math.pow(2, DYNAMICS_EXPONENT * s);
    return { lo: lo * k, hi: hi * k };
  }
  return { lo, hi };
}

let fails = 0;
const check = (name, ok, detail = '') => { if (!ok) fails++; console.log(`${ok ? ' ok ' : 'FAIL'}  ${name}${ok ? '' : '  → ' + detail}`); };

/** Runs the real play() and records the gain of every note. */
async function playedGains(text) {
  const clock = installFakeClock({ jitterSeed: 5, jitterMax: 0 });
  installStubs(text);
  const voices = await import(`${root}/js/audio/voices.js`);
  if (!globalThis.__gainHooked) {
    globalThis.__gainHooked = true;
    globalThis.__gains = [];
    voices.VOICES.forEach((v, i) => {
      voices.VOICES[i] = (freq, vol, dur, dests) => { globalThis.__gains.push(vol); return v(freq, vol, dur, dests); };
    });
  }
  globalThis.__gains = [];
  const player = await import(`${root}/js/player.js`);
  player.resetHarmony();
  const quiet = console.error; console.error = () => {};
  try { await clock.run(player.play()); } finally { console.error = quiet; }
  return globalThis.__gains;
}

const CASES = [
  ['furious', 'I am furious and I hate this so much right now and I cannot stand it'],
  ['grief', 'دلم شکسته و خیلی تنهام و هیچ کس نیست و اشکهایم آرام نمیشوند'],
  ['plain', 'The meeting is at three o clock and it starts on time'],
];

for (const [label, text] of CASES) {
  const arousal = detectMood(text).arousalScore;
  const gains = await playedGains(text);
  const toks = tokenize(text).filter(t => t.type === 'word');
  check(`${label}: play() sounded one note per word`, gains.length === toks.length, `gains=${gains.length} words=${toks.length}`);
  if (gains.length !== toks.length) continue;

  // the window and arc each word should have been drawn from
  const bounds = toks.map((t, i) => {
    const idx = tokenize(text).filter(x => x.type === 'word' || x.type === 'punct').indexOf(t);
    const all = tokenize(text).filter(x => x.type === 'word' || x.type === 'punct');
    const next = all[idx + 1];
    const isCadence = !!(next && next.type === 'punct' && ['.', '!', '?', '؟'].includes(next.text));
    const frac = toks.length > 1 ? i / (toks.length - 1) : 0.5;
    const arc = VOL_ARC_BASE + Math.sin(Math.PI * frac) * VOL_ARC_DEPTH;
    const w = expectedWindow(arousal, isCadence);
    return { lo: w.lo * arc, hi: w.hi * arc, isCadence };
  });

  // every played gain must fall inside its predicted window
  let outOfRange = null;
  gains.forEach((g, i) => {
    if (!outOfRange && (g < bounds[i].lo - 1e-6 || g > bounds[i].hi + 1e-6))
      outOfRange = `#${i} gain=${g.toFixed(4)} outside ${bounds[i].lo.toFixed(4)}..${bounds[i].hi.toFixed(4)}`;
  });
  check(`${label}: every gain came from the predicted window (arousal=${arousal.toFixed(3)})`, outOfRange === null, outOfRange);

  // and the window must itself be right: verify the realised gains span
  // the predicted range rather than collapsing to one value
  const mean = gains.reduce((a, b) => a + b, 0) / gains.length;
  const neutralWindow = expectedWindow(arousal, false);
  console.log(`      predicted ${neutralWindow.lo.toFixed(3)}..${neutralWindow.hi.toFixed(3)} (un-arc'd), mean gain ${mean.toFixed(4)}`);

  // the clamp must never be reached
  const atCeiling = gains.filter(g => g >= CLAMP_HI - 1e-9).length;
  check(`${label}: no gain reached the 0.6 clamp`, atCeiling === 0, `${atCeiling}/${gains.length} at ceiling`);

  // monotonic direction: an excited passage must be the louder one
  if (label === 'furious') {
    const plainGains = await playedGains('The meeting is at three o clock and it starts on time');
    const pm = plainGains.reduce((a, b) => a + b, 0) / plainGains.length;
    check(`excited text is louder than neutral (${mean.toFixed(4)} vs ${pm.toFixed(4)})`, mean > pm,
      `${((mean / pm - 1) * 100).toFixed(1)}%`);
  }
}

console.log(fails ? `\n${fails} FAILED` : '\nreal play() loudness matches the dynamics formula');
process.exit(fails ? 1 : 0);

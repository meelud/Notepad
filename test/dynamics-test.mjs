/**
 * Invariants of music/dynamics.js: loudness and articulation as a
 * function of arousal. Pure functions, no DOM, no rng — the caller draws
 * within the returned ranges from the RENDER stream.
 *
 * These are properties of the mapping over a grid, not fitted to a
 * dataset. Loudness and articulation are the two strongest non-pitch
 * arousal cues in music (Juslin & Laukka 2003), so the mapping has to
 * be monotone and bounded to be usable at all.
 *
 *   node test/dynamics-test.mjs
 */
import {
  dynamicsFor, saturateDynamics, velocityRange, lengthRange,
  DYNAMICS_EXPONENT, DYNAMICS_CEILING, DYNAMICS_FLOOR,
} from '../js/music/dynamics.js';
import { detectMood } from '../js/music/mood.js';
import { wordDurationMs, pacingFactorFor } from '../js/music/rhythm.js';

let fails = 0;
const check = (name, ok, detail = '') => { if (!ok) fails++; console.log(`${ok ? ' ok ' : 'FAIL'}  ${name}${ok ? '' : '  → ' + detail}`); };

// 1. the multiplier: neutral unchanged, monotone, bounded
check('neutral arousal leaves dynamics untouched', dynamicsFor(0) === 1);
{
  // monotone where the law actually responds. Below CALM_SATURATION
  // (-0.42) the curve is deliberately flat: grief and deeper calm are
  // told apart by tempo, not by pushing volume further down.
  let bad = null, prev = -Infinity;
  for (let a = -0.42; a <= 3.0001; a += 0.001) {
    const d = dynamicsFor(a);
    if (d <= prev + 1e-12) { bad = a.toFixed(3); break; }
    prev = d;
  }
  check('strictly monotone over the responsive range [-0.42, 3]', bad === null, `flat at ${bad}`);
}
{
  let over = null, under = null;
  for (let a = -5; a <= 20; a += 0.01) {
    const d = dynamicsFor(a);
    if (d > DYNAMICS_CEILING + 1e-12 && over === null) over = a;
    if (d < DYNAMICS_FLOOR - 1e-12 && under === null) under = a;
  }
  check(`never louder than the ${DYNAMICS_CEILING.toFixed(2)}x ceiling, however extreme`, over === null, `exceeded at a=${over}`);
  check(`never quieter than the ${DYNAMICS_FLOOR}x floor`, under === null, `dropped below at a=${under}`);
  check('the law asymptotes rather than growing without bound', Math.abs(dynamicsFor(1e9) - DYNAMICS_CEILING) < 1e-9, dynamicsFor(1e9).toFixed(4));
  check('it still responds near neutral (no dead zone)', Math.abs((dynamicsFor(0.01) - 1) / 0.01) > 0.1, Math.abs((dynamicsFor(0.01) - 1) / 0.01).toFixed(3));
}
check('the calm side saturates on a floor, like tempo does',
  saturateDynamics(-5) === saturateDynamics(-0.42) && dynamicsFor(-5) === dynamicsFor(-0.42));

// 2. velocity: above neutral the floor rises and the ceiling does not
//    move, so a loud passage gains median without ever gaining peak
{
  const cases = [false, true];
  for (const cad of cases) {
    const label = cad ? 'cadence' : 'non-cadence';
    const neutral = velocityRange(0, cad);
    check(`${label}: neutral is exactly the old hard-coded window`,
      Math.abs(neutral.lo - (cad ? 0.20 : 0.18)) < 1e-12 && Math.abs(neutral.hi - (cad ? 0.40 : 0.52)) < 1e-12,
      JSON.stringify(neutral));

    // the ceiling is what clips, so it must never move
    let topMoved = null;
    for (let a = 0; a <= 3.0001; a += 0.01) {
      if (velocityRange(a, cad).hi > neutral.hi + 1e-12) { topMoved = a.toFixed(2); break; }
    }
    check(`${label}: the top of the window never rises (this is what avoided the clamp)`, topMoved === null, `hi moved at a=${topMoved}`);

    let floorBad = null;
    for (let a = 0; a <= 3.0001; a += 0.01) {
      if (velocityRange(a, cad).lo < neutral.lo - 1e-12) { floorBad = a.toFixed(2); break; }
    }
    check(`${label}: the floor rises monotonically above neutral`, floorBad === null, `lo fell at a=${floorBad}`);

    check(`${label}: excited is louder in the median`, (velocityRange(1.13, cad).lo + velocityRange(1.13, cad).hi) / 2 > (neutral.lo + neutral.hi) / 2);
    check(`${label}: calm is quieter in both bounds`, velocityRange(-0.62, cad).lo < neutral.lo && velocityRange(-0.62, cad).hi < neutral.hi);

    // the acceptance criterion: worst-case draw must stay under the 0.6
    // clamp in player.js, including the widest phrase arc (volArc 1.15)
    let worst = 0;
    for (let a = 0; a <= 3.0001; a += 0.01) worst = Math.max(worst, velocityRange(a, cad).hi * 1.15);
    check(`${label}: the loudest possible draw stays under the 0.6 clamp`, worst < 0.6, `worst=${worst.toFixed(4)}`);
  }
}

// 3. articulation: excitement detaches, calm sustains, never inverts
{
  for (const cad of [false, true]) {
    const label = cad ? 'cadence' : 'non-cadence';
    const neutral = lengthRange(0, cad);
    check(`${label}: neutral is exactly the old hard-coded window`,
      Math.abs(neutral.lo - (cad ? 0.45 : 0.22)) < 1e-12 && Math.abs(neutral.hi - (cad ? 0.75 : 0.45)) < 1e-12,
      JSON.stringify(neutral));
    check(`${label}: excited notes are shorter (more detached)`, lengthRange(1.13, cad).hi < neutral.hi);
    check(`${label}: calm notes are longer (more sustained)`, lengthRange(-0.62, cad).lo > neutral.lo);
    let bad = null;
    for (let a = -1.5; a <= 3.0001; a += 0.01) {
      const l = lengthRange(a, cad);
      if (l.lo > l.hi + 1e-12 || l.lo <= 0) { bad = `a=${a.toFixed(2)}`; break; }
    }
    check(`${label}: length window stays ordered and positive`, bad === null, bad);
    // the two cues must move in opposite directions, or they cancel
    check(`${label}: louder and shorter at once (the two cues reinforce)`,
      velocityRange(1.13, cad).lo > velocityRange(0, cad).lo && lengthRange(1.13, cad).hi < lengthRange(0, cad).hi);
  }
}

// 4. real texts: the mapping separates the emotions a listener would
//    name as opposites, and leaves neutral text alone
{
  const loud = detectMood('I am so furious!!! I hate everything about this!!!').arousalScore;
  const quiet = detectMood('دلم شکسته و خیلی تنهام. هیچ‌کس نیست. اشک‌هایم آرام نمی‌شوند.').arousalScore;
  const calm = detectMood('کنار دریا نشسته بودم و آرامش داشتم. هیچ عجله‌ای نبود.').arousalScore;
  const neutral = detectMood('The meeting is at three o clock and it starts on time').arousalScore;

  check('furious text is louder than grief text', dynamicsFor(loud) > dynamicsFor(quiet),
    `${dynamicsFor(loud).toFixed(3)} vs ${dynamicsFor(quiet).toFixed(3)} (a=${loud.toFixed(2)}/${quiet.toFixed(2)})`);
  check('grief is quieter than neutral', dynamicsFor(quiet) < 1, dynamicsFor(quiet).toFixed(3));
  check('furious is louder than neutral', dynamicsFor(loud) > 1, dynamicsFor(loud).toFixed(3));
  // Calm and grief both sit below neutral, so both are quieter than
  // neutral text. What matters is that they are not the SAME: calm
  // (a≈-0.5) must stay louder than grief (a≈-0.73), i.e. the mapping
  // still resolves the difference even though both are on the quiet
  // side of the floor.
  check('peaceful stays distinct from grief (both quiet, but not identical)', dynamicsFor(calm) > dynamicsFor(quiet),
    `calm ${dynamicsFor(calm).toFixed(3)} vs grief ${dynamicsFor(quiet).toFixed(3)}`);
  check('neutral text is left exactly alone', dynamicsFor(neutral) === 1 && velocityRange(neutral, false).lo === 0.18);
  console.log(`      grief a=${quiet.toFixed(2)} k=${dynamicsFor(quiet).toFixed(3)}   furious a=${loud.toFixed(2)} k=${dynamicsFor(loud).toFixed(3)}`);
}

// 5. dynamics and tempo must not fight each other: both say "faster" or
//    "slower" at the same time, or the piece contradicts itself
{
  let bad = null;
  for (let a = -0.6; a <= 3.0001; a += 0.05) {
    const tempoFaster = pacingFactorFor(a) < 1;
    const dynamicsLouder = dynamicsFor(a) > 1;
    if (tempoFaster !== dynamicsLouder) { bad = `a=${a.toFixed(2)}: tempo ${pacingFactorFor(a).toFixed(3)}, dynamics ${dynamicsFor(a).toFixed(3)}`; break; }
  }
  check('tempo and dynamics never point in opposite directions', bad === null, bad);
}

// 6. the module must stay pure — no stream, no rng, no globals
{
  const src = await import('node:fs').then(fs => fs.readFileSync(new URL('../js/music/dynamics.js', import.meta.url), 'utf8'));
  check('does not import utils/rng.js', !/from\s+['"].*rng\.js['"]/.test(src));
  // strip comments first: the file's doc comment legitimately names
  // AudioContext and window in prose, which is not a dependency
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  check('executable code touches neither the DOM nor AudioContext', !/document|AudioContext|AudioNode|window\./.test(code));
  check('exports no rng-consuming function', !/export function \w*\([^)]*\)\s*\{[^}]*\brnd\(|\brpick\(|\barnd\(|\bapick\(/.test(src));
}

console.log(fails ? `\n${fails} FAILED` : '\nall dynamics invariants hold');
process.exit(fails ? 1 : 0);

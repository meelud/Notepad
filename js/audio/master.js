/**
 * js/audio/master.js
 * ─────────────────────────────────────────────────────────────────
 * The master bus: everything audible (word voices, ambient bed, punctuation,
 * reverb return) is summed here and goes through two stages before it reaches
 * the speakers AND the recorder tap:
 *
 *   input → makeup gain → soft-knee ceiling (WaveShaper, 4× oversampled) → outs
 *
 * Why these two stages and not a compressor — decided from measurement, not
 * assumption (tools/mix-report.mjs, 8 texts, English + Persian, real play()
 * rendered offline, master bypassed; the makeup gain below has since been retuned):
 *   • nothing clipped: peaks −3.9 … −9.0 dBFS, so there was no clipping to cure;
 *   • but the pieces were quiet: integrated loudness −19.1 … −21.7 LUFS (mean
 *     −20.5), with a crest factor of 14–18 dB;
 *   • so the useful job is makeup gain with a guaranteed ceiling. Peaks are rare
 *     (a few voices landing together), which a stateless shaper handles without
 *     the pumping a feed-forward compressor would add to sparse, quiet ambient
 *     material — and without DynamicsCompressorNode's automatic makeup gain,
 *     whose amount differs by threshold/ratio and is not stated in any one place.
 *
 * Stateless means deterministic and identical in every browser: no attack or
 * release, no lookahead, no randomness, and no draw from either rng stream, so
 * the melodic and render streams (and every parity / determinism test) are
 * untouched.
 *
 * Curve (odd-symmetric, continuous in value AND slope at the knee):
 *     |x| ≤ KNEE :  y = x
 *     |x| >  KNEE:  y = KNEE + (CEILING − KNEE) · tanh((|x| − KNEE) / (CEILING − KNEE))
 * so the TABLE never outputs more than CEILING however hot the sum gets, and
 * everything under KNEE passes unchanged (apart from the oversampling filter).
 *
 * What the ceiling does and does not promise, as measured offline with
 * tools/render-offline.mjs: at the shipped makeup (+4 dB) the loudest of the 8
 * corpus texts peaks at −1.2 dBFS (true-peak estimate −1.2), under the −1 dBFS
 * ceiling. Under absurd drive (+20 dB) the oversampling filter's ringing lets the
 * sample peak reach −0.7 dBFS, ≈ 0.3 dB over the ceiling, and still below 0 dBFS
 * (no sample ≥ 0.999). The ceiling is therefore "−1 dBFS, plus up to a few tenths
 * of a dB of filter overshoot when driven absurdly hard" — not a brickwall.
 * With oversample 'none' the sample peak sits exactly on the ceiling but the
 * inter-sample peak is higher (−0.6 dBFS), so oversampling is kept for its lower
 * aliasing.
 */
import { ac } from './context.js';

export const MASTER_BUS_ENABLED = true;

// Makeup gain in dB. First set to +4 from the corpus numbers above (mean ≈ −20.5 →
// ≈ −16.5 LUFS-I); then the melody got a +3 dB foreground offset (register-comp.js),
// which brought the corpus mean to −15.6, a little above the usual −16…−18 ambient
// range. Compared by ear at +4 and +3, +3 was preferred, so it is +3 now: corpus mean
// −16.6 LUFS-I (texts from −15.3 to −19.1), worst true peak −1.2 dBTP.
// Raise it for louder pieces; the ceiling keeps it safe, at the cost of more shaping
// on the loudest peaks.
export const MASTER_GAIN_DB = 3;

export const MASTER_CEILING = Math.pow(10, -1 / 20);   // −1 dBFS ≈ 0.891
export const MASTER_KNEE = Math.pow(10, -4 / 20);      // −4 dBFS ≈ 0.631: below this, untouched

// The shaper sees the signal pre-attenuated by SHAPER_RANGE so its curve covers
// ±SHAPER_RANGE instead of ±1 — WebAudio clamps WaveShaper input at ±1, and the
// sum after makeup can exceed that. Output is restored by the curve itself.
const SHAPER_RANGE = 2;

/** y = f(x) as defined in the header. Pure; exported for the test. */
export function softCeiling(x, knee = MASTER_KNEE, ceiling = MASTER_CEILING) {
  const a = Math.abs(x);
  if (a <= knee) return x;
  const r = ceiling - knee;
  return Math.sign(x) * (knee + r * Math.tanh((a - knee) / r));
}

/** WaveShaper table covering u ∈ [−1, 1], i.e. x = u · SHAPER_RANGE. */
export function buildCurve(n = 8193, knee = MASTER_KNEE, ceiling = MASTER_CEILING) {
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) c[i] = softCeiling(((i / (n - 1)) * 2 - 1) * SHAPER_RANGE, knee, ceiling);
  return c;
}

let cachedCurve = null;

/**
 * Builds one master bus for a piece.
 * @param {AudioNode[]} outs   final destinations (speakers, recorder tap)
 * @returns {{input: AudioNode}}
 *          Everything that used to connect to `outs` connects to `input`.
 *          There is deliberately no teardown: notes already sounding keep
 *          ringing through their reverb tails after stop() (as they did before
 *          this bus existed), and a bus whose sources have all ended and that
 *          nothing references is garbage-collected by the browser.
 */
export function createMasterBus(outs) {
  const c = ac();
  const bypass = !MASTER_BUS_ENABLED || globalThis.__NOTEPAD_NO_MASTER__ === true;
  const input = c.createGain();
  if (bypass) {
    outs.forEach(o => input.connect(o));
  } else {
    const db = typeof globalThis.__NOTEPAD_MASTER_DB__ === 'number' ? globalThis.__NOTEPAD_MASTER_DB__ : MASTER_GAIN_DB;
    input.gain.value = Math.pow(10, db / 20) / SHAPER_RANGE;
    const shaper = c.createWaveShaper();
    cachedCurve = cachedCurve || buildCurve();
    shaper.curve = cachedCurve;
    shaper.oversample = '4x';
    input.connect(shaper);
    outs.forEach(o => shaper.connect(o));
  }
  return { input };
}

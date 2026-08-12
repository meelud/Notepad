/**
 * js/audio/reverb-math.js
 * Pure, dependency-free reverb mathematics.
 * Everything here is a deterministic function of its inputs — no
 * window/AudioContext, no shared RNG state — so it can be unit-tested
 * under plain Node (see test/reverb-math.mjs).
 *
 * A reverb space is defined by a PROFILE baked from four perceptual
 * drivers:
 *   • mood   (normScore, -1.5 dark .. 1.5 bright)      → room character
 *   • density (0.55 sparse .. 1.35 dense)              → how full the mix is
 *   • energy  (0 calm .. 1 intense)                    → how loud/busy it is
 *   • role   (lead/pad/fx)                            → per-layer send levels
 *       (all three role sends are always computed so the audio graph can
 *        route each source on its own bus)
 *
 * The profile yields independent, musically-meaningful parameters:
 *   room size, decay time, pre-delay, damping, wet/dry, early reflections.
 *   (Note: `dry` is informational only — the dry path is the sources'
 *   direct connection to `dests` in each voice; this module does not
 *   apply a dry level itself.)
 *
 * The impulse responses are synthesized analytically (exponential
 * decay, modal/early-reflection taps, frequency-dependent damping via
 * a time-varying one-pole filter), so no IR assets are required.
 */

// 32-bit seeded PRNG (mulberry32) — keeps rendering deterministic so
// tests never flake. Reverb builds its own noise; it must NOT touch
// the app's global playback RNG (utils/rng.js).
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ─── Profile computation ─────────────────────────────────────────
/**
 * Maps perceptual drivers to reverb parameters.
 * Everything is clamped and smooth-scaled; the returned object is
 * plain data (safe to pass across module boundaries / test).
 * @param {{normScore?:number, density?:number, energy?:number}} input
 * @returns {{
 *   roomSize:number, decay:number, preDelay:number, damping:number,
 *   wet:number, dry:number, erLevel:number,
 *   reverbTime:number, impulseDuration:number,
 *   roleSend:{lead:number, pad:number, fx:number}
 * }}
 */
export function computeReverbProfile({ normScore = 0, density = 1, energy = 0.5 } = {}) {
  const mood = clamp((normScore + 1.5) / 3, 0, 1); // 0 dark .. 1 bright
  const densityF = clamp(density, 0.55, 1.35);

  // ── Room character — driven by mood ──────────────────────────
  // Dark/melancholic → big, long, dark (more distant); bright → small,
  // short, brighter (more present). These read as the "size" of the space.
  const roomSize = 0.45 + (1 - mood) * 0.50;      // 0.45 (bright) .. 0.95 (dark)
  const reverbTime = 1.6 + roomSize * 2.4;        // seconds (RT60-ish) 2.7 .. 3.9s
  const impulseDuration = reverbTime * 1.6;       // enough tail length

  const preDelay  = 0.012 + (1 - mood) * 0.028;   // 12 .. 40 ms — longer gap reads as distance
  const damping   = 0.30 + (1 - mood) * 0.40;     // 0.30 .. 0.70 — darker rooms absorb more highs

  // ── Density → how much instrument is pushed into the space ──
  // Sparse mix can sit far back in a huge room; a dense passage must
  // pull back the send/wet so instruments don't smear into mud.
  const densityTrim = clamp((densityF - 0.55) / 0.80, 0, 1); // 0 sparse .. 1 dense
  const sendFactor  = 1 - densityTrim * 0.30;     // dense → send 30% less

  // ── Energy → wet/dry balance ─────────────────────────────────
  // High-energy passages get drier and tighter so attacks stay clear.
  const energyTrim = clamp(energy, 0, 1);

  const wet = clamp(0.55 - mood * 0.30 + (1 - densityTrim) * 0.08 - energyTrim * 0.08, 0.18, 0.60);
  const dry = clamp(1 - wet * 0.5, 0.60, 1.0);    // dry path keeps presence; never fully silenced

  // ── Late-level sensitivity to mood ───────────────────────────
  const erLevel = clamp(0.30 + (1 - mood) * 0.30 - densityTrim * 0.12, 0.10, 0.65);

  // ── Role → per-layer send into the space ─────────────────────
  // These are ABSOLUTE send-bus gains applied AFTER `wet`, so the
  // lead layer (the reference) gets exactly the legacy wet level and
  // only pads/fx are offset from it:
  //   lead = wet   (matches the old wetness applied directly)
  //   pad  = wet × padSend (a little deeper — pads are the space)
  //   fx   = wet × fxSend  (a little drier — chimes stay present)
  // leadSend is fixed at 1.0 so lead feedback == `wet` exactly; density
  // trims the depth layers toward the lead so dense passages pull back
  // cleanly without disturbing the lead's wet level — and even at the
  // densest setting pads always sit slightly deeper than the lead.
  const padSend = 1.0 + 0.40 * sendFactor;    // 1.28 (dense) .. 1.40 (sparse)
  const fxSend  = 0.7 + 0.20 * sendFactor;    // 0.84 (dense) .. 0.90 (sparse)
  const roleSend = {
    lead: 1.0,
    pad: padSend,
    fx: fxSend,
  };

  return {
    roomSize,
    decay: reverbTime,
    preDelay,
    damping,
    wet,
    dry,
    erLevel,
    reverbTime,
    impulseDuration,
    roleSend,
  };
}

// ─── Impulse response synthesis ──────────────────────────────────
/**
 * Synthesizes a mono impulse response for a room defined by a profile.
 * Structure:
 *   - a short burst of discrete "early reflection" taps near t≈0,
 *     spaced roughly by the pre-delay, decaying ~4 taps deep;
 *   - then the diffuse tail: exponentially-decaying noise whose high
 *     frequencies are progressively absorbed (time-varying one-pole
 *     lowpass = frequency-dependent damping).
 * @param {number} sampleRate
 * @param {number} profile profile from computeReverbProfile
 * @param {number} seed
 * @returns {Float32Array}
 */
export function renderImpulseResponse(sampleRate, profile, seed) {
  const p = profile;
  const preDelaySamples = Math.floor(p.preDelay * sampleRate);

  // Early reflections: 4 discrete taps, each a short filtered burst,
  // spaced by preDelay (in real rooms reflections scale with room size).
  // The buffer must be long enough to hold the LAST tap plus its burst,
  // even if `impulseDuration` alone would cut it — otherwise the tap is
  // silently dropped. We guard the length here so short ER impulses never
  // lose their final reflection.
  const taps = 4;
  const burstLen = Math.floor(0.025 * sampleRate);
  const lastTap = preDelaySamples + Math.round((taps - 1) * preDelaySamples * 1.7);
  const len = Math.max(
    Math.floor(profile.impulseDuration * sampleRate),
    lastTap + burstLen + Math.floor(0.05 * sampleRate)
  );
  const ir = new Float32Array(len);
  const rnd = mulberry32(seed);

  for (let t = 0; t < taps; t++) {
    const dest = preDelaySamples + Math.round(t * preDelaySamples * 1.7);
    const amp = Math.pow(0.62, t) * 0.9;
    // short noise burst shaped like a damped knock
    const bn = burstLen;
    let state = 0;
    for (let i = 0; i < bn && dest + i < len; i++) {
      const fc = 6000 * Math.pow(1 - i / bn, 2) + 300;
      const coeff = 1 - Math.exp(-2 * Math.PI * fc / sampleRate);
      state += coeff * ((rnd() * 2 - 1) - state);
      ir[dest + i] += state * amp * (1 - i / bn);
    }
  }

  // Diffuse tail with frequency-dependent damping. Each sample passes
  // through a one-pole lowpass whose cutoff falls over time — high
  // frequencies die first, which is how real rooms decay.
  const decayRate = 6.91 / p.reverbTime;              // −60 dB by reverbTime
  const cutoffStart = 9000 * (1.0 - p.damping * 0.5); // brighter rooms: higher
  let lp = 0;
  for (let i = preDelaySamples; i < len; i++) {
    const t = (i - preDelaySamples) / sampleRate;
    const env = Math.max(0, 1 - t / p.reverbTime) * Math.exp(-decayRate * t);

    const dampingShift = p.damping * (i / len);       // more damping over time
    const cutoff = cutoffStart * Math.pow(0.25, dampingShift);
    const coeff = 1 - Math.exp(-2 * Math.PI * cutoff / sampleRate);
    lp += coeff * ((rnd() * 2 - 1) - lp);

    ir[i] = lp * env;
  }

  // Normalize to a consistent level so wet/dry mixing behaves predictably.
  let peak = 0;
  for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(ir[i]));
  if (peak > 0) {
    const norm = 0.7 / peak;
    for (let i = 0; i < len; i++) ir[i] *= norm;
  }
  return ir;
}

/**
 * Renders a stereo AudioBuffer-friendly pair of impulse responses
 * (channel decorrelation via different seeds).
 * @param {number} sampleRate
 * @param {number} profile
 * @param {number} seed
 * @returns {[Float32Array, Float32Array]}
 */
export function renderStereoImpulse(sampleRate, profile, seed) {
  return [
    renderImpulseResponse(sampleRate, profile, seed),
    renderImpulseResponse(sampleRate, profile, seed + 0x9E3779B9),
  ];
}
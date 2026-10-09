/**
 * js/audio/mix-metrics.js
 * ─────────────────────────────────────────────────────────────────
 * Objective measurements of a rendered mix. Pure functions over Float32Arrays:
 * no WebAudio, no DOM, no randomness — so the numbers are reproducible and the
 * module is testable in Node (test/mix-metrics-test.mjs).
 *
 * What it measures, and why each number is there:
 *   peakDb / clipped        — does the sum ever leave ±1? (WebAudio hard-clips
 *                             at ±1 and the recording / MP3 export inherits it)
 *   truePeakDb              — inter-sample peak, 4× windowed-sinc estimate; an
 *                             MP3 encode can overshoot sample peak
 *   lufsI / lufsShortMax    — ITU-R BS.1770-4 loudness (K-weighted, gated), so
 *                             "louder" / "quieter" after a change is a number
 *   rmsDb / crestDb         — unweighted level and peak-to-RMS (how much of the
 *                             loudness is spent on rare peaks)
 *   aShortMaxDb / aEqDb     — A-weighted level (IEC 61672): the ear's low-frequency
 *                             insensitivity (~ -19 dB at 100 Hz, -26 dB at 63 Hz).
 *                             K-weighting (LUFS) only removes content below ~38 Hz,
 *                             so for a melody sitting at 65-130 Hz it OVERSTATES how
 *                             loud the melody sounds; A-weighting is the 40-phon
 *                             equal-loudness proxy. The truth at normal listening
 *                             levels lies between the two — report both.
 *   bands                   — share of total power per band, from a Welch
 *                             average on the mid signal. `lowMid` (150–500 Hz)
 *                             is the "mud" band where a pad and a melody mask
 *                             each other.
 *
 * Calibration: a stereo 1 kHz sine at −23 dBFS per channel reads −23.0 LUFS
 * (EBU Tech 3341, test case 1) — asserted in the test.
 */

const db = x => (x > 0 ? 20 * Math.log10(x) : -Infinity);
const dbPow = p => (p > 0 ? 10 * Math.log10(p) : -Infinity);

// ─── BS.1770-4 K-weighting (bilinear transform at any sample rate) ──────
function kWeightCoeffs(fs) {
  // stage 1: high shelf (~+4 dB above 1.7 kHz)
  {
    var f0 = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196;
    var K = Math.tan(Math.PI * f0 / fs);
    var Vh = Math.pow(10, G / 20), Vb = Math.pow(Vh, 0.4996667741545416);
    var a0 = 1 + K / Q + K * K;
    var shelf = {
      b: [(Vh + Vb * K / Q + K * K) / a0, 2 * (K * K - Vh) / a0, (Vh - Vb * K / Q + K * K) / a0],
      a: [1, 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0],
    };
  }
  // stage 2: RLB high-pass (~38 Hz)
  {
    var g0 = 38.13547087602444, Q2 = 0.5003270373238773;
    var K2 = Math.tan(Math.PI * g0 / fs);
    var d = 1 + K2 / Q2 + K2 * K2;
    var hp = { b: [1, -2, 1], a: [1, 2 * (K2 * K2 - 1) / d, (1 - K2 / Q2 + K2 * K2) / d] };
  }
  return [shelf, hp];
}

function biquad(x, { b, a }) {
  const y = new Float64Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const xi = x[i];
    const yi = b[0] * xi + b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2;
    x2 = x1; x1 = xi; y2 = y1; y1 = yi;
    y[i] = yi;
  }
  return y;
}

function kWeight(x, fs) {
  let y = x;
  for (const s of kWeightCoeffs(fs)) y = biquad(y, s);
  return y;
}

/**
 * Gated integrated loudness plus momentary (400 ms) and short-term (3 s) maxima.
 * Channels are summed with weight 1 each (front L/R). Returns LUFS, or -Infinity
 * for silence.
 */
export function loudness(chs, fs) {
  const w = chs.map(c => kWeight(c, fs));
  const hop = Math.round(0.1 * fs);
  const winM = Math.round(0.4 * fs), winS = Math.round(3 * fs);
  const n = w[0].length;
  // running sums of squares per channel (prefix sums, Float64)
  const pre = w.map(c => { const p = new Float64Array(n + 1); for (let i = 0; i < n; i++) p[i + 1] = p[i] + c[i] * c[i]; return p; });
  const energy = (start, len) => {
    let z = 0;
    for (const p of pre) z += (p[start + len] - p[start]) / len;
    return z;
  };
  const blocks = [];
  for (let s = 0; s + winM <= n; s += hop) blocks.push(energy(s, winM));
  let momMax = -Infinity;
  for (const z of blocks) momMax = Math.max(momMax, -0.691 + dbPow(z));
  let stMax = -Infinity;
  for (let s = 0; s + winS <= n; s += hop) stMax = Math.max(stMax, -0.691 + dbPow(energy(s, winS)));
  // two-stage gate
  const abs = blocks.filter(z => -0.691 + dbPow(z) > -70);
  let integrated = -Infinity;
  if (abs.length) {
    const rel = -0.691 + dbPow(abs.reduce((a, b) => a + b, 0) / abs.length) - 10;
    const gated = abs.filter(z => -0.691 + dbPow(z) > rel);
    if (gated.length) integrated = -0.691 + dbPow(gated.reduce((a, b) => a + b, 0) / gated.length);
  }
  return { lufsI: integrated, lufsMomentaryMax: momMax, lufsShortMax: stMax };
}


// ─── A-weighting (IEC 61672) as a cascade of three biquads ──────────
// Analog prototype: s^4 / ((s+w1)^2 (s+w2)(s+w3)(s+w4)^2) with poles at
// 20.599, 107.653, 737.862 and 12194.217 Hz, split into three sections and
// discretised with the bilinear transform pre-warped at 1 kHz, then normalised
// to exactly 0 dB at 1 kHz (checked against the IEC table in the test).
function aWeightCoeffs(fs) {
  const w = f => 2 * Math.PI * f;
  const w1 = w(20.598997), w2 = w(107.65265), w3 = w(737.86223), w4 = w(12194.217);
  // bilinear transform s = c (z-1)/(z+1), pre-warped at 1 kHz. Measured against the
  // IEC table at 44.1 and 48 kHz: within 0.35 dB from 31.5 Hz to 4 kHz, and about
  // 0.7 dB too low at 8 kHz (bilinear warping toward Nyquist; per-section pre-warping
  // and a searched warp frequency were tried and are worse overall). Music made here
  // has almost no energy above 6 kHz, so the 8 kHz figure does not move the results.
  const c = w(1000) / Math.tan(w(1000) / (2 * fs));
  // analog (b2,b1,b0)/(a2,a1,a0) -> digital biquad
  const bil = (b2, b1, b0, a2, a1, a0) => {
    const nb0 = b2 * c * c + b1 * c + b0, nb1 = 2 * (b0 - b2 * c * c), nb2 = b2 * c * c - b1 * c + b0;
    const na0 = a2 * c * c + a1 * c + a0, na1 = 2 * (a0 - a2 * c * c), na2 = a2 * c * c - a1 * c + a0;
    return { b: [nb0 / na0, nb1 / na0, nb2 / na0], a: [1, na1 / na0, na2 / na0] };
  };
  const secs = [
    bil(1, 0, 0, 1, 2 * w1, w1 * w1),                 // s^2 / (s+w1)^2
    bil(1, 0, 0, 1, w2 + w3, w2 * w3),                // s^2 / ((s+w2)(s+w3))
    bil(0, 0, w4 * w4, 1, 2 * w4, w4 * w4),           // w4^2 / (s+w4)^2
  ];
  // gain at 1 kHz of the digital cascade
  const om = 2 * Math.PI * 1000 / fs;
  let re = 1, im = 0;
  for (const { b, a } of secs) {
    const nr = b[0] + b[1] * Math.cos(om) + b[2] * Math.cos(2 * om), ni = -(b[1] * Math.sin(om) + b[2] * Math.sin(2 * om));
    const dr = a[0] + a[1] * Math.cos(om) + a[2] * Math.cos(2 * om), di = -(a[1] * Math.sin(om) + a[2] * Math.sin(2 * om));
    const d = dr * dr + di * di, qr = (nr * dr + ni * di) / d, qi = (ni * dr - nr * di) / d;
    [re, im] = [re * qr - im * qi, re * qi + im * qr];
  }
  return { secs, norm: 1 / Math.hypot(re, im) };
}

export function aWeight(x, fs) {
  const { secs, norm } = aWeightCoeffs(fs);
  let y = x;
  for (const s of secs) y = biquad(y, s);
  const out = new Float64Array(y.length);
  for (let i = 0; i < y.length; i++) out[i] = y[i] * norm;
  return out;
}

/**
 * A-weighted levels in dB re full scale (power summed over channels, like the
 * loudness above but without K-weighting or gating): short-term (3 s) maximum,
 * the typical (median live-window) level, and the energy mean over the whole file.
 */
export function aLevels(chs, fs) {
  const w = chs.map(c => aWeight(c, fs));
  const n = w[0].length, win = Math.round(3 * fs), hop = Math.round(0.1 * fs);
  const pre = w.map(c => { const p = new Float64Array(n + 1); for (let i = 0; i < n; i++) p[i + 1] = p[i] + c[i] * c[i]; return p; });
  const energy = (s, len) => { let z = 0; for (const p of pre) z += (p[s + len] - p[s]) / len; return z; };
  let stMax = -Infinity;
  const perSecond = [];                                              // 3 s windows, 1 s apart
  for (let s = 0; s + win <= n; s += hop) {
    const v = dbPow(energy(s, win));
    stMax = Math.max(stMax, v);
    if (((s / hop) | 0) % 10 === 0) perSecond.push(v);
  }
  // "typical" level: the median of the windows within 20 dB of the loudest one, so a
  // quiet low-register stretch counts even when the single loudest window is elsewhere
  // (the short-term MAX is blind to it), and silence between phrases does not.
  const live = perSecond.filter(v => v > stMax - 20).sort((a, b) => a - b);
  const aTypicalDb = live.length ? live[Math.floor((live.length - 1) / 2)] : -Infinity;
  return { aShortMaxDb: stMax, aTypicalDb, aEqDb: dbPow(energy(0, n)) };
}

// ─── Peaks ──────────────────────────────────────────────────────
export function samplePeak(chs) {
  let p = 0;
  for (const c of chs) for (let i = 0; i < c.length; i++) { const a = Math.abs(c[i]); if (a > p) p = a; }
  return p;
}

// 4× oversampling with a Hann-windowed sinc (16 taps per phase). An estimate of
// the inter-sample peak, not a certified BS.1770 true-peak meter.
export function truePeak(chs) {
  const TAPS = 16, half = TAPS / 2;
  const phases = [1, 2, 3].map(k => {
    const frac = k / 4, h = new Float64Array(TAPS);
    for (let j = 0; j < TAPS; j++) {
      const t = j - half + 1 - frac;                      // distance from the sample grid
      const sinc = t === 0 ? 1 : Math.sin(Math.PI * t) / (Math.PI * t);
      const win = 0.5 * (1 + Math.cos(Math.PI * t / half));
      h[j] = sinc * win;
    }
    return h;
  });
  let peak = 0;
  for (const c of chs) {
    for (let i = half; i < c.length - half; i++) {
      const a = Math.abs(c[i]); if (a > peak) peak = a;
      for (const h of phases) {
        let s = 0;
        for (let j = 0; j < TAPS; j++) s += h[j] * c[i - half + 1 + j];
        if (Math.abs(s) > peak) peak = Math.abs(s);
      }
    }
  }
  return peak;
}

// ─── Spectrum (Welch on mid) ────────────────────────────────────
function fftInPlace(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}

export const BANDS = [
  ['sub',      0,    60],
  ['bass',     60,   150],
  ['lowMid',   150,  500],
  ['mid',      500,  2000],
  ['presence', 2000, 6000],
  ['air',      6000, Infinity],
];

/** Share of total power in each band (dB relative to the total), Welch N=4096. */
export function bandShares(chs, fs) {
  const N = 4096, hop = N / 2;
  const n = chs[0].length;
  const mid = new Float64Array(n);
  for (let i = 0; i < n; i++) { let s = 0; for (const c of chs) s += c[i]; mid[i] = s / chs.length; }
  const win = new Float64Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);
  const power = new Float64Array(N / 2);
  let frames = 0;
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let s = 0; s + N <= n; s += hop) {
    for (let i = 0; i < N; i++) { re[i] = mid[s + i] * win[i]; im[i] = 0; }
    fftInPlace(re, im);
    for (let k = 0; k < N / 2; k++) power[k] += re[k] * re[k] + im[k] * im[k];
    frames++;
  }
  const out = {};
  if (!frames) { for (const [name] of BANDS) out[name] = -Infinity; return out; }
  let total = 0;
  for (let k = 1; k < N / 2; k++) total += power[k];
  for (const [name, lo, hi] of BANDS) {
    let p = 0;
    for (let k = 1; k < N / 2; k++) {
      const f = k * fs / N;
      if (f >= lo && f < hi) p += power[k];
    }
    out[name] = dbPow(p / total);
  }
  return out;
}

// ─── Everything at once ─────────────────────────────────────────
/**
 * @param {Float32Array[]} chs  one array per channel (same length)
 * @param {number} fs           sample rate
 */
export function analyzeMix(chs, fs) {
  const n = chs[0].length;
  const peak = samplePeak(chs);
  let clipped = 0, over = 0, sq = 0;
  for (const c of chs) for (let i = 0; i < n; i++) {
    const a = Math.abs(c[i]);
    if (a >= 0.999) clipped++;
    if (a > 1) over++;
    sq += c[i] * c[i];
  }
  const rms = Math.sqrt(sq / (n * chs.length));
  const L = loudness(chs, fs);
  return {
    seconds: n / fs,
    peakDb: db(peak),
    truePeakDb: db(truePeak(chs)),
    clippedSamples: clipped,
    overSamples: over,
    rmsDb: db(rms),
    crestDb: db(peak) - db(rms),
    ...L,
    ...aLevels(chs, fs),
    bands: bandShares(chs, fs),
  };
}

const f1 = v => (Number.isFinite(v) ? v.toFixed(1) : '-inf');

export function formatMetrics(m) {
  const b = m.bands;
  return [
    `  length        ${m.seconds.toFixed(1)} s`,
    `  peak          ${f1(m.peakDb)} dBFS   true-peak≈ ${f1(m.truePeakDb)}   samples ≥0.999: ${m.clippedSamples}  (>1.0: ${m.overSamples})`,
    `  loudness      ${f1(m.lufsI)} LUFS-I   short-term max ${f1(m.lufsShortMax)}   momentary max ${f1(m.lufsMomentaryMax)}`,
    `  A-weighted    short-term max ${f1(m.aShortMaxDb)} dB(A)FS   mean ${f1(m.aEqDb)}   (ear-like: bass counts for much less than in LUFS)`,
    `  rms / crest   ${f1(m.rmsDb)} dBFS / ${f1(m.crestDb)} dB`,
    `  band share    sub ${f1(b.sub)}  bass ${f1(b.bass)}  lowMid ${f1(b.lowMid)}  mid ${f1(b.mid)}  presence ${f1(b.presence)}  air ${f1(b.air)}  (dB re total)`,
  ].join('\n');
}

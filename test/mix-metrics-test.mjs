// mix-metrics.js against references that are known independently of the code:
//  - EBU Tech 3341 case 1: stereo 1 kHz sine at -23 dBFS/channel reads -23.0 LUFS
//  - a full-scale sine has peak 0 dBFS and RMS -3.01 dBFS (crest 3.01 dB)
//  - the absolute gate: a signal below -70 LUFS is silence for integrated loudness
//  - band shares put a pure tone in the right band
//  - clipping counters see what they should
import { analyzeMix, samplePeak, truePeak, bandShares, loudness, aWeight } from '../js/audio/mix-metrics.js';

let bad = 0;
const ok = (c, m) => { if (!c) { bad++; console.log(' FAIL ', m); } };
const near = (a, b, tol, m) => ok(Math.abs(a - b) <= tol, `${m}: got ${a}, want ${b} ±${tol}`);

const fs = 48000;
const sine = (hz, amp, sec, sr = fs) => {
  const x = new Float32Array(Math.round(sr * sec));
  for (let i = 0; i < x.length; i++) x[i] = amp * Math.sin(2 * Math.PI * hz * i / sr);
  return x;
};
const amp = d => Math.pow(10, d / 20);

// 1. EBU Tech 3341 test case 1 (and the same at another sample rate: the
//    K-weighting is derived per sample rate, so it must not depend on 48 kHz)
for (const sr of [48000, 44100]) {
  const s = sine(1000, amp(-23), 20, sr);
  near(loudness([s, s], sr).lufsI, -23.0, 0.15, `-23 dBFS stereo sine @${sr}`);
}

// 2. level arithmetic on a full-scale sine
{
  const s = sine(1000, 1, 3);
  const m = analyzeMix([s, s], fs);
  near(m.peakDb, 0, 0.01, 'full-scale sine peak');
  near(m.rmsDb, -3.01, 0.02, 'full-scale sine rms');
  near(m.crestDb, 3.01, 0.03, 'full-scale sine crest');
}

// 3. absolute gate
{
  const s = sine(1000, amp(-90), 5);
  ok(loudness([s, s], fs).lufsI === -Infinity, 'a -90 dBFS sine is below the -70 LUFS gate');
}

// 4. relative gate: a loud passage followed by a long quiet one must read close
//    to the loud one, not to their average
{
  const loud = sine(1000, amp(-20), 10), quiet = sine(1000, amp(-50), 30);
  const x = new Float32Array(loud.length + quiet.length); x.set(loud); x.set(quiet, loud.length);
  const g = loudness([x, x], fs).lufsI, l = loudness([loud, loud], fs).lufsI;
  near(g, l, 0.3, 'relative gate ignores the quiet tail');
}

// 5. sample peak / true peak: a tone at fs/4 phased so the samples straddle the
//    crest has a sample peak of 0.707 but a true peak of 1.0
{
  const x = new Float32Array(2000);
  for (let i = 0; i < x.length; i++) x[i] = Math.sin(2 * Math.PI * (fs / 4) * i / fs + Math.PI / 4);
  near(samplePeak([x]), Math.SQRT1_2, 0.01, 'sample peak of straddled fs/4 tone');
  near(truePeak([x]), 1, 0.03, 'true peak recovers the inter-sample crest');
}

// 6. bands: a pure tone lands in its own band, and shares sum to ~1
{
  const cases = [[40, 'sub'], [100, 'bass'], [300, 'lowMid'], [1000, 'mid'], [4000, 'presence'], [10000, 'air']];
  for (const [hz, band] of cases) {
    const s = sine(hz, 0.5, 2);
    const b = bandShares([s, s], fs);
    const best = Object.entries(b).sort((p, q) => q[1] - p[1])[0][0];
    ok(best === band, `${hz} Hz tone should be in "${band}", was "${best}"`);
  }
  const mix = sine(100, 0.3, 2).map((v, i) => v + 0.3 * Math.sin(2 * Math.PI * 1000 * i / fs));
  const b = bandShares([mix, mix], fs);
  const total = Object.values(b).reduce((a, v) => a + Math.pow(10, v / 10), 0);
  near(total, 1, 0.02, 'band powers sum to the total');
}

// 7. clipping counters
{
  const x = new Float32Array(1000); x[10] = 1.2; x[20] = -1; x[30] = 0.5;
  const m = analyzeMix([x, x], fs);
  ok(m.overSamples === 2, `samples >1.0 should be 2 (one per channel), got ${m.overSamples}`);
  ok(m.clippedSamples === 4, `samples >=0.999 should be 4, got ${m.clippedSamples}`);
}

// 8. A-weighting against the IEC 61672 reference table (Class 1 tolerance is about
//    from 31.5 Hz to 4 kHz we hold 0.35 dB; at 8 kHz the bilinear design reads ~0.7 dB low
//    (documented in mix-metrics.js; no musical content there), so 1.0 dB is allowed
{
  const IEC = [[31.5, -39.4], [63, -26.2], [125, -16.1], [250, -8.6], [500, -3.2], [1000, 0], [2000, 1.2], [4000, 1.0], [8000, -1.1]];
  for (const sr of [44100, 48000]) for (const [hz, want] of IEC) {
    const x = sine(hz, 0.5, 6, sr), y = aWeight(x, sr);
    let a = 0, b = 0; const from = Math.round(2 * sr);            // skip the filter's start-up
    for (let i = from; i < x.length; i++) { a += x[i] * x[i]; b += y[i] * y[i]; }
    const got = 10 * Math.log10(b / a);
    near(got, want, hz >= 8000 ? 1.0 : 0.35, `A-weighting at ${hz} Hz @${sr}`);
  }
}

if (bad) { console.log(`${bad} failure(s)`); process.exit(1); }
console.log('mix-metrics: reference levels, gates, peaks, bands and A-weighting all check out');

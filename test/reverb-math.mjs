/**
 * test/reverb-math.mjs
 * ─────────────────────────────────────────────────
 * Unit tests for the pure reverb math (no browser APIs, no globals).
 * Verifies the perceptual mapping stays monotonic/sane and the synthesized
 * impulse responses look physically plausible.
 *
 * Usage: node test/reverb-math.mjs
 */
import { computeReverbProfile, renderImpulseResponse, renderStereoImpulse, mulberry32, registerModifier } from '../js/audio/reverb-math.js';

let fails = 0;
function check(name, cond, detail = '') {
  if (cond) {
    console.log(`  ok  ${name}`);
  } else {
    fails++;
    console.log(`FAIL  ${name}  ${detail}`);
  }
}

const approx = (a, b, eps) => Math.abs(a - b) < eps;

console.log('== deterministic PRNG ==');
{
  const a = mulberry32(42), b = mulberry32(42);
  const seqA = Array.from({ length: 5 }, () => a());
  const seqB = Array.from({ length: 5 }, () => b());
  check('same seed → same sequence', seqA.every((v, i) => v === seqB[i]));
  check('values in [0,1)', seqA.every(v => v >= 0 && v < 1), JSON.stringify(seqA));
}

console.log('== profile: mood drives room character ==');
{
  const dark = computeReverbProfile({ normScore: -1.5, density: 1, energy: 0.5 });
  const bright = computeReverbProfile({ normScore: 1.5, density: 1, energy: 0.5 });
  check('dark room is bigger than bright', dark.roomSize > bright.roomSize, `${dark.roomSize} vs ${bright.roomSize}`);
  check('dark decay longer', dark.decay > bright.decay, `${dark.decay} vs ${bright.decay}`);
  check('dark pre-delay longer (distance)', dark.preDelay > bright.preDelay, `${dark.preDelay} vs ${bright.preDelay}`);
  check('dark damping stronger', dark.damping > bright.damping, `${dark.damping} vs ${bright.damping}`);
  check('dark wet ≥ bright wet', dark.wet >= bright.wet, `${dark.wet} vs ${bright.wet}`);
  check('roomSize clamped ≤ 0.95', dark.roomSize <= 0.95, dark.roomSize);
}

console.log('== profile: density pulls depth layers back ==');
{
  const sparse = computeReverbProfile({ normScore: 0, density: 0.55, energy: 0.3 });
  const dense = computeReverbProfile({ normScore: 0, density: 1.35, energy: 0.3 });
  // lead stays at the reference wet; only the depth layers (pad/fx) trim
  check('lead is fixed reference', sparse.roleSend.lead === dense.roleSend.lead && dense.roleSend.lead === 1,
    `${dense.roleSend.lead} vs ${sparse.roleSend.lead}`);
  check('dense → pad/fx sends lower than sparse',
    dense.roleSend.pad < sparse.roleSend.pad && dense.roleSend.fx < sparse.roleSend.fx,
    `pad ${dense.roleSend.pad} vs ${sparse.roleSend.pad}; fx ${dense.roleSend.fx} vs ${sparse.roleSend.fx}`);
}

console.log('== profile: energy tightens wet ==');
{
  const calm = computeReverbProfile({ normScore: 0, density: 1, energy: 0.1 });
  const intense = computeReverbProfile({ normScore: 0, density: 1, energy: 1.0 });
  check('intense → less wet than calm', intense.wet < calm.wet, `${intense.wet} vs ${calm.wet}`);
  check('erLevel stays in range', calm.erLevel >= 0.10 && calm.erLevel <= 0.65, calm.erLevel);
}

console.log('== profile: role sends ordered ==');
{
  const p = computeReverbProfile({ normScore: -0.5, density: 1, energy: 0.5 });
  check('pad deepest, lead mid, fx lightest',
    p.roleSend.pad > p.roleSend.lead && p.roleSend.lead > p.roleSend.fx,
    JSON.stringify(p.roleSend));
}

console.log('== profile: all params finite & bounded ==');
{
  const p = computeReverbProfile({ normScore: -2, density: 2, energy: 2 });
  const vals = [p.roomSize, p.decay, p.preDelay, p.damping, p.wet, p.dry, p.erLevel, p.impulseDuration];
  check('clamped inputs stay finite/bounded', vals.every(Number.isFinite),
    JSON.stringify({ vals, roleSend: p.roleSend }));
  check('wet+er in range', p.wet >= 0.15 && p.wet <= 0.62 && p.erLevel >= 0.10 && p.erLevel <= 0.65);
  check('dry never silenced', p.dry >= 0.60 && p.dry <= 1.0, p.dry);
}

console.log('== impulse response render ==');
{
  const sr = 48000;
  const profile = computeReverbProfile({ normScore: -0.8, density: 1, energy: 0.5 });
  const ir = renderImpulseResponse(sr, profile, 0x1234);
  const expectedLen = Math.floor(profile.impulseDuration * sr);
  check('IR length matches impulseDuration', ir.length === expectedLen, `${ir.length} vs ${expectedLen}`);
  let peak = Math.abs(ir[0]);
  for (let i = 1; i < ir.length; i++) if (Math.abs(ir[i]) > peak) peak = Math.abs(ir[i]);
  check('IR normalized (peak ≈ 0.7)', approx(peak, 0.7, 0.001), peak);

  // energy decays over time
  const half = Math.floor(ir.length / 2);
  const eFirst = ir.slice(0, half).reduce((s, v) => s + v * v, 0);
  const eLast = ir.slice(half).reduce((s, v) => s + v * v, 0);
  check('tail energy decays (first half ≫ second half)', eFirst > eLast * 4, `${eFirst} vs ${eLast}`);

  // early-reflection taps exist near the pre-delay
  const tapStart = Math.max(0, Math.floor(profile.preDelay * sr) - 2);
  const tapEnd = Math.min(ir.length, tapStart + 40);
  let tapPeak = 0;
  for (let i = tapStart; i < tapEnd; i++) if (Math.abs(ir[i]) > tapPeak) tapPeak = Math.abs(ir[i]);
  check('early reflections present near pre-delay', tapPeak > 0.05, tapPeak);
}

console.log('== stereo render decorrelates channels ==');
{
  const sr = 44100;
  const profile = computeReverbProfile({ normScore: 0.2, density: 0.9, energy: 0.6 });
  const [l, r] = renderStereoImpulse(sr, profile, 99);
  check('same length both channels', l.length === r.length);
  let corr = 0, lPow = 0, rPow = 0;
  for (let i = 0; i < l.length; i++) { corr += l[i] * r[i]; lPow += l[i] * l[i]; rPow += r[i] * r[i]; }
  const cc = corr / Math.sqrt(lPow * rPow + 1e-12);
  check('channels decorrelated (|c| < 0.3)', Math.abs(cc) < 0.3, cc);
}

console.log('== render is deterministic ==');
{
  const sr = 22050;
  const profile = computeReverbProfile({ normScore: 0, density: 1, energy: 0.5 });
  const a = renderImpulseResponse(sr, profile, 7);
  const b = renderImpulseResponse(sr, profile, 7);
  check('same seed → identical IR', a.length === b.length && a.every((v, i) => v === b[i]));
}

console.log('== register modifier ==');
{
  const bass = registerModifier(110);    // A2 — low bass
  const mid  = registerModifier(440);    // A4 — reference
  const treble = registerModifier(4000); // ~C7 — high treble
  check('reference frequency (A4) returns 1.0', approx(mid, 1.0, 0.001), mid);
  check('bass returns > 1.0 (excites more room)', bass > 1.0, bass);
  check('treble returns < 1.0 (stays more direct)', treble < 1.0, treble);
  check('monotonic: higher freq → lower multiplier',
    bass > mid && mid > treble, `${bass} > ${mid} > ${treble}`);
  check('bounded [0.80, 1.20]',
    bass <= 1.20 && treble >= 0.80, `bass=${bass}, treble=${treble}`);
  check('edge: 0 or negative freq returns 1.0 (safe fallback)',
    registerModifier(0) === 1.0 && registerModifier(-100) === 1.0);
  check('edge: NaN returns 1.0', registerModifier(NaN) === 1.0);
}

console.log(`\n${fails === 0 ? 'ALL PASS' : fails + ' FAILURE(S)'}`);
process.exit(fails === 0 ? 0 : 1);
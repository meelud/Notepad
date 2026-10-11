// Melodic-motion knobs in music/harmony.js (STEP_INERTIA, LEAP_UP_BIAS, VOICE_WEIGHT):
//  - exactly neutral at their defaults (and when overridden TO the defaults),
//  - each moves its statistic in the intended direction, measured over many seeded draws,
//  - nothing leaves the scale or the register, whatever the setting.
import { seedRng } from '../js/utils/rng.js';
import { deriveTextHarmony, stepwiseNote, arbitrateMelodyNote, wordNoteScale, currentScale, MELODY_FLOOR_HZ, STEP_INERTIA, LEAP_UP_BIAS, VOICE_WEIGHT } from '../js/music/harmony.js';

let bad = 0;
const ok = (c, m) => { if (!c) { bad++; console.log(' FAIL ', m); } };
ok(STEP_INERTIA === 0 && LEAP_UP_BIAS === 0 && VOICE_WEIGHT === 1, 'shipped defaults are neutral (0, 0, 1)');

deriveTextHarmony('We did it, I cannot believe it. Tonight we celebrate, everyone come over.');   // a major-ish key
const len = currentScale.length;
const startOct = stepwiseNote(null).octave;
const mid = { degree: 3, octave: startOct * 2, freq: currentScale[3] * startOct * 2, lastInterval: 0 };
const withLast = (iv) => ({ ...mid, lastInterval: iv });
const set = o => { globalThis.__NOTEPAD_MELODY__ = o; };

// 1. neutrality: a long seeded walk through stepwiseNote and arbitrateMelodyNote is identical with no
//    override and with the override set to the defaults
function walk() {
  seedRng(777); let prev = null; const out = [];
  for (let i = 0; i < 400; i++) {
    const n = i % 2 ? arbitrateMelodyNote(prev, (i * 2) % len, (i % 5) / 5, ((i % 3) - 1) * 0.5, i % 17 === 0, i % 4 === 0, (i % 3) - 1, 0, null, 0.4) : stepwiseNote(prev, (i % 5) / 5, ((i % 3) - 1) * 0.5, i % 11 === 0);
    out.push(`${n.degree}/${n.octave}/${n.lastInterval}`); prev = n;
  }
  return out.join(' ');
}
set(undefined); const base = walk();
set({ inertia: 0, leapUp: 0, voice: 1 }); const same = walk();
ok(base === same, 'overriding the knobs to their defaults reproduces the walk exactly');

// 2. directions of effect
const share = (f, n = 4000) => { let c = 0; for (let i = 0; i < n; i++) if (f(i)) c++; return c / n; };
function stepContinuesUp(inertia) {
  set({ inertia }); seedRng(11);
  return share(() => { const n = stepwiseNote(withLast(1), 0, 0, false); return n.lastInterval === 1; }, 6000);
}
const c0 = stepContinuesUp(0), c1 = stepContinuesUp(1);
ok(c1 > c0 + 0.2, `after a step up, inertia 1 continues up more often than inertia 0 (${c1.toFixed(2)} vs ${c0.toFixed(2)})`);

function leapUpShare(leapUp) {
  set({ leapUp }); seedRng(12);
  let up = 0, leaps = 0;
  for (let i = 0; i < 8000; i++) { const n = stepwiseNote(withLast(0), 0.9, 0, true); if (Math.abs(n.lastInterval) >= 2) { leaps++; if (n.lastInterval > 0) up++; } }
  return up / leaps;
}
const l0 = leapUpShare(0), l1 = leapUpShare(1);
ok(l1 > l0 + 0.1, `leaps go up more often with leapUp 1 than with 0 (${l1.toFixed(2)} vs ${l0.toFixed(2)})`);

function meanArbLeap(voice) {
  set({ voice }); seedRng(13);
  let s = 0, n = 0; let prev = mid;
  for (let i = 0; i < 3000; i++) { const x = arbitrateMelodyNote(prev, (i * 3) % len, 0.3, 0, false, i % 2 === 0, 0, 0, null, 0.4); s += Math.abs(Math.log2(x.freq / prev.freq)) * 12; n++; prev = x; }
  return s / n;
}
const v1 = meanArbLeap(1), v2 = meanArbLeap(2);
ok(v2 < v1, `a larger voice-leading weight gives smaller average moves (${v2.toFixed(2)} vs ${v1.toFixed(2)} semitones)`);

// 3. invariants under extreme settings: in scale, above the floor
set({ inertia: 1, leapUp: 1, voice: 3 });
seedRng(21); let prev = null, outScale = 0, low = 0, total = 0;
for (let i = 0; i < 1500; i++) {
  const n = i % 2 ? arbitrateMelodyNote(prev, (i * 2) % len, 0.8, 0.5, i % 13 === 0, i % 4 === 0, 1, 0, null, 0.4) : stepwiseNote(prev, 0.8, 0.5, i % 9 === 0);
  total++; if (!currentScale.some(s => { const r = Math.log2(n.freq / s); return Math.abs(r - Math.round(r)) < 1e-9; })) outScale++;
  if (n.freq < MELODY_FLOOR_HZ * (1 - 1e-9)) low++;
  prev = n;
}
ok(outScale === 0, `extreme settings: ${outScale} of ${total} notes left the scale`);
ok(low === 0, `extreme settings: ${low} of ${total} notes fell under the register floor`);
set(undefined);

if (bad) { console.log(`${bad} failure(s)`); process.exit(1); }
console.log('melody knobs: neutral by default, each moves its statistic the right way, scale and register hold');

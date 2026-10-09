// Melody register rule (music/harmony.js: MELODY_FLOOR_HZ, MELODY_START_MIN_HZ):
//   - no melody note below the floor, anywhere,
//   - the melody starts at or above the start minimum,
//   - it moves as little as it can: untouched where it was already fine, the set moves
//     rigidly with the start (intervals and contour intact), only sub-floor octaves are
//     dropped, and it never raises the top of the range,
//   - the real wordNoteScale()/placeNearest path agrees and stays in key.
import { MODE_ORDER } from '../js/music/scales.js';
import { melodyRegisterFor, MELODY_FLOOR_HZ, MELODY_START_MIN_HZ, deriveTextHarmony, wordNoteScale, currentScale } from '../js/music/harmony.js';

let bad = 0;
const ok = (c, m) => { if (!c) { bad++; if (bad < 25) console.log(' FAIL ', m); } };
const noteFreq = n => 110 * Math.pow(2, n / 12);                      // same as harmony.js
const rootsFor = modeIdx => Array.from({ length: 12 }, (_, i) => noteFreq(modeIdx <= 5 ? i - 12 : i));
const OLD = i => (i <= 4 ? [0.5, 1, 2] : i <= 8 ? [0.5, 1, 2, 4] : i <= 12 ? [1, 2, 4, 8] : [1, 2, 4, 8, 16]);
const isPow2 = x => Math.abs(Math.log2(x) - Math.round(Math.log2(x))) < 1e-12;
const EPS = 1 - 1e-9;

let combos = 0, untouched = 0, startUp1 = 0, startUp2 = 0, onlyDropped = 0, minNotes = Infinity, topNew = 0, topOld = 0, minSize = Infinity;
for (let mi = 0; mi < MODE_ORDER.length; mi++) for (const root of rootsFor(mi)) {
  combos++;
  const { octaves, startOct } = melodyRegisterFor(mi, root), old = OLD(mi), tag = `${MODE_ORDER[mi]} @${root.toFixed(1)}`;
  const oldStart = old[Math.floor(old.length / 2)];
  ok(octaves.length >= 2 && octaves.every(isPow2) && isPow2(startOct), `${tag}: octaves and start must be powers of two (and there must be a usable range)`);
  ok(octaves.every(o => root * o >= MELODY_FLOOR_HZ * EPS), `${tag}: a melody octave is under the floor`);
  ok(octaves.includes(startOct), `${tag}: the starting octave must be one of the octaves`);
  ok(root * startOct >= MELODY_START_MIN_HZ * EPS, `${tag}: melody starts at ${(root * startOct).toFixed(1)} Hz, under the minimum`);
  const f = startOct / oldStart;
  ok(isPow2(f) && f >= 1, `${tag}: the start may only move up, by whole octaves`);
  ok(octaves.every(o => old.some(b => Math.abs(o / (b * f) - 1) < 1e-12)), `${tag}: the set must be the old set moved rigidly with the start (then trimmed)`);
  if (f > 1) ok(root * oldStart * (f / 2) < MELODY_START_MIN_HZ, `${tag}: start moved by ${f}x but ${f / 2}x would have been enough`);
  if (root * oldStart >= MELODY_START_MIN_HZ * EPS) ok(f === 1, `${tag}: start was already high enough and must not move`);
  const lowestOldKept = old.filter(b => root * b >= MELODY_FLOOR_HZ * EPS);
  if (f === 1) ok(octaves.length === lowestOldKept.length, `${tag}: with the start unmoved only sub-floor octaves may be dropped`);
  const same = f === 1 && octaves.length === old.length;
  untouched += same; if (f === 2) startUp1++; if (f >= 4) startUp2++; onlyDropped += (f === 1 && !same);
  minNotes = Math.min(minNotes, root * octaves[0]); minSize = Math.min(minSize, octaves.length);
  topNew = Math.max(topNew, root * octaves[octaves.length - 1] * 2); topOld = Math.max(topOld, root * old[old.length - 1] * 2);
}
ok(topNew <= topOld * (1 + 1e-9), `the rule must not raise the highest possible melody pitch (${topNew.toFixed(0)} vs ${topOld.toFixed(0)} Hz)`);
console.log(`  ${combos} (mode, root) combinations: untouched ${untouched}, only a sub-A2 octave dropped ${onlyDropped}, start +1 octave ${startUp1}, start +2 octaves ${startUp2}`);
console.log(`  lowest melody note anywhere ${minNotes.toFixed(1)} Hz (floor ${MELODY_FLOOR_HZ}); smallest octave set has ${minSize} octaves; highest possible ${topNew.toFixed(0)} Hz (was ${topOld.toFixed(0)})`);

// the real path
for (const t of ['Do not ever speak to me like that again. I am done. Get out!', 'I got the job! We did it, tonight we celebrate!',
                 'The morning light slid across the table, slow and quiet.', 'دلم برات تنگ شده و همه چیز ساکته']) {
  deriveTextHarmony(t);
  const pool = wordNoteScale();
  ok(Math.min(...pool) >= MELODY_FLOOR_HZ * EPS, `"${t.slice(0, 20)}…": real melody pool has a note under the floor (${Math.min(...pool).toFixed(1)} Hz)`);
  ok(pool.every(f => currentScale.some(s => { const r = Math.log2(f / s); return Math.abs(r - Math.round(r)) < 1e-9; })), `"${t.slice(0, 20)}…": melody pool left its scale`);
}

// the experiment hook: 0 / 0 is exactly the old behaviour, and a higher start minimum moves the start
{
  let same = true;
  for (let mi = 0; mi < MODE_ORDER.length; mi++) for (const root of rootsFor(mi)) {
    const old = OLD(mi), r = melodyRegisterFor(mi, root, 0, 0);
    if (r.startOct !== old[Math.floor(old.length / 2)] || r.octaves.length !== old.length || r.octaves.some((o, j) => o !== old[j])) same = false;
  }
  ok(same, 'floor 0 / start 0 must reproduce the old octave sets and starting octave exactly');
  globalThis.__NOTEPAD_MELODY__ = { startMin: 880 };
  ok(melodyRegisterFor(6, 165).startOct * 165 >= 880, 'the global override reaches melodyRegisterFor');
  globalThis.__NOTEPAD_MELODY__ = undefined;
}

if (bad) { console.log(`${bad} failure(s)`); process.exit(1); }
console.log('melody register: nothing under A2, starts at or above A3, moves only as much as needed, still in key');

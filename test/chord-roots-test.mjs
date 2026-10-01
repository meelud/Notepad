// ─── Chord roots per mode ────────────────────────────────────────
// The fact this file exists to pin: chord roots used to come from a single
// constant, [0, 2, 4, 6], for EVERY mode. In a 7-note major scale that is
// I, iii, V, vii-dim — so:
//
//   IV and vi never occurred at all. The subdominant and the submediant, the
//   two warmest functional chords, were unreachable in any mode.
//   vii-dim, the darkest triad in the scale, carried a flat 25% of all roots.
//   A cheerful piece and a sad one drew from exactly the same four degrees.
//
// Triad qualities are now CLASSIFIED from each mode's own intervals rather
// than assumed from degree numbers, so vii is found diminished in major, iii
// in mixolydian, #iv in lydian and v in phrygian without any of them being
// named in the source.

import { MODE_OFFSETS, MODE_ORDER } from '../js/music/scales.js';
import {
  createChordClock, chordRootsForMode, triadsForMode, triadQuality,
} from '../js/music/rhythm.js';
import { PENT_PARENT, PENT_PARENT_TRIADS, pentToParentMap } from '../js/music/pent-parent.js';

let failed = 0;
function check(name, ok, detail = '') {
  console.log(` ${ok ? ' ok  ' : 'FAIL '} ${name}${detail ? '  → ' + detail : ''}`);
  if (!ok) failed++;
}

const BRIGHT = ['major', 'lydian', 'mixolydian', 'pentMajor'];
const DARK = ['minor', 'harmonicMinor', 'phrygian', 'pentMinor', 'locrian'];
const LEGACY = [0, 2, 4, 6];

console.log('\nchord roots per mode\n');

// 1. the triads are classified from intervals, so the label follows the pitches
{
  check('triadQuality reads intervals, not degree numbers',
    triadQuality(0, 4, 7) === 'major' && triadQuality(0, 3, 7) === 'minor'
    && triadQuality(0, 3, 6) === 'diminished' && triadQuality(0, 4, 8) === 'augmented');

  // the four claims in the commit message, each checked against the mode
  const CLAIMS = [['major', 6, 'diminished'], ['mixolydian', 2, 'diminished'],
                  ['lydian', 3, 'diminished'], ['phrygian', 4, 'diminished']];
  const bad = CLAIMS.filter(([m, d, q]) => triadsForMode(MODE_OFFSETS[m])[d] !== q)
    .map(([m, d, q]) => `${m}[${d}] is ${triadsForMode(MODE_OFFSETS[m])[d]}, not ${q}`);
  check('vii/iii/#iv/v are found diminished in their own modes, not hard-coded',
    bad.length === 0, bad.join('; '));
}

// 2. bright modes: major and minor only
{
  let bad = [];
  for (const m of BRIGHT) {
    const offsets = MODE_OFFSETS[m];
    // pentatonic triads must come from the PARENT scale — stacking inside a
    // 5-note scale gives "oth" for every degree, which is exactly the hazard
    // commit 2 exists for
    const quads = m.includes('pent') ? PENT_PARENT_TRIADS[m] : triadsForMode(offsets);
    for (const r of chordRootsForMode(offsets, m)) {
      const q = quads[r.degree];
      if (q !== 'major' && q !== 'minor') bad.push(`${m} root ${r.degree} = ${q}`);
    }
  }
  check('no diminished or augmented root in any bright mode', bad.length === 0, bad.join('; '));
}

// 3. dark modes: no diminished, EXCEPT locrian's tonic
{
  let bad = [], excUsed = [];
  for (const m of DARK) {
    const offsets = MODE_OFFSETS[m];
    const quads = m.includes('pent') ? PENT_PARENT_TRIADS[m] : triadsForMode(offsets);
    for (const r of chordRootsForMode(offsets, m)) {
      const q = quads[r.degree];
      if (q === 'augmented') bad.push(`${m} root ${r.degree} = augmented`);
      if (q === 'diminished') {
        // the documented exception, and only it
        if (m === 'locrian' && r.degree === 0) excUsed.push('locrian tonic');
        else bad.push(`${m} root ${r.degree} = diminished`);
      }
    }
  }
  check('no diminished root in any dark mode, except locrian tonic', bad.length === 0, bad.join('; '));
  check('and locrian really does keep a diminished tonic (the anchor survives)',
    excUsed.length === 1
    && triadsForMode(MODE_OFFSETS.locrian)[0] === 'diminished');
}

// 4. IV and vi are reachable in major — the headline defect
{
  const roots = chordRootsForMode(MODE_OFFSETS.major, 'major').map(r => r.degree);
  check('major can put a root on IV (degree 3)', roots.includes(3), JSON.stringify(roots));
  check('major can put a root on vi (degree 5)', roots.includes(5), JSON.stringify(roots));
  check('major no longer needs vii-dim', !roots.includes(6), JSON.stringify(roots));
}

// 5. functional weighting: tonic is the heaviest root everywhere
{
  const bad = [];
  for (const m of [...BRIGHT, ...DARK]) {
    const roots = chordRootsForMode(MODE_OFFSETS[m], m);
    const tonic = roots.find(r => r.degree === 0);
    if (!tonic) { bad.push(`${m}: no tonic`); continue; }
    const max = Math.max(...roots.map(r => r.weight));
    if (tonic.weight !== max) bad.push(`${m}: tonic ${tonic.weight} != max ${max}`);
  }
  check('the tonic is the heaviest root in every bright and dark mode',
    bad.length === 0, bad.join('; '));
}

// 6. neutral modes are bit-identical to the old constant
{
  let bad = [];
  for (const m of MODE_ORDER) {
    if (BRIGHT.includes(m) || DARK.includes(m)) continue;
    const roots = chordRootsForMode(MODE_OFFSETS[m], m);
    const same = roots.length === LEGACY.length
      && roots.every((r, i) => r.degree === LEGACY[i] && r.weight === 1);
    if (!same) bad.push(`${m}: ${JSON.stringify(roots)}`);
  }
  check('neutral modes keep the exact legacy root list and equal weights',
    bad.length === 0, bad.join('; '));

  // and their progressions must be unchanged, seed for seed
  let seqBad = [];
  for (const m of ['dorian', 'melodicMinor', 'enigmatic']) {
    for (let seed = 1; seed <= 60; seed++) {
      const a = createChordClock(seed);           // no mode: legacy path
      const b = createChordClock(seed, m);
      for (let bar = 0; bar < 8; bar++) {
        if (a.degreeAtBar(bar) !== b.degreeAtBar(bar)) { seqBad.push(`${m} seed ${seed} bar ${bar}`); break; }
      }
    }
  }
  check('and their chord sequences are unchanged seed for seed',
    seqBad.length === 0, seqBad.slice(0, 3).join('; '));
}

// 7. bar 0 is the tonic for the computed modes
{
  let bad = [];
  for (const m of [...BRIGHT, ...DARK]) {
    for (let seed = 1; seed <= 200; seed++) {
      if (createChordClock(seed, m).degreeAtBar(0) !== 0) { bad.push(`${m} seed ${seed}`); break; }
    }
  }
  check('bar 0 is the tonic in every bright and dark mode, over 200 seeds each',
    bad.length === 0, bad.join('; '));
}

// 8. over 500 seeded sequences, no forbidden root ever appears at runtime
{
  let dim = [], offList = [];
  for (const m of BRIGHT) {
    const offsets = MODE_OFFSETS[m];
    const allowed = new Set(chordRootsForMode(offsets, m).map(r => r.degree));
    const quads = m.includes('pent') ? PENT_PARENT_TRIADS[m] : triadsForMode(offsets);
    for (let seed = 1; seed <= 500; seed++) {
      const cc = createChordClock(seed, m);
      for (let bar = 0; bar < 24; bar++) {
        const d = cc.degreeAtBar(bar);
        if (!allowed.has(d)) { offList.push(`${m}/${seed}/${bar} root ${d}`); break; }
        if (quads[d] === 'diminished' || quads[d] === 'augmented') { dim.push(`${m}/${seed}/${bar}`); break; }
      }
    }
  }
  check('over 500 seeded bright sequences x 24 bars: no root outside the set',
    offList.length === 0, offList.slice(0, 3).join('; '));
  check('over the same run: no diminished or augmented triad ever sounds',
    dim.length === 0, dim.slice(0, 3).join('; '));
}

// 9. determinism: same seed and mode gives the same progression
{
  let bad = [];
  for (const m of [...BRIGHT, ...DARK, 'dorian']) {
    for (let seed = 1; seed <= 40; seed++) {
      const a = createChordClock(seed, m), b = createChordClock(seed, m);
      for (let bar = 0; bar < 12; bar++) {
        if (a.degreeAtBar(bar) !== b.degreeAtBar(bar)) { bad.push(`${m}/${seed}/${bar}`); break; }
      }
    }
  }
  check('same (seed, mode) gives the same progression', bad.length === 0, bad.slice(0, 3).join('; '));
}

// 10. the mode actually changes the harmony — otherwise nothing was achieved
{
  const same = [];
  for (let seed = 1; seed <= 200; seed++) {
    const a = createChordClock(seed, 'major'), b = createChordClock(seed, 'minor');
    let identical = true;
    for (let bar = 0; bar < 12; bar++) if (a.degreeAtBar(bar) !== b.degreeAtBar(bar)) { identical = false; break; }
    if (identical) same.push(seed);
  }
  check('major and minor progressions differ for essentially every seed',
    same.length < 10, `${same.length}/200 seeds identical`);
}

if (failed) {
  console.log(`\n${failed} FAILED`);
  process.exit(1);
}
console.log('\nthe harmony now knows which mode it is in');
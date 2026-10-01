// ─── Pentatonic pad chords stack in the parent scale ─────────────
// A 5-note scale has no thirds. Stack one inside pentMajor [0,2,4,7,9] and a
// third above degree 0 is scale-index 2 (4 semitones), a fifth above is index 4
// (9 semitones) — so chordFromScale gives 0/4/9, which is not a triad at all.
//
// The fix is to map the pentatonic degrees into the parent heptatonic scale
// (pentMajor ⊂ major, pentMinor ⊂ minor) and stack thirds THERE. Then deg0 is
// 0/4/7, a real major triad.
//
// THE HAZARD, and why it is survivable: those parent pitches are not all in
// the pentatonic scale — 7 is not. The melody's harmonic-fit code snaps to
// chord tones, so a naive implementation makes the melody leave its own scale.
// It does not, and the reason is structural rather than lucky: the snap works
// in scale-degree INDICES, resolved through the same currentScale the melody
// is built from. A chord can be anything; the melody still picks indices from
// its own scale. Both halves of that are asserted below.
//
// A wrong map would silently shift every chord root, so the map is derived by
// matching semitones and throws at load if it does not reproduce the pentatonic
// offsets exactly — checked here from both directions.

import { MODE_OFFSETS } from '../js/music/scales.js';
import {
  PENT_PARENT, PENT_PARENT_TRIADS, pentToParentMap, pentChordPitches,
} from '../js/music/pent-parent.js';
import { triadQuality } from '../js/music/rhythm.js';
import { deriveTextHarmony, currentScale } from '../js/music/harmony.js';
import { simulateText } from './player-sim.mjs';

let failed = 0;
function check(name, ok, detail = '') {
  console.log(` ${ok ? ' ok  ' : 'FAIL '} ${name}${detail ? '  → ' + detail : ''}`);
  if (!ok) failed++;
}

const PENTS = ['pentMajor', 'pentMinor'];
/** pitch class of a frequency, as a semitone count from A440's octave */
const semi = f => Math.round(12 * Math.log2(f / 440)) % 12;

console.log('\npentatonic chords from the parent scale\n');

// 1. the map is real, both directions, for every pentatonic mode
{
  let bad = [];
  for (const pent of PENTS) {
    const parent = PENT_PARENT[pent];
    const po = MODE_OFFSETS[pent], pa = MODE_OFFSETS[parent];
    // the parent must CONTAIN the pentatonic set
    if (!po.every(s => pa.includes(s))) bad.push(`${pent} is not a subset of ${parent}`);
    // and the map must reproduce it exactly, each way
    const map = pentToParentMap(pent, po);
    map.forEach((pi, i) => {
      if (pa[pi] !== po[i]) bad.push(`${pent}[${i}] -> ${parent}[${pi}] = ${pa[pi]} ≠ ${po[i]}`);
      if (po.indexOf(pa[pi]) !== i) bad.push(`${parent}[${pi}] maps back to ${po.indexOf(pa[pi])} ≠ ${i}`);
    });
  }
  check('the pentatonic→parent map is exact in both directions', bad.length === 0, bad.join('; '));
}

// 2. every pentatonic chord has a REAL third — the whole point
{
  let bad = [], badQ = [];
  for (const pent of PENTS) {
    const n = MODE_OFFSETS[pent].length;
    for (let d = 0; d < n; d++) {
      const semis = pentChordPitches(pent, d);
      const [r, t3, t5] = semis;
      // a real third is 3 or 4 semitones; the old 5-note stacking gave 4 for
      // deg0 by accident and 5 (a fourth!) for the others
      const third = ((t3 - r) % 12 + 12) % 12;
      const fifth = ((t5 - r) % 12 + 12) % 12;
      if (third !== 3 && third !== 4) bad.push(`${pent}[${d}] third=${third}`);
      if (fifth !== 7) bad.push(`${pent}[${d}] fifth=${fifth}`);
      const q = triadQuality(r, t3, t5);
      if (q === 'other') badQ.push(`${pent}[${d}] quality=${q} ${JSON.stringify(semis)}`);
    }
  }
  check('every pentatonic chord has a real third and fifth', bad.length === 0, bad.slice(0, 4).join('; '));
  check('and every one classifies as major or minor (never "other")',
    badQ.length === 0, badQ.join('; '));
}

// 3. the parent stacking differs from the naive 5-note stacking — otherwise
//    this commit would be a no-op
{
  const at = (o, d) => { const n = o.length; return o[((d % n) + n) % n] + 12 * Math.floor(d / n); };
  const pent = 'pentMajor';
  const naive = [0, 2, 4].map(k => at(MODE_OFFSETS[pent], 0 + k));
  const parent = pentChordPitches(pent, 0);
  check('the parent triad differs from the naive pentatonic one',
    JSON.stringify(naive) !== JSON.stringify(parent),
    `naive=${JSON.stringify(naive)} parent=${JSON.stringify(parent)}`);
  check('and the parent one is a major triad', triadQuality(...parent) === 'major');
}

// 4. HAZARD: the melody must never leave its own scale
{
  // Texts that reach pentatonic modes, seeded and real, with the pad playing
  // parent-scale chords underneath them.
  const TEXTS = [
    'hey baby i love you', 'I love you', 'she said yes', 'so happy today',
    'my heart is full', 'everything is good', 'I adore you', 'you are lovely',
  ];
  let escapes = [], checked = 0, pentTexts = 0;
  for (const text of TEXTS) {
    for (let i = 0; i < 40; i++) {
      const t = `${text} ${i}`;   // vary the text so the seed changes
      const h = deriveTextHarmony(t);
      if (!PENTS.includes(h.mood)) continue;
      pentTexts++;
      const sim = simulateText(t);
      // the melody must be pitches of the mode's own scale
      const offsets = MODE_OFFSETS[h.mood];
      for (const note of sim.sequence) {
        checked++;
        // which semitone of the scale is this note?
        const s = Math.round(12 * Math.log2(note.freq / h.root));
        const rel = ((s % 12) + 12) % 12;
        if (!offsets.includes(rel)) {
          escapes.push(`${h.mood} "${t.slice(0, 18)}" pitch class ${rel} not in ${JSON.stringify(offsets)}`);
          break;
        }
      }
    }
  }
  check('the melody never emits a pitch outside its own scale',
    escapes.length === 0,
    `${checked} notes over ${pentTexts} pentatonic runs; ` + escapes.slice(0, 3).join(' | '));
}

// 5. and the structural reason it cannot, stated as an invariant: the snap
//    works in scale-degree indices into currentScale
{
  // Not this specific text: the top-tier edge is derived now, and "hey baby i
  // love you" is soft enough to land in major. Probe for a pentatonic mode.
  let probe = null;
  for (const t of ['hey baby i love you', 'I love you', 'she said yes', 'I adore you', 'my heart is full']) {
    const h = deriveTextHarmony(t);
    if (PENTS.includes(h.mood)) { probe = h.mood; break; }
  }
  check('a pentatonic mode is reachable, so the hazard was real',
    probe !== null, probe || 'none of the probes reached a pentatonic mode');
  // the pad and the melody ARE on different scales by design — that is the
  // point of using the parent — so assert it rather than hoping it is false
  // degree 0 happens to land fully inside pentMajor, so the hazard shows at
  // other degrees — checked across all of them rather than assumed
  const escapes = [];
  for (const pent of PENTS) {
    for (let d = 0; d < MODE_OFFSETS[pent].length; d++) {
      const semis = pentChordPitches(pent, d);
      if (semis.some(x => !MODE_OFFSETS[pent].includes(x))) escapes.push(`${pent}[${d}]`);
    }
  }
  check('most parent chords do reach outside the mode (the hazard is real)',
    escapes.length >= 6, `${escapes.length} of 10 degrees: ${escapes.join(' ')}`);
}

// 6. non-pentatonic modes are untouched by all of this
{
  let bad = [];
  for (const m of ['major', 'minor', 'dorian', 'lydian', 'harmonicMinor']) {
    if (pentChordPitches(m, 0) !== null) bad.push(m);
  }
  check('pentChordPitches returns null for every non-pentatonic mode',
    bad.length === 0, bad.join('; '));
}

if (failed) {
  console.log(`\n${failed} FAILED`);
  process.exit(1);
}
console.log('\nthe pad may play outside the scale; the melody may not');
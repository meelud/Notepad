#!/usr/bin/env node
/**
 * test/composition.mjs
 * Zero-dependency regression test for js/music/composition.js.
 * Run: node test/composition.mjs
 */
import { deriveComposition } from '../js/music/composition.js';

let failures = 0;
function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); failures++; }
  else console.log('ok:', msg);
}

// 1. Adaptive template selection by sentence count
assert(deriveComposition('One sentence only.').sections.length === 1, '1 sentence -> 1 section');
assert(deriveComposition('First one. Second one.').sections.length === 2, '2 sentences -> 2 sections');
assert(deriveComposition('One. Two. Three.').sections.length === 3, '3 sentences -> 3 sections');
assert(deriveComposition('One. Two. Three. Four. Five.').sections.length === 4, '5 sentences -> 4 sections');
assert(
  deriveComposition('One. Two. Three. Four. Five. Six. Seven. Eight.').sections.length === 6,
  '8 sentences -> 6 sections'
);

// 2. Empty text degenerates gracefully
const empty = deriveComposition('');
assert(empty.sections.length === 1, 'empty text -> single fallback section');
assert(!isNaN(empty.getStateAt(0.5).energy), 'empty text getStateAt does not NaN');

// 3. Determinism
const text = 'It started calm. Then something shifted. Tension grew fast. Then it broke.';
const a = deriveComposition(text).getStateAt(0.6);
const b = deriveComposition(text).getStateAt(0.6);
assert(JSON.stringify(a) === JSON.stringify(b), 'same text -> identical state (determinism)');

// 4. Interpolation stays in valid numeric range across the whole piece
const comp = deriveComposition(text);
let rangeOk = true;
for (let i = 0; i <= 20; i++) {
  const s = comp.getStateAt(i / 20);
  if ([s.energy, s.tension, s.density, s.spatialDepth, s.harmonicStability].some(v => isNaN(v) || v < -0.01 || v > 1.01)) {
    rangeOk = false;
  }
}
assert(rangeOk, 'all curve values stay in [0,1] across full progress range');

// 5. Motif is sometimes inactive (point 6 requirement — motif must not always be on)
const motifStates = [0.1, 0.3, 0.5, 0.7, 0.9].map(p => comp.getStateAt(p).motifActive);
assert(motifStates.includes(false), 'motif is silenced somewhere across the piece');

// 6. Section boundaries are monotonically increasing and cover [0,1]
const secs = comp.sections;
assert(secs[0].startProgress === 0, 'first section starts at progress 0');
assert(secs[secs.length - 1].endProgress === 1, 'last section ends at progress 1');
let monotonic = true;
for (let i = 1; i < secs.length; i++) if (secs[i].startProgress < secs[i - 1].startProgress) monotonic = false;
assert(monotonic, 'section boundaries are monotonically increasing');

console.log(failures === 0 ? '\nAll composition.js tests passed.' : `\n${failures} test(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);

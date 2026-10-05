// Item 1: unstable cadence lands on 3rd/5th; clauses with no lexicon evidence get contourBias 0.
// Run: node test/cadence-intention.mjs
import assert from 'node:assert/strict';
import { deriveTextHarmony, resolveCadence, currentScale, currentMood } from '../js/music/harmony.js';
import { MODE_OFFSETS } from '../js/music/scales.js';
import { deriveIntentions } from '../js/music/intention.js';

// ── (a) weak cadence never lands on an arbitrary degree ──────────
const texts = ['I love you so much', 'I hate everything', 'the table is wooden', 'dark cold night alone', 'امروز خیلی خوشحالم'];
for (const t of texts) {
  deriveTextHarmony(t);
  const offsets = MODE_OFFSETS[currentMood] || MODE_OFFSETS.minor;
  const nearest = (target, skip0) => {
    let b = -1, bd = Infinity;
    offsets.forEach((o, i) => { if (skip0 && i === 0) return; const d = Math.abs(o - target); if (d < bd) { bd = d; b = i; } });
    return { i: b, d: bd };
  };
  const th = nearest(3.5, true), fi = nearest(7, false);
  const allowed = new Set();
  if (th.d <= 0.5 && th.i > 0) allowed.add(th.i);
  if (fi.i > 0) allowed.add(fi.i);
  if (allowed.size === 0) allowed.add(0);

  const landed = new Set();
  for (let d = 0; d < currentScale.length; d++) {
    for (const oct of [1, 2]) {
      const prev = { degree: d, octave: oct, lastInterval: 0 };
      for (const type of ['statement', 'question', 'exclaim']) {
        const n = resolveCadence(prev, type, 0, 0);
        landed.add(n.degree);
        // determinism: same input, same output
        assert.deepEqual(resolveCadence(prev, type, 0, 0), n);
      }
    }
  }
  for (const d of landed) assert.ok(allowed.has(d), `${t} [${currentMood}]: weak cadence landed on degree ${d}, allowed ${[...allowed]}`);
  // strength 1 is unchanged: statement still resolves to the tonic
  assert.equal(resolveCadence({ degree: 3 % currentScale.length, octave: 1, lastInterval: 0 }, 'statement', 1, 0).degree, 0);
}

// ── (b) no lexicon evidence → contourBias 0, cadence stays strong ─
const a = deriveIntentions('I love you. The table is wooden.');
assert.equal(a.length, 2);
assert.equal(a[1].contourBias, 0, 'neutral clause after positive must not get a negative bias');
assert.equal(a[1].cadenceStrength, 1);

// the neutral clause must not become a fake dip: third clause compares with the first
const b = deriveIntentions('I love you. The table is wooden. I love you.');
assert.equal(b[2].contourBias, 0);

// real evidence still produces a trajectory
const c = deriveIntentions('I love you. I hate this.');
assert.ok(c[1].contourBias < 0);

console.log('cadence-intention: ok');

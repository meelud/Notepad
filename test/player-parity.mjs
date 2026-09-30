/**
 * Parity test: test/player-sim.mjs must make EXACTLY the same melodic
 * decisions as the REAL play() in js/player.js.
 *
 * The real play() is run headless (stubbed DOM/WebAudio, fake clock with
 * injected timer jitter — see test/harness/); every call into
 * harmony.js's arbitrateMelodyNote / resolveCadence / motifNote is
 * recorded by an ESM loader hook (no production code is modified). The
 * sequence is compared note-for-note with simulateText(): decision
 * path, degree, octave, frequency, and — for arbitrated notes — the
 * isStrongBeat flag, the chord tone the note was pulled toward, and the
 * contrary-motion direction that were passed in.
 *
 * Usage: node --import ./test/harness/register.mjs test/player-parity.mjs
 */
import { runPlay } from './harness/run-play.mjs';
import { simulateText } from './player-sim.mjs';
import { EVAL_DATASET, LONG_TEXTS } from './eval-dataset-with-long-texts.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KIND = { arbitration: 'arb', cadence: 'cad', motif: 'motif' };
const r4 = x => Math.round(x * 1e4) / 1e4;

const texts = [...EVAL_DATASET.map(x => x[0]), ...LONG_TEXTS];
let bad = 0, notes = 0;
for (const text of texts) {
  const real = await runPlay(root, text, { jitterSeed: 42, jitterMax: 150 });
  const sim = simulateText(text).sequence;
  let problem = null;
  if (real.length !== sim.length) problem = `note count real=${real.length} sim=${sim.length}`;
  for (let i = 0; !problem && i < real.length; i++) {
    const a = real[i], b = sim[i];
    notes++;
    const diff = (field, x, y) => { if (x !== y) problem = `#${i} ${field}: real=${x} sim=${y}`; };
    diff('path', a.k, KIND[b.path]);
    diff('degree', a.degree, b.degree);
    diff('octave', a.octave, b.octave);
    diff('freq', a.freq, r4(b.freq));
    if (a.k === 'arb') {
      diff('isStrongBeat', a.strong, b.isStrongBeat);
      diff('chordDeg', a.chordDeg, b.chordArg);
      diff('contrary', a.contrary, b.contraryArg);
    }
  }
  if (problem) bad++;
  if (problem || process.env.VERBOSE) console.log(`${problem ? 'FAIL' : ' ok '}  ${text.slice(0, 40).replace(/\n/g, ' ')}${problem ? '  → ' + problem : ''}`);
}
console.log(`${texts.length - bad}/${texts.length} texts: player-sim == real play()  (${notes} notes compared)`);
process.exit(bad ? 1 : 0);

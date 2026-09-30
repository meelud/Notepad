/**
 * Acceptance test: replaying the same text under different real-time
 * jitter must yield the EXACT same melodic decision log (pitch,
 * isStrongBeat, chord target, contrary direction) from the REAL play().
 *
 * Usage: node --import ./test/harness/register.mjs test/determinism-test.mjs [rootDir]
 */
import { runPlay } from './harness/run-play.mjs';
import { EVAL_DATASET, LONG_TEXTS } from './eval-dataset-with-long-texts.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(process.argv[2] || path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
const JITTER_MAX = 150;              // ms of extra random delay per timer
const SEEDS = [1, 2, 3, 4, 5];
const N_SHORT = Number(process.env.N_SHORT ?? 12);
const texts = [
  ...EVAL_DATASET.slice(0, N_SHORT).map(x => x[0]),
  ...LONG_TEXTS,
];

let bad = 0;
const causes = { strong: 0, pitch: 0, chord: 0, contrary: 0, length: 0 };
for (const text of texts) {
  const runs = [];
  for (const s of SEEDS) runs.push(await runPlay(root, text, { jitterSeed: s, jitterMax: JITTER_MAX }));
  const ref = runs[0];
  let diverged = null;
  for (let r = 1; r < runs.length && !diverged; r++) {
    const o = runs[r];
    if (o.length !== ref.length) { diverged = { i: -1, why: 'length' }; causes.length++; break; }
    for (let i = 0; i < ref.length; i++) {
      const a = ref[i], b = o[i];
      if (a.strong !== b.strong) { diverged = { i, why: 'strong' }; causes.strong++; break; }
      if (a.chordDeg !== b.chordDeg) { diverged = { i, why: 'chord' }; causes.chord++; break; }
      if (a.contrary !== b.contrary) { diverged = { i, why: 'contrary' }; causes.contrary++; break; }
      if (a.degree !== b.degree || a.octave !== b.octave || a.freq !== b.freq) { diverged = { i, why: 'pitch' }; causes.pitch++; break; }
    }
  }
  if (diverged) bad++;
  console.log(`${diverged ? 'FAIL' : ' ok '}  notes=${String(ref.length).padStart(3)}  ${diverged ? `first divergence @note ${diverged.i} (${diverged.why})  ` : ''}${text.slice(0, 34).replace(/\n/g, ' ')}`);
}
console.log(`\n${texts.length - bad}/${texts.length} texts deterministic under jitter (${SEEDS.length} runs each, up to ${JITTER_MAX}ms/timer)`);
if (bad) console.log('first-divergence causes:', JSON.stringify(causes));
process.exit(bad ? 1 : 0);

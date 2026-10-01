/**
 * Sync test: the deterministic timeline must also be what you HEAR.
 *
 *  A) the chord ambient.js actually sounds on bar k is exactly the chord
 *     the melody assumed for bar k (chordClock.degreeAtBar(k));
 *  B) chord onsets sit on absolute bar boundaries (no cumulative slip);
 *  C) every word is heard within a bounded distance of its planned onset
 *     and that distance does not GROW over the piece (no drift).
 *
 * B/C are measured under injected timer overshoot (default 5ms ≈ a busy
 * real browser; STRESS=150 for the harsh case used by the other tests).
 *
 * Usage: node --import ./test/harness/register.mjs test/sync-test.mjs [rootDir]
 */
import { runPlay } from './harness/run-play.mjs';
import { simulateText } from './player-sim.mjs';
import { LONG_TEXTS } from './eval-dataset-with-long-texts.mjs';
import { createChordClock, BAR_MS } from '../js/music/rhythm.js';
import { deriveTextHarmony } from '../js/music/harmony.js';
import { hashText } from '../js/music/harmony.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(process.argv[2] || path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
const J = Number(process.env.STRESS ?? 5);
const mean = a => a.reduce((x, y) => x + y, 0) / (a.length || 1);

let fail = 0;
for (const text of LONG_TEXTS) {
  const { trace, chords, ambientStart } = await runPlay(root, text, { jitterSeed: 9, jitterMax: J, withTiming: true });
  const sim = simulateText(text).sequence;
  // The mode must be passed, or this builds a DIFFERENT progression from the
  // one player.js plays: player.js passes pieceMood, and since c470ae5 the
  // root set depends on it. Before that commit createChordClock(seed) was the
  // whole story and this was correct by accident; afterwards it compared the
  // audible chords against a clock that had no mode and reported
  // chordMismatch=13 of 14 bars on texts that were actually in sync.
  const mode = deriveTextHarmony(text).mood;
  const clock = createChordClock(hashText(text), mode);

  // A) audible chord == assumed chord
  const wrong = chords.filter((c, k) => c.degree !== clock.degreeAtBar(k)).length;
  // B) chord onsets vs absolute bar boundaries
  const chordDev = chords.map((c, k) => c.t - (ambientStart + k * BAR_MS));
  // C) word onsets vs plan
  const wordDev = trace.map((n, i) => n.t - (ambientStart + sim[i].startMs));
  const third = Math.floor(wordDev.length / 3);
  const early = mean(wordDev.slice(0, third)), late = mean(wordDev.slice(-third));
  const maxChordDev = Math.max(...chordDev.map(Math.abs));
  const maxWordDev = Math.max(...wordDev.map(Math.abs));

  // A word's deviation is a sum of two independent uniforms: the ±28ms
  // humanising offset and 0..J timer overshoot. With n words per third
  // the difference of the two thirds' means has std sqrt(2*var/n); a real
  // drift must exceed 4 of those, so honest sampling noise can't fail.
  const varWord = (56 ** 2 + J ** 2) / 12;
  const driftTol = 4 * Math.sqrt(2 * varWord / third);
  const ok = wrong === 0 && maxChordDev <= J + 1 && maxWordDev <= J + 60 && Math.abs(late - early) <= driftTol;
  if (!ok) fail++;
  console.log(`${ok ? ' ok ' : 'FAIL'} words=${String(trace.length).padStart(3)} bars=${String(chords.length).padStart(2)}  ` +
    `chordMismatch=${wrong}  chordDev≤${maxChordDev.toFixed(0)}ms  wordDev≤${maxWordDev.toFixed(0)}ms  ` +
    `meanDev first⅓=${early.toFixed(0)}ms last⅓=${late.toFixed(0)}ms (drift ${(late - early).toFixed(0)}ms, tol ±${driftTol.toFixed(0)})  ${text.slice(0, 22).replace(/\n/g, ' ')}`);
}
console.log(`\n${LONG_TEXTS.length - fail}/${LONG_TEXTS.length} long texts in sync (timer overshoot up to ${J}ms)`);
process.exit(fail ? 1 : 0);

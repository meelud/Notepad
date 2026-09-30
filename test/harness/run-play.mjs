import { installStubs } from './stubs.mjs';
import { installFakeClock } from './fake-clock.mjs';

/**
 * Runs the REAL play() of the player.js under `root` on `text`, under a
 * fake clock with injected timing jitter. Returns the ordered log of
 * melodic decisions.
 */
export async function runPlay(root, text, { jitterSeed = 1, jitterMax = 0, withTiming = false } = {}) {
  const clock = installFakeClock({ jitterSeed, jitterMax });
  installStubs(text);
  globalThis.__TRACE__ = [];
  globalThis.__CHORDS__ = [];
  const player = await import(`${root}/js/player.js`);
  player.resetHarmony();
  const quiet = console.error; console.error = () => {};
  try { await clock.run(player.play()); } finally { console.error = quiet; }
  const trace = globalThis.__TRACE__; globalThis.__TRACE__ = null;
  const chords = globalThis.__CHORDS__; globalThis.__CHORDS__ = null;
  if (!withTiming) return trace;
  // clearAmb() nulls the ambient start at the end of play(); the first
  // chord is sounded synchronously by startAmbient(), so its timestamp IS the start.
  return { trace, chords, ambientStart: chords.length ? chords[0].t : null };
}

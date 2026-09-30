/**
 * Three independent seeded streams. seedRng(seed) resets all of them.
 *
 *   rnd / pick    MELODIC stream — consumed only by music decisions
 *                 (harmony.js: arbitrateMelodyNote, resolveCadence, …),
 *                 called in strict text order by player.js's word loop
 *                 (and test/player-sim.mjs), so its sequence is a pure
 *                 function of the text.
 *   rrnd / rpick  RENDER stream — timbre/volume/pan/voice choice and
 *                 humanising timing offsets (voices.js, player.js).
 *   arnd / apick  AMBIENT stream — the ambient bed's own randomness.
 *
 * WHY SEPARATE: previously all of these drew from ONE stream, and the
 * ambient bed draws from it inside its own setTimeout chain. Where an
 * ambient draw landed relative to a melody draw depended on real timer
 * ordering, so the melody could change from play to play. With separate
 * streams no amount of timing jitter, and no amount of new timbre
 * randomness, can shift the melodic stream.
 */
function makeStream(salt) {
  let state = 123456789;
  return {
    seed(seed) { state = ((seed ^ salt) >>> 0) || 1; },
    next() {
      state |= 0;
      state = (state + 0x6D2B79F5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}

// salt 0 keeps the melodic stream bit-identical to the old shared one
const melodic = makeStream(0);
const render  = makeStream(0x9E3779B9);
const ambient = makeStream(0x85EBCA6B);

export function seedRng(seed) {
  melodic.seed(seed); render.seed(seed); ambient.seed(seed);
}

const mk = s => ({
  rnd: (a, b) => a + s.next() * (b - a),
  pick: arr => arr[Math.floor(s.next() * arr.length)],
});
const M = mk(melodic), R = mk(render), A = mk(ambient);

export const rnd = M.rnd,  pick = M.pick;
export const rrnd = R.rnd, rpick = R.pick;
export const arnd = A.rnd, apick = A.pick;

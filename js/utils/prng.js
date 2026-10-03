/**
 * Pure 32-bit seeded PRNG (mulberry32). No state shared with the app's
 * playback streams (utils/rng.js).
 *
 * WHY THIS EXISTS: noise buffers are filled one sample at a time, and the
 * number of samples depends on the AudioContext sample rate (44.1k vs 48k).
 * Drawing each sample from the shared render/ambient stream made the stream
 * advance a different amount per device, so the same text stopped being the
 * same piece. Voices now draw ONE number per note (noiseSeed) and fill the
 * buffer from a local generator seeded with it.
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Exactly one draw from a playback stream, as a 32-bit seed. */
export function noiseSeed(rnd) { return Math.floor(rnd(0, 4294967296)) >>> 0; }

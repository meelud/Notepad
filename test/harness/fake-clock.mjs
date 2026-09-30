/**
 * Fake wall-clock for headless runs of the REAL player.js/ambient.js.
 * Replaces setTimeout/clearTimeout/performance.now with a virtual
 * scheduler. Every timer gets an extra, independent random delay
 * ("jitter", 0..jitterMax ms) — modelling GC pauses, audio-queue
 * stalls, slow devices — drawn from a private PRNG that has nothing to
 * do with the app's own seeded rng. Two runs of the same text with
 * different jitterSeeds therefore experience different real timing.
 */
const realSetImmediate = globalThis.setImmediate;

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function installFakeClock({ jitterSeed = 1, jitterMax = 0, startAt = 1000 } = {}) {
  const rand = mulberry(jitterSeed);
  let now = startAt, seq = 0;
  const timers = new Map();
  globalThis.setTimeout = (fn, ms = 0, ...args) => {
    const id = ++seq;
    const extra = jitterMax > 0 ? rand() * jitterMax : 0;
    timers.set(id, { due: now + Math.max(0, ms) + extra, id, fn, args });
    return id;
  };
  globalThis.clearTimeout = id => { timers.delete(id); };
  Object.defineProperty(globalThis, 'performance', {
    value: { now: () => now }, configurable: true, writable: true,
  });
  const clock = {
    get now() { return now; },
    startedAt: startAt,
    async run(promise) {
      let done = false, err = null;
      promise.then(() => { done = true; }, e => { done = true; err = e; });
      for (let guard = 0; !done && guard < 5_000_000; guard++) {
        await new Promise(r => realSetImmediate(r)); // drain microtasks
        if (done) break;
        let best = null;
        for (const t of timers.values()) if (!best || t.due < best.due || (t.due === best.due && t.id < best.id)) best = t;
        if (!best) { await new Promise(r => realSetImmediate(r)); if (!done) throw new Error('deadlock: no timers, play() unresolved'); break; }
        timers.delete(best.id);
        now = Math.max(now, best.due);
        best.fn(...best.args);
      }
      if (err) throw err;
    },
  };
  return clock;
}

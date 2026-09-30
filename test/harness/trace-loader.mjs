/**
 * ESM loader hook: when player.js imports music/harmony.js, hand it a
 * thin wrapper that re-exports the REAL module (same instance, so
 * currentScale etc. stay shared) but records every melodic decision
 * (its inputs that matter here, and the note it returned) into
 * globalThis.__TRACE__. No production code is modified.
 */
const PREFIX = 'trace-harmony:';
export async function resolve(specifier, context, next) {
  const r = await next(specifier, context);
  if (r.url.endsWith('/js/music/harmony.js') && context.parentURL) {
    if (context.parentURL.endsWith('/js/player.js')) return { url: PREFIX + 'player:' + encodeURIComponent(r.url), shortCircuit: true };
    if (context.parentURL.endsWith('/js/audio/ambient.js')) return { url: PREFIX + 'ambient:' + encodeURIComponent(r.url), shortCircuit: true };
  }
  return r;
}
export async function load(url, context, next) {
  if (!url.startsWith(PREFIX)) return next(url, context);
  const rest = url.slice(PREFIX.length);
  const who = rest.slice(0, rest.indexOf(':'));
  const real = decodeURIComponent(rest.slice(rest.indexOf(':') + 1));
  if (who === 'ambient') {
    // records every chord the ambient bed ACTUALLY sounds, with real time
    return { format: 'module', shortCircuit: true, source: `
      import * as real from ${JSON.stringify(real)};
      export * from ${JSON.stringify(real)};
      export function chordFromScale(...a) {
        globalThis.__CHORDS__?.push({ degree: a[1], t: performance.now() });
        return real.chordFromScale(...a);
      }
    ` };
  }
  const source = `
    import * as real from ${JSON.stringify(real)};
    export * from ${JSON.stringify(real)};
    const T = () => globalThis.__TRACE__;
    const rec = (k, extra, n) => { T()?.push({ k, t: performance.now(), ...extra, degree: n.degree, octave: n.octave, freq: Math.round(n.freq * 1e4) / 1e4 }); return n; };
    export function arbitrateMelodyNote(...a) {
      return rec('arb', { chordDeg: a[1], strong: a[5], contrary: a[6] }, real.arbitrateMelodyNote(...a));
    }
    export function resolveCadence(...a) { return rec('cad', {}, real.resolveCadence(...a)); }
    export function motifNote(...a) { return rec('motif', {}, real.motifNote(...a)); }
  `;
  return { format: 'module', source, shortCircuit: true };
}

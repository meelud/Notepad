#!/usr/bin/env node
// ─── Render the REAL player offline and measure the mix ────────────────────
// Runs the unmodified play() of js/player.js under the same fake clock the
// tests use, but with a real (offline) Web Audio engine behind it instead of
// stubs, then analyses the result with js/audio/mix-metrics.js.
//
// DEV TOOL ONLY. It needs a Node Web Audio implementation, which the app does
// not depend on and the repo does not vendor:
//
//     npm install --no-save node-web-audio-api      # node_modules/ is gitignored
//
// Usage:
//     node tools/render-offline.mjs --text "I miss you so much."        [--wav out.wav]
//     node tools/render-offline.mjs --file texts/a.txt --no-master      # A/B: master bus off
//     node tools/render-offline.mjs --text "..." --master-db 6          # try another makeup gain
//     node tools/render-offline.mjs --text "..." --stem voices          # solo one layer: ambient | voices | punctuation
//     node tools/render-offline.mjs --text "..." --comp 0.5 --fg-db 3   # melody register compensation / foreground offset
//     node tools/render-offline.mjs --text "..." --melody-floor 110 --melody-start 440   # melody register rule (0 / 0 = the old behaviour)
//     node tools/render-offline.mjs --text "..." --max-sec 90 --sr 48000
//
// How the offline graph is made faithful to the real-time one:
//   • The whole of play() runs first (fast, on virtual time), THEN the graph is
//     rendered. Every voice starts with osc.start() — "now" — so the context
//     proxy reports currentTime = virtual time and defaults start(when) to it.
//   • disconnect() is a no-op: in real time a node is disconnected AFTER it has
//     sounded; in an offline graph that is built ahead of rendering the same call
//     would remove it from the whole timeline. Retired reverb rooms are already
//     faded to 0 by their own gain automation, so nothing audible is lost.
//   • MediaStreamDestination (the recorder tap) becomes a dead-end gain.
//   • setTargetAtTime is emulated (piecewise-linear, 4 steps per time constant,
//     10 time constants) because node-web-audio-api 2.2.0 implements it wrongly:
//     the value grows e^{+(t-T0)/tau} instead of decaying, which blew the whole
//     render up to 1e32 on the reverb's per-word updates. The emulation is
//     checked against the closed form at startup (selfTestSetTarget) and the tool
//     refuses to run if it is off by more than 1 %.
// Sample rate: default 48 kHz. The dry layers are sample-rate independent (measured:
// identical at 44.1 / 48 / 96 kHz) and so is the reverb impulse response's spectrum, but
// this engine's ConvolverNode level differs between rates in a way Chromium's documented
// normalisation (1/rms x 44100/sr) does not predict, so full-mix numbers at 44.1 or 96 kHz
// can be 2-3 dB off. Compare against a real browser export only at 48 kHz, where the
// match was checked (~0.75 dB louder offline, same crest and band shares).
// Not covered: browser-specific DynamicsCompressor implementation differences,
// and anything that depends on real-time scheduling jitter.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ── args ──────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = n => argv.includes(`--${n}`);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };

const text = opt('text') ?? (opt('file') ? fs.readFileSync(opt('file'), 'utf8') : null);
if (!text) { console.error('usage: node tools/render-offline.mjs --text "..." | --file f.txt [--wav out.wav] [--no-master] [--max-sec 120] [--sr 48000]'); process.exit(2); }
const SR = Number(opt('sr', 48000));          // 48 kHz: what the Chrome export was validated at (see header)
const MAX_SEC = Number(opt('max-sec', 120));
const wavOut = opt('wav', null);
const STEM = opt('stem', null);
if (STEM && !['ambient', 'voices', 'punctuation'].includes(STEM)) { console.error('--stem must be ambient, voices or punctuation'); process.exit(2); }
if (flag('no-master')) globalThis.__NOTEPAD_NO_MASTER__ = true;
if (['comp', 'fg-db'].some(k => opt(k) !== undefined)) globalThis.__NOTEPAD_MIX__ = { comp: opt('comp') !== undefined ? Number(opt('comp')) : undefined, fgDb: opt('fg-db') !== undefined ? Number(opt('fg-db')) : undefined };
if (opt('melody-floor') !== undefined || opt('melody-start') !== undefined) globalThis.__NOTEPAD_MELODY__ = { floor: opt('melody-floor') !== undefined ? Number(opt('melody-floor')) : undefined, startMin: opt('melody-start') !== undefined ? Number(opt('melody-start')) : undefined };
if (opt('master-db') !== undefined) globalThis.__NOTEPAD_MASTER_DB__ = Number(opt('master-db'));

let NWA;
try { NWA = await import('node-web-audio-api'); }
catch { console.error('node-web-audio-api is not installed. Run:  npm install --no-save node-web-audio-api'); process.exit(2); }

const { installStubs } = await import(pathToFileURL(path.join(root, 'test/harness/stubs.mjs')));
const { installFakeClock } = await import(pathToFileURL(path.join(root, 'test/harness/fake-clock.mjs')));
const { analyzeMix, formatMetrics } = await import(pathToFileURL(path.join(root, 'js/audio/mix-metrics.js')));

// ── the offline context behind ac() ───────────────────────────
const clock = installFakeClock({ jitterSeed: 1, jitterMax: 0 });
const T0 = clock.startedAt;
const off = new NWA.OfflineAudioContext(2, Math.ceil(SR * MAX_SEC), SR);
const now = () => (clock.now - T0) / 1000;


// ── AudioParam wrapper: faithful setTargetAtTime (see header) ──────────────
const PARAMS = ['gain', 'frequency', 'detune', 'Q', 'pan', 'playbackRate', 'offset',
                'threshold', 'knee', 'ratio', 'attack', 'release'];
const STEPS_PER_TC = 4, TCS = 10;
function wrapParam(p) {
  let cur = p.value, seg = null;                       // seg: running exponential approach
  const at = t => (seg && t >= seg.t0) ? seg.target + (seg.v0 - seg.target) * Math.exp(-(t - seg.t0) / seg.tc) : cur;
  return new Proxy(p, {
    get(t, k) {
      if (k === 'value') return t.value;
      if (k === 'setTargetAtTime') return (target, T0, tc) => {
        if (!(tc > 0)) { t.setValueAtTime(target, T0); cur = target; seg = null; return p; }
        const v0 = at(T0);
        t.cancelScheduledValues(T0);                    // a later event ends the earlier approach at T0
        t.setValueAtTime(v0, T0);
        const n = STEPS_PER_TC * TCS;
        for (let i = 1; i <= n; i++) t.linearRampToValueAtTime(target + (v0 - target) * Math.exp(-i / STEPS_PER_TC), T0 + i * tc / STEPS_PER_TC);
        seg = { t0: T0, v0, target, tc }; cur = target;
        return p;
      };
      if (k === 'setValueAtTime') return (v, T) => { t.setValueAtTime(v, T); cur = v; seg = null; return p; };
      if (k === 'linearRampToValueAtTime' || k === 'exponentialRampToValueAtTime')
        return (v, T) => { t[k](v, T); cur = v; seg = null; return p; };
      const v = t[k];
      return typeof v === 'function' ? v.bind(t) : v;
    },
    set(t, k, v) { if (k === 'value') { t.value = v; cur = v; seg = null; } else t[k] = v; return true; },
  });
}

async function selfTestSetTarget() {
  const sr = 8000, c = new NWA.OfflineAudioContext(1, sr * 2, sr);
  const src = c.createConstantSource(), g = c.createGain();
  g.gain.value = 0.8;
  const gp = wrapParam(g.gain);
  gp.setTargetAtTime(0.2, 0.5, 0.1);
  src.connect(g); g.connect(c.destination); src.start(0);
  const d = (await c.startRendering()).getChannelData(0);
  let worst = 0;
  for (const t of [0.3, 0.55, 0.7, 0.9, 1.3, 1.8]) {
    const want = t < 0.5 ? 0.8 : 0.2 + (0.8 - 0.2) * Math.exp(-(t - 0.5) / 0.1);
    worst = Math.max(worst, Math.abs(d[Math.round(t * sr)] - want) / want);
  }
  if (worst > 0.01) { console.error(`setTargetAtTime emulation is off by ${(worst * 100).toFixed(1)} % — refusing to produce numbers`); process.exit(3); }
}
await selfTestSetTarget();

const SCHEDULED = new Set(['OscillatorNode', 'AudioBufferSourceNode', 'ConstantSourceNode']);
function wrapNode(n) {
  if (!n || typeof n !== 'object') return n;
  if (SCHEDULED.has(n.constructor?.name)) {
    const start = n.start.bind(n);
    n.start = (when, ...r) => start(when === undefined ? now() : when, ...r);
  }
  n.disconnect = () => {};
  if (STEM && SCHEDULED.has(n.constructor?.name)) {
    // which layer made this source? the first js/audio/<file>.js frame in the stack.
    // Reverb is shared on purpose: a solo layer is heard with its own room send.
    const frame = new Error().stack.split('\n').find(l => /js\/audio\/(ambient|punctuation|voices)\.js/.test(l)) || '';
    const layer = (frame.match(/(ambient|punctuation|voices)\.js/) || [])[1];
    if (layer !== STEM) { n.start = () => {}; n.stop = () => {}; }
  }
  for (const name of PARAMS) {
    let p; try { p = n[name]; } catch { continue; }
    if (p && typeof p.setValueAtTime === 'function') Object.defineProperty(n, name, { value: wrapParam(p), configurable: true });
  }
  return n;
}
const ctxProxy = new Proxy(off, {
  get(t, k) {
    if (k === 'currentTime') return now();
    if (k === 'resume') return () => Promise.resolve();
    if (k === 'createMediaStreamDestination') return () => wrapNode(off.createGain());
    const v = t[k];
    if (typeof v === 'function') {
      return (...a) => {
        const r = v.apply(t, a);
        return (typeof k === 'string' && k.startsWith('create')) ? wrapNode(r) : r;
      };
    }
    return v;
  },
});

installStubs(text);
globalThis.window.AudioContext = function () { return ctxProxy; };
globalThis.MediaRecorder = undefined;               // no recorder offline; player tolerates it

// ── run the real play() ───────────────────────────────────────
const player = await import(pathToFileURL(path.join(root, 'js/player.js')));
player.resetHarmony();
const quiet = console.error; console.error = () => {};
try { await clock.run(player.play()); } finally { console.error = quiet; }
const playedSec = now();

const buf = await off.startRendering();
let L = buf.getChannelData(0), R = buf.getChannelData(1);

// trim trailing silence (keep 0.5 s) so the metrics are not diluted by the unused part of the buffer
let end = L.length;
while (end > 0 && Math.abs(L[end - 1]) < 1e-5 && Math.abs(R[end - 1]) < 1e-5) end--;
end = Math.min(L.length, end + Math.round(0.5 * SR));
L = L.slice(0, end); R = R.slice(0, end);

const M = analyzeMix([L, R], SR);
if (flag('json')) { console.log(JSON.stringify({ playedSec, ...M })); process.exit(0); }
if (SR !== 48000 && !flag('json')) console.log(`  note: ${SR} Hz — not the validated rate; reverb level in this engine varies with sample rate (see header)`);
console.log(`${STEM ? 'stem: ' + STEM + ' | ' : ''}${flag('no-master') ? 'master OFF' : 'master as configured'}  |  played ${playedSec.toFixed(1)} s  |  rendered ${(end / SR).toFixed(1)} s @ ${SR} Hz`);
if (playedSec > MAX_SEC - 2) console.log(`  WARNING: piece (${playedSec.toFixed(0)} s) is close to --max-sec ${MAX_SEC}; raise it`);
console.log(formatMetrics(M));

if (wavOut) {
  const data = Buffer.alloc(end * 4);
  for (let i = 0; i < end; i++) {
    data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(L[i] * 32767))), i * 4);
    data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(R[i] * 32767))), i * 4 + 2);
  }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVEfmt ', 8);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(2, 22);
  h.writeUInt32LE(SR, 24); h.writeUInt32LE(SR * 4, 28); h.writeUInt16LE(4, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  fs.writeFileSync(wavOut, Buffer.concat([h, data]));
  console.log(`  wrote ${wavOut}`);
}
process.exit(0);

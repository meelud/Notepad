// Audio P1 regressions: (1) reverb rebuild is faded, never null; (2) noise
// buffers do not make the render stream sample-rate dependent; (3) the
// vibraphone tremolo cannot outlive its envelope.
import { installStubs } from './harness/stubs.mjs';

let bad = 0;
const ok = (c, m) => { if (!c) { bad++; console.log(' FAIL ', m); } };

// ── recording fake AudioContext ───────────────────────────────
const param = () => ({ value: 0, ramped: false, calls: [], setValueAtTime() {}, linearRampToValueAtTime() {},
  exponentialRampToValueAtTime() { this.ramped = true; }, setTargetAtTime(...a) { this.calls.push(a); } });
const made = [];
const node = kind => { const n = { kind, gain: param(), frequency: param(), detune: param(), Q: param(), out: [],
  disconnected: 0, buffer: null, connect(t) { this.out.push(t); return t; }, disconnect() { this.disconnected++; },
  start() {}, stop() {} }; made.push(n); return n; };
const ctx = { sampleRate: 44100, currentTime: 0, destination: node('dest'),
  createGain: () => node('gain'), createOscillator: () => node('osc'), createBiquadFilter: () => node('filter'),
  createConvolver: () => node('conv'), createBufferSource: () => node('src'),
  createBuffer: (ch, len) => { const d = Array.from({ length: ch }, () => new Float32Array(len));
    return { length: len, getChannelData: i => d[i] }; } };
installStubs('');
globalThis.window.AudioContext = function () { return ctx; };

const { seedRng, rrnd } = await import('../js/utils/rng.js');
const { mulberry32, noiseSeed } = await import('../js/utils/prng.js');
const { VOICES } = await import('../js/audio/voices.js');
const R = await import('../js/audio/reverb.js');

// ── 2. determinism across sample rates ────────────────────────
const tail = sr => { ctx.sampleRate = sr; seedRng(4242);
  VOICES[5](440, 0.5, 1, []); VOICES[20](440, 0.5, 1, []); VOICES[5](330, 0.5, 2, []);
  return [rrnd(0, 1), rrnd(0, 1), rrnd(0, 1)]; };
const a = tail(44100), b = tail(48000);
ok(a.every((x, i) => x === b[i]), `render stream diverges across sample rates: ${a} vs ${b}`);
seedRng(7); const before = rrnd(0, 1); seedRng(7); noiseSeed(rrnd); const after = rrnd(0, 1);
seedRng(7); rrnd(0, 1); const one = rrnd(0, 1);
ok(after === one && before !== after, 'noiseSeed must consume exactly one draw');
const m1 = mulberry32(5), m2 = mulberry32(5);
ok(m1() === m2() && m1() === m2(), 'mulberry32 is deterministic');

// ── 3. vibraphone: LFO must not feed an enveloped (exp-ramped) param ──
ctx.sampleRate = 44100; made.length = 0;
VOICES[10](440, 0.5, 1, []);
const lfoGain = made.find(n => n.kind === 'gain' && n.out.some(t => t && typeof t.setTargetAtTime === 'function')); // a gain wired into an AudioParam
ok(!!lfoGain, 'vibraphone: LFO depth node not found');
ok(lfoGain && !lfoGain.out[0].ramped, 'vibraphone: LFO is summed onto the envelope param (tail never decays)');

// ── 1. reverb: faded retire, never null ───────────────────────
const timers = []; const realST = globalThis.setTimeout;
globalThis.setTimeout = (f, ms) => { timers.push({ f, ms }); return 0; };
const nonNull = () => [R.getReverbNode(), R.getLeadSend(), R.getPadSend(), R.getFxSend()].every(Boolean);
ok(nonNull(), 'getters null before the first room');
R.ensureReverb([ctx.destination], { normScore: 0, density: 1, energy: 0.5 }, 1);
const oldLead = R.getLeadSend(); ok(nonNull(), 'null after first ensureReverb');
made.length = 0;
R.resetReverb();                       // what play() does before its await
ok(nonNull(), 'getters null between resetReverb and ensureReverb');
ok(timers.length === 1, 'old room not scheduled for delayed disconnect');
const oldNodes = timers.length ? timers[0].f : null;
R.ensureReverb([ctx.destination], { normScore: 0, density: 1, energy: 0.5 }, 2);
ok(R.getLeadSend() !== oldLead, 'new room not swapped in');
ok(nonNull(), 'getters null after rebuild');
R.updateReverb({ normScore: 0, density: 1, energy: 0.5 });
const oldWet = [...made].length; // new graph nodes only; old ones were created earlier
ok(oldLead.disconnected === 0, 'old room was disconnected instantly (click)');
if (oldNodes) oldNodes();
ok(oldLead.disconnected === 1, 'old room never disconnected after the fade');
globalThis.setTimeout = realST;

console.log(bad ? `\n${bad} FAILED` : 'audio P1: all passed');
process.exit(bad ? 1 : 0);

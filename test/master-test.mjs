// js/audio/master.js: the shaper TABLE never exceeds the ceiling, the knee is
// transparent, and the wiring puts the bus in front of BOTH the speakers and the
// recorder tap. (The oversampling filter's overshoot is a property of the browser's
// resampler, not of this table; it is measured offline — see master.js header.)
import { installStubs } from './harness/stubs.mjs';

let bad = 0;
const ok = (c, m) => { if (!c) { bad++; console.log(' FAIL ', m); } };
const near = (a, b, tol, m) => ok(Math.abs(a - b) <= tol, `${m}: got ${a}, want ${b} ±${tol}`);

// ── recording fake AudioContext ───────────────────────────────
const made = [];
const param = v => ({ value: v });
const node = (kind, extra = {}) => { const n = { kind, out: [], connect(t) { this.out.push(t); return t; }, disconnect() {}, ...extra }; made.push(n); return n; };
const ctx = { sampleRate: 44100, currentTime: 0, destination: node('dest'),
  createGain: () => node('gain', { gain: param(1) }),
  createWaveShaper: () => node('shaper', { curve: null, oversample: 'none' }) };
installStubs('');
globalThis.window.AudioContext = function () { return ctx; };

const M = await import('../js/audio/master.js');
const { softCeiling, buildCurve, createMasterBus, MASTER_KNEE: K, MASTER_CEILING: C, MASTER_GAIN_DB } = M;

// ── 1. the transfer function ──────────────────────────────────
for (const x of [0, 0.1, -0.3, K, -K]) near(softCeiling(x), x, 1e-12, `identity at or below the knee (${x})`);
for (const x of [0.7, 1, 1.7, 10, 1e6]) {
  ok(softCeiling(x) <= C + 1e-12, `never above the ceiling (${x} → ${softCeiling(x)})`);
  near(softCeiling(-x), -softCeiling(x), 1e-12, `odd symmetry (${x})`);
}
let prev = -Infinity, mono = true;
for (let i = -4000; i <= 4000; i++) { const y = softCeiling(i / 1000); if (y < prev) mono = false; prev = y; }
ok(mono, 'monotonic non-decreasing on [-4, 4]');
const e = 1e-6;
near((softCeiling(K + e) - softCeiling(K)) / e, 1, 1e-4, 'slope is 1 just above the knee (no kink)');
near((softCeiling(K) - softCeiling(K - e)) / e, 1, 1e-4, 'slope is 1 just below the knee');
ok(softCeiling(1e6) > C - 1e-9, 'the ceiling is actually reached for a very hot input');

// ── 2. the table, as WaveShaper will read it ──────────────────
const curve = buildCurve();
ok(curve.length >= 4097 && curve.length % 2 === 1, 'odd-length table, so 0 sits exactly on a sample');
near(curve[(curve.length - 1) / 2], 0, 1e-9, 'table centre is 0');
ok(curve[0] < 0 && curve[curve.length - 1] > 0 && Math.abs(curve[0] + curve[curve.length - 1]) < 1e-6, 'table is odd-symmetric');

// ── 3. wiring ─────────────────────────────────────────────────
const outSpeakers = node('speakers'), outTap = node('tap');
made.length = 0;
const bus = createMasterBus([outSpeakers, outTap]);
const [input, shaper] = made;
ok(bus.input === input && input.kind === 'gain', 'input is a gain node');
ok(shaper && shaper.kind === 'shaper', 'a WaveShaper follows the input');
ok(input.out.length === 1 && input.out[0] === shaper, 'input feeds ONLY the shaper (nothing bypasses the ceiling)');
ok(shaper.out.length === 2 && shaper.out.includes(outSpeakers) && shaper.out.includes(outTap), 'shaper feeds the speakers AND the recorder tap');
ok(shaper.oversample === '4x', 'shaper is oversampled to keep the clipping products out of the audible band');
ok(shaper.curve && shaper.curve.length === curve.length, 'shaper has the curve');
near(input.gain.value, Math.pow(10, MASTER_GAIN_DB / 20) / 2, 1e-9, 'input gain = makeup / shaper range');

// ── 4. end to end: gain → shaper table, read the way WaveShaper reads it ──
const readTable = u => { // linear interpolation over u in [-1, 1]; WaveShaper clamps outside
  const p = (Math.max(-1, Math.min(1, u)) + 1) / 2 * (shaper.curve.length - 1);
  const i = Math.floor(p), f = p - i;
  return shaper.curve[i] * (1 - f) + shaper.curve[Math.min(i + 1, shaper.curve.length - 1)] * f;
};
const through = x => readTable(x * input.gain.value);
const makeup = Math.pow(10, MASTER_GAIN_DB / 20);
let worst = 0, over = 0;
for (let x = -8; x <= 8; x += 0.01) {
  const y = through(x);
  if (Math.abs(y) > C + 1e-4) over++;
  if (Math.abs(x) * makeup <= K) worst = Math.max(worst, Math.abs(y - x * makeup));
}
ok(over === 0, `the table output stays under the ceiling for inputs up to ±8 (${over} samples over)`);
ok(worst < 2e-4, `below the knee the bus is exactly the makeup gain (worst error ${worst})`);

// ── 5. bypass (used by the A/B tooling) ───────────────────────
globalThis.__NOTEPAD_NO_MASTER__ = true;
made.length = 0;
const byp = createMasterBus([outSpeakers]);
ok(made.length === 1 && byp.input.out.length === 1 && byp.input.out[0] === outSpeakers && byp.input.gain.value === 1,
   'bypass is a unity gain straight to the outputs');
globalThis.__NOTEPAD_NO_MASTER__ = false;

if (bad) { console.log(`${bad} failure(s)`); process.exit(1); }
console.log('master bus: table ceiling holds, knee is transparent, bus sits in front of speakers and recorder');

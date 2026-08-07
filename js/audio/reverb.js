import { ac } from './context.js';
import { rnd } from '../utils/rng.js';

// ─── State ──────────────────────────────────────────────────────
let reverbNode = null;
let reverbSend = null;

// ─── Public API ─────────────────────────────────────────────────
export function getReverbNode() { return reverbNode; }

export function resetReverb() {
  reverbNode = null;
  reverbSend = null;
}

// ─── Convolver builder ──────────────────────────────────────────
/**
 * Builds a stereo convolution reverb from a synthetic impulse response.
 * The IR is random noise shaped by an exponential decay curve.
 * @param {AudioContext} c
 * @returns {ConvolverNode}
 */
function buildReverb(c) {
  const dur = 4.5,    // reverb tail length in seconds
        decay = 2.2;  // exponential decay exponent (higher = faster falloff)
  const len = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++)
      d[i] = (rnd(0, 2) - 1) * Math.pow(1 - i / len, decay);
  }
  const conv = c.createConvolver();
  conv.buffer = buf;
  return conv;
}

// ─── Init ───────────────────────────────────────────────────────
/**
 * Creates the reverb node once and connects it to all destinations.
 * Safe to call multiple times — only builds on first call.
 * @param {AudioNode[]} dests
 * @param {number} [wetness=0.38] — dry/wet send level (0 = dry, 1 = full wet)
 */
export function ensureReverb(dests, wetness = 0.38) {
  const c = ac();
  if (!reverbNode) {
    reverbNode = buildReverb(c);
    reverbSend = c.createGain();
    reverbSend.gain.value = wetness; // dry/wet mix (0 = dry, 1 = full wet)
    reverbNode.connect(reverbSend);
    dests.forEach(d => reverbSend.connect(d));
  }
}

import { ac } from './context.js';
import { rnd } from '../utils/rng.js';

let reverbNode = null;
let reverbSend = null;

export function getReverbNode() { return reverbNode; }

export function resetReverb() {
  reverbNode = null;
  reverbSend = null;
}

function buildReverb(c) {
  const dur = 4.5, decay = 2.2;
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

export function ensureReverb(dests) {
  const c = ac();
  if (!reverbNode) {
    reverbNode = buildReverb(c);
    reverbSend = c.createGain();
    reverbSend.gain.value = 0.38;
    reverbNode.connect(reverbSend);
    dests.forEach(d => reverbSend.connect(d));
  }
}

import { ac } from './context.js';
import { computeReverbProfile, renderStereoImpulse } from './reverb-math.js';

// ─── State ──────────────────────────────────────────────────────
let reverbNodes = []; // every node created for this room — for teardown
let erConv = null;
let tailConv = null;
let wetGain = null;  // wet return level (post-convolver)
let erGain = null;   // early-reflection blend
let leadSend = null; // word voices feed here
let padSend = null;  // ambient pads feed here
let fxSend = null;   // punctuation feeds here

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ─── Internal graph helpers ──────────────────────────────────────
function track(node) { reverbNodes.push(node); return node; }

/** Builds the full reverb graph (send buses → early refs + diffuse tail → wet return). */
function buildGraph(c, dests) {
  leadSend = track(c.createGain());
  padSend = track(c.createGain());
  fxSend = track(c.createGain());

  erConv = track(c.createConvolver());
  tailConv = track(c.createConvolver());
  erGain = track(c.createGain());
  wetGain = track(c.createGain());

  // each role bus fans into BOTH the early-reflection room and the tail room
  [leadSend, padSend, fxSend].forEach(send => {
    send.connect(erConv);
    send.connect(tailConv);
  });
  // early reflections blend against the main tail, then the combined
  // reverberant signal is the wet return → destinations
  erConv.connect(erGain);
  tailConv.connect(wetGain);
  erGain.connect(wetGain);
  // one wet return per destination (dests already includes c.destination
  // at the call site — connecting it twice would double the wet level)
  dests.forEach(d => wetGain.connect(d));
}

/** Renders a stereo buffer pair for a profile and assigns it to a convolver. */
function setProfileIR(c, convolver, profile, seed) {
  const [l, r] = renderStereoImpulse(c.sampleRate, profile, seed);
  const buf = c.createBuffer(2, l.length, c.sampleRate);
  buf.getChannelData(0).set(l);
  buf.getChannelData(1).set(r);
  convolver.buffer = buf;
}

/** Applies a profile: renders + assigns both IRs and sets all levels. */
function applyProfile(c, profile, seed) {
  // early-reflection IR shares the room's character but shorter/denser
  const erProfile = {
    ...profile,
    impulseDuration: Math.max(0.18, profile.preDelay * 6),
    damping: profile.damping + 0.15,
  };
  setProfileIR(c, erConv, erProfile, seed);
  setProfileIR(c, tailConv, profile, seed + 0x1234567);

  wetGain.gain.value = profile.wet;
  erGain.gain.value = profile.erLevel;
  leadSend.gain.value = profile.roleSend.lead;
  padSend.gain.value = profile.roleSend.pad;
  fxSend.gain.value = profile.roleSend.fx;
}

// ─── Public API ─────────────────────────────────────────────────
// getReverbNode() is kept for voices.js backward compatibility — it now
// returns the LEAD send bus (word voices), so existing voice code that
// does `g.connect(rev)` routes through the per-role send unchanged.
export function getReverbNode() { return leadSend; }
export function getLeadSend() { return leadSend; }
export function getPadSend() { return padSend; }
export function getFxSend() { return fxSend; }

/**
 * Creates (or rebuilds) the reverb room for a perceptual state.
 * Call on composition changes (start, paragraph/sentence shifts).
 * @param {AudioNode[]} dests
 * @param {Object} [state] { normScore, density, energy, role }
 * @param {number} [seed]
 */
export function ensureReverb(dests, state = {}, seed = 0xCAFE) {
  const c = ac();
  resetReverb();
  buildGraph(c, dests);
  const profile = computeReverbProfile(state);
  applyProfile(c, profile, seed);
}

/**
 * Smoothly updates live parameters (wet, early reflections, role sends)
 * without rebuilding impulse responses. Sized for per-word density/energy
 * changes — short exp smoothing makes moves gradual, not clicks.
 * @param {Object} state { normScore, density, energy }
 */
export function updateReverb(state = {}) {
  if (!wetGain || !erGain) return;
  const c = ac();
  const profile = computeReverbProfile(state);
  const t = c.currentTime;
  const k = 0.05;
  wetGain.gain.setTargetAtTime(profile.wet, t, k);
  erGain.gain.setTargetAtTime(profile.erLevel, t, k);
  leadSend.gain.setTargetAtTime(profile.roleSend.lead, t, k);
  padSend.gain.setTargetAtTime(profile.roleSend.pad, t, k);
  fxSend.gain.setTargetAtTime(profile.roleSend.fx, t, k);
}

export function resetReverb() {
  reverbNodes.forEach(n => {
    try { n.disconnect(); } catch (e) {}
  });
  reverbNodes = [];
  erConv = null;
  tailConv = null;
  wetGain = null;
  erGain = null;
  leadSend = null;
  padSend = null;
  fxSend = null;
}
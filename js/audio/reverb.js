import { ac } from './context.js';
import { computeReverbProfile, renderStereoImpulse, registerModifier } from './reverb-math.js';

// ─── State ──────────────────────────────────────────────────────
let reverbNodes = []; // every node created for this room — for teardown
let erConv = null;
let tailConv = null;
let wetGain = null;  // wet return level (post-convolver)
let erGain = null;   // early-reflection blend
let leadSend = null; // word voices feed here
let padSend = null;  // ambient pads feed here
let fxSend = null;   // punctuation feeds here

let live = false;     // false once the current graph has been retired
let silentBus = null; // never-connected sink: what getters return before any room exists

// A retired room is faded, not cut: its wet return falls to 0 over a few
// time constants and its nodes are disconnected only after that, so notes
// still ringing do not lose their wet path with a click.
const RETIRE_TC = 0.08;   // seconds (exp time constant → ~-76 dB at RETIRE_MS)
const RETIRE_MS = 700;

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
// Getters NEVER return null: before the first room (or if a voice fires
// between a reset and a rebuild) they hand back a send that is either the
// retired room (fading out) or a silent unconnected bus, so `g.connect(rev)`
// cannot throw a TypeError.
const bus = n => n || silentBus || (silentBus = ac().createGain());
export function getReverbNode() { return bus(leadSend); }
export function getLeadSend() { return bus(leadSend); }
export function getPadSend() { return bus(padSend); }
export function getFxSend() { return bus(fxSend); }

/**
 * Creates (or rebuilds) the reverb room for a perceptual state.
 * Call on composition changes (start, paragraph/sentence shifts).
 * @param {AudioNode[]} dests
 * @param {Object} [state] { normScore, density, energy, role }
 * @param {number} [seed]
 */
export function ensureReverb(dests, state = {}, seed = 0xCAFE) {
  const c = ac();
  // Build the NEW room completely (synchronously, so no caller can observe a
  // half-built one), then retire the old. The old room is never torn down
  // before the new one exists.
  resetReverb();            // fades + schedules disconnect of the old room
  buildGraph(c, dests);
  const profile = computeReverbProfile(state);
  applyProfile(c, profile, seed);
  live = true;
}

/**
 * Smoothly updates live parameters (wet, early reflections, role sends)
 * without rebuilding impulse responses. Sized for per-word density/energy
 * changes — short exp smoothing makes moves gradual, not clicks.
 * Register-aware: if `frequency` is provided, all three role sends are
 * scaled by registerModifier(frequency) so bass notes excite more room
 * modes and treble notes stay more direct.
 * @param {Object} state { normScore, density, energy, frequency? }
 */
export function updateReverb(state = {}) {
  if (!live || !wetGain || !erGain) return;
  const c = ac();
  const profile = computeReverbProfile(state);
  const t = c.currentTime;
  const k = 0.05;
  const regMod = registerModifier(state.frequency || 440);
  wetGain.gain.setTargetAtTime(profile.wet, t, k);
  erGain.gain.setTargetAtTime(profile.erLevel, t, k);
  leadSend.gain.setTargetAtTime(profile.roleSend.lead * regMod, t, k);
  padSend.gain.setTargetAtTime(profile.roleSend.pad * regMod, t, k);
  fxSend.gain.setTargetAtTime(profile.roleSend.fx * regMod, t, k);
}

/**
 * Retires the current room: fade its wet return to 0, disconnect after the
 * fade. Idempotent. The module refs are left pointing at the retired room
 * (silent and harmless) rather than nulled, so getters stay non-null.
 */
export function resetReverb() {
  live = false;
  if (!reverbNodes.length) return;
  const old = reverbNodes, oldWet = wetGain;
  reverbNodes = [];
  try {
    const c = ac();
    if (oldWet) oldWet.gain.setTargetAtTime(0, c.currentTime, RETIRE_TC);
  } catch (e) {}
  setTimeout(() => {
    old.forEach(n => { try { n.disconnect(); } catch (e) {} });
  }, RETIRE_MS);
}

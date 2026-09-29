import { ac } from './context.js';
import { getPadSend } from './reverb.js';
// the ambient bed's own randomness lives on its OWN stream (utils/rng.js)
import { arnd as rnd, apick as pick } from '../utils/rng.js';
import { BEAT_SEC, BEAT_MS, BAR_BEATS, createChordClock } from '../music/rhythm.js';
import { currentScale, chordFromScale } from '../music/harmony.js';

// ─── State ──────────────────────────────────────────────────────
let ambTimers = [];
let clockRunning = false;
let ambientDensity = 1;


// ─── Public API ─────────────────────────────────────────────────
export function setAmbientDensity(v) { ambientDensity = v; }

// Live harmonic context: the scale-degree root of whichever chord is
// currently sounding in the ambient bed. Updated once per bar (every
// time tick() picks a new chord), read by player.js so melody notes
// can be chord-aware instead of blind to what's harmonizing underneath
// them. null before the first chord of a session has been chosen.
let currentChordRootDegree = null;
export function getCurrentChordDegree() { return currentChordRootDegree; }

// Direction the chord root just moved (-1 down, 0 none/first chord, +1
// up), for contrary-motion melody bias — see harmonizeNote's caller.
let currentChordDirection = 0;
export function getChordDirection() { return currentChordDirection; }

// performance.now() at the moment the ambient clock started. player.js
// anchors its word schedule to this (ambientStart + virtualMs) so words
// land on the audible bars. It only positions sounds in time; it is
// never an input to a musical decision (those use music/rhythm.js's
// virtual timeline — see there for why).
let ambientStartTime = null;
export function getAmbientStartTime() { return ambientStartTime; }

export function clearAmb() {
  ambTimers.forEach(id => clearTimeout(id));
  ambTimers = [];
  clockRunning = false;
  currentChordRootDegree = null;
  currentChordDirection = 0;
  ambientStartTime = null;
}

// ─── Ambient clock ──────────────────────────────────────────────
/**
 * Starts a looping clock that plays chords, pulses, and motif notes.
 * Density scales the volume of all ambient layers.
 * @param {AudioNode[]} dests — audio destinations
 * @param {() => boolean} isStopping — callback to check if playback stopped
 * @param {{degreeAtBar:(n:number)=>number, directionAtBar:(n:number)=>number}} [chordClock]
 *        deterministic progression from music/rhythm.js's createChordClock;
 *        the SAME object player.js uses to pick chord tones, so the chord
 *        the melody assumes is the chord you actually hear.
 */
export function startAmbient(dests, isStopping, chordClock = createChordClock(1)) {
  const c = ac();
  const rev = getPadSend();
  clockRunning = true;
  ambientStartTime = performance.now();
  let beat = 0;
  let lastDegree = null;

  function playChord(freqs, dur) {
    const detunes = [-7, 7, 0, 4];
    freqs.forEach((f, idx) => {
      const type = idx === 0 ? 'sine' : (idx % 2 === 0 ? 'sine' : 'sawtooth');
      const osc = c.createOscillator(), g = c.createGain();
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1200; lp.Q.value = 0.4;
      osc.type = type; osc.frequency.value = f; osc.detune.value = detunes[idx % detunes.length];
      const peak = (idx === 0 ? 0.085 : 0.05) * ambientDensity;
      const attack = dur * 0.35, release = dur * 0.5;
      g.gain.setValueAtTime(0, c.currentTime);
      g.gain.linearRampToValueAtTime(peak, c.currentTime + attack);
      g.gain.setValueAtTime(peak, c.currentTime + dur - release);
      g.gain.linearRampToValueAtTime(0, c.currentTime + dur);
      osc.connect(lp); lp.connect(g); g.connect(rev);
      dests.forEach(d => g.connect(d));
      osc.start(); osc.stop(c.currentTime + dur + 0.1);
    });
  }

  function playPulse() {
    const osc = c.createOscillator(), g = c.createGain();
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 180;
    osc.type = 'sine'; osc.frequency.value = 55;
    const dur = BEAT_SEC * 0.8;
    g.gain.setValueAtTime(0, c.currentTime);
    g.gain.linearRampToValueAtTime(0.09 * ambientDensity, c.currentTime + 0.04);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
    osc.connect(lp); lp.connect(g);
    dests.forEach(d => g.connect(d));
    osc.start(); osc.stop(c.currentTime + dur + 0.05);
  }

  function playMotifNote() {
    const f = pick(currentScale) * 2;
    const osc = c.createOscillator(), g = c.createGain();
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2000;
    osc.type = 'sine'; osc.frequency.value = f;
    const dur = BEAT_SEC * rnd(1.4, 2.2);
    g.gain.setValueAtTime(0, c.currentTime);
    g.gain.linearRampToValueAtTime(rnd(0.03, 0.055) * ambientDensity, c.currentTime + 0.12);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
    osc.connect(lp); lp.connect(g); g.connect(rev);
    dests.forEach(d => g.connect(d));
    osc.start(); osc.stop(c.currentTime + dur + 0.1);
  }

  function playTapeWarmth(dur) {
    const buf = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
    const d = buf.getChannelData(0);
    for (let j = 0; j < d.length; j++) d[j] = (rnd(0, 2) - 1) * 0.4;
    const src = c.createBufferSource(); src.buffer = buf;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 3200; bp.Q.value = 0.5;
    const g = c.createGain();
    const attack = dur * 0.3, release = dur * 0.3;
    g.gain.setValueAtTime(0, c.currentTime);
    g.gain.linearRampToValueAtTime(0.015 * ambientDensity, c.currentTime + attack);
    g.gain.setValueAtTime(0.015 * ambientDensity, c.currentTime + dur - release);
    g.gain.linearRampToValueAtTime(0, c.currentTime + dur);
    src.connect(bp); bp.connect(g);
    dests.forEach(dd => g.connect(dd));
    src.start();
  }

  function tick() {
    if (isStopping() || !clockRunning) return;
    const beatInBar = beat % BAR_BEATS;
    const barDur = BEAT_SEC * BAR_BEATS;

    if (beatInBar === 0) {
      const bar = Math.floor(beat / BAR_BEATS);
      const degree = chordClock.degreeAtBar(bar);
      currentChordDirection = chordClock.directionAtBar(bar);
      lastDegree = degree;
      currentChordRootDegree = degree;
      playChord(chordFromScale(currentScale, degree), barDur * 1.15);
      playTapeWarmth(barDur * 1.1);
    }

    if (beatInBar === 0 || beatInBar === 2) playPulse();

    if (rnd(0, 1) < 0.32 * ambientDensity && (beatInBar === 1 || beatInBar === 3)) {
      playMotifNote();
    }

    beat++;
    // Drift-corrected: schedule against the ABSOLUTE start time, not
    // "1.15s after whenever this tick happened to run" — chained
    // relative timeouts accumulate a few ms per beat (measured minutes
    // of slip over a long piece), which would slowly pull the audible
    // bars away from the timeline the words are scheduled on.
    const nextAt = ambientStartTime + beat * BEAT_MS;
    ambTimers.push(setTimeout(tick, Math.max(0, nextAt - performance.now())));
  }

  tick();
}

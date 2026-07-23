import { ac } from './context.js';
import { getReverbNode } from './reverb.js';
import { rnd, pick } from '../utils/rng.js';
import { currentScale } from '../music/harmony.js';

let ambTimers = [];
let clockRunning = false;
let ambientDensity = 1;

const BEAT_SEC = 1.15;
const BAR_BEATS = 4;
const CHORD_DEGREES = [0, 2, 4, 6];

export function setAmbientDensity(v) { ambientDensity = v; }

export function clearAmb() {
  ambTimers.forEach(id => clearTimeout(id));
  ambTimers = [];
  clockRunning = false;
}

function chordFromScaleLocal(scale, degreeRoot) {
  const len = scale.length;
  const root    = scale[degreeRoot % len] * (degreeRoot >= len ? 2 : 1);
  const third   = scale[(degreeRoot + 2) % len] * ((degreeRoot + 2) >= len ? 2 : 1);
  const fifth   = scale[(degreeRoot + 4) % len] * ((degreeRoot + 4) >= len ? 2 : 1);
  const seventh = scale[(degreeRoot + 6) % len] * ((degreeRoot + 6) >= len ? 2 : 1);
  return [root, third, fifth, seventh];
}

export function startAmbient(dests, isStopping) {
  const c = ac();
  const rev = getReverbNode();
  clockRunning = true;
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
      let degree = pick(CHORD_DEGREES);
      if (degree === lastDegree) degree = pick(CHORD_DEGREES.filter(d => d !== lastDegree));
      lastDegree = degree;
      playChord(chordFromScaleLocal(currentScale, degree), barDur * 1.15);
      playTapeWarmth(barDur * 1.1);
    }

    if (beatInBar === 0 || beatInBar === 2) playPulse();

    if (rnd(0, 1) < 0.32 * ambientDensity && (beatInBar === 1 || beatInBar === 3)) {
      playMotifNote();
    }

    beat++;
    ambTimers.push(setTimeout(tick, BEAT_SEC * 1000));
  }

  tick();
}

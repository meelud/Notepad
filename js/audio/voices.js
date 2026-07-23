import { ac } from './context.js';
import { getReverbNode } from './reverb.js';
import { rnd, pick } from '../utils/rng.js';

export const VOICES = [
  // 0 — Soft pad
  (freq, vol, dur, dests) => {
    const c = ac(); const rev = getReverbNode();
    [[freq,'sine',1.0],[freq*0.5,'sine',0.4],[freq*2,'triangle',0.12]].forEach(([f,type,lv]) => {
      const osc = c.createOscillator(), g = c.createGain();
      osc.type = type; osc.frequency.value = f;
      g.gain.setValueAtTime(0, c.currentTime);
      g.gain.linearRampToValueAtTime(vol*lv*0.7, c.currentTime+0.12);
      g.gain.setValueAtTime(vol*lv*0.7, c.currentTime+dur*0.6);
      g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime+dur+0.5);
      osc.connect(g); g.connect(rev);
      dests.forEach(d => g.connect(d));
      osc.start(); osc.stop(c.currentTime+dur+0.6);
    });
  },

  // 1 — Plucked string
  (freq, vol, dur, dests) => {
    const c = ac(); const rev = getReverbNode();
    const osc = c.createOscillator(), g = c.createGain();
    const lp = c.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value=freq*3; lp.Q.value=2;
    osc.type='sawtooth'; osc.frequency.value=freq;
    g.gain.setValueAtTime(vol*0.55, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime+dur+0.9);
    osc.connect(lp); lp.connect(g); g.connect(rev);
    dests.forEach(d => g.connect(d));
    osc.start(); osc.stop(c.currentTime+dur+1.0);
    const osc2 = c.createOscillator(), g2 = c.createGain();
    osc2.type='sine'; osc2.frequency.value=freq*2.01;
    g2.gain.setValueAtTime(vol*0.12, c.currentTime);
    g2.gain.exponentialRampToValueAtTime(0.0001, c.currentTime+dur*0.5);
    osc2.connect(g2); g2.connect(rev); dests.forEach(d => g2.connect(d));
    osc2.start(); osc2.stop(c.currentTime+dur*0.6);
  },

  // 2 — Breath
  (freq, vol, dur, dests) => {
    const c = ac(); const rev = getReverbNode();
    [-7,0,5].forEach(det => {
      const osc = c.createOscillator(), lp = c.createBiquadFilter(), g = c.createGain();
      lp.type='lowpass'; lp.frequency.value=500+rnd(0,200); lp.Q.value=0.5;
      osc.type='sawtooth'; osc.frequency.value=freq; osc.detune.value=det;
      g.gain.setValueAtTime(0, c.currentTime);
      g.gain.linearRampToValueAtTime(vol*0.22, c.currentTime+0.18);
      g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime+dur+0.4);
      osc.connect(lp); lp.connect(g); g.connect(rev);
      dests.forEach(d => g.connect(d));
      osc.start(); osc.stop(c.currentTime+dur+0.5);
    });
  },

  // 3 — Bell / metallic
  (freq, vol, dur, dests) => {
    const c = ac(); const rev = getReverbNode();
    [1,2.756,5.404,8.933,13.35].map((r,i) => ({f:freq*r, v:vol*Math.pow(0.55,i)})).forEach(({f,v}) => {
      const osc = c.createOscillator(), g = c.createGain();
      osc.type='sine'; osc.frequency.value=f;
      g.gain.setValueAtTime(v*0.35, c.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime+dur+rnd(0.3,1.2));
      osc.connect(g); g.connect(rev); dests.forEach(d => g.connect(d));
      osc.start(); osc.stop(c.currentTime+dur+1.3);
    });
  },

  // 4 — Ghost chord
  (freq, vol, dur, dests) => {
    const c = ac(); const rev = getReverbNode();
    [1,1.498,1.782].forEach(r => {
      const osc = c.createOscillator(), g = c.createGain();
      osc.type='sine'; osc.frequency.value=freq*r;
      g.gain.setValueAtTime(0, c.currentTime);
      g.gain.linearRampToValueAtTime(vol*0.28, c.currentTime+0.08);
      g.gain.setValueAtTime(vol*0.28, c.currentTime+dur*0.7);
      g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime+dur+0.6);
      osc.connect(g); g.connect(rev); dests.forEach(d => g.connect(d));
      osc.start(); osc.stop(c.currentTime+dur+0.7);
    });
  },

  // 5 — Piano
  (freq, vol, dur, dests) => {
    const c = ac(); const rev = getReverbNode();
    [{r:1,v:1.0,det:0},{r:2.0,v:0.35,det:3},{r:3.005,v:0.16,det:-2},{r:4.02,v:0.08,det:0}].forEach(({r,v,det}) => {
      const osc = c.createOscillator(), g = c.createGain();
      const lp = c.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value=freq*r*4;
      osc.type='triangle'; osc.frequency.value=freq*r; osc.detune.value=det;
      const decay = dur + rnd(0.9,1.8);
      g.gain.setValueAtTime(0, c.currentTime);
      g.gain.linearRampToValueAtTime(vol*v, c.currentTime+0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime+decay);
      osc.connect(lp); lp.connect(g); g.connect(rev); dests.forEach(d => g.connect(d));
      osc.start(); osc.stop(c.currentTime+decay+0.1);
    });
    const buf = c.createBuffer(1, Math.ceil(c.sampleRate*0.02), c.sampleRate);
    const bd = buf.getChannelData(0);
    for (let i = 0; i < bd.length; i++) bd[i] = (rnd(0,2)-1)*Math.exp(-i/(c.sampleRate*0.004));
    const src = c.createBufferSource(); src.buffer = buf;
    const hp = c.createBiquadFilter(); hp.type='highpass'; hp.frequency.value=1800;
    const ng = c.createGain(); ng.gain.value = vol*0.1;
    src.connect(hp); hp.connect(ng); dests.forEach(d => ng.connect(d));
    src.start();
  },

  // 6 — Warm synth pad
  (freq, vol, dur, dests) => {
    const c = ac(); const rev = getReverbNode();
    const swell = Math.max(dur*1.4, 0.5);
    [{type:'sawtooth',det:-6,v:0.5},{type:'sawtooth',det:6,v:0.5},{type:'sine',det:0,v:0.4},{type:'sine',det:0,v:0.22,oct:0.5}].forEach(({type,det,v,oct}) => {
      const osc = c.createOscillator(), g = c.createGain();
      const lp = c.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value=1100; lp.Q.value=0.7;
      osc.type=type; osc.frequency.value=freq*(oct||1); osc.detune.value=det;
      g.gain.setValueAtTime(0, c.currentTime);
      g.gain.linearRampToValueAtTime(vol*v*0.55, c.currentTime+swell*0.45);
      g.gain.linearRampToValueAtTime(0, c.currentTime+swell);
      osc.connect(lp); lp.connect(g); g.connect(rev); dests.forEach(d => g.connect(d));
      osc.start(); osc.stop(c.currentTime+swell+0.1);
    });
  },

  // 7 — Plucked string ensemble
  (freq, vol, dur, dests) => {
    const c = ac(); const rev = getReverbNode();
    const decay = dur + rnd(1.2,2.4);
    const osc = c.createOscillator(), g = c.createGain();
    const bp = c.createBiquadFilter(); bp.type='bandpass'; bp.frequency.value=freq*1.5; bp.Q.value=3;
    osc.type='sawtooth'; osc.frequency.value=freq;
    g.gain.setValueAtTime(vol*0.5, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime+decay);
    osc.connect(bp); bp.connect(g); g.connect(rev); dests.forEach(d => g.connect(d));
    osc.start(); osc.stop(c.currentTime+decay+0.1);
    const osc2 = c.createOscillator(), g2 = c.createGain();
    osc2.type='sine'; osc2.frequency.value=freq*0.5;
    g2.gain.setValueAtTime(vol*0.22, c.currentTime);
    g2.gain.exponentialRampToValueAtTime(0.0001, c.currentTime+decay*0.8);
    osc2.connect(g2); g2.connect(rev); dests.forEach(d => g2.connect(d));
    osc2.start(); osc2.stop(c.currentTime+decay*0.85);
  },

  // 8 — Marimba
  (freq, vol, dur, dests) => {
    const c = ac(); const rev = getReverbNode();
    [{r:1,v:1,t:'sine'},{r:4.0,v:0.18,t:'sine'},{r:9.8,v:0.06,t:'sine'}].forEach(({r,v,t}) => {
      const osc = c.createOscillator(), g = c.createGain();
      osc.type=t; osc.frequency.value=freq*r;
      const decay = dur*0.6 + rnd(0.15,0.35);
      g.gain.setValueAtTime(vol*v*0.6, c.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime+decay);
      osc.connect(g); g.connect(rev); dests.forEach(d => g.connect(d));
      osc.start(); osc.stop(c.currentTime+decay+0.05);
    });
  },

  // 9 — Glass / FM bell
  (freq, vol, dur, dests) => {
    const c = ac(); const rev = getReverbNode();
    [1,2.41,3.9,6.13].forEach((r,i) => {
      const osc = c.createOscillator(), g = c.createGain();
      osc.type='sine'; osc.frequency.value=freq*r;
      const decay = dur + rnd(0.6,1.6) + i*0.2;
      g.gain.setValueAtTime(vol*Math.pow(0.5,i)*0.4, c.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime+decay);
      osc.connect(g); g.connect(rev); dests.forEach(d => g.connect(d));
      osc.start(); osc.stop(c.currentTime+decay+0.1);
    });
  },

  // 10 — Vibraphone
  (freq, vol, dur, dests) => {
    const c = ac(); const rev = getReverbNode();
    const osc = c.createOscillator(), g = c.createGain();
    const lfo = c.createOscillator(), lfoGain = c.createGain();
    lfo.type='sine'; lfo.frequency.value=5.5; lfoGain.gain.value=vol*0.15;
    lfo.connect(lfoGain); lfoGain.connect(g.gain);
    osc.type='sine'; osc.frequency.value=freq;
    const decay = dur + rnd(1.0,2.0);
    g.gain.setValueAtTime(vol*0.5, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime+decay);
    osc.connect(g); g.connect(rev); dests.forEach(d => g.connect(d));
    lfo.start(); osc.start();
    lfo.stop(c.currentTime+decay+0.1); osc.stop(c.currentTime+decay+0.1);
  },

  // 11 — Music box
  (freq, vol, dur, dests) => {
    const c = ac(); const rev = getReverbNode();
    [0,6].forEach(det => {
      const osc = c.createOscillator(), g = c.createGain();
      osc.type='triangle'; osc.frequency.value=freq*2; osc.detune.value=det;
      const decay = dur*0.5 + rnd(0.3,0.7);
      g.gain.setValueAtTime(vol*0.35, c.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime+decay);
      osc.connect(g); g.connect(rev); dests.forEach(d => g.connect(d));
      osc.start(); osc.stop(c.currentTime+decay+0.1);
    });
  },

  // 12 — Choir pad
  (freq, vol, dur, dests) => {
    const c = ac(); const rev = getReverbNode();
    const swell = Math.max(dur*1.6, 0.8);
    [-5,0,5,12].forEach(det => {
      const osc = c.createOscillator(), g = c.createGain();
      const bp = c.createBiquadFilter(); bp.type='bandpass'; bp.frequency.value=freq*2; bp.Q.value=1.5;
      bp.frequency.setValueAtTime(freq*1.5, c.currentTime);
      bp.frequency.linearRampToValueAtTime(freq*2.5, c.currentTime+swell);
      osc.type='sawtooth'; osc.frequency.value=freq; osc.detune.value=det;
      g.gain.setValueAtTime(0, c.currentTime);
      g.gain.linearRampToValueAtTime(vol*0.13, c.currentTime+swell*0.4);
      g.gain.linearRampToValueAtTime(0, c.currentTime+swell);
      osc.connect(bp); bp.connect(g); g.connect(rev); dests.forEach(d => g.connect(d));
      osc.start(); osc.stop(c.currentTime+swell+0.1);
    });
  },

  // 13 — Soft organ
  (freq, vol, dur, dests) => {
    const c = ac(); const rev = getReverbNode();
    [{r:1,v:0.6},{r:2,v:0.3},{r:3,v:0.15},{r:4,v:0.1}].forEach(({r,v}) => {
      const osc = c.createOscillator(), g = c.createGain();
      osc.type='sine'; osc.frequency.value=freq*r;
      g.gain.setValueAtTime(0, c.currentTime);
      g.gain.linearRampToValueAtTime(vol*v*0.5, c.currentTime+0.05);
      g.gain.setValueAtTime(vol*v*0.5, c.currentTime+dur*0.7);
      g.gain.linearRampToValueAtTime(0, c.currentTime+dur+0.3);
      osc.connect(g); g.connect(rev); dests.forEach(d => g.connect(d));
      osc.start(); osc.stop(c.currentTime+dur+0.35);
    });
  },

  // 14 — Sub thump
  (freq, vol, dur, dests) => {
    const c = ac(); const rev = getReverbNode();
    const osc = c.createOscillator(), g = c.createGain();
    osc.type='sine';
    osc.frequency.setValueAtTime(freq*0.25, c.currentTime);
    osc.frequency.exponentialRampToValueAtTime(freq*0.18, c.currentTime+0.3);
    g.gain.setValueAtTime(vol*0.6, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime+dur+0.4);
    osc.connect(g); g.connect(rev); dests.forEach(d => g.connect(d));
    osc.start(); osc.stop(c.currentTime+dur+0.5);
  },

  // 15 — Reed / woodwind
  (freq, vol, dur, dests) => {
    const c = ac(); const rev = getReverbNode();
    const osc = c.createOscillator(), g = c.createGain();
    const lp = c.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value=freq*4;
    const lfo = c.createOscillator(), lfoGain = c.createGain();
    lfo.type='sine'; lfo.frequency.value=4.5; lfoGain.gain.value=3;
    lfo.connect(lfoGain); lfoGain.connect(osc.frequency);
    osc.type='square'; osc.frequency.value=freq;
    g.gain.setValueAtTime(0, c.currentTime);
    g.gain.linearRampToValueAtTime(vol*0.28, c.currentTime+0.1);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime+dur+0.5);
    osc.connect(lp); lp.connect(g); g.connect(rev); dests.forEach(d => g.connect(d));
    lfo.start(); osc.start();
    lfo.stop(c.currentTime+dur+0.6); osc.stop(c.currentTime+dur+0.6);
  },

  // 16 — Bowed cello
  (freq, vol, dur, dests) => {
    const c = ac(); const rev = getReverbNode();
    const osc = c.createOscillator(), g = c.createGain();
    const bp = c.createBiquadFilter(); bp.type='bandpass'; bp.frequency.value=freq*2.2; bp.Q.value=2.5;
    osc.type='sawtooth'; osc.frequency.value=freq*0.5;
    const swell = Math.max(dur*1.3, 0.6);
    g.gain.setValueAtTime(0, c.currentTime);
    g.gain.linearRampToValueAtTime(vol*0.4, c.currentTime+swell*0.5);
    g.gain.linearRampToValueAtTime(0, c.currentTime+swell);
    osc.connect(bp); bp.connect(g); g.connect(rev); dests.forEach(d => g.connect(d));
    osc.start(); osc.stop(c.currentTime+swell+0.1);
  },

  // 17 — Kalimba
  (freq, vol, dur, dests) => {
    const c = ac(); const rev = getReverbNode();
    [{r:1,v:1},{r:3.2,v:0.2},{r:5.1,v:0.08}].forEach(({r,v}) => {
      const osc = c.createOscillator(), g = c.createGain();
      osc.type='triangle'; osc.frequency.value=freq*r;
      const decay = dur*0.7 + rnd(0.4,0.9);
      g.gain.setValueAtTime(vol*v*0.5, c.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime+decay);
      osc.connect(g); g.connect(rev); dests.forEach(d => g.connect(d));
      osc.start(); osc.stop(c.currentTime+decay+0.1);
    });
  },

  // 18 — Synth brass swell
  (freq, vol, dur, dests) => {
    const c = ac(); const rev = getReverbNode();
    const swell = Math.max(dur*1.2, 0.4);
    [-4,4].forEach(det => {
      const osc = c.createOscillator(), g = c.createGain();
      const lp = c.createBiquadFilter(); lp.type='lowpass';
      lp.frequency.setValueAtTime(300, c.currentTime);
      lp.frequency.linearRampToValueAtTime(freq*5, c.currentTime+swell*0.4);
      osc.type='sawtooth'; osc.frequency.value=freq; osc.detune.value=det;
      g.gain.setValueAtTime(0, c.currentTime);
      g.gain.linearRampToValueAtTime(vol*0.3, c.currentTime+swell*0.3);
      g.gain.linearRampToValueAtTime(0, c.currentTime+swell);
      osc.connect(lp); lp.connect(g); g.connect(rev); dests.forEach(d => g.connect(d));
      osc.start(); osc.stop(c.currentTime+swell+0.1);
    });
  },

  // 19 — Detuned celeste
  (freq, vol, dur, dests) => {
    const c = ac(); const rev = getReverbNode();
    [0,9,-9].forEach(det => {
      const osc = c.createOscillator(), g = c.createGain();
      osc.type='sine'; osc.frequency.value=freq*2; osc.detune.value=det;
      const decay = dur + rnd(0.8,1.5);
      g.gain.setValueAtTime(vol*0.22, c.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime+decay);
      osc.connect(g); g.connect(rev); dests.forEach(d => g.connect(d));
      osc.start(); osc.stop(c.currentTime+decay+0.1);
    });
  },

  // 20 — Granular texture
  (freq, vol, dur, dests) => {
    const c = ac(); const rev = getReverbNode();
    const glen = Math.max(0.08, dur*0.5);
    const buf = c.createBuffer(1, Math.ceil(c.sampleRate*glen), c.sampleRate);
    const d = buf.getChannelData(0);
    for (let j = 0; j < d.length; j++) d[j] = (rnd(0,2)-1)*Math.pow(Math.sin(Math.PI*j/d.length), 0.7);
    const src = c.createBufferSource(); src.buffer = buf;
    const bp = c.createBiquadFilter(); bp.type='bandpass'; bp.frequency.value=freq*2; bp.Q.value=4;
    const g = c.createGain(); g.gain.value = vol*0.4;
    src.connect(bp); bp.connect(g); g.connect(rev); dests.forEach(d2 => g.connect(d2));
    src.start();
    const osc = c.createOscillator(), g2 = c.createGain();
    osc.type='sine'; osc.frequency.value=freq;
    g2.gain.setValueAtTime(vol*0.15, c.currentTime);
    g2.gain.exponentialRampToValueAtTime(0.0001, c.currentTime+dur+0.3);
    osc.connect(g2); g2.connect(rev); dests.forEach(d2 => g2.connect(d2));
    osc.start(); osc.stop(c.currentTime+dur+0.4);
  },

  // 21 — Deep gong swell
  (freq, vol, dur, dests) => {
    const c = ac(); const rev = getReverbNode();
    [1,1.78,2.4,3.6].forEach((r,i) => {
      const osc = c.createOscillator(), g = c.createGain();
      osc.type='sine'; osc.frequency.value=freq*0.5*r;
      const decay = dur + rnd(1.5,3) + i*0.3;
      g.gain.setValueAtTime(0, c.currentTime);
      g.gain.linearRampToValueAtTime(vol*Math.pow(0.6,i)*0.4, c.currentTime+0.3);
      g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime+decay);
      osc.connect(g); g.connect(rev); dests.forEach(d => g.connect(d));
      osc.start(); osc.stop(c.currentTime+decay+0.1);
    });
  },
];

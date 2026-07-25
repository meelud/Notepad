import { ac } from './context.js';
import { getReverbNode } from './reverb.js';

export function playPunctuation(ch, dests, intensity) {
  const c = ac();
  const rev = getReverbNode();

  // Meaningful silence: '.' and ',' no longer strike a lead note. The pause
  // itself (already handled by the timing gap in player.js) IS the punctuation —
  // the ambient pad/drone keeps breathing underneath, but nothing new is voiced
  // on top of it. This gives the piece real moments of rest instead of a
  // dedicated tone on every single mark.
  if (ch === '.' || ch === ',' || ch === '،') {
    return;

  } else if (ch === '!') {
    [523.25, 659.25, 784].forEach((f, i) => {
      const osc = c.createOscillator(), g = c.createGain();
      osc.type = 'triangle'; osc.frequency.value = f;
      g.gain.setValueAtTime(0.2 * intensity * (1 - i * 0.25), c.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.4);
      osc.connect(g); g.connect(rev); dests.forEach(d => g.connect(d));
      osc.start(); osc.stop(c.currentTime + 0.5);
    });

  } else if (ch === '?' || ch === '؟') {
    const osc = c.createOscillator(), g = c.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(293.66, c.currentTime);
    osc.frequency.exponentialRampToValueAtTime(440, c.currentTime + 0.35);
    g.gain.setValueAtTime(0.18 * intensity, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.5);
    osc.connect(g); g.connect(rev); dests.forEach(d => g.connect(d));
    osc.start(); osc.stop(c.currentTime + 0.6);

  } else if (ch === '\n') {
    const osc = c.createOscillator(), g = c.createGain();
    osc.type = 'sine'; osc.frequency.setValueAtTime(73.42, c.currentTime);
    g.gain.setValueAtTime(0.15 * intensity, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 1.1);
    osc.connect(g); g.connect(rev); dests.forEach(d => g.connect(d));
    osc.start(); osc.stop(c.currentTime + 1.2);
  }
}

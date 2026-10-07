// Punctuation pitches must belong to the piece's key. Exhaustive over every mode
// and every root candidate harmony.js can choose, then end-to-end through the real
// playPunctuation() with a recording AudioContext, fed the way player.js feeds it.
import { installStubs } from './harness/stubs.mjs';
import { MODE_ORDER, buildScale } from '../js/music/scales.js';
import { punctuationPitches, foldInto } from '../js/music/punct-pitches.js';

let bad = 0;
const ok = (c, m) => { if (!c) { bad++; if (bad < 25) console.log(' FAIL ', m); } };

const noteFreq = n => 110 * Math.pow(2, n / 12);                 // same as harmony.js
const rootsFor = modeIdx => Array.from({ length: 12 }, (_, i) => noteFreq(modeIdx <= 5 ? i - 12 : i));
const cents = (a, b) => 1200 * Math.log2(a / b);
// distance in cents from f to the nearest pitch class (any octave) of the scale
const toScale = (f, scale) => Math.min(...scale.map(s => { const c = ((cents(f, s) % 1200) + 1200) % 1200; return Math.min(c, 1200 - c); }));

// ── 1. exhaustive: every pitch is in the key, in its window, with its shape ──
let combos = 0, worstCents = 0, worstFifth = 0, noFifth = 0;
for (let mi = 0; mi < MODE_ORDER.length; mi++) for (const root of rootsFor(mi)) {
  const mode = MODE_ORDER[mi], scale = buildScale(root, mode), tag = `${mode} @${root.toFixed(1)}Hz`;
  const p = punctuationPitches(scale);
  combos++;
  const all = [...p.bang, p.question.from, p.question.to, p.newline];
  for (const f of all) { const d = toScale(f, scale); worstCents = Math.max(worstCents, d); ok(d < 1e-6, `${tag}: ${f.toFixed(2)} Hz is ${d.toFixed(3)} cents off the scale`); }
  ok(p.bang.length === 3 && p.bang[0] >= 350 && p.bang[0] < 700, `${tag}: '!' root ${p.bang[0]} outside [350,700)`);
  ok(p.bang[0] < p.bang[1] && p.bang[1] < p.bang[2] && p.bang[2] < 2 * p.bang[0], `${tag}: '!' is not a strictly rising stack inside one octave: ${p.bang}`);
  ok(p.question.from >= 262 && p.question.from < 524, `${tag}: '?' start ${p.question.from} outside [262,524)`);
  ok(p.question.to > p.question.from && p.question.to <= 2 * p.question.from, `${tag}: '?' does not rise within an octave`);
  ok(p.newline >= 65.4 && p.newline < 130.8, `${tag}: newline ${p.newline} outside [65.4,130.8)`);
  // the question opens to the scale tone nearest a perfect fifth
  const semis = 12 * Math.log2(p.question.to / p.question.from);
  const hasFifth = scale.some(s => Math.abs(((cents(s, scale[0]) % 1200) + 1200) % 1200 - 700) < 1e-6);
  if (hasFifth) ok(Math.abs(semis - 7) < 1e-9, `${tag}: scale has a fifth but '?' rises ${semis.toFixed(3)} semitones`);
  else { noFifth++; worstFifth = Math.max(worstFifth, Math.abs(semis - 7)); ok(Math.abs(semis - 7) <= 1.0001, `${tag}: no fifth, nearest should be ≤1 semitone away, got ${semis.toFixed(3)}`); }
  // same tonic in all three gestures
  ok(toScale(p.newline, [scale[0]]) < 1e-6 && toScale(p.question.from, [scale[0]]) < 1e-6 && toScale(p.bang[0], [scale[0]]) < 1e-6, `${tag}: '!', '?' and newline do not share the tonic`);
}
ok(foldInto(110, 350) === 440 && foldInto(1000, 350) === 500 && foldInto(350, 350) === 350, 'foldInto basics');

// ── 2. what the OLD fixed pitches did, for the record ─────────────
const OLD = { bang: [523.25, 659.25, 784], question: [293.66, 440], newline: [73.42] };
let oldIn = 0, oldTot = 0, combosWithAnyOut = 0;
for (let mi = 0; mi < MODE_ORDER.length; mi++) for (const root of rootsFor(mi)) {
  const scale = buildScale(root, MODE_ORDER[mi]); let any = false;
  for (const f of Object.values(OLD).flat()) { oldTot++; if (toScale(f, scale) < 3) oldIn++; else any = true; }
  if (any) combosWithAnyOut++;
}
console.log(`  exhaustive: ${combos} (mode, root) combinations; worst deviation from the scale ${worstCents.toExponential(1)} cents`);
console.log(`  scales without a fifth: ${noFifth}; worst "nearest fifth" miss ${worstFifth.toFixed(2)} semitones`);
console.log(`  OLD fixed pitches: ${oldIn}/${oldTot} in key (${(100 * oldIn / oldTot).toFixed(0)} %); ${combosWithAnyOut}/${combos} combinations had at least one out-of-key punctuation pitch`);

// ── 3. end to end through the real playPunctuation ────────────────
const created = [];
const mkParam = () => ({ value: 0, calls: [], setValueAtTime(v) { this.calls.push(v); this.value = v; }, exponentialRampToValueAtTime(v) { this.calls.push(v); }, linearRampToValueAtTime(v) { this.calls.push(v); } });
const mkNode = (kind, extra = {}) => ({ kind, connect() { return this; }, disconnect() {}, ...extra });
const ctx = { sampleRate: 44100, currentTime: 0, destination: mkNode('dest'),
  createGain: () => mkNode('gain', { gain: mkParam() }),
  createOscillator: () => { const o = mkNode('osc', { type: 'sine', frequency: mkParam(), start() {}, stop() {} }); created.push(o); return o; } };
installStubs('');
globalThis.window.AudioContext = function () { return ctx; };
const { deriveTextHarmony } = await import('../js/music/harmony.js');
const { playPunctuation } = await import('../js/audio/punctuation.js');
const H = await import('../js/music/harmony.js');
const TEXTS = ['I miss you so much and it hurts.', 'We did it, I cannot believe it!', 'The morning light slid across the table.', 'دلم برات تنگ شده و همه چیز ساکته', 'Get out. Get out right now!'];
let played = 0;
for (const t of TEXTS) {
  deriveTextHarmony(t);
  const scale = H.currentScale;
  for (const ch of ['!', '?', '؟', '\n', '.', ',']) {
    created.length = 0;
    playPunctuation(ch, [ctx.destination], 1, punctuationPitches(scale));   // exactly what player.js passes
    const want = (ch === '.' || ch === ',') ? 0 : ch === '!' ? 3 : 1;
    ok(created.length === want, `"${t.slice(0, 18)}…" ${JSON.stringify(ch)}: expected ${want} oscillator(s), got ${created.length}`);
    for (const o of created) for (const f of [o.frequency.value, ...o.frequency.calls]) { played++; ok(toScale(f, scale) < 1e-6, `"${t.slice(0, 18)}…" ${JSON.stringify(ch)} played ${f} Hz, not in the key of the text`); }
  }
}
console.log(`  end to end: ${played} punctuation pitches over ${TEXTS.length} texts, all in key`);

if (bad) { console.log(`${bad} failure(s)`); process.exit(1); }
console.log('punctuation pitches: all in key, in register, and shaped as before');

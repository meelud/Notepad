import { editor, render, bPlay, bStop, bSave, viz, bars, prog, pf } from './dom.js';
import { ac } from './audio/context.js';
import { ensureReverb, resetReverb } from './audio/reverb.js';
import { VOICES } from './audio/voices.js';
import { playPunctuation } from './audio/punctuation.js';
import { startAmbient, clearAmb, setAmbientDensity } from './audio/ambient.js';
import { deriveTextHarmony, hashText, wordNoteScale, currentScale } from './music/harmony.js';
import { seedRng, rnd, pick } from './utils/rng.js';
import { tokenize, esc, buildRender, sleep } from './utils/text.js';

let playing = false;
let stopping = false;
let rec = null;
let chunks = [];
let audioBlob = null;
let harmonyLocked = false;

export function isPlaying() { return playing; }
export function getAudioBlob() { return audioBlob; }

const VOICE_GROUPS = {
  statement: [0, 2, 5, 6, 10, 12, 13, 15, 16, 20, 21],
  question:  [1, 4, 7, 9, 11, 17, 19, 20],
  exclaim:   [1, 3, 5, 8, 9, 11, 14, 17, 18],
};

function animBars(vol) {
  bars.forEach(b => { b.style.height = Math.round(rnd(1.5, vol * 17)) + 'px'; });
  setTimeout(() => bars.forEach(b => b.style.height = '1.5px'), 120);
}

export async function play() {
  const text = editor.value;
  if (!text.trim()) return;

  if (!harmonyLocked) {
    deriveTextHarmony(text);
    harmonyLocked = true;
  }

  seedRng(hashText(text));

  playing = true; stopping = false;
  resetReverb();
  setAmbientDensity(1);
  bPlay.disabled = true; bStop.disabled = false; bSave.disabled = true;
  editor.style.display = 'none';
  render.style.display = 'block';
  render.innerHTML = esc(text);
  viz.classList.add('on');
  prog.classList.add('on');
  pf.style.width = '0%';
  chunks = []; audioBlob = null;

  const c = ac();
  await c.resume();
  const sd = c.createMediaStreamDestination();
  const dests = [c.destination, sd];
  ensureReverb(dests);

  rec = new MediaRecorder(sd.stream);
  rec.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
  rec.onstop = () => {
    audioBlob = new Blob(chunks, { type: 'audio/webm' });
    bSave.disabled = false;
  };
  rec.start();

  startAmbient(dests, () => stopping);

  const tokens = tokenize(text);
  const playable = tokens.filter(t => t.type === 'word' || t.type === 'punct');
  const totalWords = tokens.filter(t => t.type === 'word').length;

  let voiceIdx = pick(VOICE_GROUPS.statement);
  let wordsSeen = 0;

  for (let i = 0; i < playable.length; i++) {
    if (stopping) break;
    const tok = playable[i];

    render.innerHTML = buildRender(text, tok.start, tok.end);

    if (tok.type === 'punct') {
      const intensity = 0.7 + 0.3;
      playPunctuation(tok.text, dests, intensity);
      animBars(0.2 * intensity);
      const pause = tok.text === '.' ? 420 : tok.text === '?' ? 380 : tok.text === '!' ? 340 : tok.text === ',' ? 200 : 150;
      await sleep(pause);
      continue;
    }

    wordsSeen++;
    const wlen = tok.text.replace(/\W/g, '').length || 1;
    const group = VOICE_GROUPS[tok.sentenceType] || VOICE_GROUPS.statement;

    const density = tok.paraPos === 'start' ? 0.55 : tok.paraPos === 'end' ? 1.35 : 1;
    setAmbientDensity(density);

    const freq = pick(wordNoteScale());
    const vol  = rnd(0.18, 0.52);
    const dur  = rnd(0.22, 0.45);

    if (rnd(0, 1) < 0.4) voiceIdx = pick(group);
    VOICES[voiceIdx](freq, vol, dur, dests);
    animBars(vol);

    const base = 300 + wlen * 28;
    const spd  = Math.min(600, base) + rnd(-30, 50);
    pf.style.width = Math.round((wordsSeen / totalWords) * 100) + '%';
    await sleep(spd);
  }

  stopping = true;
  clearAmb();
  pf.style.width = '100%';
  if (rec.state !== 'inactive') rec.stop();
  render.innerHTML = esc(text);
  viz.classList.remove('on');
  bars.forEach(b => b.style.height = '1.5px');
  playing = false;
  bPlay.disabled = false; bStop.disabled = true;
  setTimeout(() => prog.classList.remove('on'), 900);

  // show continue prompt
  editor.style.display = '';
  render.style.display = 'none';
  editor.focus();
  editor.setSelectionRange(editor.value.length, editor.value.length);
}

export function stop() {
  stopping = true;
  clearAmb();
  if (rec && rec.state !== 'inactive') rec.stop();
  editor.style.display = '';
  render.style.display = 'none';
  viz.classList.remove('on');
  prog.classList.remove('on');
  bars.forEach(b => b.style.height = '1.5px');
  playing = false;
  bPlay.disabled = false; bStop.disabled = true;
}

export function resetHarmony() {
  harmonyLocked = false;
}

export function clearAudioState() {
  audioBlob = null;
  chunks = [];
}

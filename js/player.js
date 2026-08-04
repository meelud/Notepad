import { editor, render, bPlay, bStop, bSave } from './dom.js';
import { ac, unlockIOSAudio } from './audio/context.js';
import { ensureReverb, resetReverb } from './audio/reverb.js';
import { VOICES } from './audio/voices.js';
import { playPunctuation } from './audio/punctuation.js';
import { startAmbient, clearAmb, setAmbientDensity } from './audio/ambient.js';
import { deriveTextHarmony, hashText, wordNoteScale, currentScale } from './music/harmony.js';
import { seedRng, rnd, pick } from './utils/rng.js';
import { tokenize, esc, buildRender, sleep } from './utils/text.js';
import { findPersonaMessage, showPersonaToast } from './persona.js';

// ─── State ──────────────────────────────────────────────────────
let playing = false;
let stopping = false;
let rec = null;
let chunks = [];
let audioBlob = null;
let harmonyLocked = false;
let sessionTenseScore = 0; // tenseScore of the current text, used to nudge pacing
let sessionNormScore = 0; // normScore of the current text, used to nudge reverb wetness

export function isPlaying() { return playing; }
export function getAudioBlob() { return audioBlob; }

// ─── Voice selection by sentence type ───────────────────────────
const VOICE_GROUPS = {
  statement: [0, 2, 5, 6, 10, 12, 13, 15, 16, 20, 21],
  question:  [1, 4, 7, 9, 11, 17, 19, 20],
  exclaim:   [1, 3, 5, 8, 9, 11, 14, 17, 18],
};

// ─── Playback ───────────────────────────────────────────────────
/**
 * Main playback loop — tokenizes text, derives harmony,
 * and plays each word/punctuation as audio.
 * Records output to a Blob (audio/webm) for later save.
 */
export async function play() {
  const text = editor.value;
  if (!text.trim()) return;

  unlockIOSAudio();

  if (!harmonyLocked) {
    const harmonyInfo = deriveTextHarmony(text);
    sessionTenseScore = harmonyInfo.tenseScore;
    sessionNormScore = harmonyInfo.normScore;
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
  chunks = []; audioBlob = null;

  let c;
  try {
    c = ac();
    await c.resume();
  } catch (err) {
    showPersonaToast("Couldn't start audio here — your browser may not support it.");
    playing = false;
    bPlay.disabled = false; bStop.disabled = true;
    editor.style.display = '';
    render.style.display = 'none';
    return;
  }
  const sd = c.createMediaStreamDestination();
  const dests = [c.destination, sd];

  // mood-driven reverb space: dark/sad text sits in a more spacious,
  // distant-feeling reverb; bright text stays drier and more present.
  // This is the piece's emotional "room size", separate from anything
  // per-word — a much more standard way to convey melancholy/distance
  // than simply turning the volume down.
  const clampedNorm = Math.max(-1.5, Math.min(1.5, sessionNormScore));
  const moodWetness = 0.55 - ((clampedNorm + 1.5) / 3.0) * 0.30;
  ensureReverb(dests, moodWetness);

  // Recording is a nice-to-have, not essential — if MediaRecorder isn't
  // available or fails to construct (some browsers/embedded webviews),
  // playback should still work, just without the Save button.
  try {
    rec = new MediaRecorder(sd.stream);
    rec.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
    rec.onstop = () => {
      audioBlob = new Blob(chunks, { type: 'audio/webm' });
      bSave.disabled = false;
    };
    rec.start();
  } catch (err) {
    rec = null;
    showPersonaToast("Can't record here, but playback still works — no Save this time.");
  }

  startAmbient(dests, () => stopping);

  const tokens = tokenize(text);
  const playable = tokens.filter(t => t.type === 'word' || t.type === 'punct');

  // sentence-position map: for each word token's index in `playable`,
  // record its 1-based position and the total word count of its
  // sentence — used to shape a gentle volume arc across the sentence
  // rather than every word's loudness being fully independent.
  const sentencePos = new Array(playable.length).fill(null);
  {
    let sentenceWordIdxs = [];
    const flushSentence = () => {
      const n = sentenceWordIdxs.length;
      sentenceWordIdxs.forEach((idx, k) => { sentencePos[idx] = { pos: k + 1, total: n }; });
      sentenceWordIdxs = [];
    };
    playable.forEach((tok, idx) => {
      if (tok.type === 'word') {
        sentenceWordIdxs.push(idx);
      } else if (tok.type === 'punct' && ['.', '!', '?', '؟'].includes(tok.text)) {
        flushSentence();
      }
    });
    flushSentence(); // trailing sentence with no terminal punctuation, if any
  }

  let voiceIdx = pick(VOICE_GROUPS.statement);

  for (let i = 0; i < playable.length; i++) {
    if (stopping) break;
    const tok = playable[i];

    render.innerHTML = buildRender(text, tok.start, tok.end);

    if (tok.type === 'punct') {
      const intensity = 0.7 + 0.3;
      playPunctuation(tok.text, dests, intensity);
      // pause durations (ms): period=420, question=380, exclaim=340, comma=200, other=150
      const pause = (tok.text === '.') ? 420
                  : (tok.text === '?' || tok.text === '؟') ? 380
                  : (tok.text === '!') ? 340
                  : (tok.text === ',' || tok.text === '،') ? 200
                  : 150;
      await sleep(pause);
      continue;
    }

    const wlen = (tok.text.match(/[\p{L}\p{N}]/gu) || []).length || 1;
    const group = VOICE_GROUPS[tok.sentenceType] || VOICE_GROUPS.statement;

    // ambient density: thinner at paragraph start, thicker at end
    const density = tok.paraPos === 'start' ? 0.55 : tok.paraPos === 'end' ? 1.35 : 1;
    setAmbientDensity(density);

    // cadence: the last word right before sentence-ending punctuation
    // gets a softer, longer note — a natural "landing" instead of an
    // arbitrary cutoff, the way a spoken sentence settles at its end.
    const next = playable[i + 1];
    const isCadence = next && next.type === 'punct' && ['.', '!', '?', '؟'].includes(next.text);

    const freq = pick(wordNoteScale());

    // gentle volume arc across the sentence: quieter near the edges,
    // fuller in the middle — real phrasing breathes, it doesn't hold
    // one flat loudness word to word. Sin-shaped, ±15%, clamped.
    const sp = sentencePos[i] || { pos: 1, total: 1 };
    const frac = sp.total > 1 ? (sp.pos - 1) / (sp.total - 1) : 0.5;
    const volArc = 0.85 + Math.sin(Math.PI * frac) * 0.3;

    const vol = Math.max(0.12, Math.min(0.6,
      (isCadence ? rnd(0.20, 0.40) : rnd(0.18, 0.52)) * volArc
    ));
    const dur = isCadence ? rnd(0.45, 0.75) : rnd(0.22, 0.45);

    // subtle stereo placement per word — real width instead of
    // everything piling up dead-center. Kept modest (±0.35, not full
    // hard-left/right) so it widens the space without being jarring.
    // Only the word voices are panned; ambient pads and punctuation
    // chimes stay centered as the stable "bed" underneath.
    const panner = c.createStereoPanner();
    panner.pan.value = rnd(-0.35, 0.35);
    panner.connect(c.destination);
    panner.connect(sd);

    if (rnd(0, 1) < 0.4) voiceIdx = pick(group);
    VOICES[voiceIdx](freq, vol, dur, [panner]);

    // word-length → timing: base 380ms + 42ms per letter, no cap —
    // longer words genuinely get more time instead of being clipped.
    // A small, clamped nudge from the text's overall tenseScore layers
    // on top: tense/urgent text reads a little faster, calm text a
    // little slower — capped at ±15% so it stays a subtle emotional
    // cue, not a dramatic tempo swing.
    const clampedTense = Math.max(-0.5, Math.min(1.0, sessionTenseScore));
    const pacingFactor = 1 - clampedTense * 0.15;
    const base = (380 + wlen * 42) * pacingFactor;
    const spd  = (isCadence ? base * 1.2 : base) + rnd(-20, 60);
    await sleep(spd);
  }

  const completedNaturally = !stopping;

  stopping = true;
  clearAmb();
  if (rec && rec.state !== 'inactive') rec.stop();
  render.innerHTML = esc(text);
  playing = false;
  bPlay.disabled = false; bStop.disabled = true;

  // show continue prompt
  editor.style.display = '';
  render.style.display = 'none';
  editor.focus();
  editor.setSelectionRange(editor.value.length, editor.value.length);

  if (completedNaturally) {
    const msg = findPersonaMessage(text);
    if (msg) showPersonaToast(msg);
  }
}

// ─── Stop ───────────────────────────────────────────────────────
export function stop() {
  stopping = true;
  clearAmb();
  if (rec && rec.state !== 'inactive') rec.stop();
  editor.style.display = '';
  render.style.display = 'none';
  playing = false;
  bPlay.disabled = false; bStop.disabled = true;
}

// ─── Reset helpers ──────────────────────────────────────────────
export function resetHarmony() {
  harmonyLocked = false;
  sessionTenseScore = 0;
  sessionNormScore = 0;
}

export function clearAudioState() {
  audioBlob = null;
  chunks = [];
}

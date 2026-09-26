import { editor, render, bPlay, bStop, bSave } from './dom.js';
import { ac, unlockIOSAudio } from './audio/context.js';
import { ensureReverb, updateReverb, resetReverb } from './audio/reverb.js';
import { VOICES } from './audio/voices.js';
import { playPunctuation } from './audio/punctuation.js';
import { startAmbient, clearAmb, setAmbientDensity, getCurrentChordDegree, getChordDirection } from './audio/ambient.js';
import { deriveTextHarmony, hashText, resolveCadence, generateMotif, motifSequenceStartDegree, motifNote, globalTensionBias, arbitrateMelodyNote } from './music/harmony.js';
import { wordEmotionWeight } from './music/mood.js';
import { deriveIntentions, deriveSemanticSpans } from './music/intention.js';
import { deriveComposition } from './music/composition.js';
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
let lastHarmonyText = null;
let sessionTenseScore = 0;
let sessionNormScore = 0;
let pieceMotif = null;
let pieceIntentions = [];
let pieceComposition = null;
let pieceSemanticSpans = [];
const MUSICAL_INTENTION_ENABLED = true;
const REGISTER_BIAS_ENABLED = true;
const NEIGHBOR_TONE_ENABLED = true;
const COMPOSITION_LAYER_ENABLED = true;

const GLOBAL_TENSION_ENABLED = true;
const CONTRARY_MOTION_ENABLED = true;
const SEMANTIC_STABILITY_ENABLED = true;
const SEMANTIC_WEIGHT_THRESHOLD = 0.5;

export function isPlaying() { return playing; }
export function getAudioBlob() { return audioBlob; }
export function getAudioMimeType() { return rec && rec.mimeType ? rec.mimeType : 'audio/webm'; }

const VOICE_GROUPS = {
  statement: [0, 2, 5, 6, 10, 12, 13, 15, 16, 20, 21],
  question:  [1, 4, 7, 9, 11, 17, 19, 20],
  exclaim:   [1, 3, 5, 8, 9, 11, 14, 17, 18],
};

const DARK_VOICES = [2, 4, 12, 14, 16, 20, 21];
const BRIGHT_VOICES = [1, 3, 5, 8, 9, 10, 11, 17, 18, 19];

const PERCUSSIVE_VOICES = [1, 3, 5, 7, 8, 9, 10, 11, 14, 17, 19, 20];
const RAMPED_VOICES = [0, 2, 4, 6, 12, 13, 15, 16, 18, 21];

function pickOrchestVoice(group, normScore, family) {
  const moodSet = normScore <= -0.15 ? DARK_VOICES
                : normScore >= 0.15  ? BRIGHT_VOICES
                : null;
  let candidates = group.filter(v => family.includes(v) && (!moodSet || moodSet.includes(v)));
  if (candidates.length === 0) candidates = group.filter(v => family.includes(v));
  if (candidates.length === 0 && moodSet) candidates = group.filter(v => moodSet.includes(v));
  if (candidates.length === 0) candidates = group;
  return pick(candidates);
}

function familyForMood(normScore) {
  if (normScore <= -0.15) return RAMPED_VOICES;
  if (normScore >= 0.15) return PERCUSSIVE_VOICES;
  return pick([PERCUSSIVE_VOICES, RAMPED_VOICES]);
}

export async function play() {
  const text = editor.value;
  if (!text.trim()) return;

  unlockIOSAudio();

  if (harmonyLocked && text !== lastHarmonyText) {
    harmonyLocked = false;
  }

  if (!harmonyLocked) {
    const harmonyInfo = deriveTextHarmony(text);
    sessionTenseScore = harmonyInfo.tenseScore;
    sessionNormScore = harmonyInfo.normScore;
    pieceMotif = generateMotif(hashText(text), sessionTenseScore);
    pieceIntentions = MUSICAL_INTENTION_ENABLED ? deriveIntentions(text) : [];
    pieceSemanticSpans = SEMANTIC_STABILITY_ENABLED ? deriveSemanticSpans(text) : [];
    pieceComposition = COMPOSITION_LAYER_ENABLED ? deriveComposition(text) : null;
    harmonyLocked = true;
    lastHarmonyText = text;
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

  const clampedNorm = Math.max(-1.5, Math.min(1.5, sessionNormScore));
  const startEnergy = Math.max(0, Math.min(1, (sessionTenseScore + 1) / 2));
  const roomSeed = hashText(text) >>> 0;
  ensureReverb(dests, {
    normScore: clampedNorm,
    density: 1,
    energy: startEnergy,
  }, roomSeed);

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
  const totalWordsInText = playable.filter(t => t.type === 'word').length;

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
    flushSentence();
  }

  let currentFamily = familyForMood(sessionNormScore);
  let voiceIdx = pickOrchestVoice(VOICE_GROUPS.statement, sessionNormScore, currentFamily);
  let lastNote = null;
  let sentenceCycle = 0;
  let wordIdxInSentence = 0;
  let pendingNeighborTarget = null;
  let sentenceUsesMotif = false;
  let sentenceStartDegree = 0;
  let wordGlobalIndex = 0;
  let clauseCursor = 0;
  let wordIdxInClause = 0;
  let semanticSpanCursor = 0;

  for (let i = 0; i < playable.length; i++) {
    if (stopping) break;
    const tok = playable[i];
    try {

    render.innerHTML = buildRender(text, tok.start, tok.end);

    if (tok.type === 'punct') {
      const intensity = 0.7 + 0.3;
      playPunctuation(tok.text, dests, intensity);
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

    const density = tok.paraPos === 'start' ? 0.55 : tok.paraPos === 'end' ? 1.35 : 1;
    setAmbientDensity(density);
    updateReverb({ normScore: sessionNormScore, density, energy: startEnergy });

    const next = playable[i + 1];
    const isCadence = next && next.type === 'punct' && ['.', '!', '?', '؟'].includes(next.text);

    const sp = sentencePos[i] || { pos: 1, total: 1 };

    if (sp.pos === 1) {
      sentenceCycle++;
      wordIdxInSentence = 0;
      sentenceUsesMotif = (sentenceCycle % 2 === 1);
      if (sentenceUsesMotif) {
        const occurrenceIdx = Math.floor((sentenceCycle - 1) / 2);
        sentenceStartDegree = motifSequenceStartDegree(occurrenceIdx);
      }
    }

    while (clauseCursor < pieceIntentions.length - 1 && tok.start >= pieceIntentions[clauseCursor].end) {
      clauseCursor++;
      wordIdxInClause = 0;
    }
    const intention = pieceIntentions[clauseCursor] || { contourBias: 0, isDisruption: false, cadenceStrength: 1 };
    const isFirstWordOfClause = wordIdxInClause === 0;
    wordIdxInClause++;

    const freq = (() => {
      let note;
      const progress = totalWordsInText > 1 ? wordGlobalIndex / (totalWordsInText - 1) : 0;
      const compState = COMPOSITION_LAYER_ENABLED && pieceComposition ? pieceComposition.getStateAt(progress) : null;
      const combinedRegisterBias = REGISTER_BIAS_ENABLED
        ? Math.max(-1, Math.min(1, intention.contourBias + (compState ? compState.registerTendency * 0.5 : 0)))
        : 0;
      const motifAllowed = compState ? compState.motifActive : true;

      if (isCadence) {
        note = resolveCadence(lastNote, tok.sentenceType, intention.cadenceStrength, combinedRegisterBias);
      } else if (motifAllowed && sentenceUsesMotif && wordIdxInSentence <= pieceMotif.intervals.length) {
        note = motifNote(pieceMotif, sentenceStartDegree, wordIdxInSentence, lastNote);
      } else {
        const isStrongBeat = sp.pos % 2 === 1;
        while (semanticSpanCursor < pieceSemanticSpans.length && tok.start >= pieceSemanticSpans[semanticSpanCursor].end) {
          semanticSpanCursor++;
        }
        const spanWeight = SEMANTIC_STABILITY_ENABLED
          && pieceSemanticSpans[semanticSpanCursor]
          && tok.start >= pieceSemanticSpans[semanticSpanCursor].start
          && tok.start < pieceSemanticSpans[semanticSpanCursor].end
          ? pieceSemanticSpans[semanticSpanCursor].weight
          : 0;
        const semanticWeight = SEMANTIC_STABILITY_ENABLED ? Math.max(wordEmotionWeight(tok.text), spanWeight) : 0;
        const isSemanticallyStable = semanticWeight >= SEMANTIC_WEIGHT_THRESHOLD;
        const chordDeg = (isStrongBeat || isSemanticallyStable) ? getCurrentChordDegree() : null;
        const effectiveTense = GLOBAL_TENSION_ENABLED
          ? Math.max(0, Math.min(1, sessionTenseScore + globalTensionBias(progress) + (compState ? compState.tension * 0.25 : 0)))
          : sessionTenseScore;
        const isDisruptionNow = intention.isDisruption && isFirstWordOfClause;
        const prevDegreeBeforeThisNote = lastNote ? lastNote.degree : null;
        note = arbitrateMelodyNote(
          lastNote,
          chordDeg,
          effectiveTense,
          intention.contourBias,
          isDisruptionNow,
          isStrongBeat,
          CONTRARY_MOTION_ENABLED ? getChordDirection() : 0,
          combinedRegisterBias,
          NEIGHBOR_TONE_ENABLED ? pendingNeighborTarget?.degree : null
        );
        pendingNeighborTarget = null;
        if (NEIGHBOR_TONE_ENABLED && !isStrongBeat && !isCadence && prevDegreeBeforeThisNote !== null
            && Math.abs(note.lastInterval || 0) === 1) {
          pendingNeighborTarget = { degree: prevDegreeBeforeThisNote };
        }
      }
      lastNote = note;
      wordIdxInSentence++;
      wordGlobalIndex++;
      return note.freq;
    })();

    const frac = sp.total > 1 ? (sp.pos - 1) / (sp.total - 1) : 0.5;
    const volArc = 0.85 + Math.sin(Math.PI * frac) * 0.3;

    const vol = Math.max(0.12, Math.min(0.6,
      (isCadence ? rnd(0.20, 0.40) : rnd(0.18, 0.52)) * volArc
    ));
    const dur = isCadence ? rnd(0.45, 0.75) : rnd(0.22, 0.45);

    const panner = c.createStereoPanner();
    panner.pan.value = rnd(-0.35, 0.35);
    panner.connect(c.destination);
    panner.connect(sd);

    if (sp.pos === 1) currentFamily = familyForMood(sessionNormScore);

    if (rnd(0, 1) < 0.4) {
      const pickFamily = isCadence
        ? (currentFamily === PERCUSSIVE_VOICES ? RAMPED_VOICES : PERCUSSIVE_VOICES)
        : currentFamily;
      voiceIdx = pickOrchestVoice(group, sessionNormScore, pickFamily);
    }
    VOICES[voiceIdx](freq, vol, dur, [panner]);

    const clampedTense = Math.max(-0.5, Math.min(1.0, sessionTenseScore));
    const pacingFactor = 1 - clampedTense * 0.15;
    const base = (380 + wlen * 42) * pacingFactor;
    const spd  = (isCadence ? base * 1.2 : base) + rnd(-20, 60);
    await sleep(spd);
    } catch (err) {
      console.error('Notepad: error playing word, skipping to next', tok?.text, err);
    }
  }

  const completedNaturally = !stopping;

  stopping = true;
  clearAmb();
  if (rec && rec.state !== 'inactive') rec.stop();
  render.innerHTML = esc(text);
  playing = false;
  bPlay.disabled = false; bStop.disabled = true;

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
  lastHarmonyText = null;
  sessionTenseScore = 0;
  sessionNormScore = 0;
}

export function clearAudioState() {
  audioBlob = null;
  chunks = [];
}

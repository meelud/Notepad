import { editor, render, bPlay, bStop, bSave } from './dom.js';
import { ac, unlockIOSAudio } from './audio/context.js';
import { ensureReverb, updateReverb, resetReverb } from './audio/reverb.js';
import { VOICES } from './audio/voices.js';
import { playPunctuation } from './audio/punctuation.js';
import { startAmbient, clearAmb, setAmbientDensity, getCurrentChordDegree, getChordDirection } from './audio/ambient.js';
import { deriveTextHarmony, hashText, resolveCadence, generateMotif, motifSequenceStartDegree, motifNote, globalTensionBias, arbitrateMelodyNote } from './music/harmony.js';
import { wordEmotionWeight } from './music/mood.js';
import { deriveIntentions } from './music/intention.js';
import { seedRng, rnd, pick } from './utils/rng.js';
import { tokenize, esc, buildRender, sleep } from './utils/text.js';
import { findPersonaMessage, showPersonaToast } from './persona.js';

// ─── State ──────────────────────────────────────────────────────
let playing = false;
let stopping = false;
let rec = null;
let chunks = [];
let audioBlob = null;
let audioMimeType = 'audio/webm';
let harmonyLocked = false;
let lastHarmonyText = null; // the text harmonyLocked was derived from — auto-invalidates the lock if the text changes
let sessionTenseScore = 0; // tenseScore of the current text, used to nudge pacing
let sessionNormScore = 0; // normScore of the current text, used to nudge reverb wetness
let pieceMotif = null; // {intervals:number[]} — generated once per text, reused across sentences
let pieceIntentions = []; // clause-level Musical Intention sequence — see music/intention.js
// Musical Intention layer toggle — flip to false to ignore clause-level
// semantics (contrast/contour) entirely, reverting to prior behavior.
const MUSICAL_INTENTION_ENABLED = true;
const REGISTER_BIAS_ENABLED = true;

// Item #3 (global tension profile) toggle — flip to false to instantly
// revert to pure per-sentence tenseScore for A/B comparison.
const GLOBAL_TENSION_ENABLED = true;
// Item #2 (contrary motion vs chord movement) toggle — flip to false to
// revert harmonizeNote calls to plain nearest-tone voice leading only.
const CONTRARY_MOTION_ENABLED = true;
// Item #1 (GTTM-style structural weighting) toggle — flip to false to
// revert to strong-beat-only harmonization, ignoring word semantics.
const SEMANTIC_STABILITY_ENABLED = true;
const SEMANTIC_WEIGHT_THRESHOLD = 0.5; // lexicon match strength that earns chord-tone pull on an otherwise-free (weak) beat

export function isPlaying() { return playing; }
export function getAudioBlob() { return audioBlob; }
export function getAudioMimeType() { return audioMimeType; }

// ─── Voice selection by sentence type ───────────────────────────
const VOICE_GROUPS = {
  statement: [0, 2, 5, 6, 10, 12, 13, 15, 16, 20, 21],
  question:  [1, 4, 7, 9, 11, 17, 19, 20],
  exclaim:   [1, 3, 5, 8, 9, 11, 14, 17, 18],
};

// ─── Mood-aware timbre bias ──────────────────────────────────────
// Purely a selection bias within the existing 22 voices above — no
// new voices, no changes to voices.js itself. Dark/melancholic text
// leans toward airier, deeper, more textural voices; bright text
// leans toward bell-like, playful, bolder ones. Classification is by
// each voice's own description comment in voices.js.
const DARK_VOICES = [2, 4, 12, 14, 16, 20, 21];   // Breath, Ghost chord, Choir pad, Sub thump, Bowed cello, Granular, Deep gong
const BRIGHT_VOICES = [1, 3, 5, 8, 9, 10, 11, 17, 18, 19]; // Pluck, Bell, Piano, Marimba, Glass bell, Vibraphone, Music box, Kalimba, Brass swell, Celeste

// ─── Attack-family classification ────────────────────────────────
// Extracted from each voice's ACTUAL gain envelope in voices.js (not
// its descriptive comment): does the note start at/near full gain
// immediately (percussive), or ramp up over 80ms+ (swelling)? This is
// the real structural signal for sequencing — a percussive voice
// landing right after a slow-swelling one (or vice versa) with no
// transition is what reads as a disjointed string of timbres rather
// than a phrase. Notably, this split already correlates strongly with
// DARK/BRIGHT above (ramped ≈ dark/airy, percussive ≈ bright/lively),
// so the two signals reinforce rather than fight each other.
const PERCUSSIVE_VOICES = [1, 3, 5, 7, 8, 9, 10, 11, 14, 17, 19, 20];
const RAMPED_VOICES = [0, 2, 4, 6, 12, 13, 15, 16, 18, 21];

/**
 * Picks a voice from the sentenceType group, layering two signals:
 * mood (emotional color) and attack-family (structural/sequential
 * coherence — keeps a sentence's timbral "gesture" consistent instead
 * of jumping between percussive and swelling voices word to word).
 * Fallback chain guarantees a valid pick even if the intersection is
 * empty: mood∩family → family alone → mood alone → full group.
 * @param {number[]} group — sentenceType-appropriate voice indices
 * @param {number} normScore — session mood score (-1.5 dark .. 1.5 bright)
 * @param {number[]} family — PERCUSSIVE_VOICES or RAMPED_VOICES
 */
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

/** Picks the attack-family a new sentence should "live in" — follows
 * the mood's natural correlation (dark→ramped, bright→percussive),
 * coin-flip for neutral text. */
function familyForMood(normScore) {
  if (normScore <= -0.15) return RAMPED_VOICES;
  if (normScore >= 0.15) return PERCUSSIVE_VOICES;
  return pick([PERCUSSIVE_VOICES, RAMPED_VOICES]);
}

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

  // A locked harmony is only valid for the text it was derived from —
  // if the editor's content has changed since then (typed new text and
  // hit Play without clicking Clear), the lock must NOT carry over, or
  // every subsequent piece silently reuses the first text's mode/
  // scale/motif/intentions regardless of what the new text actually
  // says. Clear() still works as an explicit reset; this just makes
  // editing-then-replaying also behave correctly without relying on it.
  if (harmonyLocked && text !== lastHarmonyText) {
    harmonyLocked = false;
  }

  if (!harmonyLocked) {
    const harmonyInfo = deriveTextHarmony(text);
    sessionTenseScore = harmonyInfo.tenseScore;
    sessionNormScore = harmonyInfo.normScore;
    pieceMotif = generateMotif(hashText(text), sessionTenseScore);
    pieceIntentions = MUSICAL_INTENTION_ENABLED ? deriveIntentions(text) : [];
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

  // mood-driven reverb space: dark/sad text sits in a more spacious,
  // distant-feeling reverb; bright text stays drier and more present.
  // This is the piece's emotional "room size", separate from anything
  // per-word — a much more standard way to convey melancholy/distance
  // than simply turning the volume down.
  const clampedNorm = Math.max(-1.5, Math.min(1.5, sessionNormScore));
  const startEnergy = Math.max(0, Math.min(1, (sessionTenseScore + 1) / 2));
  const roomSeed = hashText(text) >>> 0;
  ensureReverb(dests, {
    normScore: clampedNorm,
    density: 1,
    energy: startEnergy,
  }, roomSeed);

  // Recording is a nice-to-have, not essential — if MediaRecorder isn't
  // available or fails to construct (some browsers/embedded webviews),
  // playback should still work, just without the Save button.
  try {
    rec = new MediaRecorder(sd.stream);
    audioMimeType = rec.mimeType || 'audio/webm';
    rec.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
    rec.onstop = () => {
      audioBlob = new Blob(chunks, { type: audioMimeType });
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

  let currentFamily = familyForMood(sessionNormScore);
  let voiceIdx = pickOrchestVoice(VOICE_GROUPS.statement, sessionNormScore, currentFamily);
  let lastNote = null; // melodic contour state: {degree, octave, lastInterval} — persists across sentences for register continuity
  let sentenceCycle = 0;       // 1-based count of sentences seen so far
  let wordIdxInSentence = 0;   // 0-based position of the current word within its sentence
  let sentenceUsesMotif = false;
  let sentenceStartDegree = 0;
  let wordGlobalIndex = 0; // 0-based position of this word across the WHOLE text (for global tension arc)
  let clauseCursor = 0;
  let wordIdxInClause = 0;

  for (let i = 0; i < playable.length; i++) {
    if (stopping) break;
    const tok = playable[i];
    try {

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
    // reverb follows the same density: sparse passages sit further back in
    // a huge room, dense ones pull the depth layers in so nothing smears.
    updateReverb({ normScore: sessionNormScore, density, energy: startEnergy });

    // cadence: the last word right before sentence-ending punctuation
    // gets a softer, longer note — a natural "landing" instead of an
    // arbitrary cutoff, the way a spoken sentence settles at its end.
    const next = playable[i + 1];
    const isCadence = next && next.type === 'punct' && ['.', '!', '?', '؟'].includes(next.text);

    // sentence position (must be computed before the melody contour
    // block below, which reads sp.pos to detect a new sentence)
    const sp = sentencePos[i] || { pos: 1, total: 1 };

    if (sp.pos === 1) {
      // new sentence: decide whether it restates the piece's motif
      // (odd-numbered sentences: 1st, 3rd, 5th...) as a rising sequence,
      // or moves freely (even-numbered) — periodic recurrence rather
      // than either constant repetition or pure randomness every time
      sentenceCycle++;
      wordIdxInSentence = 0;
      sentenceUsesMotif = (sentenceCycle % 2 === 1);
      if (sentenceUsesMotif) {
        const occurrenceIdx = Math.floor((sentenceCycle - 1) / 2);
        sentenceStartDegree = motifSequenceStartDegree(occurrenceIdx);
      }
    }

    // advance the clause cursor so it always points at the clause
    // containing this word (both arrays are in text order, so a simple
    // forward-only pointer is enough — no need to search from scratch)
    while (clauseCursor < pieceIntentions.length - 1 && tok.start >= pieceIntentions[clauseCursor].end) {
      clauseCursor++;
      wordIdxInClause = 0;
    }
    const intention = pieceIntentions[clauseCursor] || { contourBias: 0, isDisruption: false, cadenceStrength: 1 };
    const isFirstWordOfClause = wordIdxInClause === 0;
    wordIdxInClause++;

    const freq = (() => {
      let note;
      if (isCadence) {
        note = resolveCadence(lastNote, tok.sentenceType, intention.cadenceStrength, REGISTER_BIAS_ENABLED ? intention.contourBias : 0);
      } else if (sentenceUsesMotif && wordIdxInSentence <= pieceMotif.intervals.length) {
        note = motifNote(pieceMotif, sentenceStartDegree, wordIdxInSentence, lastNote);
      } else {
        // Harmonic awareness: on odd word positions within the sentence
        // (a simple downbeat proxy — true beat-grid sync is a separate,
        // higher-risk item on the roadmap), pull the note onto the
        // nearest tone of whatever chord ambient.js is currently
        // sounding, so it doesn't land on an arbitrary scale degree
        // that clashes with the live harmony. Even word positions stay
        // free passing-tone motion, exactly as before.
        const isStrongBeat = sp.pos % 2 === 1;
        const semanticWeight = SEMANTIC_STABILITY_ENABLED ? wordEmotionWeight(tok.text) : 0;
        const isSemanticallyStable = semanticWeight >= SEMANTIC_WEIGHT_THRESHOLD;
        const chordDeg = (isStrongBeat || isSemanticallyStable) ? getCurrentChordDegree() : null;
        const progress = totalWordsInText > 1 ? wordGlobalIndex / (totalWordsInText - 1) : 0;
        const effectiveTense = GLOBAL_TENSION_ENABLED
          ? Math.max(0, Math.min(1, sessionTenseScore + globalTensionBias(progress)))
          : sessionTenseScore;
        // Tier 2 arbitration: harmony's chord-tone pull, semantic/
        // tension-driven motion, and plain voice-leading all compete
        // as scored candidates from a real pool (see harmony.js's
        // arbitrateMelodyNote) — not two pre-decided "winners" combined
        // by a single ad hoc weight. Cadence/motif above stay hard
        // overrides on purpose (Tier 1 — see arbitrate's docstring).
        const isDisruptionNow = intention.isDisruption && isFirstWordOfClause;
        note = arbitrateMelodyNote(
          lastNote,
          chordDeg,
          effectiveTense,
          intention.contourBias,
          isDisruptionNow,
          isStrongBeat,
          CONTRARY_MOTION_ENABLED ? getChordDirection() : 0,
          REGISTER_BIAS_ENABLED ? intention.contourBias : 0
        );
      }
      lastNote = note;
      wordIdxInSentence++;
      wordGlobalIndex++;
      return note.freq;
    })();

    // gentle volume arc across the sentence: quieter near the edges,
    // fuller in the middle — real phrasing breathes, it doesn't hold
    // one flat loudness word to word. Sin-shaped, ±15%, clamped.
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

    // refresh the sentence's timbral "family" at each new sentence —
    // keeps a stable percussive-vs-swelling identity across the whole
    // sentence instead of rerolling structure word to word
    if (sp.pos === 1) currentFamily = familyForMood(sessionNormScore);

    if (rnd(0, 1) < 0.4) {
      // cadence words may deliberately cross into the opposite family
      // as a resolution gesture (e.g. a percussive sentence settling
      // into a swelling voice at its very end) — everywhere else,
      // voice changes stay within the sentence's established family
      const pickFamily = isCadence
        ? (currentFamily === PERCUSSIVE_VOICES ? RAMPED_VOICES : PERCUSSIVE_VOICES)
        : currentFamily;
      voiceIdx = pickOrchestVoice(group, sessionNormScore, pickFamily);
    }
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
    } catch (err) {
      // A failure synthesizing/scheduling this one word must not kill the
      // whole loop — previously an uncaught error here silently stopped
      // playback after the first word while startAmbient()'s independent
      // setTimeout clock kept running forever with no cleanup (clearAmb()
      // is only called after the loop finishes normally or via stop()).
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
  lastHarmonyText = null;
  sessionTenseScore = 0;
  sessionNormScore = 0;
}

export function clearAudioState() {
  audioBlob = null;
  chunks = [];
}

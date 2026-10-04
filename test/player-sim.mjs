/**
 * player-sim.mjs
 * ─────────────────────────────────────────────────────────────────
 * Headless re-implementation of player.js's per-word decision loop,
 * stripped of everything audio/DOM-related (no AudioContext, no
 * voices, no reverb, no recording). Every MUSICAL decision path is
 * kept faithful to the real player.js.
 *
 * Timeline: player.js and this simulator share music/rhythm.js. Strong
 * beats, the chord a word is pulled toward and the chord's direction are
 * pure functions of the word's VIRTUAL onset (sum of planned durations)
 * and of the text — no wall clock, no shared rng — so this simulation is
 * not an approximation of the browser's decisions but the same decisions.
 * test/player-parity.mjs proves that against the real play().
 *
 * Output per text: the full sequence of {degree, octave, freq,
 * lastInterval, isCadence, isStrongBeat, sentenceType, wordIdx, path}.
 */
import { deriveTextHarmony, hashText, resolveCadence, generateMotif, repeatNote,
         motifSequenceStartDegree, motifNote, globalTensionBias,
         arbitrateMelodyNote, chordFromScale, currentScale } from '../js/music/harmony.js';
import { wordEmotionWeight } from '../js/music/mood.js';
import { deriveIntentions, deriveSemanticSpans } from '../js/music/intention.js';
import { deriveComposition } from '../js/music/composition.js';
import { seedRng } from '../js/utils/rng.js';
import { barIndexAt, isStrongBeatAt, punctPauseFor, wordDurationMs, createChordClock } from '../js/music/rhythm.js';
import { tokenize } from '../js/utils/text.js';
import { derivePhrasing } from '../js/music/phrasing.js';

// These mirror player.js's own flags. They must agree: the sim's compState
// lines have NO null-guard where player.js's do, so the two files only agree
// today because both flags are true everywhere. Turn one off here and the
// paths diverge — which is exactly the latent asymmetry player-parity cannot
// currently reach, because with the flags all true compState is never null in
// either file. There is no text that triggers it, so no text can be added to
// the parity corpus; the guard has to be structural instead.
//
// Asserted by test/player-sim-parity-mirror.mjs, which reads both files.
const MUSICAL_INTENTION_ENABLED = true;
const COMPOSITION_LAYER_ENABLED = true;
const REGISTER_BIAS_ENABLED = true;
const SEMANTIC_STABILITY_ENABLED = true;

const SEMANTIC_WEIGHT_THRESHOLD = 0.5;
const CONTRARY_MOTION_ENABLED = true; // mirrors player.js

/**
 * Runs the full headless simulation for one text and returns the
 * complete note sequence plus the session's harmony/tension info.
 */
export function simulateText(text) {
  const harmonyInfo = deriveTextHarmony(text);
  const sessionTenseScore = harmonyInfo.tenseScore;
  const sessionArousalScore = harmonyInfo.arousalScore;
  const sessionNormScore = harmonyInfo.normScore;
  const pieceMotif = generateMotif(hashText(text), sessionTenseScore);
  const pieceIntentions = MUSICAL_INTENTION_ENABLED ? deriveIntentions(text) : [];
  const pieceSemanticSpans = SEMANTIC_STABILITY_ENABLED ? deriveSemanticSpans(text) : []; // see js/player.js's third phrase-awareness fix
  const pieceComposition = COMPOSITION_LAYER_ENABLED ? deriveComposition(text) : null;
  seedRng(hashText(text)); // after all derive*() calls, exactly as in player.js

  const tokens = tokenize(text);
  const playable = tokens.filter(t => t.type === 'word' || t.type === 'punct');
  const totalWordsInText = playable.filter(t => t.type === 'word').length;
  const phrasing = derivePhrasing(playable);
  const wordNotes = [];

  const sentencePos = new Array(playable.length).fill(null);
  {
    let sentenceWordIdxs = [];
    const flushSentence = () => {
      const n = sentenceWordIdxs.length;
      sentenceWordIdxs.forEach((idx, k) => { sentencePos[idx] = { pos: k + 1, total: n }; });
      sentenceWordIdxs = [];
    };
    playable.forEach((tok, idx) => {
      if (tok.type === 'word') sentenceWordIdxs.push(idx);
      else if (tok.type === 'punct' && ['.', '!', '?', '؟'].includes(tok.text)) flushSentence();
    });
    flushSentence();
  }

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

  // deterministic timeline shared with player.js (music/rhythm.js)
  const chordClock = createChordClock(hashText(text), harmonyInfo.mood);
  let virtualMs = 0;

  const sequence = [];

  for (let i = 0; i < playable.length; i++) {
    const tok = playable[i];

    if (tok.type === 'punct') {
      const pause = punctPauseFor(tok.text, sessionArousalScore);
      virtualMs += pause;
      continue;
    }

    const next = playable[i + 1];
    // mirrors player.js exactly, including the last-word-is-a-cadence rule.
    // See the comment at the same line in player.js: isCadence used to require
    // trailing punctuation, so it was false for most prose and the final note
    // never resolved. If the two files ever disagree here again, player-parity
    // is what catches it.
    const isLastWord = wordGlobalIndex === totalWordsInText - 1;
    const isCadence = isLastWord
      || (next && next.type === 'punct' && ['.', '!', '?', '؟'].includes(next.text));
    const sp = sentencePos[i] || { pos: 1, total: 1 };

    const wlen = (tok.text.match(/[\p{L}\p{N}]/gu) || []).length || 1;
    const wordStartMs = virtualMs;
    virtualMs += wordDurationMs(wlen, sessionArousalScore, isCadence);

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

    let note;
    const progress = totalWordsInText > 1 ? wordGlobalIndex / (totalWordsInText - 1) : 0;
    const compState = COMPOSITION_LAYER_ENABLED && pieceComposition ? pieceComposition.getStateAt(progress) : null;
    const combinedRegisterBias = REGISTER_BIAS_ENABLED
      ? Math.max(-1, Math.min(1, intention.contourBias + (compState ? compState.registerTendency * 0.5 : 0)))
      : 0;
    const motifAllowed = compState ? compState.motifActive : true;

    let isStrongBeat = null;
    let chordArg = null, contraryArg = null;

    const repLink = phrasing.repetitionAt(wordGlobalIndex);
    const cadenceKind = phrasing.cadenceKind(i);
    const isHalf = !isCadence && cadenceKind === 'half';
    const isRep = !isCadence && !isHalf && !!(repLink && wordNotes[repLink.src]);
    if (isCadence) {
      note = resolveCadence(lastNote, tok.sentenceType, intention.cadenceStrength, combinedRegisterBias);
    } else if (isHalf) {
      note = resolveCadence(lastNote, 'half', 1, combinedRegisterBias);
    } else if (isRep) {
      note = repeatNote(wordNotes[repLink.src], lastNote, combinedRegisterBias);
    } else if (motifAllowed && sentenceUsesMotif && wordIdxInSentence <= pieceMotif.intervals.length) {
      note = motifNote(pieceMotif, sentenceStartDegree, wordIdxInSentence, lastNote);
    } else {
      const barIdx = barIndexAt(wordStartMs);
      isStrongBeat = isStrongBeatAt(wordStartMs);
      while (semanticSpanCursor < pieceSemanticSpans.length && tok.start >= pieceSemanticSpans[semanticSpanCursor].end) {
        semanticSpanCursor++;
      }
      const spanWeight = pieceSemanticSpans[semanticSpanCursor]
        && tok.start >= pieceSemanticSpans[semanticSpanCursor].start
        && tok.start < pieceSemanticSpans[semanticSpanCursor].end
        ? pieceSemanticSpans[semanticSpanCursor].weight : 0;
      const semanticWeight = Math.max(wordEmotionWeight(tok.text), spanWeight);
      const isSemanticallyStable = semanticWeight >= SEMANTIC_WEIGHT_THRESHOLD;
      const effChordDeg = (isStrongBeat || isSemanticallyStable) ? chordClock.degreeAtBar(barIdx) : null;
      chordArg = effChordDeg;
      contraryArg = CONTRARY_MOTION_ENABLED ? chordClock.directionAtBar(barIdx) : 0;
      const effectiveTense = Math.max(0, Math.min(1, sessionTenseScore + globalTensionBias(progress) + (compState ? compState.tension * 0.25 : 0)));
      const isDisruptionNow = intention.isDisruption && isFirstWordOfClause;
      const prevDegreeBeforeThisNote = lastNote ? lastNote.degree : null;
      note = arbitrateMelodyNote(
        lastNote, effChordDeg, effectiveTense, intention.contourBias, isDisruptionNow,
        isStrongBeat, contraryArg, combinedRegisterBias, pendingNeighborTarget?.degree
      );
      pendingNeighborTarget = null;
      if (!isStrongBeat && !isCadence && prevDegreeBeforeThisNote !== null && Math.abs(note.lastInterval || 0) === 1) {
        pendingNeighborTarget = { degree: prevDegreeBeforeThisNote };
      }
    }

    const path = (isCadence || isHalf) ? 'cadence'
      : isRep ? 'repetition'
      : (motifAllowed && sentenceUsesMotif && wordIdxInSentence <= pieceMotif.intervals.length) ? 'motif'
      : 'arbitration';

    sequence.push({
      degree: note.degree, octave: note.octave, freq: note.freq,
      lastInterval: note.lastInterval, isCadence, cadenceKind: isCadence ? 'full' : (isHalf ? 'half' : null),
      repSrc: isRep ? repLink.src : null, isStrongBeat, chordArg, contraryArg, startMs: wordStartMs,
      sentenceType: tok.sentenceType, wordIdx: wordGlobalIndex,
      cadenceStrength: intention.cadenceStrength, path,
      compRole: compState ? compState.role : null, compTension: compState ? compState.tension : 0, compEnergy: compState ? compState.energy : 0,
      progress,
      // the LOCAL, per-word effective tension that actually fed into this
      // note's decision (session base + globalTensionBias's arc + a slice
      // of the composition layer's own tension curve) — see note below on
      // why this, not sessionTenseScore, is the right unit for testing
      // the tense->leap design intent.
      effectiveTense: path === 'arbitration'
        ? Math.max(0, Math.min(1, sessionTenseScore + globalTensionBias(progress) + (compState ? compState.tension * 0.25 : 0)))
        : null,
    });

    lastNote = note;
    wordNotes[wordGlobalIndex] = note;
    wordIdxInSentence++;
    wordGlobalIndex++;

  }

  return {
    sequence, sessionTenseScore, sessionNormScore, mood: harmonyInfo.mood,
    scaleLength: currentScale.length, sentenceCount: sentenceCycle,
  };
}


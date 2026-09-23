/**
 * player-sim.mjs
 * ─────────────────────────────────────────────────────────────────
 * Headless re-implementation of player.js's per-word decision loop,
 * stripped of everything audio/DOM-related (no AudioContext, no
 * voices, no reverb, no recording). Every MUSICAL decision path is
 * kept faithful to the real player.js.
 *
 * Chord clock (v2 — real elapsed-time simulation): the real
 * ambient.js chord clock advances on a WALL-CLOCK timer (BEAT_SEC
 * seconds per beat, 4 beats/bar), driven by setTimeout ticks that run
 * concurrently with — not synchronized to — player.js's word loop.
 * An earlier version of this module advanced the chord once every 4
 * WORDS as a structural stand-in, which is a real approximation, not
 * a simulation. This version instead accumulates the SAME elapsed
 * milliseconds player.js's own loop would produce (using the exact
 * pause/spd formulas from play()'s word/punct branches, including the
 * tenseScore-driven pacingFactor) and advances the chord bar exactly
 * when that much real time would have crossed a bar boundary —
 * calling pickNextDegree() once per bar exactly as ambient.js's
 * tick() does at beatInBar===0. This is now a faithful timing
 * simulation, not an approximation, though one caveat remains
 * unavoidable in any headless model: in the real browser, player.js's
 * word loop and ambient.js's setTimeout clock are two independent
 * JS event-loop timers, so their exact interleaving (and therefore
 * the exact point within a bar a "strong beat" word lands on) has
 * real jitter session-to-session even for the same text — this
 * module reproduces the DESIGNED timing exactly, not that jitter.
 *
 * Output per text: the full sequence of {degree, octave, freq,
 * lastInterval, isCadence, isStrongBeat, sentenceType, wordIdx, path}.
 */
import { deriveTextHarmony, hashText, resolveCadence, generateMotif,
         motifSequenceStartDegree, motifNote, globalTensionBias,
         arbitrateMelodyNote, chordFromScale, currentScale } from '../js/music/harmony.js';
import { wordEmotionWeight } from '../js/music/mood.js';
import { deriveIntentions, deriveSemanticSpans } from '../js/music/intention.js';
import { deriveComposition } from '../js/music/composition.js';
import { seedRng, rnd, pick } from '../js/utils/rng.js';
import { tokenize } from '../js/utils/text.js';

const CHORD_DEGREES = [0, 2, 4, 6];
const SEMANTIC_WEIGHT_THRESHOLD = 0.5;
const BEAT_SEC = 1.15;   // exact value from ambient.js
const BAR_MS = BEAT_SEC * 4 * 1000; // 4 beats per bar

function pickNextDegree(prevDegree) {
  if (prevDegree === null) return pick(CHORD_DEGREES);
  const weights = CHORD_DEGREES.map(d => {
    if (d === prevDegree) return 0;
    const dist = Math.abs(d - prevDegree);
    return 1 / (dist + 0.5);
  });
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rnd(0, total);
  for (let i = 0; i < CHORD_DEGREES.length; i++) {
    r -= weights[i];
    if (r <= 0) return CHORD_DEGREES[i];
  }
  return CHORD_DEGREES[CHORD_DEGREES.length - 1];
}

/**
 * Runs the full headless simulation for one text and returns the
 * complete note sequence plus the session's harmony/tension info.
 */
export function simulateText(text) {
  const harmonyInfo = deriveTextHarmony(text);
  const sessionTenseScore = harmonyInfo.tenseScore;
  const sessionNormScore = harmonyInfo.normScore;
  seedRng(hashText(text));
  const pieceMotif = generateMotif(hashText(text), sessionTenseScore);
  const pieceIntentions = deriveIntentions(text);
  const pieceSemanticSpans = deriveSemanticSpans(text); // see js/player.js's third phrase-awareness fix
  const pieceComposition = deriveComposition(text);

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

  // real elapsed-time chord clock (see module docstring)
  let elapsedMs = 0;
  let barIndex = -1; // -1 so the very first bar crossing (index 0) triggers an initial pick
  let chordDeg = null;
  const clampedTense = Math.max(-0.5, Math.min(1.0, sessionTenseScore));
  const pacingFactor = 1 - clampedTense * 0.15;

  function advanceClockTo(newElapsedMs) {
    const newBarIndex = Math.floor(newElapsedMs / BAR_MS);
    while (barIndex < newBarIndex) {
      barIndex++;
      chordDeg = pickNextDegree(chordDeg);
    }
    elapsedMs = newElapsedMs;
  }
  advanceClockTo(0); // bar 0's chord is picked before the first word, exactly as ambient.js's tick() does at t=0

  const sequence = [];

  for (let i = 0; i < playable.length; i++) {
    const tok = playable[i];

    if (tok.type === 'punct') {
      const pause = (tok.text === '.') ? 420
                  : (tok.text === '?' || tok.text === '؟') ? 380
                  : (tok.text === '!') ? 340
                  : (tok.text === ',' || tok.text === '،') ? 200
                  : 150;
      advanceClockTo(elapsedMs + pause);
      continue;
    }

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

    let note;
    const progress = totalWordsInText > 1 ? wordGlobalIndex / (totalWordsInText - 1) : 0;
    const compState = pieceComposition.getStateAt(progress);
    const combinedRegisterBias = Math.max(-1, Math.min(1, intention.contourBias + compState.registerTendency * 0.5));
    const motifAllowed = compState.motifActive;

    let isStrongBeat = null;

    if (isCadence) {
      note = resolveCadence(lastNote, tok.sentenceType, intention.cadenceStrength, combinedRegisterBias);
    } else if (motifAllowed && sentenceUsesMotif && wordIdxInSentence <= pieceMotif.intervals.length) {
      note = motifNote(pieceMotif, sentenceStartDegree, wordIdxInSentence, lastNote);
    } else {
      isStrongBeat = sp.pos % 2 === 1;
      while (semanticSpanCursor < pieceSemanticSpans.length && tok.start >= pieceSemanticSpans[semanticSpanCursor].end) {
        semanticSpanCursor++;
      }
      const spanWeight = pieceSemanticSpans[semanticSpanCursor]
        && tok.start >= pieceSemanticSpans[semanticSpanCursor].start
        && tok.start < pieceSemanticSpans[semanticSpanCursor].end
        ? pieceSemanticSpans[semanticSpanCursor].weight : 0;
      const semanticWeight = Math.max(wordEmotionWeight(tok.text), spanWeight);
      const isSemanticallyStable = semanticWeight >= SEMANTIC_WEIGHT_THRESHOLD;
      const effChordDeg = (isStrongBeat || isSemanticallyStable) ? chordDeg : null;
      const effectiveTense = Math.max(0, Math.min(1, sessionTenseScore + globalTensionBias(progress) + compState.tension * 0.25));
      const isDisruptionNow = intention.isDisruption && isFirstWordOfClause;
      const prevDegreeBeforeThisNote = lastNote ? lastNote.degree : null;
      note = arbitrateMelodyNote(
        lastNote, effChordDeg, effectiveTense, intention.contourBias, isDisruptionNow,
        isStrongBeat, 0, combinedRegisterBias, pendingNeighborTarget?.degree
      );
      pendingNeighborTarget = null;
      if (!isStrongBeat && !isCadence && prevDegreeBeforeThisNote !== null && Math.abs(note.lastInterval || 0) === 1) {
        pendingNeighborTarget = { degree: prevDegreeBeforeThisNote };
      }
    }

    const path = isCadence ? 'cadence'
      : (motifAllowed && sentenceUsesMotif && wordIdxInSentence <= pieceMotif.intervals.length) ? 'motif'
      : 'arbitration';

    sequence.push({
      degree: note.degree, octave: note.octave, freq: note.freq,
      lastInterval: note.lastInterval, isCadence, isStrongBeat,
      sentenceType: tok.sentenceType, wordIdx: wordGlobalIndex,
      cadenceStrength: intention.cadenceStrength, path,
      compRole: compState.role, compTension: compState.tension, compEnergy: compState.energy,
      progress,
      // the LOCAL, per-word effective tension that actually fed into this
      // note's decision (session base + globalTensionBias's arc + a slice
      // of the composition layer's own tension curve) — see note below on
      // why this, not sessionTenseScore, is the right unit for testing
      // the tense->leap design intent.
      effectiveTense: path === 'arbitration'
        ? Math.max(0, Math.min(1, sessionTenseScore + globalTensionBias(progress) + compState.tension * 0.25))
        : null,
    });

    lastNote = note;
    wordIdxInSentence++;
    wordGlobalIndex++;

    // advance the real-time clock by however long this word would have
    // taken to play — same formula as play()'s word branch
    const wlen = (tok.text.match(/[\p{L}\p{N}]/gu) || []).length || 1;
    const base = (380 + wlen * 42) * pacingFactor;
    const spd = isCadence ? base * 1.2 + 40 : base + 20; // rnd(-20,60) replaced by its midpoint (+20/+40) for a reproducible simulation — real playback has ±jitter this doesn't model
    advanceClockTo(elapsedMs + spd);
  }

  return {
    sequence, sessionTenseScore, sessionNormScore, mood: harmonyInfo.mood,
    scaleLength: currentScale.length, sentenceCount: sentenceCycle,
  };
}


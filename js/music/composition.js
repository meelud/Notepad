/**
 * js/music/composition.js
 * ─────────────────────────────────────────────────────────────────
 * Composition Layer — the "composer above the organs."
 *
 * Everything built so far (melody contour, motif, cadence, harmonic
 * awareness, intention) operates at the word/clause level: it decides
 * what happens NOW, informed by what just happened. Nothing decides
 * where the WHOLE PIECE is going. This module is that missing layer:
 * it derives an adaptive section timeline from the text's own
 * structure (sentence count/position — no new NLP, reusing what
 * text.js/mood.js already extract) and exposes a single read function,
 * getStateAt(progress), that any subsystem can query for "what is the
 * piece's musical state at this point in time."
 *
 * Deliberately NOT a note generator: nothing here touches pitch,
 * chords, or voices directly. It only produces a Musical State
 * (energy/tension/density/register/harmonicStability/motifActive/
 * spatialDepth) that callers (currently just player.js) blend into
 * their own existing decisions — additive, optional, toggleable.
 *
 * Fully deterministic: pure function of the input text, no RNG.
 */
import { wordSentimentSign } from './mood.js';

const WORD_RE = /[a-zA-Zا-ی]+/g;
const SENTENCE_SPLIT_RE = /[.!?؟]+/;

// ─── Section role templates ───────────────────────────────────────
// Adaptive by sentence count, not a rigid fixed form — a short text
// gets a short form, a long text gets a fuller one. Each role's
// energy/tension/density/spatialDepth curves are the document's own
// example numbers (0.20→0.30 etc.), used directly as the v1 baseline
// rather than invented values.
const ROLE_CURVES = {
  establish:   { energy: [0.20, 0.35], tension: [0.15, 0.25], density: [0.25, 0.35], spatial: [0.15, 0.25], motif: true  },
  develop:     { energy: [0.35, 0.60], tension: [0.25, 0.55], density: [0.35, 0.55], spatial: [0.25, 0.45], motif: false },
  intro:       { energy: [0.20, 0.30], tension: [0.15, 0.25], density: [0.25, 0.35], spatial: [0.15, 0.20], motif: true  },
  development: { energy: [0.30, 0.60], tension: [0.25, 0.65], density: [0.35, 0.55], spatial: [0.25, 0.50], motif: false },
  sectionA:    { energy: [0.30, 0.50], tension: [0.25, 0.45], density: [0.35, 0.50], spatial: [0.25, 0.40], motif: true  },
  sectionB:    { energy: [0.45, 0.65], tension: [0.40, 0.60], density: [0.45, 0.60], spatial: [0.35, 0.50], motif: false },
  climax:      { energy: [0.75, 1.00], tension: [0.80, 0.95], density: [0.70, 0.90], spatial: [0.70, 1.00], motif: true  },
  release:     { energy: [1.00, 0.35], tension: [0.95, 0.15], density: [0.90, 0.30], spatial: [1.00, 0.60], motif: false },
  resolve:     { energy: [0.55, 0.30], tension: [0.45, 0.15], density: [0.45, 0.30], spatial: [0.40, 0.30], motif: true  },
};

// Adaptive templates keyed by sentence count — chosen by the SMALLEST
// threshold the sentence count meets, per the document's guidance that
// a short text gets "Establish→Develop→Resolve" while a long one can
// reach "Intro→A→Development→B→Climax→Release". Never a fixed 7-part
// template regardless of length.
const TEMPLATES = [
  { minSentences: 1, roles: ['establish'] },
  { minSentences: 2, roles: ['establish', 'resolve'] },
  { minSentences: 3, roles: ['establish', 'develop', 'resolve'] },
  { minSentences: 5, roles: ['intro', 'development', 'climax', 'release'] },
  { minSentences: 8, roles: ['intro', 'sectionA', 'development', 'sectionB', 'climax', 'release'] },
];

function pickTemplate(sentenceCount) {
  let chosen = TEMPLATES[0];
  for (const t of TEMPLATES) { if (sentenceCount >= t.minSentences) chosen = t; }
  return chosen.roles;
}

function smoothstep(t) { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); }
function lerp(a, b, t) { return a + (b - a) * smoothstep(t); }

/**
 * Average signed sentiment magnitude over a run of sentences — used
 * only for harmonicStability (louder emotional content = less stable
 * harmonic footing), a lightweight reuse of the same lexicon signal
 * intention.js already uses at clause level, applied here at
 * section/sentence granularity.
 */
function sectionSentimentMagnitude(sentences) {
  let sum = 0, count = 0;
  sentences.forEach(s => {
    const words = s.match(WORD_RE) || [];
    words.forEach(w => { sum += Math.abs(wordSentimentSign(w)); count++; });
  });
  return count > 0 ? sum / count : 0;
}

/**
 * Derives the section timeline for a text.
 * @param {string} text
 * @returns {{
 *   sections: Array<{role:string, startProgress:number, endProgress:number,
 *     curves:Object, registerTendency:number, harmonicStability:number}>,
 *   getStateAt: (progress:number) => {
 *     role:string, energy:number, tension:number, density:number,
 *     spatialDepth:number, registerTendency:number,
 *     harmonicStability:number, motifActive:boolean, sectionProgress:number
 *   }
 * }}
 */
export function deriveComposition(text) {
  const rawSentences = text.split(SENTENCE_SPLIT_RE).map(s => s.trim()).filter(Boolean);
  if (rawSentences.length === 0) {
    // degenerate/empty text — a single flat neutral section so
    // getStateAt never has to special-case "no sections"
    const flat = { role: 'establish', startProgress: 0, endProgress: 1, curves: ROLE_CURVES.establish, registerTendency: 0, harmonicStability: 0.5 };
    return { sections: [flat], getStateAt: () => stateFromSection(flat, 0) };
  }

  const wordCounts = rawSentences.map(s => (s.match(WORD_RE) || []).length || 1);
  const totalWords = wordCounts.reduce((a, b) => a + b, 0);

  const roles = pickTemplate(rawSentences.length);
  const numSections = roles.length;

  // bucket sentences into sections proportionally by index — every
  // section gets at least one sentence since numSections never
  // exceeds the sentence count (guaranteed by TEMPLATES' thresholds)
  const sectionSentenceIdx = roles.map(() => []);
  rawSentences.forEach((_, i) => {
    const bucket = Math.min(numSections - 1, Math.floor((i * numSections) / rawSentences.length));
    sectionSentenceIdx[bucket].push(i);
  });

  let cumWords = 0;
  const sections = roles.map((role, idx) => {
    const sentenceIdxs = sectionSentenceIdx[idx];
    const sectionWordCount = sentenceIdxs.reduce((sum, i) => sum + wordCounts[i], 0);
    const startProgress = totalWords > 0 ? cumWords / totalWords : 0;
    cumWords += sectionWordCount;
    const endProgress = totalWords > 0 ? cumWords / totalWords : 1;

    // Contrast (point 5): alternate register tendency by section index
    // so consecutive sections don't repeat the same registral/textural
    // lean — a documented v1 simplification (true adjacent-property
    // contrast across ALL axes is a richer future refinement).
    const registerTendency = idx % 2 === 0 ? 0.4 : -0.4;

    const sentimentMag = sectionSentimentMagnitude(sentenceIdxs.map(i => rawSentences[i]));
    const harmonicStability = Math.max(0, 1 - Math.min(1, sentimentMag / 1.5));

    return {
      role,
      startProgress,
      endProgress: idx === numSections - 1 ? 1 : endProgress, // guard float drift on the last section
      curves: ROLE_CURVES[role],
      registerTendency,
      harmonicStability,
    };
  });

  function findSection(progress) {
    const p = Math.max(0, Math.min(1, progress));
    for (let i = 0; i < sections.length; i++) {
      if (p <= sections[i].endProgress || i === sections.length - 1) return sections[i];
    }
    return sections[sections.length - 1];
  }

  function stateFromSection(section, progress) {
    const span = section.endProgress - section.startProgress;
    const t = span > 0 ? (progress - section.startProgress) / span : 0;
    const c = section.curves;
    return {
      role: section.role,
      energy: lerp(c.energy[0], c.energy[1], t),
      tension: lerp(c.tension[0], c.tension[1], t),
      density: lerp(c.density[0], c.density[1], t),
      spatialDepth: lerp(c.spatial[0], c.spatial[1], t),
      registerTendency: section.registerTendency,
      harmonicStability: section.harmonicStability,
      motifActive: c.motif,
      sectionProgress: Math.max(0, Math.min(1, t)),
    };
  }

  return {
    sections,
    getStateAt: (progress) => stateFromSection(findSection(progress), progress),
  };
}

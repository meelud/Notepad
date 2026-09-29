import { scanPhraseMatches } from './mood.js';

const WORD_RE = /[a-zA-Zا-ی]+/g;
const SENTENCE_SPLIT_RE = /[.!?؟]+/;

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
 * harmonic footing).
 *
 * FIXED (phrase-awareness): this used to sum wordSentimentSign(w) over
 * single words, missing the ~61% of the lexicon that's multi-word
 * phrases — measurably, 36% of sections in the project's eval corpus
 * got harmonicStability pinned at its maximum (1.0, "zero sentiment
 * detected") even for sections of clearly emotional text. Now scans
 * for real phrase matches the same way detectMood/intention.js do.
 * The denominator stays `words.length` (not match count) so magnitude
 * stays normalized per word of text, not per match.
 */
function sectionSentimentMagnitude(sentences) {
  let sum = 0, count = 0;
  sentences.forEach(s => {
    const words = s.match(WORD_RE) || [];
    scanPhraseMatches(words).forEach(({ weight }) => { sum += Math.abs(weight); });
    count += words.length;
  });
  return count > 0 ? sum / count : 0;
}

export function deriveComposition(text) {
  const rawSentences = text.split(SENTENCE_SPLIT_RE).map(s => s.trim()).filter(Boolean);
  if (rawSentences.length === 0) {
    const flat = { role: 'establish', startProgress: 0, endProgress: 1, curves: ROLE_CURVES.establish, registerTendency: 0, harmonicStability: 0.5 };
    return { sections: [flat], getStateAt: () => stateFromSection(flat, 0) };
  }

  const wordCounts = rawSentences.map(s => (s.match(WORD_RE) || []).length || 1);
  const totalWords = wordCounts.reduce((a, b) => a + b, 0);

  const roles = pickTemplate(rawSentences.length);
  const numSections = roles.length;

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

    const registerTendency = idx % 2 === 0 ? 0.4 : -0.4;

    const sentimentMag = sectionSentimentMagnitude(sentenceIdxs.map(i => rawSentences[i]));
    const harmonicStability = Math.max(0, 1 - Math.min(1, sentimentMag / 1.5));

    return {
      role,
      startProgress,
      endProgress: idx === numSections - 1 ? 1 : endProgress,
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

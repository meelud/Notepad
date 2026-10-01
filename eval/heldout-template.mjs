// ─── Held-out set ────────────────────────────────────────────────
// Same shape as eval/gold.mjs: [text, valence -1..+1, arousal -1..+1, lang]
// congruence-eval reads GOLD / default / DATASET, so name it GOLD.
//
// WRITE THIS WITHOUT LOOKING AT ANY SCORE. The point of a held-out set is
// that it is written before measurement. If you tune on it and then score on
// it, it is the tuning set again under a new name — which is what 64 texts of
// gold.mjs already are.
export const GOLD = [
  // ---- high valence, high arousal ----
  ['I got the job!', 1, 1, 'en'],
  // ---- high valence, low arousal ----
  ['A quiet afternoon by the window.', 1, -1, 'en'],
  // ---- low valence, high arousal ----
  ['I am furious about this!', -1, 1, 'en'],
  // ---- low valence, low arousal ----
  ['I feel empty and so tired.', -1, -1, 'en'],
  // ---- neutral ----
  ['The train leaves every twenty minutes.', 0, 0, 'en'],
  // ---- Persian, same five ----
  ['قبول شدم!', 1, 1, 'fa'],
];

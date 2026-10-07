/**
 * js/music/punct-pitches.js
 * ─────────────────────────────────────────────────────────────────
 * Which pitches the punctuation sounds play, derived from the piece's own scale.
 *
 * Before this module, audio/punctuation.js used fixed frequencies — '!' a C-major
 * triad (523.25 / 659.25 / 784), '?' a glide D4 → A4 (293.66 → 440), newline D2
 * (73.42) — whatever key the text had landed in. In a piece in F♯ minor, or in a
 * mode with a flattened 2nd, those are simply out of the key. (The count is in the
 * commit message and is asserted by test/punct-pitches-test.mjs.)
 *
 * The same discipline already applies to the melody (harmony.js: every multiplier
 * is a power of two so the melody cannot leave its scale) and to the pad (parent-
 * scale chord tones). This extends it to the third voice of the texture.
 *
 * Each gesture keeps the register and the shape it had:
 *   '!'   rising triad on the tonic, stacked in thirds from the scale
 *         (scale degrees 1-3-5 by index — the diatonic triad, or the sus / dim /
 *         augmented analogue the mode itself provides), root in [350, 700) Hz
 *         (the old C5 = 523 Hz sat in the middle of that window)
 *   '?'   a glide from the tonic (in [262, 524) Hz; old D4 = 293.66) UP to the
 *         scale tone nearest a perfect fifth above it — exactly the old D → A
 *         when the scale has a fifth, the closest available interval when it does
 *         not (locrian, whole-tone, …). The ear hears a question that opens to the
 *         dominant instead of resolving.
 *   '\n'  the tonic in [65.4, 130.8) Hz (old D2 = 73.42)
 *
 * Pure: no WebAudio, no randomness, no state — the scale is passed in.
 */

/** Folds f by octaves into [lo, 2·lo). */
export function foldInto(f, lo) {
  while (f >= 2 * lo) f /= 2;
  while (f < lo) f *= 2;
  return f;
}

const FIFTH = Math.pow(2, 7 / 12);

/**
 * @param {number[]} scale  currentScale (Hz, ascending degrees, tonic first)
 * @returns {{ bang: number[], question: {from: number, to: number}, newline: number }}
 */
export function punctuationPitches(scale) {
  const tonic = scale[0];

  // '!': scale degrees by index 0, 2, 4 (clamped for very short scales), stacked upward
  const root = foldInto(tonic, 350);
  const above = i => {
    let f = foldInto(scale[Math.min(i, scale.length - 1)], root);   // in [root, 2·root)
    if (f <= root * 1.0001) f *= 2;                                 // never double the root
    return f;
  };
  const bang = [root, above(2), above(4)].sort((a, b) => a - b);

  // '?': glide from the tonic up to the scale tone nearest a perfect fifth
  const from = foldInto(tonic, 262);
  let to = null, best = Infinity;
  for (let i = 1; i < scale.length; i++) {
    const f = foldInto(scale[i], from);
    const err = Math.abs(Math.log2(f / from) - Math.log2(FIFTH));
    if (err < best - 1e-9 || (Math.abs(err - best) <= 1e-9 && f > to)) { best = err; to = f; }
  }
  if (to === null || to <= from * 1.0001) to = from * 2;            // degenerate one-note scale

  return { bang, question: { from, to }, newline: foldInto(tonic, 65.4) };
}

/**
 * js/audio/voice-trim.js
 * ─────────────────────────────────────────────────────────────────
 * Per-voice LEVEL trim, in dB. Level only — no voice's tone, envelope or
 * pitch is touched; voices.js multiplies the `vol` it is given by this
 * before running the voice, so the dry signal AND the reverb send move
 * together (the voices feed both from the same gain nodes, which is why
 * the trim cannot live on the destination side).
 *
 * Why it exists: the 22 voices were written one at a time, each with its
 * own gain constants, and nothing ever balanced them against each other.
 * Measured on the real voices.js, rendered offline (A-weighted, max 400 ms
 * window, vol 0.4, dur 0.8 s, mean over 130/196/294/440/660 Hz): the spread
 * was 18.7 dB across the 21 audible voices (Bowed cello and Choir pad near
 * the bottom, Soft pad and Piano near the top), against a ±1.3 dB dynamics
 * arc. Because the voice changes every few words, that spread — not the
 * arousal curve — was the loudest thing in a phrase.
 *
 * Method: trim = clamp(median − measured, −6, +6) dB, rounded to 0.5 dB.
 * The ±6 dB clamp is a headroom limit, not a target: a voice that would
 * need more than +6 dB stays somewhat quieter than the rest rather than
 * risk clipping against the pads. Residual spread after trimming: 6.7 dB.
 *
 * Voice 14 (Sub thump) is left at 0 on purpose: it is quiet because its
 * fundamental sits at 0.18–0.25 × the note (often below 60 Hz), which is an
 * audibility problem, not a level one, and boosting a sub-bass sine by 6 dB
 * only asks small speakers to do something they cannot. voice-plan.js keeps
 * it away from notes where it would be inaudible instead.
 *
 * Re-measure (and regenerate this table) whenever a voice is changed.
 */
export const VOICE_TRIM_DB = [
  -6,   //  0 Soft pad
  -0.5, //  1 Plucked string
   5,   //  2 Breath
  -0.5, //  3 Bell / metallic
  -6,   //  4 Ghost chord
  -5.5, //  5 Piano
  -2.5, //  6 Warm synth pad
   6,   //  7 Plucked string ensemble
   3,   //  8 Marimba
  -1.5, //  9 Glass / FM bell
   0.5, // 10 Vibraphone
  -0.5, // 11 Music box
   6,   // 12 Choir pad
  -2.5, // 13 Soft organ
   0,   // 14 Sub thump (see above)
   1.5, // 15 Reed / woodwind
   6,   // 16 Bowed cello
   3.5, // 17 Kalimba
  -1.5, // 18 Synth brass swell
  -2.5, // 19 Detuned celeste
   6,   // 20 Granular texture
   1.5, // 21 Deep gong swell
];

/** Linear gain for voice `i`; 1 for an unknown index. */
export function trimGain(i) {
  const db = VOICE_TRIM_DB[i];
  return typeof db === 'number' ? Math.pow(10, db / 20) : 1;
}

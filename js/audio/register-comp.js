/**
 * js/audio/register-comp.js
 * ─────────────────────────────────────────────────────────────────
 * Register-aware level for the melody voices (level only: no timbre, envelope
 * or pitch is touched — it multiplies the `vol` player.js hands to VOICES[i],
 * exactly where voice-trim.js already multiplies it, so dry and reverb send
 * move together).
 *
 * Why: voice-trim.js equalises the 21 voices against each other at 130-660 Hz.
 * It cannot equalise a note against the same voice an octave or three lower.
 * The ear needs ~19 dB more level at 100 Hz than at 1 kHz for the same loudness
 * (A-weighting / ISO 226), and the melody's register moves with the key the
 * text lands in (corpus: C2 ... E6). Measured on the 8-text corpus the melody
 * sits anywhere from 8 dB under to 3.6 dB over the bed (A-weighted) for the same
 * trims, so no constant offset can place it.
 *
 * Model: boost = amount × (−A-weighting at the note's fundamental), clamped to
 * [−MIN_DB, +MAX_DB]. A-weighting is the 40-phon equal-loudness contour; at
 * normal listening levels the low-frequency penalty is smaller, so `amount`
 * < 1 is the honest setting — it is chosen from the corpus
 * (tools/stem-report.mjs --comp), not assumed. The cap exists because a +20 dB
 * boost on a 65 Hz sine asks small speakers for something they cannot do.
 *
 * FOREGROUND_DB then lifts every melody note above the bed (a pure level
 * offset: with the register term the spread of the gap is already small, so
 * the offset places it).
 *
 * Both default to 0 here (= bit-identical to before). tools/render-offline.mjs
 * overrides them with --comp / --fg-db to compare settings on the corpus.
 */

export const REGISTER_COMP_AMOUNT = 0;     // 0 = off, 1 = full A-weighting compensation
export const FOREGROUND_DB = 0;
export const REGISTER_COMP_MAX_DB = 12;    // boost cap
export const REGISTER_COMP_MIN_DB = 2;     // how far above 1 kHz may be trimmed (A is +1.3 dB at 2-4 kHz)

/** IEC 61672 A-weighting in dB, analytic form (0 dB at 1 kHz). Pure. */
export function aWeightDb(f) {
  const f2 = f * f;
  const ra = (12194 ** 2 * f2 * f2) /
    ((f2 + 20.6 ** 2) * Math.sqrt((f2 + 107.7 ** 2) * (f2 + 737.9 ** 2)) * (f2 + 12194 ** 2));
  return 20 * Math.log10(ra) + 2.0;
}

/** Level change in dB for a note whose fundamental is `freq`. Pure. */
export function registerCompDb(freq, amount = REGISTER_COMP_AMOUNT) {
  if (!(amount > 0) || !(freq > 0)) return 0;
  const f = Math.min(Math.max(freq, 40), 4000);
  const boost = -amount * aWeightDb(f);
  return Math.max(-REGISTER_COMP_MIN_DB, Math.min(REGISTER_COMP_MAX_DB, boost));
}

/** Linear gain for the melody voice at `freq`: register term + foreground offset. */
export function voiceLevelGain(freq) {
  const o = globalThis.__NOTEPAD_MIX__ || {};
  const amount = typeof o.comp === 'number' ? o.comp : REGISTER_COMP_AMOUNT;
  const fg = typeof o.fgDb === 'number' ? o.fgDb : FOREGROUND_DB;
  return Math.pow(10, (registerCompDb(freq, amount) + fg) / 20);
}

/**
 * Whole-piece octave lift of the melody's SOUNDING pitch (experiment, default 0).
 * A constant factor, so the contour and every interval are preserved; melodic
 * decisions (degrees, cadences, voice choice) are made on the unlifted pitch, so
 * parity and determinism are untouched. If it is adopted for good, the right home
 * is the octave sets in music/harmony.js, not this call-site factor.
 */
export function liftFactor() {
  const o = globalThis.__NOTEPAD_MIX__ || {};
  const k = typeof o.liftOct === 'number' ? o.liftOct : 0;
  return Math.pow(2, k);
}

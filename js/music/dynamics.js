/**
 * music/dynamics.js
 * ─────────────────────────────────────────────────────────────────
 * How loud a passage is, and how far each note is held, as a function
 * of the text's AROUSAL (detectMood().arousalScore, Russell's second
 * circumplex axis).
 *
 * WHY A SEPARATE AXIS. Loudness and articulation are two of the
 * strongest non-pitch carriers of activation in music (Juslin &
 * Laukka 2003, and Juslin 2003 on acoustic features). Until now the
 * app used them for nothing: word volume was rrnd(0.18, 0.52) and note
 * length rrnd(0.22, 0.45), both flat and independent of emotion. Two
 * audible arousal cues therefore carried zero signal — a furious
 * passage and a grief-stricken one were mixed at the same level.
 *
 * This module is deliberately PURE: no rng, no DOM, no AudioContext, no
 * stream access. The caller draws a position within the returned range
 * from the RENDER stream, exactly as it already did with a hard-coded
 * rrnd(lo, hi). Keeping the draw outside is what lets these helpers be
 * unit-tested without a browser, and it is why this change cannot shift
 * the melodic stream: see "stream safety" below.
 *
 * THE LAW. Same shape as rhythm.js's pacingFactorFor: a smooth saturating
 * curve rather than a hard clip, so arousal stays strictly monotone over
 * the whole real range (repeated "!" pushes a text past 1.0, and a hard
 * ceiling would flatten exactly the loudest texts) while asymptoting to
 * a bounded multiple of neutral. Negative arousal saturates on a floor
 * for the same reason calm has a floor in tempo: beyond a point, "very
 * quiet" stops being distinguishable and just gets thin.
 */

/** Multiplier applied to the nominal dynamic range. 1.0 at neutral. */
export const DYNAMICS_EXPONENT = 0.62;

/** Ceiling for the positive side: raised volume never exceeds this. */
export const DYNAMICS_CEILING = Math.pow(2, DYNAMICS_EXPONENT);   // 1.54x
/** Floor for the negative side: 1 / 2^0.42, so quiet never inaudible. */
export const DYNAMICS_FLOOR = 0.75;

/**
 * Saturation curve shared by both mappings. tanh on the positive side
 * keeps the response near neutral and never runs away; the negative side
 * is floored at CALM_SATURATION because deep calm and grief should not
 * be told apart by loudness alone (tempo still separates them).
 */
const CALM_SATURATION = -0.42;

/**
 * The ceiling's exponent, used ONLY for arousal < 0. See velocityRange().
 *
 * DERIVATION: a target spread S_dB at saturation requires
 *   E_CALM = DYNAMICS_EXPONENT + (S_dB - 20*log10(hi/lo)) / (20*log10(2) * CALM_SATURATION)
 * With S = 3.5 dB, hi/lo = 52/18 (9.21 dB) and CALM_SATURATION = -0.42 that is
 * 2.88. The nominal 3.5 dB target is inside the 3-4 dB band the brief asks for,
 * and 2.88 falls out of it rather than being picked and then justified.
 */
export const CALM_CEILING_EXPONENT = 2.88;

export function saturateDynamics(arousal) {
  if (arousal >= 0) return Math.tanh(arousal);
  return Math.max(arousal, CALM_SATURATION);
}

/**
 * Overall dynamic multiplier for a passage, 1.0 at neutral arousal.
 * Monotone increasing in arousal, bounded to
 * [DYNAMICS_FLOOR, DYNAMICS_CEILING].
 * @param {number} arousal detectMood().arousalScore
 */
export function dynamicsFor(arousal) {
  return Math.pow(2, DYNAMICS_EXPONENT * saturateDynamics(arousal));
}

/**
 * How much of the window the raised floor closes, as a fraction of that
 * window's own width. Given per window rather than as one constant,
 * because the two windows differ in width (0.34 vs 0.20) and a single
 * factor would lift one median 22% and the other 15%.
 *
 * The window's top is left alone and the BOTTOM is raised instead, which
 * sounds like shrinking the range but is not: a loud passage has fewer
 * very quiet notes, so its median rises while its peak does not. Scaling
 * the whole window instead pushed `hi` past the 0.6 clamp in player.js,
 * where every excited note piled up at the ceiling — flattening exactly
 * the dynamic variety the cue exists to provide. Measured on the 64-text
 * gold set, scaling pinned 12.7% of notes at 0.6; this pins none.
 *
 * Each factor puts that window's median 22% above neutral at saturation
 * (tanh(2.9) ≈ 1): 0.4557 of the 0.18..0.52 width, 0.6640 of the
 * narrower 0.20..0.40 cadence window.
 */
export const FLOOR_RISE = {
  word: 0.4557,
  cadence: 0.6640,
};

/**
 * Nominal velocity range for a word, before the draw.
 * The caller does rrnd(lo, hi) on the RENDER stream; this only shifts
 * the window, so the number of random draws per word is unchanged.
 *
 * Ranges are the app's existing ones:
 *   non-cadence  0.18 .. 0.52
 *   cadence      0.20 .. 0.40
 *
 * Above neutral, `hi` stays put and `lo` rises toward it, so the passage
 * gets more uniformly loud without ever getting louder at the top. Below
 * neutral both bounds scale down, which is the direction with headroom.
 * Neutral reproduces the original pair exactly.
 *
 * @param {number} arousal
 * @param {boolean} isCadence
 * @returns {{lo:number, hi:number}} linear gain bounds
 */
export function velocityRange(arousal, isCadence) {
  const [nomLo, nomHi] = isCadence ? [0.20, 0.40] : [0.18, 0.52];
  if (arousal > 0) {
    const k = isCadence ? FLOOR_RISE.cadence : FLOOR_RISE.word;
    const rise = (nomHi - nomLo) * k * Math.tanh(arousal);
    return { lo: nomLo + rise, hi: nomHi };
  }
  if (arousal < 0) {
    // CALM NARROWS ITS WINDOW. Scaling both bounds by one factor left the
    // window exactly as wide as it started — 0.18..0.52 is 9.21 dB at every
    // arousal, because a ratio does not change when you multiply it. Measured
    // with the real play() on "i feel calm and peaceful" over 60 seeds, the
    // spread between the loudest and quietest word was p10/p50/p90 =
    // 4.2 / 7.3 / 9.7 dB, and the same sentence spelled "peacful" gave
    // 0.37 / 0.41 / 0.47 / 0.46 / 0.24 — a calm sentence that was loud on
    // four of its five words.
    //
    // Calm and tender expression carries LOW loudness variability (Juslin &
    // Laukka 2003), so the fix is that the CEILING falls faster than the
    // floor. Same law, same saturation curve, one steeper exponent on `hi`:
    //
    //   lo' = lo * 2^(0.62 * sat)      unchanged — the floor still descends
    //   hi' = hi * 2^(2.88 * sat)      steeper   — the ceiling falls away
    //
    // 2.88 is derived, not chosen. Spread at saturation is
    //   20*log10(hi'/lo') = 20*log10(hi/lo) + 20*(E_CALM-0.62)*sat*log10(2)
    // and the nominal 9.21 dB has to become the ~3.5 dB target, which at
    // sat = CALM_SATURATION = -0.42 gives E_CALM = 2.88 exactly.
    //
    // Monotone and smooth: both bounds are still single exponentials in the
    // same saturating variable, so nothing can kink, and the ceiling can
    // never cross the floor — checkVelocityRange() in dynamics-test.mjs
    // sweeps the whole real range to prove it.
    const s = saturateDynamics(arousal);
    return {
      lo: nomLo * Math.pow(2, DYNAMICS_EXPONENT * s),
      hi: nomHi * Math.pow(2, CALM_CEILING_EXPONENT * s),
    };
  }
  return { lo: nomLo, hi: nomHi };
}

/**
 * Nominal note-length range, in the same units player.js passes to the
 * voice functions. Longer notes read as sustained, shorter as detached;
 * that is the articulation cue, and it should follow activation the way
 * a player's does.
 *
 *   non-cadence  0.22 .. 0.45
 *   cadence      0.45 .. 0.75
 *
 * Arousal SHORTENS the window, so an excited passage is more detached
 * and a calm one more sustained. The window is never allowed to invert,
 * and the neutral case is exactly the old hard-coded pair.
 *
 * @param {number} arousal
 * @param {boolean} isCadence
 * @returns {{lo:number, hi:number}}
 */
export function lengthRange(arousal, isCadence) {
  const [nomLo, nomHi] = isCadence ? [0.45, 0.75] : [0.22, 0.45];
  // Inverted mapping: excitement detaches. Expressed as a positive
  // scale on the neutral window so the bounds stay ordered.
  const k = 1 / dynamicsFor(arousal);
  return { lo: nomLo * k, hi: nomHi * k };
}

/**
 * STREAM SAFETY. Every random draw this module informs must come from
 * the RENDER stream (rrnd/rpick) — loudness, timbre and articulation
 * are all properties of how a note is rendered, never of which note it
 * is. Drawing any of it from the melodic stream (rnd/pick) would shift
 * the note sequence; drawing from the ambient stream (arnd/apick) would
 * couple the piece to timer jitter. Neither is acceptable, and neither
 * happens here: this module never imports utils/rng.js at all.
 */

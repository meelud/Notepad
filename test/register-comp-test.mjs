// js/audio/register-comp.js: analytic A-weighting matches the IEC table, the
// register term has the right shape and limits, and with both knobs at their
// shipped defaults it is exactly neutral.
import { aWeightDb, registerCompDb, voiceLevelGain, REGISTER_COMP_AMOUNT, FOREGROUND_DB, REGISTER_COMP_MAX_DB, REGISTER_COMP_MIN_DB } from '../js/audio/register-comp.js';
let bad = 0;
const ok = (c, m) => { if (!c) { bad++; console.log(' FAIL ', m); } };
const near = (a, b, tol, m) => ok(Math.abs(a - b) <= tol, `${m}: got ${a}, want ${b} ±${tol}`);

// 1. IEC 61672 table. The standard tabulates the EXACT base-10 third-octave centres
//    (10^(n/10) Hz), not the nominal 31.5 / 63 / 125 ...; the closed form matches
//    the table's 0.1 dB rounding there.
for (const [hz, want] of [[10 ** 1.5, -39.4], [10 ** 1.8, -26.2], [10 ** 2.1, -16.1], [10 ** 2.4, -8.6], [10 ** 2.7, -3.2], [1000, 0], [10 ** 3.3, 1.2], [10 ** 3.6, 1.0], [10 ** 3.9, -1.1]])
  near(aWeightDb(hz), want, 0.1, `A-weighting at ${hz.toFixed(1)} Hz`);

// 2. register term
near(registerCompDb(1000, 1), 0, 0.01, 'no change at 1 kHz');
near(registerCompDb(100, 0), 0, 0, 'amount 0 is off');
near(registerCompDb(200, 1), -aWeightDb(200), 1e-9, 'amount 1 at 200 Hz is the full A-weighting penalty (≈ +10.9 dB)');
near(registerCompDb(200, 0.5), registerCompDb(200, 1) / 2, 1e-9, 'amount scales the boost linearly (below the cap)');
near(registerCompDb(100, 1), REGISTER_COMP_MAX_DB, 0, 'at 100 Hz the full penalty (≈ 19 dB) is capped at the maximum boost');
let prev = Infinity, mono = true;
for (let f = 40; f <= 1000; f *= 1.02) { const d = registerCompDb(f, 0.5); if (d > prev + 1e-9) mono = false; prev = d; }
ok(mono, 'boost never increases with pitch between 40 Hz and 1 kHz');
ok(registerCompDb(50, 1) <= REGISTER_COMP_MAX_DB + 1e-9 && registerCompDb(40, 1) === REGISTER_COMP_MAX_DB, 'boost is capped');
ok(registerCompDb(3000, 1) >= -REGISTER_COMP_MIN_DB - 1e-9, 'trim above 1 kHz is bounded');
ok(registerCompDb(20, 1) === registerCompDb(40, 1) && registerCompDb(20000, 1) === registerCompDb(4000, 1), 'frequency is clamped to 40..4000 Hz before weighting');
ok(registerCompDb(NaN, 1) === 0 && registerCompDb(-5, 1) === 0, 'garbage frequency is neutral');

// 3. shipped defaults: no register boost, a flat +3 dB foreground offset (chosen by listening)
ok(REGISTER_COMP_AMOUNT === 0, 'the register boost is off (it saturates the lowest notes; the register rule in harmony.js replaced it)');
near(FOREGROUND_DB, 3, 0, 'foreground offset is +3 dB');
for (const f of [55, 110, 440, 1760]) near(voiceLevelGain(f), Math.pow(10, 3 / 20), 1e-12, `voiceLevelGain(${f}) is the flat +3 dB at the defaults`);
globalThis.__NOTEPAD_MIX__ = { fgDb: 0 };
for (const f of [55, 440]) near(voiceLevelGain(f), 1, 0, `--fg-db 0 reproduces the old level exactly (${f} Hz)`);
globalThis.__NOTEPAD_MIX__ = undefined;

// 4. overrides (what the offline tool uses)
globalThis.__NOTEPAD_MIX__ = { comp: 1, fgDb: 3 };
near(voiceLevelGain(1000), Math.pow(10, 3 / 20), 1e-3, 'foreground offset applies (analytic A-weighting is 0 dB at 1 kHz to ~1e-4)');
near(voiceLevelGain(100), Math.pow(10, (REGISTER_COMP_MAX_DB + 3) / 20), 1e-9, 'register term (capped at 12 dB) and offset add in dB');
near(voiceLevelGain(250), Math.pow(10, (-aWeightDb(250) + 3) / 20), 1e-9, 'below the cap they add in dB too');
globalThis.__NOTEPAD_MIX__ = undefined;

if (bad) { console.log(`${bad} failure(s)`); process.exit(1); }
console.log('register-comp: A-weighting exact, boost monotone and capped, neutral at the defaults');

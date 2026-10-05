// Voice planning (js/audio/voice-plan.js) and per-voice level trim (js/audio/voice-trim.js).
// Run: node test/voice-plan.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { planVoice, poolCell, groupFor, octClass, audibleAt, ACCENT_VOICES, GROUP_EXTRA, CLEAN_CADENCE } from '../js/audio/voice-plan.js';
import { VOICE_TRIM_DB, trimGain } from '../js/audio/voice-trim.js';

// The tables live in player.js (which needs a DOM to import), so read them from its source.
const src = readFileSync(new URL('../js/player.js', import.meta.url), 'utf8');
const grab = name => { const m = src.match(new RegExp(`const ${name} = (\\[[^\\]]*\\]|\\{[^}]*\\});`)); assert.ok(m, `${name} not found in player.js`); return new Function(`return ${m[1]}`)(); };
const tables = { VOICE_GROUPS: grab('VOICE_GROUPS'), DARK_VOICES: grab('DARK_VOICES'), BRIGHT_VOICES: grab('BRIGHT_VOICES'), PERCUSSIVE_VOICES: grab('PERCUSSIVE_VOICES'), RAMPED_VOICES: grab('RAMPED_VOICES') };
const WARM = grab('WARM_VOICES');
tables.WARM_VOICES = WARM;
const { PERCUSSIVE_VOICES: P, RAMPED_VOICES: R } = tables;

function rngFrom(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const legacyPick = (rngPick) => (group, norm, family, hits) => {
  const pool = hits === 0 ? group.filter(v => WARM.includes(v)) : group;
  let c = pool.filter(v => family.includes(v));
  if (!c.length) c = pool.length ? pool : WARM;
  return rngPick(c);
};

// ── 1. no body pool collapses (the old tables had pools of 1 and 2) ──────────
for (const type of ['statement', 'question', 'exclaim']) {
  for (const [norm, fam, label] of [[-0.8, R, 'dark/ramped'], [0.8, P, 'bright/percussive'], [0, P, 'neutral/percussive'], [0, R, 'neutral/ramped']]) {
    const cell = poolCell(type, norm, fam, 440, tables);
    assert.equal(cell.how, 'mood+family', `${type} ${label}: fell back to '${cell.how}'`);
    assert.ok(cell.list.length >= 3, `${type} ${label}: only ${cell.list.length} voices ${cell.list}`);
  }
}
// the dark exclamation no longer lands on the Synth brass (18), which is not a dark voice
assert.ok(!poolCell('exclaim', -0.8, R, 440, tables).list.includes(18));
// every extra voice is a real voice, and none duplicates a base entry
for (const [t, ex] of Object.entries(GROUP_EXTRA)) for (const v of ex) { assert.ok(v >= 0 && v < 22); assert.ok(!tables.VOICE_GROUPS[t].includes(v), `${t}: ${v} already in base group`); }

// ── 2. a long mixed run keeps every invariant ────────────────────────────────
function run(seed, norm, hits) {
  const r = rngFrom(seed), pick = a => a[Math.floor(r() * a.length)];
  const lp = legacyPick(pick);
  const log = []; let prev = null, wordVoices = [], idx = 0;
  const fam = () => (norm <= -0.15 || hits === 0) ? R : norm >= 0.15 ? P : pick([P, R]);
  for (let s = 0; s < 40; s++) {
    const type = r() < 0.7 ? 'statement' : r() < 0.5 ? 'question' : 'exclaim';
    const len = 3 + Math.floor(r() * 7), family = fam();
    let lastHalf = false;
    for (let w = 0; w < len; w++) {
      const isCadence = w === len - 1, freq = 90 + r() * 800, strength = r() < 0.7 ? 1 : 0.3 * r();
      const half = !isCadence && r() < 0.12;
      const repeat = idx > 6 && r() < 0.08 ? Math.floor(r() * (idx - 1)) : null;
      const phraseStart = prev === null || w === 0 || lastHalf;
      const v = planVoice({ prevVoice: prev, isPhraseStart: phraseStart, isCadence, cadenceStrength: strength, sentenceType: type,
        normScore: norm, lexiconHits: hits, family, freq, roll: r(), repeatVoice: repeat === null ? undefined : wordVoices[repeat] }, tables, pick, lp);
      log.push({ v, prev, phraseStart, isCadence, strength, type, family, freq, repeat, repVoice: repeat === null ? undefined : wordVoices[repeat] });
      wordVoices[idx++] = v; prev = v; lastHalf = half;
    }
  }
  return log;
}
let changes = 0, words = 0, structural = 0, midPhrase = 0;
for (const [norm, hits] of [[-0.8, 3], [0, 3], [0.8, 3], [0, 0]]) {
  for (let seed = 1; seed <= 25; seed++) {
    const log = run(seed * 7919 + norm * 100, norm, hits);
    const again = run(seed * 7919 + norm * 100, norm, hits);
    assert.deepEqual(log.map(x => x.v), again.map(x => x.v), 'same seed, same voices');
    for (const x of log) {
      words++;
      assert.ok(x.v >= 0 && x.v < 22);
      assert.ok(audibleAt(x.v, x.freq), `voice ${x.v} sounded at ${x.freq.toFixed(0)} Hz where it is inaudible`);
      if (hits > 0) assert.ok(groupFor(x.type, tables).includes(x.v), `voice ${x.v} is not in the ${x.type} pool`);
      if (hits === 0) assert.ok(WARM.includes(x.v), `unreadable text got non-warm voice ${x.v}`);
      const warmNow = tables.VOICE_GROUPS[x.type].filter(v => WARM.includes(v));
      const poolNow = (hits > 0 ? groupFor(x.type, tables) : (warmNow.length ? warmNow : WARM)).filter(v => audibleAt(v, x.freq));
      if (x.repVoice !== undefined && poolNow.includes(x.repVoice)) assert.equal(x.v, x.repVoice, 'repeated text must keep its voice');
      if (x.prev === null || x.v === x.prev) continue;
      changes++;
      if (x.phraseStart || x.isCadence || x.repVoice !== undefined || ACCENT_VOICES.includes(x.prev)) structural++; else midPhrase++;
      if (!x.phraseStart && x.repVoice === undefined && !ACCENT_VOICES.includes(x.prev)) {
        if (x.isCadence) {
          assert.ok(x.strength >= CLEAN_CADENCE, 'an unstable cadence must keep the voice');
          assert.ok(R.includes(x.v) && octClass(x.v) === octClass(x.prev) && ![14, 18, 20, 21].includes(x.v), `bad settling voice ${x.v}`);
        } else {
          assert.equal(octClass(x.v), octClass(x.prev), `mid-phrase change ${x.prev}→${x.v} moves the sounding octave`);
          assert.ok(x.family.includes(x.v), 'mid-phrase change left the sentence family');
        }
      }
    }
  }
}
const perWord = changes / words, midPerWord = midPhrase / words, structuralShare = structural / changes;
// The old rule changed voice ~0.3 times per word, at random positions. The changes that remain should
// mostly be structural (phrase start, cadence, repeat, accent voice), with only a trickle mid-phrase.
assert.ok(midPerWord <= 0.06, `mid-phrase changes per word ${midPerWord.toFixed(3)}`);
assert.ok(structuralShare >= 0.7, `only ${(structuralShare * 100).toFixed(0)}% of voice changes are structural`);

// ── 3. the level trim ────────────────────────────────────────────────────────
assert.equal(VOICE_TRIM_DB.length, 22);
VOICE_TRIM_DB.forEach((db, i) => assert.ok(db >= -6 && db <= 6, `trim ${i} = ${db} dB is outside the ±6 dB headroom clamp`));
assert.equal(VOICE_TRIM_DB[14], 0); assert.equal(trimGain(14), 1);
assert.ok(Math.abs(trimGain(2) - Math.pow(10, 5 / 20)) < 1e-12);
assert.equal(trimGain(99), 1);

console.log(`voice-plan: ok  (${words} words; ${perWord.toFixed(2)} changes/word, ${(structuralShare * 100).toFixed(0)}% at phrase start/cadence/repeat, ${midPerWord.toFixed(3)} mid-phrase/word)`);

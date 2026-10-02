// Measures the loudness SPREAD of a rendered piece with the real play() —
// the gain actually handed to each voice, not a window computed from the
// formula. This is the measurement that motivated narrowing the calm window:
// the old window was 9.21 dB wide at every arousal, and the audible result
// was a calm sentence that was loud on four of its five words.
//
//   node eval/measure-calm-spread.mjs           current HEAD
//   node eval/measure-calm-spread.mjs <ref>    a commit, for before/after
//
// Spread is reported as p10/p50/p90 of the per-piece loudest-vs-quietest
// difference in dB, over 60 seeds per sentence.

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const ref = process.argv[2];

// A worktree is only needed when measuring another commit; measuring HEAD is
// done in place so the real player.js is the one under test.
let dir = root;
if (ref) {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spread-'));
  execSync(`git worktree add -f --detach ${JSON.stringify(dir)} ${ref}`, { cwd: root, stdio: 'ignore' });
}

const { installFakeClock } = await import(path.join(dir, 'test/harness/fake-clock.mjs'));
const { installStubs } = await import(path.join(dir, 'test/harness/stubs.mjs'));
const { detectMood } = await import(path.join(dir, 'js/music/mood.js'));

const SEEDS = 60;
const SENTENCES = [
  ['calm', 'i feel calm and peaceful'],
  ['neutral', 'the meeting is at three o clock'],
  ['excited', 'I am so happy and excited today'],
];

const dB = g => 20 * Math.log10(g);
const pct = (a, q) => {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * s.length)))];
};

console.log(`\ncalm loudness spread — ${ref || 'HEAD'}\n`);
console.log('  sentence        arousal   gain p10/p50/p90      spread dB p10/p50/p90');
console.log('  --------------  --------  --------------------  ----------------------');

const summary = {};
for (const [label, text] of SENTENCES) {
  const gains = [];
  const spreads = [];
  for (let seed = 0; seed < SEEDS; seed++) {
    const clock = installFakeClock({ jitterSeed: seed + 1, jitterMax: 0 });
    installStubs(text);
    const voices = await import(path.join(dir, 'js/audio/voices.js'));
    if (!globalThis.__gainHooked) {
      globalThis.__gainHooked = true;
      globalThis.__gains = [];
      voices.VOICES.forEach((v, i) => {
        voices.VOICES[i] = (f, vol, d, dests) => { globalThis.__gains.push(vol); return v(f, vol, d, dests); };
      });
    }
    globalThis.__gains = [];
    const player = await import(path.join(dir, 'js/player.js'));
    player.resetHarmony();
    const quiet = console.error; console.error = () => {};
    try { await clock.run(player.play()); } finally { console.error = quiet; }

    const g = globalThis.__gains.filter(x => x > 0);
    if (!g.length) continue;
    gains.push(...g);
    spreads.push(dB(Math.max(...g) / Math.min(...g)));
  }
  const arousal = detectMood(text).arousalScore;
  const fmt = a => [0.1, 0.5, 0.9].map(q => pct(a, q).toFixed(3)).join(' / ');
  const fmtS = a => [0.1, 0.5, 0.9].map(q => pct(a, q).toFixed(1)).join(' / ');
  console.log(`  ${label.padEnd(14)}  ${arousal.toFixed(3).padStart(6)}    ${fmt(gains).padEnd(20)}  ${fmtS(spreads).padEnd(12)}`);
  summary[label] = { arousal, gains, spreads };
}

console.log('\n  calm median gain: ' + pct(summary.calm.gains, 0.5).toFixed(4));
console.log(`  (p10/p50/p90 of the SPREAD are the loudest-minus-quietest difference within`);
console.log(`   each of ${SEEDS} seeds, so they are a property of the piece, not of the seed.)`);

if (ref) {
  execSync(`git worktree remove --force ${JSON.stringify(dir)}`, { cwd: root, stdio: 'ignore' });
}
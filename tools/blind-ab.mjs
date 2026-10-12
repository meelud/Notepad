#!/usr/bin/env node
// ─── Blind, level-matched listening files ─────────────────────────────────────
// Renders one text under several melody settings, matches their loudness (LUFS) so
// "louder" cannot pass for "better", and gives the files neutral names in a random
// order. Which letter is which is written to key.txt — do not open it until you have
// ranked the files.
//
//   node tools/blind-ab.mjs --text 'I miss you so much. ...' --out ~/Desktop/blind-sad
//   node tools/blind-ab.mjs --text '...' --out ~/Desktop/blind-joy --variants now,gentle,strong
//
// Variants (melody-motion knobs, music/harmony.js):
//   now     as shipped (0 / 0 / 1)          gentle  voice=2,leapUp=0.5,inertia=0.9
//   strong  voice=2,leapUp=1,inertia=1
//   blendA  voice=2,leapUp=0.75,inertia=0.95     (between gentle and strong)
//   blendB  voice=2,leapUp=0.6,inertia=1         (strong's lines, gentler leap direction)
//   blendC  voice=1.6,leapUp=0.75,inertia=1      (strong's lines, more chord-tone pull)
// A blend is a THIRD melody, not a mixture of two: the knobs change probabilities, so the note path
// diverges from the first changed choice on. What a blend can do is sit between the two characters.
//
// Needs:  npm install --no-save node-web-audio-api
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readWav } from './measure-wav.mjs';
import { loudness } from '../js/audio/mix-metrics.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const text = opt('text'), out = opt('out');
if (!text || !out) { console.error("usage: node tools/blind-ab.mjs --text '...' --out <dir> [--variants now,gentle,strong]"); process.exit(2); }
const SETS = { now: '', gentle: 'voice=2,leapUp=0.5,inertia=0.9', strong: 'voice=2,leapUp=1,inertia=1',
  blendA: 'voice=2,leapUp=0.75,inertia=0.95', blendB: 'voice=2,leapUp=0.6,inertia=1', blendC: 'voice=1.6,leapUp=0.75,inertia=1' };
const names = opt('variants', 'now,gentle,strong').split(',');
for (const n of names) if (!(n in SETS)) { console.error(`unknown variant "${n}" (known: ${Object.keys(SETS).join(', ')})`); process.exit(2); }

fs.mkdirSync(out, { recursive: true });
const tmp = names.map(n => path.join(out, `.tmp-${n}.wav`));
names.forEach((n, i) => {
  const args = [path.join(here, 'render-offline.mjs'), '--text', text, '--wav', tmp[i], ...(SETS[n] ? ['--melody-set', SETS[n]] : [])];
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 1 << 26 });
  if (r.status !== 0) { console.error(r.stderr || r.stdout); process.exit(1); }
});

// level match: attenuate every file to the quietest integrated loudness (never boost, so no clipping)
const wavs = tmp.map(f => readWav(fs.readFileSync(f)));
const lufs = wavs.map(w => loudness(w.chs, w.sr).lufsI), floor = Math.min(...lufs);
const write = (file, chs, sr, gain) => {
  const n = chs[0].length, data = Buffer.alloc(n * 4);
  for (let i = 0; i < n; i++) for (let c = 0; c < 2; c++) data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(chs[c][i] * gain * 32767))), i * 4 + c * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(2, 22);
  h.writeUInt32LE(sr, 24); h.writeUInt32LE(sr * 4, 28); h.writeUInt16LE(4, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([h, data]));
};

// random assignment of neutral letters
const order = names.map((_, i) => i);
for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
const letters = 'ABCDEFGH';
const key = [];
order.forEach((idx, pos) => {
  const gain = Math.pow(10, (floor - lufs[idx]) / 20);
  write(path.join(out, `${letters[pos]}.wav`), wavs[idx].chs, wavs[idx].sr, gain);
  key.push(`${letters[pos]} = ${names[idx]}   (loudness ${lufs[idx].toFixed(1)} LUFS-I, attenuated by ${(lufs[idx] - floor).toFixed(1)} dB to ${floor.toFixed(1)})`);
});
tmp.forEach(f => fs.unlinkSync(f));
fs.writeFileSync(path.join(out, 'key.txt'), 'DO NOT OPEN until you have ranked the files.\n\n' + key.join('\n') + '\n');
console.log(`wrote ${names.length} blind, level-matched files to ${out}: ${order.map((_, p) => letters[p] + '.wav').join(' ')}\nrank them, then reveal with:  cat ${path.join(out, 'key.txt')}`);

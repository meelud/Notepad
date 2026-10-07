#!/usr/bin/env node
// ─── Measure any WAV file with the same metrics as the offline renderer ───────
// Purpose: cross-check the offline render against what a REAL browser produced.
// Export a piece from the app (Save / MP3), convert it to WAV, measure it, and
// compare with `node tools/render-offline.mjs --text "<the same text>"`.
//
//   afconvert -f WAVE -d LEI16 piece.mp3 piece.wav     # macOS, built in
//   node tools/measure-wav.mjs piece.wav
//
// Reads 16/24-bit PCM and 32-bit float WAV, mono or stereo. No dependencies.
import fs from 'node:fs';
import { analyzeMix, formatMetrics } from '../js/audio/mix-metrics.js';

export function readWav(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error('not a RIFF/WAVE file');
  let fmt = null, data = null;
  for (let p = 12; p + 8 <= buf.length;) {
    const id = buf.toString('ascii', p, p + 4), size = buf.readUInt32LE(p + 4), body = p + 8;
    if (id === 'fmt ') fmt = { tag: buf.readUInt16LE(body), ch: buf.readUInt16LE(body + 2), sr: buf.readUInt32LE(body + 4), bits: buf.readUInt16LE(body + 14) };
    if (id === 'data') data = buf.subarray(body, Math.min(buf.length, body + size));
    p = body + size + (size & 1);
  }
  if (!fmt || !data) throw new Error('missing fmt or data chunk');
  const tag = fmt.tag === 0xFFFE ? (fmt.bits === 32 ? 3 : 1) : fmt.tag;      // WAVE_FORMAT_EXTENSIBLE
  const bytes = fmt.bits / 8, n = Math.floor(data.length / (bytes * fmt.ch));
  if (!((tag === 1 && (fmt.bits === 16 || fmt.bits === 24)) || (tag === 3 && fmt.bits === 32))) throw new Error(`unsupported WAV: tag ${fmt.tag}, ${fmt.bits}-bit`);
  const chs = Array.from({ length: fmt.ch }, () => new Float32Array(n));
  for (let i = 0; i < n; i++) for (let c = 0; c < fmt.ch; c++) {
    const o = (i * fmt.ch + c) * bytes;
    chs[c][i] = tag === 3 ? data.readFloatLE(o) : fmt.bits === 16 ? data.readInt16LE(o) / 32768 : data.readIntLE(o, 3) / 8388608;
  }
  return { chs, sr: fmt.sr };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const file = process.argv[2];
  if (!file) { console.error('usage: node tools/measure-wav.mjs file.wav'); process.exit(2); }
  const { chs, sr } = readWav(fs.readFileSync(file));
  console.log(`${file}  |  ${chs.length} ch @ ${sr} Hz`);
  console.log(formatMetrics(analyzeMix(chs.length === 1 ? [chs[0], chs[0]] : chs.slice(0, 2), sr)));
}

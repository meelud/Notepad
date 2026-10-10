#!/usr/bin/env node
// ─── Reference melody statistics from the Essen Folksong Collection ───────────
// Turns a directory of Essen .abc files into ONE small JSON of aggregate statistics
// (tools/reference/essen-melody-stats.json), computed with js/music/melody-metrics.js — the
// same module the generator report uses, so the two are comparable by construction.
//
// The tunes themselves are NOT stored in the repo: the collection's legal status is
// "unclear ... permission for non-commercial distribution" (music21's corpus/essenFolksong/
// license.txt). Only aggregate numbers, which are facts about the collection, are kept.
//
// One-time recipe to get the files (any machine with Python):
//     pip download music21 --no-deps -d /tmp/m21 && cd /tmp/m21 && unzip -qo music21-*.whl 'music21/corpus/essenFolksong/*'
//     node tools/essen-stats.mjs /tmp/m21/music21/corpus/essenFolksong
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { melodyStats } from '../js/music/melody-metrics.js';

const LETTER = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const SHARP_ORDER = ['F', 'C', 'G', 'D', 'A', 'E', 'B'], FLAT_ORDER = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];
const MAJOR_SHARPS = { 0: 0, 7: 1, 2: 2, 9: 3, 4: 4, 11: 5, 6: 6, 1: -5, 5: -1, 10: -2, 3: -3, 8: -4 };
const MODE_TO_MAJOR = { '': 0, maj: 0, major: 0, ion: 0, m: 3, min: 3, minor: 3, aeo: 3, mix: 5, dor: 10, phr: 8, lyd: 7, loc: 1 };

/** Key field -> map letter -> semitone adjustment (+1 sharp, -1 flat). */
export function keySignature(k) {
  const m = /^\s*([A-G])([#b]?)\s*([A-Za-z]*)/.exec(k);
  if (!m) return {};
  const pc = (LETTER[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + 12) % 12;
  const mode = (m[3] || '').toLowerCase().slice(0, 3) || '';
  const off = MODE_TO_MAJOR[mode] ?? MODE_TO_MAJOR[(m[3] || '').toLowerCase()] ?? 0;
  const n = MAJOR_SHARPS[(pc + off) % 12];
  const adj = {};
  if (n > 0) SHARP_ORDER.slice(0, n).forEach(l => adj[l] = 1);
  if (n < 0) FLAT_ORDER.slice(0, -n).forEach(l => adj[l] = -1);
  return adj;
}

/** One tune's body -> MIDI pitches (rests, chords, grace notes, ornaments ignored; ties merged). */
export function parseBody(body, keyAdj) {
  const out = []; let barAcc = {}, tieNext = false, i = 0;
  while (i < body.length) {
    const c = body[i];
    if (c === '"') { i = body.indexOf('"', i + 1) + 1 || body.length; continue; }
    if (c === '{') { i = body.indexOf('}', i + 1) + 1 || body.length; continue; }
    if (c === '[' || c === '!' || c === '+') { const close = c === '[' ? ']' : c; const j = body.indexOf(close, i + 1); i = j < 0 ? body.length : j + 1; continue; }
    if (c === '|') { barAcc = {}; i++; continue; }
    if (c === '-') { tieNext = true; i++; continue; }
    if ('^_='.includes(c) || /[A-Ga-g]/.test(c)) {
      let acc = null;
      while (i < body.length && '^_='.includes(body[i])) { acc = (acc ?? 0) + (body[i] === '^' ? 1 : body[i] === '_' ? -1 : 0); if (body[i] === '=') acc = 0; i++; }
      const l = body[i]; if (!/[A-Ga-g]/.test(l || '')) continue;
      i++;
      let oct = l === l.toUpperCase() ? 4 : 5;
      while (body[i] === "'" || body[i] === ',') { oct += body[i] === "'" ? 1 : -1; i++; }
      const L = l.toUpperCase(), key = L + oct;
      if (acc !== null) barAcc[key] = acc;
      const adj = key in barAcc ? barAcc[key] : (keyAdj[L] || 0);
      const midi = 12 * (oct + 1) + LETTER[L] + adj;
      while (i < body.length && /[0-9/<>]/.test(body[i])) i++;
      if (body[i] === '-') { tieNext = true; i++; }
      if (tieNext && out.length && out[out.length - 1] === midi) { tieNext = false; continue; }
      tieNext = false; out.push(midi); continue;
    }
    i++;
  }
  return out;
}

export function parseAbc(text) {
  const tunes = []; let cur = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (/^X:/.test(line)) { if (cur) tunes.push(cur); cur = { key: 'C', body: [] }; continue; }
    if (!cur) continue;
    if (/^K:/.test(line)) { cur.key = line.slice(2); continue; }
    if (/^[A-Za-z]:/.test(line) || !line || line.startsWith('%')) continue;
    cur.body.push(line);
  }
  if (cur) tunes.push(cur);
  return tunes.map(t => parseBody(t.body.join(' '), keySignature(t.key))).filter(m => m.length >= 8);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = process.argv[2];
  if (!dir || !fs.existsSync(dir)) { console.error('usage: node tools/essen-stats.mjs <dir with Essen .abc files>'); process.exit(2); }
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.abc') && !/^test/.test(f));
  const melodies = files.flatMap(f => parseAbc(fs.readFileSync(path.join(dir, f), 'utf8')));
  const stats = melodyStats(melodies);
  const out = { source: 'Essen Folksong Collection (Schaffrath, Dahlig-Turek), via the music21 corpus; aggregate statistics only', files: files.length, ...stats };
  const dest = path.join(path.dirname(fileURLToPath(import.meta.url)), 'reference', 'essen-melody-stats.json');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, JSON.stringify(out, null, 2) + '\n');
  console.log(`${melodies.length} melodies, ${stats.notes} notes, ${stats.intervals} intervals -> ${dest}`);
}

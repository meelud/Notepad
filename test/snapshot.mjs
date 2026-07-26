/**
 * test/snapshot.mjs
 * ─────────────────────────────────────────────────────────────────
 * Zero-dependency regression snapshot runner.
 *
 * Uses only Node built-ins (fs, path, url, assert) — no npm packages,
 * no node_modules, nothing to install. Keeps the project fully
 * self-contained.
 *
 * What it does:
 *   Runs a fixed set of representative inputs (EN, FA, mixed,
 *   negation, punctuation edge cases) through the project's pure
 *   logic modules (mood detection, tokenizer, scale/harmony math)
 *   and compares the output against a stored snapshot file
 *   (test/__snapshots__.json).
 *
 *   - If the snapshot file doesn't exist yet, this run creates it
 *     (first run = baseline).
 *   - If it exists, any output that drifted from the stored value
 *     is reported as a FAIL with a before/after diff.
 *
 * Usage:
 *   node test/snapshot.mjs            # check against stored snapshot
 *   node test/snapshot.mjs --update   # intentionally accept new output
 *                                       and rewrite the snapshot file
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { detectMood } from '../js/music/mood.js';
import { tokenize } from '../js/utils/text.js';
import { buildScale } from '../js/music/scales.js';
import { hashText, deriveTextHarmony } from '../js/music/harmony.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_PATH = join(__dirname, '__snapshots__.json');
const UPDATE = process.argv.includes('--update');

// ─── Representative fixed inputs ─────────────────────────────────
// Kept small and hand-picked to cover the bug classes we've fixed:
// multi-word phrase matching, negation, Persian punctuation, mixed
// EN/FA text, and deterministic hashing/harmony derivation.
const MOOD_CASES = [
  ['en_simple_joy',        "I'm feeling giddy up and over the moon today!"],
  ['en_negation',          "I am not happy about this at all."],
  ['fa_simple_joy',        'دلم میخواد جیغ بزنم از خوشحالی'],
  ['fa_negation',          'من امروز خوشحال نیستم اصلا'],
  ['fa_question_mark',     'چیکار میکنی؟ حالت خوبه؟'],
  ['fa_comma_pause',       'سلام، خوبی، خوشحالم که اومدی'],
  ['unicode_ellipsis',     'خیلی خسته‌ام…'],
  ['ascii_ellipsis',       'خیلی خسته‌ام...'],
  ['mixed_en_fa',          'I am so خوشحال today, واقعا!'],
  ['empty_string',         ''],
];

const TOKENIZE_CASES = [
  ['fa_punct_mix',   'چیکار میکنی؟ حالت خوبه، مرسی!'],
  ['en_basic',       'Hello, world! How are you?'],
  ['newline_split',  'خط اول\nخط دوم.'],
];

const SCALE_CASES = [
  ['minor_110',   [110, 'minor']],
  ['major_220',   [220, 'major']],
  ['dorian_440',  [440, 'dorian']],
];

const HASH_CASES = [
  ['hash_fa', 'سلام دنیا'],
  ['hash_en', 'hello world'],
  ['hash_empty', ''],
];

// ─── Build current output ────────────────────────────────────────
function buildCurrentSnapshot() {
  const out = {};

  out.mood = {};
  for (const [name, text] of MOOD_CASES) {
    out.mood[name] = detectMood(text);
  }

  out.tokenize = {};
  for (const [name, text] of TOKENIZE_CASES) {
    // strip absolute start/end offsets aren't interesting to snapshot;
    // keep the meaningful shape (type/text/sentenceType/paraPos)
    out.tokenize[name] = tokenize(text).map(t => ({
      type: t.type,
      text: t.text,
      sentenceType: t.sentenceType,
      paraPos: t.paraPos,
    }));
  }

  out.scales = {};
  for (const [name, [root, mode]] of SCALE_CASES) {
    out.scales[name] = buildScale(root, mode);
  }

  out.hash = {};
  for (const [name, text] of HASH_CASES) {
    out.hash[name] = hashText(text);
  }

  out.harmony = {};
  for (const [name, text] of MOOD_CASES) {
    if (!text) continue; // deriveTextHarmony on empty text isn't meaningful
    const h = deriveTextHarmony(text);
    out.harmony[name] = { mood: h.mood, root: h.root, scaleLength: h.scale.length };
  }

  return out;
}

// ─── Diff helper ──────────────────────────────────────────────────
function diffPaths(a, b, path = '') {
  const diffs = [];
  if (typeof a !== typeof b) {
    diffs.push(`${path}: type ${typeof a} → ${typeof b}`);
    return diffs;
  }
  if (a && typeof a === 'object') {
    const keys = new Set([...Object.keys(a), ...Object.keys(b || {})]);
    for (const k of keys) {
      diffs.push(...diffPaths(a[k], (b || {})[k], path ? `${path}.${k}` : k));
    }
  } else if (a !== b) {
    diffs.push(`${path}: ${JSON.stringify(a)} → ${JSON.stringify(b)}`);
  }
  return diffs;
}

// ─── Run ──────────────────────────────────────────────────────────
const current = buildCurrentSnapshot();

if (!existsSync(SNAPSHOT_PATH) || UPDATE) {
  writeFileSync(SNAPSHOT_PATH, JSON.stringify(current, null, 2) + '\n');
  console.log(UPDATE
    ? `✓ Snapshot updated: ${SNAPSHOT_PATH}`
    : `✓ Baseline snapshot created: ${SNAPSHOT_PATH}`);
  process.exit(0);
}

const stored = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8'));
const diffs = diffPaths(stored, current);

if (diffs.length === 0) {
  console.log(`✓ All snapshots match (${Object.keys(current.mood).length + Object.keys(current.tokenize).length + Object.keys(current.scales).length + Object.keys(current.hash).length + Object.keys(current.harmony).length} checks).`);
  process.exit(0);
} else {
  console.error(`✗ ${diffs.length} snapshot mismatch(es):\n`);
  diffs.forEach(d => console.error('  ' + d));
  console.error('\nIf this drift is intentional, run: node test/snapshot.mjs --update');
  process.exit(1);
}

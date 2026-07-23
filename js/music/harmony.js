import { MODE_ORDER, buildScale } from './scales.js';
import { detectMood } from './mood.js';
import { MODE_OFFSETS } from './scales.js';

export let currentScale = buildScale(110.00, 'minor');
export let currentMood = 'minor';

function noteFreq(semisFromA2) { return 110.00 * Math.pow(2, semisFromA2 / 12); }

const ROOT_CANDIDATES_LOW = Array.from({ length: 12 }, (_, i) => noteFreq(i - 12));
const ROOT_CANDIDATES_MID = Array.from({ length: 12 }, (_, i) => noteFreq(i));

export function hashText(text) {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0;
  return h;
}

export function deriveTextHarmony(text) {
  const { mode, normScore } = detectMood(text);
  const h = hashText(text);

  const modeIdx = MODE_ORDER.indexOf(mode);
  const candidates = modeIdx <= 5 ? ROOT_CANDIDATES_LOW : ROOT_CANDIDATES_MID;

  const baseIdx = h % candidates.length;
  const bias = Math.round((1 - Math.max(0, Math.min(1, (normScore + 1.5) / 3.0))) * 4);
  const rootIdx = Math.max(0, baseIdx - bias) % candidates.length;
  const root = candidates[rootIdx];

  currentMood = mode;
  currentScale = buildScale(root, mode);

  return { mood: mode, root, scale: currentScale };
}

export function wordNoteScale() {
  const out = [];
  const modeIdx = MODE_ORDER.indexOf(currentMood);
  let octaves;
  if (modeIdx <= 4)       octaves = [0.5, 1, 2];
  else if (modeIdx <= 8)  octaves = [0.5, 1, 2, 3];
  else if (modeIdx <= 12) octaves = [1, 2, 3, 4];
  else                    octaves = [1, 2, 3, 4, 6];
  octaves.forEach(oct => currentScale.forEach(f => out.push(f * oct)));
  return out;
}

export function chordFromScale(scale, degreeRoot) {
  const len = scale.length;
  const root    = scale[degreeRoot % len] * (degreeRoot >= len ? 2 : 1);
  const third   = scale[(degreeRoot + 2) % len] * ((degreeRoot + 2) >= len ? 2 : 1);
  const fifth   = scale[(degreeRoot + 4) % len] * ((degreeRoot + 4) >= len ? 2 : 1);
  const seventh = scale[(degreeRoot + 6) % len] * ((degreeRoot + 6) >= len ? 2 : 1);
  return [root, third, fifth, seventh];
}

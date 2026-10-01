// ─── Pentatonic → parent heptatonic map ─────────────────────────
/**
 * Where each pentatonic scale degree lives in its parent heptatonic scale.
 *
 * A pentatonic mode is a SUBSET of a heptatonic one — pentMajor is exactly
 * major with two notes removed, pentMinor exactly minor — but it has no thirds
 * of its own. Stack a third inside a 5-note scale and you skip a note: on
 * pentMajor [0,2,4,7,9], a third above degree 0 is scale-index 2, which is 4
 * semitones away, and a fifth above is index 4 at 9 — so the "triad" comes out
 * as 0/4/9, which is not a triad at all. Stacking in the PARENT and then
 * mapping back gives real thirds: 0/4/7, a major triad.
 *
 * This matters because the ambient chord stream is built from these degrees.
 * With a wrong map every chord root shifts, silently, and the whole bed moves
 * to the wrong key. test/chord-roots-test.mjs pins both directions of the map
 * for every pentatonic mode, so a typo here fails rather than merely sounding
 * off.
 *
 * Derived rather than typed in: matching each pentatonic semitone against the
 * parent's finds the index. That is checkable — see assertMapIsCorrect — where
 * a hand-typed map would only be checkable by ear.
 */

import { MODE_OFFSETS } from './scales.js';

/** pentatonic mode → parent heptatonic mode. */
export const PENT_PARENT = {
  pentMajor: 'major',
  pentMinor: 'minor',
};

/** Throws if the derived map does not reproduce the pentatonic offsets. */
function assertMapIsCorrect(pentMode, map, pentOffsets) {
  const parentMode = PENT_PARENT[pentMode];
  const parentOffsets = MODE_OFFSETS[parentMode];
  map.forEach((pi, i) => {
    if (parentOffsets[pi] !== pentOffsets[i]) {
      throw new Error(
        `${pentMode}: degree ${i} maps to ${parentMode}[${pi}] but ` +
        `gives ${parentOffsets[pi]}, expected ${pentOffsets[i]}`);
    }
  });
}

/**
 * pentatonic scale index → parent scale index, computed by matching semitones.
 * @param {string} pentMode
 * @param {number[]} pentOffsets — the pentatonic mode's semitone offsets
 * @param {number[]} parentOffsets
 * @returns {number[]}
 */
export function pentToParentMap(pentMode, pentOffsets, parentOffsets) {
  const parent = parentOffsets || MODE_OFFSETS[PENT_PARENT[pentMode]];
  const map = pentOffsets.map(semi => parent.indexOf(semi));
  assertMapIsCorrect(pentMode, map, pentOffsets);
  return map;
}

/** Triads for a pentatonic mode, stacked in the parent and mapped back. */
export function pentTriadsInParent(pentMode, pentOffsets) {
  const parentMode = PENT_PARENT[pentMode];
  if (!parentMode) return null;
  return PENT_PARENT_TRIADS[pentMode];
}

/**
 * PENT_PARENT_TRIADS[mode][i] is the quality of the triad whose root is
 * pentatonic degree i, computed by stacking in the parent.
 *
 * Filled in by buildPentTriads() at load: nothing here is typed in by hand.
 */
export const PENT_PARENT_TRIADS = {};



/** @param {number} semitone */
const degreeAt = (offsets, d) => {
  const n = offsets.length;
  return offsets[((d % n) + n) % n] + 12 * Math.floor(d / n);
};

function quality(root, third, fifth) {
  const a = ((third - root) % 12 + 12) % 12;
  const b = ((fifth - root) % 12 + 12) % 12;
  if (a === 4 && b === 7) return 'major';
  if (a === 3 && b === 7) return 'minor';
  if (a === 3 && b === 6) return 'diminished';
  if (a === 4 && b === 8) return 'augmented';
  return 'other';
}

// Build at load: for each pentatonic mode, map its degrees into the parent
// and stack thirds THERE. Computed, not typed, so a change to scales.js cannot
// leave a stale table behind.
for (const [pentMode, parentMode] of Object.entries(PENT_PARENT)) {
  const pentOffsets = MODE_OFFSETS[pentMode];
  const parentOffsets = MODE_OFFSETS[parentMode];
  const map = pentOffsets.map(semi => parentOffsets.indexOf(semi));
  assertMapIsCorrect(pentMode, map, pentOffsets);
  PENT_PARENT_TRIADS[pentMode] = map.map(pi =>
    quality(degreeAt(parentOffsets, pi), degreeAt(parentOffsets, pi + 2), degreeAt(parentOffsets, pi + 4)));
}

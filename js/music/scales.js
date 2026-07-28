export const MODE_OFFSETS = {
  diminished:       [0, 2, 3, 5, 6, 8, 9, 11],
  superLocrian:     [0, 1, 3, 4, 6, 8, 10],       // altered scale — extremely tense/dissonant
  locrian:          [0, 1, 3, 5, 6, 8, 10],
  doubleHarmonic:   [0, 1, 4, 5, 7, 8, 11],
  neapolitanMinor:  [0, 1, 3, 5, 7, 8, 11],       // dark, dramatic/cinematic
  phrygian:         [0, 1, 3, 5, 7, 8, 10],
  phrygianDominant: [0, 1, 4, 5, 7, 8, 10],
  inScale:          [0, 1, 5, 7, 8],              // Miyako-bushi — traditional Japanese, melancholic
  harmonicMinor:    [0, 2, 3, 5, 7, 8, 11],
  minor:            [0, 2, 3, 5, 7, 8, 10],
  hirajoshi:        [0, 2, 3, 7, 8],              // traditional Japanese — nostalgic anime-OST feel
  bluesScale:       [0, 3, 5, 6, 7, 10],
  pentMinor:        [0, 3, 5, 7, 10],
  dorian:           [0, 2, 3, 5, 7, 9, 10],
  kumoi:            [0, 2, 3, 7, 9],              // traditional Japanese — nostalgic, slightly brighter
  melodicMinor:     [0, 2, 3, 5, 7, 9, 11],
  enigmatic:        [0, 1, 4, 6, 8, 10, 11],
  wholeTone:        [0, 2, 4, 6, 8, 10],
  mixolydian:       [0, 2, 4, 5, 7, 9, 10],
  yoScale:          [0, 2, 5, 7, 9],              // bright anhemitonic Japanese pentatonic, folk-like
  bebopDominant:    [0, 2, 4, 5, 7, 9, 10, 11],
  lydian:           [0, 2, 4, 6, 7, 9, 11],
  lydianAugmented:  [0, 2, 4, 6, 8, 9, 11],       // dreamy, ethereal-bright
  pentMajor:        [0, 2, 4, 7, 9],
  major:            [0, 2, 4, 5, 7, 9, 11],
};

// 16 dark → bright TIERS — same resolution/contrast as the original
// 16-mode palette. Each tier can hold more than one mode name; those
// are alternate *colors at the same brightness level*, picked via a
// deterministic per-text hash for variety. This is deliberate: adding
// new scales as a flat 25-entry sweep diluted the original mapping's
// contrast (moderate texts kept landing in a bland pentatonic cluster).
// Keeping the tier count at 16 preserves the original dramatic range.
export const TIERS = [
  ['diminished', 'superLocrian'],
  ['locrian'],
  ['doubleHarmonic', 'neapolitanMinor'],
  ['phrygian'],
  ['phrygianDominant', 'inScale'],
  ['harmonicMinor'],
  ['minor', 'hirajoshi'],
  ['pentMinor', 'bluesScale'],
  ['dorian', 'kumoi'],
  ['melodicMinor'],
  ['enigmatic'],
  ['wholeTone'],
  ['mixolydian', 'yoScale'],
  ['lydian', 'lydianAugmented', 'bebopDominant'],
  ['pentMajor'],
  ['major'],
];

/** Finds which tier (0–15) a given mode name belongs to. */
export function tierIndexOf(modeName) {
  return TIERS.findIndex(tier => tier.includes(modeName));
}

export function buildScale(rootHz, modeName) {
  const offsets = MODE_OFFSETS[modeName] || MODE_OFFSETS.minor;
  return offsets.map(o => rootHz * Math.pow(2, o / 12));
}

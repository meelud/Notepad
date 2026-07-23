export const MODE_OFFSETS = {
  diminished:       [0, 2, 3, 5, 6, 8, 9, 11],
  locrian:          [0, 1, 3, 5, 6, 8, 10],
  doubleHarmonic:   [0, 1, 4, 5, 7, 8, 11],
  phrygian:         [0, 1, 3, 5, 7, 8, 10],
  phrygianDominant: [0, 1, 4, 5, 7, 8, 10],
  harmonicMinor:    [0, 2, 3, 5, 7, 8, 11],
  minor:            [0, 2, 3, 5, 7, 8, 10],
  pentMinor:        [0, 3, 5, 7, 10],
  dorian:           [0, 2, 3, 5, 7, 9, 10],
  melodicMinor:     [0, 2, 3, 5, 7, 9, 11],
  enigmatic:        [0, 1, 4, 6, 8, 10, 11],
  wholeTone:        [0, 2, 4, 6, 8, 10],
  mixolydian:       [0, 2, 4, 5, 7, 9, 10],
  lydian:           [0, 2, 4, 6, 7, 9, 11],
  pentMajor:        [0, 2, 4, 7, 9],
  major:            [0, 2, 4, 5, 7, 9, 11],
};

export const MODE_ORDER = [
  'diminished','locrian','doubleHarmonic','phrygian','phrygianDominant',
  'harmonicMinor','minor','pentMinor',
  'dorian','melodicMinor','enigmatic','wholeTone',
  'mixolydian','lydian','pentMajor','major',
];

export function buildScale(rootHz, modeName) {
  const offsets = MODE_OFFSETS[modeName] || MODE_OFFSETS.minor;
  return offsets.map(o => rootHz * Math.pow(2, o / 12));
}

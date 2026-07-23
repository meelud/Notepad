let _rngState = 123456789;

export function seedRng(seed) {
  _rngState = (seed >>> 0) || 1;
}

function _rand() {
  _rngState |= 0;
  _rngState = (_rngState + 0x6D2B79F5) | 0;
  let t = Math.imul(_rngState ^ (_rngState >>> 15), 1 | _rngState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function rnd(a, b) {
  return a + _rand() * (b - a);
}

export function pick(a) {
  return a[Math.floor(_rand() * a.length)];
}

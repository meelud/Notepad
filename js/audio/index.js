/**
 * audio/index.js
 * Barrel file — re-exports all audio sub-modules for convenience.
 * Usage: import { ac, VOICES, ensureReverb, ... } from './audio/index.js';
 */
export { ac } from './context.js';
export { ensureReverb, resetReverb, getReverbNode } from './reverb.js';
export { VOICES } from './voices.js';
export { startAmbient, clearAmb, setAmbientDensity } from './ambient.js';
export { playPunctuation } from './punctuation.js';

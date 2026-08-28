/**
 * js/audio/mp3encode.js
 * ─────────────────────────────────────────────────────────────────
 * Converts a recorded audio Blob (whatever format MediaRecorder gave
 * us — webm/opus, mp4/aac, etc.) into a real MP3 Blob, using the
 * self-hosted lamejs encoder (js/vendor/lame.all.js, loaded as a
 * classic <script> in index.html, exposing the global `lamejs`).
 *
 * No network calls, no external CDN — the encoder ships with the app.
 */

function floatTo16BitPCM(float32Array) {
  const out = new Int16Array(float32Array.length);
  for (let i = 0; i < float32Array.length; i++) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

/**
 * @param {Blob} blob — the recorded audio (any MediaRecorder format)
 * @returns {Promise<Blob>} an audio/mp3 Blob
 */
export async function blobToMp3(blob) {
  const arrayBuffer = await blob.arrayBuffer();
  const AC = window.AudioContext || window.webkitAudioContext;
  const ac = new AC();
  const audioBuffer = await ac.decodeAudioData(arrayBuffer);

  const channels = Math.min(2, audioBuffer.numberOfChannels);
  const sampleRate = audioBuffer.sampleRate;
  const left = floatTo16BitPCM(audioBuffer.getChannelData(0));
  const right = channels > 1 ? floatTo16BitPCM(audioBuffer.getChannelData(1)) : null;

  const encoder = new window.lamejs.Mp3Encoder(channels, sampleRate, 128);
  const blockSize = 1152;
  const mp3Chunks = [];

  for (let i = 0; i < left.length; i += blockSize) {
    const leftChunk = left.subarray(i, i + blockSize);
    const buf = right
      ? encoder.encodeBuffer(leftChunk, right.subarray(i, i + blockSize))
      : encoder.encodeBuffer(leftChunk);
    if (buf.length > 0) mp3Chunks.push(buf);
  }
  const tail = encoder.flush();
  if (tail.length > 0) mp3Chunks.push(tail);

  await ac.close();
  return new Blob(mp3Chunks, { type: 'audio/mp3' });
}

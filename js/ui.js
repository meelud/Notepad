import { editor, render, ph, bPlay, bStop, bSave, bClear, wcEl } from './dom.js';
import { play, stop, isPlaying, getAudioBlob, getAudioMimeType, resetHarmony, clearAudioState } from './player.js';
import { showPersonaToast } from './persona.js';

// maps a MediaRecorder mimeType to a real, matching file extension —
// browsers don't all produce webm (e.g. Safari commonly gives mp4)
function extensionFor(mimeType) {
  if (mimeType.includes('mp4')) return 'mp4';
  if (mimeType.includes('ogg')) return 'ogg';
  if (mimeType.includes('wav')) return 'wav';
  return 'webm';
}

// short, filesystem-safe slug from the first few words of the text
function slugFromText(text) {
  const words = text.trim().split(/\s+/).slice(0, 4).join(' ');
  const slug = words
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 40);
  return slug || 'notepad';
}

export function initUI() {

  bPlay.addEventListener('click', play);
  bStop.addEventListener('click', stop);

  bSave.addEventListener('click', () => {
    const blob = getAudioBlob();
    if (!blob) return;
    const ext = extensionFor(getAudioMimeType());
    const stamp = new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-');
    const filename = `${slugFromText(editor.value)}-${stamp}.${ext}`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
    showPersonaToast(`Saved as ${filename}`);
  });

  bClear.addEventListener('click', () => {
    if (isPlaying()) stop();
    editor.value = '';
    editor.style.display = '';
    render.style.display = 'none';
    ph.style.display = 'block';
    bPlay.disabled = true; bSave.disabled = true;
    clearAudioState();
    wcEl.textContent = '0 words';
    resetHarmony();
  });

  editor.addEventListener('input', () => {
    const v = editor.value;
    ph.style.display = v ? 'none' : 'block';
    bPlay.disabled = !v.trim();
    const w = v.trim().split(/\s+/).filter(Boolean).length;
    wcEl.textContent = w + (w === 1 ? ' word' : ' words');
  });

  document.addEventListener('keydown', (e) => {
    const meta = e.metaKey || e.ctrlKey;

    // Attempt to stop Safari from opening Reader Mode on ⌘⇧R while typing.
    // Safari sometimes intercepts this at the browser-chrome level, in
    // which case preventDefault here can't override it — but this covers
    // the cases where the keydown does reach the page first.
    if (meta && e.shiftKey && (e.key === 'r' || e.key === 'R')) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault();
      if (!isPlaying() && !bPlay.disabled) play();
      return;
    }
    if (e.key === 'Escape') {
      if (isPlaying()) { e.preventDefault(); stop(); }
      return;
    }
    if (meta && (e.key === 's' || e.key === 'S')) {
      e.preventDefault();
      if (!bSave.disabled) bSave.click();
      return;
    }
  });
}

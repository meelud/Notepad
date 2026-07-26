import { editor, render, ph, bPlay, bStop, bSave, bClear, wcEl, prog, pf } from './dom.js';
import { play, stop, isPlaying, getAudioBlob, resetHarmony, clearAudioState } from './player.js';

export function initUI() {

  bPlay.addEventListener('click', play);
  bStop.addEventListener('click', stop);

  bSave.addEventListener('click', () => {
    const blob = getAudioBlob();
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'reading.webm'; a.click();
    URL.revokeObjectURL(url);
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
    pf.style.width = '0%';
    prog.classList.remove('on');
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

let AC = null;

export function ac() {
  if (!AC) AC = new (window.AudioContext || window.webkitAudioContext)();
  return AC;
}

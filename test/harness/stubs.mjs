/** Permissive DOM/WebAudio stubs so the REAL player.js can run in Node. */
export function deep(initial = {}) {
  const store = new Map(Object.entries(initial));
  const target = function () {};
  const p = new Proxy(target, {
    get(_, k) {
      if (k === 'then') return undefined;
      if (k === Symbol.toPrimitive) return () => 0;
      if (store.has(k)) return store.get(k);
      const child = deep(); store.set(k, child); return child;
    },
    set(_, k, v) { store.set(k, v); return true; },
    apply() { return deep(); },
    construct() { return deep(); },
  });
  return p;
}

// dom.js is imported once and caches its element proxies, so the editor
// stub must be a single long-lived object whose .value we mutate per run.
const editor = deep({ value: '', style: deep(), selectionStart: 0 });
const els = new Map([['editor', editor]]);
let installed = false;

export function installStubs(editorText) {
  editor.value = editorText;
  if (installed) return editor;
  installed = true;
  globalThis.document = {
    getElementById: id => { if (!els.has(id)) els.set(id, deep()); return els.get(id); },
    createElement: () => deep(),
    body: deep(),
  };
  globalThis.window = { AudioContext: function () { return deep({ sampleRate: 44100 }); }, innerWidth: 1024 };
  globalThis.MediaRecorder = function () { return deep(); };
  return editor;
}

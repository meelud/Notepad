/**
 * persona.js
 * ─────────────────────────────────────────────────────────────────
 * A small, private easter-egg layer: if the user's text mentions
 * certain topics, a short toast message (in the author's own voice)
 * appears after playback finishes, then fades away on its own.
 *
 * Deliberately separate from mood.js / harmony.js — this has nothing
 * to do with the emotion-detection engine and shouldn't leak any of
 * its internals. Just plain keyword matching + a message.
 */
import { toast } from './dom.js';

// ─── Trigger topics ──────────────────────────────────────────────
// Each topic: a list of trigger words (EN + FA, lowercase) and the
// message shown when one of them appears in the user's text.
const TRIGGERS = [
  {
    topic: 'smoking',
    words: ['سیگار', 'سیگاری', 'دخانیات', 'cigarette', 'cigarettes', 'smoke', 'smoking'],
    message: "You're on about smoking, hope you have a good smoke today",
  },
  {
    topic: 'lily',
    words: ['lily', 'lilly', 'lilum', 'لیلی', 'لیلیوم'],
    message: "You're on about something I used to have — it had the most beautiful look and smell you could imagine. Please take care of it.",
  },
  {
    topic: 'kiyana',
    words: ['کیانا', 'kiyana', 'kiyanaaa'],
    message: "You’ve named someone dearly loved by the creator. Hopefully she catches me soon.",
  },
];

let toastTimer = null;

// ─── Public API ─────────────────────────────────────────────────
/**
 * Scans the given text for any persona trigger words. If more than
 * one topic matches, one is picked at random (kept simple for now —
 * only one topic exists anyway).
 * @param {string} text
 * @returns {string|null} the message to show, or null if nothing matched
 */
export function findPersonaMessage(text) {
  const lower = text.toLowerCase();
  const matches = TRIGGERS.filter(t => t.words.some(w => lower.includes(w)));
  if (matches.length === 0) return null;
  const pick = matches[Math.floor(Math.random() * matches.length)];
  return pick.message;
}

/**
 * Shows the toast with the given message, then fades it out after a
 * few seconds. Safe to call repeatedly — resets its own timer.
 * @param {string} message
 */
export function showPersonaToast(message) {
  if (!toast) return;
  clearTimeout(toastTimer);
  toast.textContent = message;
  // force reflow so re-triggering restarts the transition cleanly
  toast.classList.remove('on');
  void toast.offsetWidth;
  toast.classList.add('on');

  // duration scales with message length — a rough reading-time
  // estimate (~60ms/char) with sane floor/ceiling — so longer
  // messages stay up long enough to actually read.
  const duration = Math.max(4200, Math.min(9000, message.length * 60));
  toastTimer = setTimeout(() => {
    toast.classList.remove('on');
  }, duration);
}

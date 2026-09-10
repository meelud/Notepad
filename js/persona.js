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
  {
    topic: 'robbie',
    words: ['robbie'],
    message: "hey love, hope you enjoyed the birthday. I'm sure she'll love your gift. I miss you. I'm having a smoke and it doesn't taste good, it just smells of missing you.",
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

export function isRobbieText(text) {
  return text.toLowerCase().includes('robbie');
}

// ─── Robbie quiz ────────────────────────────────────────────────
// Additive easter-egg: instead of a plain toast, Robbie gets a
// question + answer box. Correct answer ("nebraska") reveals the
// robbie message; wrong answer shows "you're wrong".
export function showRobbieQuiz() {
  document.getElementById('robbie-quiz')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'robbie-quiz';
  overlay.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.55);z-index:50;padding:20px;box-sizing:border-box;';

  const box = document.createElement('div');
  box.style.cssText = 'background:transparent;border:none;padding:24px 22px;width:100%;max-width:420px;box-sizing:border-box;text-align:center;font-family:"EB Garamond",serif;';

  const q = document.createElement('div');
  q.textContent = "What would I say when you tell me you're hungry?";
  q.style.cssText = 'color:#e8e2d6;font-size:19px;line-height:1.6;margin-bottom:18px;';

  const input = document.createElement('input');
  input.type = 'text';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.style.cssText = 'display:block;width:100%;max-width:240px;margin:8px auto 0;box-sizing:border-box;background:transparent;border:none;border-bottom:1px solid rgba(196,168,108,0.35);border-radius:0;color:#e8e2d6;font-family:"EB Garamond",serif;font-size:19px;letter-spacing:0.08em;padding:6px 4px;outline:none;text-align:center;';

  const btn = document.createElement('button');
  btn.textContent = 'send';
  btn.style.cssText = 'margin-top:10px;background:none;border:none;font-family:Inter,sans-serif;font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:#a48a52;cursor:pointer;padding:6px 12px;opacity:0.8;';

  const feedback = document.createElement('div');
  feedback.style.cssText = 'min-height:28px;margin-top:112px;color:#e8e2d6;font-family:"EB Garamond",serif;font-size:18px;font-style:normal;';

  btn.onclick = () => {
    const v = input.value.trim().toLowerCase();
    if (v === 'nebraska') {
      input.disabled = true;
      btn.disabled = true;
      feedback.textContent = "you're right my dear";
      setTimeout(() => {
        const robbie = TRIGGERS.find(t => t.topic === 'robbie');
        box.innerHTML = '';
        box.style.maxWidth = '600px';
        const done = document.createElement('div');
        done.textContent = robbie ? robbie.message : 'nebraska';
        done.style.cssText = 'color:#e8e2d6;background:rgba(20,20,18,0.92);border:1px solid rgba(196,168,108,0.25);border-radius:5px;font-family:"EB Garamond",Georgia,serif;font-size:18px;line-height:1.8;text-align:center;padding:22px 26px;box-sizing:border-box;cursor:pointer;opacity:0;transition:opacity 1.6s ease;';
        done.onclick = () => overlay.remove();
        box.appendChild(done);
        requestAnimationFrame(() => requestAnimationFrame(() => { done.style.opacity = '1'; }));
      }, 2200);
    } else {
      feedback.textContent = "you're wrong my dear";
    }
  };
  input.onkeydown = (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') btn.click();
  };

  box.append(q, input, btn, feedback);
  overlay.appendChild(box);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
  input.focus();
}

/**
 * Shows the toast with the given message, then fades it out after a
 * few seconds. Safe to call repeatedly — resets its own timer.
 * @param {string} message
 */
export function showPersonaToast(message, big = false) {
  if (!toast) return;
  clearTimeout(toastTimer);
  if (big) {
    const isMobile = window.innerWidth <= 480;
    toast.style.fontSize = isMobile ? '13px' : '17px';
    toast.style.lineHeight = isMobile ? '1.6' : '1.8';
    toast.style.bottom = '140px';
    toast.style.padding = isMobile ? '12px 10px' : '16px 16px';
    toast.style.maxWidth = '96vw';
    toast.style.width = 'max-content';
  } else {
    toast.style.fontSize = '';
    toast.style.lineHeight = '';
    toast.style.bottom = '';
    toast.style.padding = '';
    toast.style.maxWidth = '';
    toast.style.width = '';
  }
  toast.textContent = message;
  // force reflow so re-triggering restarts the transition cleanly
  toast.classList.remove('on');
  void toast.offsetWidth;
  toast.classList.add('on');

  // duration scales with message length — a rough reading-time
  // estimate (~60ms/char) with sane floor/ceiling — so longer
  // messages stay up long enough to actually read.
  const duration = Math.max(4200, Math.min(23000, message.length * 60));
  toastTimer = setTimeout(() => {
    toast.classList.remove('on');
  }, duration);
}

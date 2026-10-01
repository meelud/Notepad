/**
 * The arousal lexicon must follow its own stated rule.
 *
 * A category's `arousal` is a DEFAULT describing most of its entries, and
 * where a category holds both kinds the minority is named in
 * AROUSAL_OVERRIDES. The rule that decides which is which:
 *
 *     depletion, absence, numbness, exhaustion, resignation, stillness
 *         → arousal <= 0
 *     threat, urgency, agitation, struggle
 *         → arousal > 0
 *
 * These lists are written from the rule, not harvested from an
 * evaluation set: picking the words that show up in gold.mjs would just
 * move the fitting from the table to the set.
 *
 *   node test/arousal-lexicon-test.mjs
 */
import { AROUSAL_OVERRIDES } from '../js/music/lexicon-en.js';
// EMOTION_LEXICON must come from mood.js, not lexicon-en.js: importing it
// directly would read the categories BEFORE mergeColloquialLexicon() folds
// the Persian word lists in, so every Persian entry would look absent and
// every Persian override would look like a typo.
import { EMOTION_LEXICON, detectMood, scanPhraseMatches } from '../js/music/mood.js';
import { FA_LEXICON_COLLOQUIAL } from '../js/music/lexicon-fa-colloquial.js';

let fails = 0;
const check = (name, ok, detail = '') => { if (!ok) fails++; console.log(`${ok ? ' ok ' : 'FAIL'}  ${name}${ok ? '' : '  → ' + detail}`); };

/** The arousal a given lexicon entry resolves to, in both languages. */
function arousalFor(entry) {
  for (const cat of Object.keys(EMOTION_LEXICON)) {
    if (EMOTION_LEXICON[cat].words.includes(entry)) {
      // the merged list carries both languages, so check the specific
      // Persian table first, then the shared one
      const ov = AROUSAL_OVERRIDES[cat]?.[entry] ?? AROUSAL_OVERRIDES['fa:' + cat]?.[entry];
      return { arousal: ov ?? EMOTION_LEXICON[cat].arousal, cat };
    }
  }
  return null;
}

const DEPLETION_EN = [
  'numb', 'numb to everything', 'numb to it all', 'numb af', 'numb inside',
  'hollow', 'hollow feeling', 'hollow inside', 'empty inside', 'empty on the inside',
  'fading away', 'drowning slowly', 'burnt out', 'checked out', 'nothing left in me',
  'void', 'void inside', 'abyss', 'nothingness', 'oblivion', 'black hole',
  'hopeless', 'hopeless af', 'desolate', 'defeated', 'giving up', 'given up',
  'no point anymore', 'nothing matters', 'life is meaningless',
  'life is empty', 'ghost of myself', 'shell of who I was', 'ghostlike', 'erased',
  'invisible', 'weightless', 'disconnected', 'alienated', 'empty af',
  'running on fumes', 'barely holding it together', 'existential dread',
  'can’t see a way out', 'dead inside', 'hollowed out', 'done with everything',
  'soul tired', 'bleak', 'doom', 'wound', 'wounded', 'pain', 'painful',
  'suffering', 'despair', 'cold', 'coldness', 'dark', 'darkness',
];
const AGITATION_EN = [
  'desperate', 'dying', 'trapped in darkness', 'stuck in the dark', 'suffocating',
  'claustrophobic', 'drowning', 'sinking', 'collapsing', 'crushing weight',
  'living nightmare', 'waking nightmare', 'walking through fire', 'horror show',
  'going through hell', 'crumbling', 'disintegrating', 'falling',
];

const DEPLETION_FA = [
  'بی‌حسم کاملا', 'بی‌حس شدم', 'بی‌احساس شدم', 'هیچی حس نمیکنم',
  'هیچ حسی ندارم دیگه', 'خالی شدم', 'خالی شدم از درون', 'پوچ',
  'ناامید', 'مایوس', 'بی‌معنا', 'بی‌هدف', 'گمشده', 'گمشده‌ام',
  'رهاشده', 'فراموش‌شده', 'همه تنهام گذاشتن', 'هیچکس نیست', 'خستم از بودن',
  'دیگه توانی برام نمونده', 'دیگه رمقی نیست', 'خستگی روحیه',
];
const AGITATION_FA = [
  'خفه شدم تو این وضع', 'از درون فروپاشیدم', 'فروپاشی', 'ویران شدم', 'نابود شدم',
  'داغونم', 'مونسترا تو دلمه', 'یه دیوار که آروم آروم بهم نزدیک میشه',
  'له شدم زیر فشار', 'زیر فشار له شدم', 'زیر فشار شکستم',
];

// 1. every word in the depletion list must be low-arousal
{
  const bad = [];
  for (const w of DEPLETION_EN) {
    const r = arousalFor(w);
    if (!r) { bad.push(`${w} (not in lexicon)`); continue; }
    if (r.arousal > 0) bad.push(`${w}=${r.arousal}`);
  }
  check(`every depletion word is low-arousal (<= 0) [${DEPLETION_EN.length} EN]`, bad.length === 0, bad.join(', '));
}
{
  const bad = [];
  for (const w of DEPLETION_FA) {
    const r = arousalFor(w);
    if (!r) { bad.push(`${w} (not in lexicon)`); continue; }
    if (r.arousal > 0) bad.push(`${w}=${r.arousal}`);
  }
  check(`every Persian depletion word is low-arousal (<= 0) [${DEPLETION_FA.length} FA]`, bad.length === 0, bad.join(', '));
}

// 2. every word in the agitation list must be high-arousal
{
  const bad = [];
  for (const w of AGITATION_EN) {
    const r = arousalFor(w);
    if (!r) { bad.push(`${w} (not in lexicon)`); continue; }
    if (r.arousal <= 0) bad.push(`${w}=${r.arousal}`);
  }
  check(`every agitation word is high-arousal (> 0) [${AGITATION_EN.length} EN]`, bad.length === 0, bad.join(', '));
}
{
  const bad = [];
  for (const w of AGITATION_FA) {
    const r = arousalFor(w);
    if (!r) { bad.push(`${w} (not in lexicon)`); continue; }
    if (r.arousal <= 0) bad.push(`${w}=${r.arousal}`);
  }
  check(`every Persian agitation word is high-arousal (> 0) [${AGITATION_FA.length} FA]`, bad.length === 0, bad.join(', '));
}

// 3. the three audited categories default LOW, which is the whole point
for (const cat of ['dark', 'vice', 'confusion']) {
  check(`${cat} default is low-arousal`, EMOTION_LEXICON[cat].arousal <= 0, `= ${EMOTION_LEXICON[cat].arousal}`);
}

// 4. every override key names a real entry — a typo would silently do nothing
{
  const bad = [];
  for (const [cat, table] of Object.entries(AROUSAL_OVERRIDES)) {
    const isFa = cat.startsWith('fa:');
    const base = isFa ? cat.slice(3) : cat;
    // the merged category already contains the Persian entries
    const pool = EMOTION_LEXICON[base]?.words || [];
    for (const w of Object.keys(table)) {
      if (!pool.includes(w)) bad.push(`${cat}/${w}`);
    }
  }
  check('every arousal override names a real lexicon entry', bad.length === 0, bad.join(', '));
}

// 5. the end-to-end effect that motivated the audit: grief must read as
//    LOW arousal, so it plays slow and soft rather than fast and loud
{
  const numb = detectMood('I feel numb and empty inside');
  const grief = detectMood('I am grieving, everything is grey and hollow');
  check('a numb/empty text scores LOW arousal', numb.arousalScore < 0, `= ${numb.arousalScore.toFixed(2)}`);
  check('a grief text scores LOW arousal', grief.arousalScore < 0, `= ${grief.arousalScore.toFixed(2)}`);
  const anger = detectMood('I am furious and desperate');
  check('an angry text still scores HIGH arousal', anger.arousalScore > 0.5, `= ${anger.arousalScore.toFixed(2)}`);
}

console.log(fails ? `\n${fails} FAILED` : '\nthe arousal lexicon follows its rule');
process.exit(fails ? 1 : 0);

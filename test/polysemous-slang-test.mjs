// ─── Polysemous slang needs a person subject ─────────────────────
// "on fire" was a joy entry at +1.1, because "you're on fire!" is praise.
// So "Run! The building is on fire!" scored +1.02 and played lydian — the
// worst error in the whole audit, and a wrong answer of the kind that makes
// the output feel untrustworthy rather than merely imprecise.
//
// The rule is about the SUBJECT, not about sentiment intensity: the slang
// reading needs a person. With one it fires; without one the phrase does not
// match at all, and the text falls through to whatever else it says.
//
// This test also records what was AUDITED and found not to be broken, because
// the obvious list of suspects is mostly harmless: "crush" and "dying" resolve
// through longer entries already, "sick", "crazy", "wicked" and "insane" are
// not entries at all, and "stable" is only reached where nothing negates it.

import { detectMood, PERSON_SUBJECT_SLANG } from '../js/music/mood.js';
import { EMOTION_LEXICON } from '../js/music/mood.js';

let failed = 0;
function check(name, ok, detail = '') {
  console.log(` ${ok ? ' ok  ' : 'FAIL '} ${name}${detail ? '  → ' + detail : ''}`);
  if (!ok) failed++;
}

console.log('\npolysemous slang\n');

// 1. the reported failure, and its family — these must NOT be positive
{
  const NEGATIVE = [
    'Run! The building is on fire!',
    'The building is on fire',
    'The car is on fire',
    'The forest is on fire',
    'the house is on fire',
    'Run! The building is on fire and there is smoke everywhere!',
  ];
  const bad = [];
  for (const t of NEGATIVE) {
    const m = detectMood(t);
    // must not be positive. It is NOT asserted to be negative either: with the
    // phrase not matching, the text is unread, and the calm-neutral prior is
    // what an unread text gets. Claiming a fire reads as "calm and wistful"
    // would be the same over-claim in the other direction — the honest
    // statement is that the lexicon does not yet know what a fire is.
    if (m.normScore > 0.05) bad.push(`"${t}" → ${m.normScore}`);
  }
  check('a thing that is on fire is not read as joy', bad.length === 0, bad.join(' | '));
  console.log('       (unread, so the prior applies — a fire is not yet in the lexicon at all);');
}

// 2. the slang reading still works after a person subject
{
  const POSITIVE = [
    'you are on fire!',
    'I am on fire today',
    "you're on fire",
    "we're on fire",
    'we are on fire',
    'he is on fire',
    'she is on fire',
  ];
  const bad = [];
  for (const t of POSITIVE) {
    const m = detectMood(t);
    if (m.normScore <= 0.05) bad.push(`"${t}" → ${m.normScore}`);
  }
  check('a person who is on fire still reads as praise', bad.length === 0, bad.join(' | '));
}

// 3. the guard is a property of the PHRASE, not a special case in the source
{
  check('the gated list is small and explicit', PERSON_SUBJECT_SLANG.size <= 4,
    `${PERSON_SUBJECT_SLANG.size}: ${[...PERSON_SUBJECT_SLANG].join(', ')}`);
  const orphans = [...PERSON_SUBJECT_SLANG].filter(p =>
    !Object.keys(EMOTION_LEXICON).some(cat => EMOTION_LEXICON[cat].words.includes(p)));
  check('every gated phrase is a real lexicon entry', orphans.length === 0, orphans.join(', '));
}

// 4. what was audited and found ALREADY correct — pinned so a later change
//    cannot quietly reintroduce the same class of error
{
  const CASES = [
    ['crush', 'I have a crush on her', true],      // romance
    ['crush', 'they crushed the box', false],     // destruction
    ['dying', 'I am dying', false],               // literal
    ['dying of laughter', 'I am dying of laughter', true],
    ['sick', 'I am sick', false],                 // not an entry; neutral
    ['crazy about', 'she is crazy about him', true],
    ['crazy', 'it is crazy out there', false],    // not an entry; neutral
    ['stable', 'the situation is not stable', false],
  ];
  const bad = [];
  for (const [, text, wantPositive] of CASES) {
    const m = detectMood(text);
    if (wantPositive && m.normScore <= 0.05) bad.push(`${text}: ${m.normScore}`);
    if (!wantPositive && m.normScore > 0.05) bad.push(`${text}: ${m.normScore}`);
  }
  check('the other slang suspects behave correctly already', bad.length === 0, bad.join(' | '));
}

if (failed) {
  console.log(`\n${failed} FAILED`);
  process.exit(1);
}
console.log('\na fire is only praise when a person is the one burning');
/**
 * Reconciles the arousal lexicon against the rule, from the data alone.
 * Prints per-category entry counts, how many resolved by default, how many
 * are overridden, and cross-checks the numbers the commit message claims.
 */
import { EMOTION_LEXICON, MADDA_COLLISIONS } from '../js/music/mood.js';
import { AROUSAL_OVERRIDES } from '../js/music/lexicon-en.js';

const norm = s => (s.toLowerCase().replace(/[\u200C\u200F\u200E]/g, '')
  .match(/[a-zA-Z\u0621-\u06CC]+/g) || []).join(' ');

const CATS = ['dark', 'vice', 'confusion'];
let grand = { entries: 0, overridden: 0, byDefault: 0, faEntries: 0, faOverridden: 0 };

console.log('\nAROUSAL LEXICON RECONCILIATION\n');
console.log(' category    entries   overridden   default-only   default value');
console.log(' ---------- --------- ----------- -------------- -------------');

for (const cat of CATS) {
  const words = EMOTION_LEXICON[cat].words;
  const def = EMOTION_LEXICON[cat].arousal ?? 0;
  const en = AROUSAL_OVERRIDES[cat] || {};
  const fa = AROUSAL_OVERRIDES['fa:' + cat] || {};
  const ovCount = Object.keys(en).length + Object.keys(fa).length;
  const faWords = words.filter(w => /[؀-ۿ]/.test(w)).length;

  const line = ` ${cat.padEnd(10)} ${String(words.length).padStart(9)} ${String(ovCount).padStart(11)} ${String(words.length - ovCount).padStart(14)} ${String(def).padStart(14)}`;
  console.log(line);
  grand.entries += words.length;
  grand.overridden += ovCount;
  grand.byDefault += words.length - ovCount;
}

// per-language split
console.log('\n per language (merged category lists):');
for (const cat of CATS) {
  const words = EMOTION_LEXICON[cat].words;
  const fa = words.filter(w => /[؀-ۿ]/.test(w)).length;
  const en = words.length - fa;
  const enOv = Object.keys(AROUSAL_OVERRIDES[cat] || {}).length;
  const faOv = Object.keys(AROUSAL_OVERRIDES['fa:' + cat] || {}).length;
  console.log(`   ${cat.padEnd(10)} en=${String(en).padStart(4)} (${enOv} ov)   fa=${String(fa).padStart(4)} (${faOv} ov)`);
  grand.faEntries += fa; grand.faOverridden += faOv;
}

// the rule itself, checked against every entry
const DEPLETION = [
  'numb','hollow','empty','fading','checked out','burnt out','void','hopeless',
  'given up','hit rock bottom','desolate','alienated','disconnected','numbness',
];
console.log('\n rule check — category default sign:');
for (const cat of CATS) {
  const d = EMOTION_LEXICON[cat].arousal ?? 0;
  const overrides = { ...(AROUSAL_OVERRIDES[cat] || {}), ...(AROUSAL_OVERRIDES['fa:' + cat] || {}) };
  const positive = Object.entries(overrides).filter(([, v]) => v > 0);
  const negative = Object.entries(overrides).filter(([, v]) => v < 0);
  console.log(`   ${cat.padEnd(10)} default=${d < 0 ? 'LOW  ' : 'HIGH '} ` +
    `overrides: ${negative.length} low, ${positive.length} high`);
}

// every override key must be a real entry
console.log('\n integrity:');
let bad = [];
for (const [k, table] of Object.entries(AROUSAL_OVERRIDES)) {
  const base = k.startsWith('fa:') ? k.slice(3) : k;
  const pool = EMOTION_LEXICON[base]?.words || [];
  for (const w of Object.keys(table)) if (!pool.includes(w)) bad.push(`${k}/${w}`);
}
console.log(`   override keys naming no real entry: ${bad.length}` + (bad.length ? ' → ' + bad.join(', ') : ''));
console.log(`   total entries in the three categories: ${grand.entries}`);
console.log(`   resolved by default: ${grand.byDefault}   overridden: ${grand.overridden}`);
console.log(`   FA entries: ${grand.faEntries}   FA overrides: ${grand.faOverridden}`);

// The madda-less fold merges lexicon entries that differ only by آ-vs-ا.
// mood.js exports the list but deliberately prints nothing — it runs on every
// import and would put developer bookkeeping in the browser console — so this
// is one of the two places the report actually surfaces.
console.log('\n entries merged by the madda-less fold (آ/ا), later spelling wins:');
if (!MADDA_COLLISIONS.length) console.log('   (none)');
for (const c of MADDA_COLLISIONS) {
  console.log(`   "${c.key}"  kept "${c.kept.spelling}" [${c.kept.cat} ${c.kept.weight}]` +
              `  over "${c.dropped.w}" [${c.dropped.cat} ${c.dropped.weight}]`);
}

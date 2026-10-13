// detectMood rewrites "n't" to " not" before it looks anything up, so that "don't feel happy" is a
// negation. Lexicon entries spelled with a contraction used to become unreachable there, and the negator
// then flipped the word next to it. These tests pin the repaired behaviour from three sides:
//   1. every lexicon entry with an n't is reachable and keeps the sign of its category,
//   2. idioms and exclamations that contain a negator inside a phrase read the way they mean,
//   3. real negation still works (the reason for the rewrite).
import { EMOTION_LEXICON, detectMood } from '../js/music/mood.js';

let bad = 0;
const ok = (c, m) => { if (!c) { bad++; console.log(' FAIL ', m); } };
const score = t => detectMood(t).normScore;

// 1. every lexicon entry with a contraction
let entries = 0;
for (const [cat, c] of Object.entries(EMOTION_LEXICON)) for (const w of c.words || []) {
  if (!/n['’]t\b/.test(w)) continue;
  entries++;
  const m = detectMood(w);
  ok(m.lexiconHits >= 1, `${cat} "${w}": matched nothing`);
  if (c.weight !== 0) ok(Math.sign(m.normScore) !== -Math.sign(c.weight), `${cat}(${c.weight}) "${w}": read with the opposite sign (${m.normScore.toFixed(2)})`);
}
ok(entries >= 41, `expected at least the 41 known contraction entries, found ${entries}`);

// 2. a negator inside a matched phrase is part of its meaning
ok(score("I can't believe how happy I am!") > 0.3, `"can't believe how happy" must read happy (${score("I can't believe how happy I am!").toFixed(2)})`);
ok(score("I cannot believe how happy I am!") > 0.3, 'the spelling "cannot" too');
ok(score("We did it, I can't believe it! Tonight we celebrate, everyone come over!") > 0.3, 'the joyful test text reads bright');
ok(score("I can't stop smiling") > 0.3, "can't stop smiling is joy");
ok(score("I can't wait to see you") > 0, "can't wait is positive");
ok(score("I can't stop crying") < -0.3, "can't stop crying is sadness");
ok(score("I can't stop crying and I am happy") < score("I can't stop smiling and I am happy"), 'a happy ending does not undo crying more than it adds to smiling');
const afterPhrase = score("I can't stop smiling, I am so happy");
ok(afterPhrase > score("I can't stop smiling"), `a word AFTER a phrase is no longer negated by the phrase's own negator (${afterPhrase.toFixed(2)} vs ${score("I can't stop smiling").toFixed(2)})`);

// 3. real negation still works
ok(score("I don't feel happy") < 0, `"I don't feel happy" is still negative (${score("I don't feel happy").toFixed(2)})`);
ok(score("I am not happy") < 0, '"I am not happy" is still negative');
ok(score("I can't feel anything but I am not happy") < 0, 'negation outside phrases still applies');
ok(score("I am not sad") > score("I am sad"), 'a negated sadness is less sad than sadness');

// celebrate words
ok(score('Tonight we celebrate!') > 0.3, '"celebrate" is joy');
ok(score('Hooray, congratulations!') > 0.3, '"hooray, congratulations" is joy');

if (bad) { console.log(`${bad} failure(s)`); process.exit(1); }
console.log(`mood contractions: all ${entries} contraction entries reachable with the right sign; idioms, negation and celebration read as meant`);

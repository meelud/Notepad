#!/usr/bin/env node
// One-off diagnostic — run from project root:
//   node find-lexicon-hole.mjs
// Finds any array "hole" (undefined element from a stray double-comma)
// in either lexicon file's word arrays and prints the category + index.
import { FA_LEXICON_COLLOQUIAL } from './js/music/lexicon-fa-colloquial.js';
import { EMOTION_LEXICON } from './js/music/lexicon-en.js';

function scan(label, obj, getWords) {
  for (const [cat, val] of Object.entries(obj)) {
    const words = getWords(val);
    words.forEach((w, i) => {
      if (w === undefined) {
        console.log(`HOLE FOUND: ${label} / ${cat} / index ${i} (surrounding: ${JSON.stringify(words.slice(Math.max(0,i-2), i+3))})`);
      }
    });
  }
}

scan('fa', FA_LEXICON_COLLOQUIAL, v => v);
scan('en', EMOTION_LEXICON, v => v.words);
console.log('Scan complete.');

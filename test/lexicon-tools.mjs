/**
 * test/lexicon-tools.mjs
 * Zero-dependency lexicon management: stats / add / list.
 * Usage:
 *   node test/lexicon-tools.mjs stats
 *   node test/lexicon-tools.mjs add <fa|en> <category> "<word>"
 *   node test/lexicon-tools.mjs list <fa|en> <category>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PATHS = {
  fa: join(__dirname, '../js/music/lexicon-fa-colloquial.js'),
  en: join(__dirname, '../js/music/lexicon-en.js'),
};

const [, , cmd, lang, category, ...rest] = process.argv;
const word = rest.join(' ');

function loadWords(lang, category) {
  const content = readFileSync(PATHS[lang], 'utf8');
  const re = lang === 'fa'
    ? new RegExp(`  ${category}: \\[([\\s\\S]*?)\\n  \\],`)
    : new RegExp(`${category}: \\{ weight: [-\\d.]+, tense: [-\\d.]+, words: \\[([\\s\\S]*?)\\n  \\]\\},`);
  const m = content.match(re);
  if (!m) return null;
  const words = [...m[1].matchAll(/'((?:[^'\\]|\\.)*)'/g)].map(x => x[1]);
  return { content, block: m[0], inner: m[1], words };
}

if (cmd === 'stats') {
  for (const lang of ['en', 'fa']) {
    const content = readFileSync(PATHS[lang], 'utf8');
    const cats = lang === 'fa'
      ? [...content.matchAll(/^  (\w+): \[/gm)].map(m => m[1])
      : [...content.matchAll(/^  (\w+): \{ weight:/gm)].map(m => m[1]);
    console.log(`\n=== ${lang.toUpperCase()} ===`);
    let total = 0;
    for (const cat of cats) {
      const w = loadWords(lang, cat);
      const n = w ? w.words.length : 0;
      total += n;
      console.log(`  ${cat.padEnd(12)} ${n}`);
    }
    console.log(`  TOTAL: ${total}`);
  }
} else if (cmd === 'add') {
  const w = loadWords(lang, category);
  if (!w) { console.error('category not found:', category); process.exit(1); }
  if (w.words.includes(word)) {
    console.log(`SKIP (duplicate): [${lang}/${category}] "${word}"`);
  } else {
    const newBlock = w.block.replace(w.inner, w.inner + `, '${word.replace(/'/g, "\\'")}'`);
    const newContent = w.content.replace(w.block, newBlock);
    writeFileSync(PATHS[lang], newContent);
    console.log(`ADDED: [${lang}/${category}] "${word}"`);
  }
} else if (cmd === 'list') {
  const w = loadWords(lang, category);
  console.log(w ? w.words.join(', ') : 'category not found');
} else {
  console.log('usage: node test/lexicon-tools.mjs <stats|add|list> [fa|en] [category] ["word"]');
}

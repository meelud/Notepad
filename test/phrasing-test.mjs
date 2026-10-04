// Phrase structure (music/phrasing.js): half cadences at commas, melodic
// repetition of deliberately repeated text. Pure-function tests plus the
// melodic consequences through player-sim (which parity-tests against play()).
import fs from 'node:fs';
import { derivePhrasing } from '../js/music/phrasing.js';
import { tokenize } from '../js/utils/text.js';
import { simulateText } from './player-sim.mjs';
import { resolveCadence } from '../js/music/harmony.js';
import { PHRASING_TEXTS } from './phrasing-corpus.mjs';

let failed = 0;
const check = (name, ok, detail = '') => { console.log(` ${ok ? ' ok  ' : 'FAIL '} ${name}${detail ? '   ' + detail : ''}`); if (!ok) failed++; };

const plain = t => tokenize(t).filter(x => x.type === 'word' || x.type === 'punct');
const phr = t => derivePhrasing(plain(t));
const kindsOf = t => { const pl = plain(t), ph = derivePhrasing(pl); return pl.map((x, i) => x.type === 'word' ? ph.cadenceKind(i) : undefined).filter(k => k !== undefined); };

console.log('\ncadence hierarchy\n');
check('a comma ends a phrase open, the period closes it', JSON.stringify(kindsOf('I love you, baby.')) === JSON.stringify([null, null, 'half', 'full']), JSON.stringify(kindsOf('I love you, baby.')));
check('a one-word phrase gets no half cadence ("Yes, I do.")', JSON.stringify(kindsOf('Yes, I do.')) === JSON.stringify([null, null, 'full']), JSON.stringify(kindsOf('Yes, I do.')));
check('the end of the text is a full cadence without punctuation', kindsOf('hey baby').at(-1) === 'full');
check('semicolon and colon are half cadences', JSON.stringify(kindsOf('we came; we saw: we left')) === JSON.stringify([null, 'half', null, 'half', null, 'full']) , JSON.stringify(kindsOf('we came; we saw: we left')));
check('Persian comma U+060C is a half cadence too', kindsOf('\u0633\u0644\u0627\u0645 \u062f\u0648\u0633\u062a \u0645\u0646\u060c \u062e\u0648\u0628\u0645')[2] === 'half');
check('sentence-final . ! ? stay full (unchanged behaviour)', ['a b.', 'a b!', 'a b?'].every(t => kindsOf(t).at(-1) === 'full'));

console.log('\nrepetition detection\n');
const spans = t => phr(t).spans.map(s => `${s.len}@${s.at}<${s.src}`);
check('"I love you ... I love you" is one 3-word repeat', JSON.stringify(spans('I love you and I love you')) === '["3@4<0"]', JSON.stringify(spans('I love you and I love you')));
check('a lone word repeated back to back ("never, never, never")', phr('never, never, never again').spans.length === 2);
check('anaphora: two-word openings of consecutive sentences', spans('I want peace. I want quiet.').length === 1);
check('incidental 2-word repeat ("of the ... of the") is NOT a repeat', phr('the top of the hill and the edge of the lake').spans.length === 0);
check('a repeated word that is not adjacent is NOT a repeat', phr('the cat and the dog').spans.length === 0);
check('no repeats in ordinary prose', phr('This has been the hardest year of my life and nothing got easier').spans.length === 0);
check('detection is a pure function of the text', JSON.stringify(phr('I love you so much, I love you so much').spans) === JSON.stringify(phr('I love you so much, I love you so much').spans));

console.log('\nmelodic consequences (player-sim)\n');
{
  const seq = simulateText('I love you, baby and I miss you').sequence;
  const half = seq.filter(x => x.cadenceKind === 'half');
  check('a comma lands on the dominant, same degree a question would', half.length === 1 && half[0].degree === resolveCadence(null, 'question', 1, 0).degree, half.map(h => h.degree).join());
  check('the final word is still the full cadence (unchanged path)', seq.at(-1).path === 'cadence' && seq.at(-1).isCadence);
}
{
  const seq = simulateText('I love you so much, I love you so much').sequence;
  const reps = seq.filter(x => x.path === 'repetition');
  check('the repeated text is played as repeated degrees', reps.length >= 3 && reps.every(r => r.degree === seq[r.repSrc].degree), `${reps.length} copied`);
  check('the last word of a repeat may differ (it is a cadence)', seq.at(-1).path === 'cadence');
}
{
  const a = simulateText(PHRASING_TEXTS[2]).sequence.map(x => x.freq).join();
  const b = simulateText(PHRASING_TEXTS[2]).sequence.map(x => x.freq).join();
  check('same text, same melody (no RNG in either mechanism)', a === b);
}

console.log('\nshared by the player and the simulator\n');
{
  const player = fs.readFileSync(new URL('../js/player.js', import.meta.url), 'utf8');
  const sim = fs.readFileSync(new URL('./player-sim.mjs', import.meta.url), 'utf8');
  check('both derive phrasing from the same module', /derivePhrasing\(playable\)/.test(player) && /derivePhrasing\(playable\)/.test(sim));
  check('both place half cadences and copies with the same calls', [player, sim].every(f => /resolveCadence\(lastNote, 'half', 1,/.test(f) && /repeatNote\(wordNotes\[repLink\.src\]/.test(f)));
}

if (failed) { console.log(`\n${failed} FAILED`); process.exit(1); }
console.log('\nphrase structure: all passed');

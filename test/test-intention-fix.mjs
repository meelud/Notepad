import { deriveIntentions } from './intention.js';

let fails = 0;
function check(name, cond, detail = '') {
  if (cond) { console.log(`  ok  ${name}`); }
  else { fails++; console.log(`FAIL  ${name}  ${detail}`); }
}

console.log('== bug scenario: sentence-end before a later contrast word must NOT be dropped ==');
{
  const text = "I love this city. It has great food. But then I got sick.";
  const intentions = deriveIntentions(text);
  // Expect 3 clauses: "I love this city", "It has great food", "But then I got sick"
  check('produces 3 clauses (not 1 merged)', intentions.length === 3, JSON.stringify(intentions.map(i => text.slice(i.start, i.end))));
  if (intentions.length >= 2) {
    check('clause 0 is marked isSentenceEnd', intentions[0].isSentenceEnd === true, intentions[0]);
    check('clause 1 is marked isSentenceEnd', intentions[1].isSentenceEnd === true, intentions[1]);
  }
  if (intentions.length >= 3) {
    check('clause 2 (after "But") is marked isDisruption', intentions[2].isDisruption === true, intentions[2]);
  }
}

console.log('== Persian equivalent: sentence-end before a later ولی ==');
{
  const text = 'امروز هوا خوب بود. رفتیم بیرون. ولی بعدش بارون گرفت.';
  const intentions = deriveIntentions(text);
  check('produces 3 clauses', intentions.length === 3, JSON.stringify(intentions.map(i => text.slice(i.start, i.end))));
}

console.log('== regression: simple contrast-only sentence still works ==');
{
  const text = 'باهاش خوش گذشت ولی خیلی خسته‌ام';
  const intentions = deriveIntentions(text);
  check('produces 2 clauses', intentions.length === 2, JSON.stringify(intentions));
  check('second clause is disruption', intentions[1] && intentions[1].isDisruption === true);
}

console.log('== regression: comma-only splitting still works ==');
{
  const text = 'سلام، خوبی، خوشحالم که اومدی';
  const intentions = deriveIntentions(text);
  check('produces 3 clauses', intentions.length === 3, JSON.stringify(intentions));
}

console.log('== regression: plain single sentence, no boundaries ==');
{
  const text = 'من امروز خیلی خوشحالم';
  const intentions = deriveIntentions(text);
  check('produces 1 clause', intentions.length === 1, JSON.stringify(intentions));
  check('marked as sentence end (trailing, no punctuation)', intentions[0].isSentenceEnd === true);
}

console.log('== regression: empty text ==');
{
  const intentions = deriveIntentions('');
  check('produces 0 clauses', intentions.length === 0);
}

console.log('== regression: contraction negation still normalized in clauseSentiment ==');
{
  const a = deriveIntentions("I don't feel happy.");
  const b = deriveIntentions("I do not feel happy.");
  check("don't vs do not give same contourBias sign/shape", a[0].contourBias === b[0].contourBias, `${a[0].contourBias} vs ${b[0].contourBias}`);
}

console.log(`\n${fails === 0 ? 'ALL PASS' : fails + ' FAILURE(S)'}`);
process.exit(fails === 0 ? 0 : 1);

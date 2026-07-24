/**
 * negators.js
 * Bilingual negation data — words that flip emotion polarity.
 *
 * English negators typically precede the word ("not happy").
 * Persian is verb-final, so negation frequently comes AFTER the emotion
 * word ("خوشحال نیستم" = "[happy] [I'm-not]").
 */
export const NEGATORS = new Set([
  // English
  'not', "n't", 'never', 'none', 'neither', 'nor',
  "isn't", "aren't", "wasn't", "weren't", "don't", "doesn't", "didn't",
  "won't", "wouldn't", "can't", "cannot", "couldn't", "shouldn't", 'no',
  // Persian — verb-final negated forms (auxiliary/copula + negation)
  'نیستم','نیستی','نیست','نیستیم','نیستید','نیستند',
  'نبودم','نبودی','نبود','نبودیم','نبودید','نبودند',
  'ندارم','نداری','نداره','نداریم','ندارید','ندارند',
  'نمیخوام','نمیخوای','نمیخواد','نمیخوایم','نمیخواین','نمیخوان',
  'نمیشه','نکن','نکنم','هرگز','ابدا','اصلا',
]);

/**
 * Pure emphasis particles — they only amplify a nearby true negator
 * but cannot negate on their own. Without this distinction, phrases
 * like "اصلا خوب نیست" would double-cancel back to positive.
 */
export const EMPHASIS_ONLY = new Set(['اصلا', 'ابدا']);

/** Number of words to look before/after for a negator. */
export const NEGATION_WINDOW = 3;

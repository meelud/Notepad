/**
 * test/eval-dataset.mjs
 * ─────────────────────────────────────────────────────────────────
 * Hand-labeled evaluation set for detectMood(). NOT a training set —
 * this is purely for measuring how well the existing heuristic agrees
 * with human sentiment judgment, so the project can state an actual
 * accuracy number instead of "it feels right."
 *
 * Label scale (my own honest judgment per text, made BEFORE running
 * the algorithm, to avoid unconsciously cherry-picking to match it):
 *   -2 strongly negative   -1 negative   0 neutral   1 positive   2 strongly positive
 *
 * Coverage is deliberately broad: Persian formal, Persian colloquial
 * (matching each lexicon category), English, mixed-language,
 * negation, contrastive "but" sentences, intensifiers/diminishers,
 * everyday neutral text, and a few known-hard cases (sarcasm,
 * rhetorical questions) included on purpose to expose real weaknesses
 * rather than hide them.
 */
export const EVAL_DATASET = [
  // ── Persian colloquial: joy ──────────────────────────────────
  ['امروز خیلی خوشحالم و حالم عالیه', 2],
  ['دلم میخواد جیغ بزنم از خوشحالی', 2],
  ['کیف کردیم باهم دیشب', 1],
  ['یه لبخند رو لبمه', 1],
  ['حالم بد نیست', 0],

  // ── Persian colloquial: sadness ──────────────────────────────
  ['دلم شکسته و خیلی تنهام', -2],
  ['بغض دارم و نمیتونم گریه کنم', -2],
  ['یکم دلم گرفته امروز', -1],
  ['حوصله ندارم زیاد', -1],
  ['خسته‌ام ولی چیز خاصی نیست', 0],

  // ── Persian colloquial: anger ────────────────────────────────
  ['از دستش خیلی عصبانی‌ام و دیگه نمیخوام ببینمش', -2],
  ['حسابی حرصم گرفت امروز', -1],
  ['یکم رو اعصابم رفت', -1],
  ['یه بحث کوچیک داشتیم', 0],

  // ── Persian colloquial: fear ──────────────────────────────────
  ['وحشت کردم وقتی اون صدا رو شنیدم', -2],
  ['یکم نگرانم برای فردا', -1],
  ['استرس امتحان دارم', -1],

  // ── Persian colloquial: love ──────────────────────────────────
  ['عاشقتم و همیشه کنارتم', 2],
  ['خیلی دوست دارم', 2],
  ['بهت علاقه دارم', 1],

  // ── Persian colloquial: hope ──────────────────────────────────
  ['امیدوارم فردا روز بهتری باشه', 1],
  ['یه روزی همه چی درست میشه', 1],
  ['هنوز مطمئن نیستم ولی امیدوارم', 0],

  // ── Persian colloquial: calm ──────────────────────────────────
  ['آرومم و خیالم راحته', 1],
  ['یه گوشه نشستم و دارم استراحت میکنم', 0],

  // ── Persian colloquial: dark / hopeless ──────────────────────
  ['دیگه هیچ امیدی برام نمونده', -2],
  ['زندگی برام بی‌معنا شده', -2],
  ['یکم ناامیدم این روزا', -1],

  // ── Persian colloquial: nostalgia ────────────────────────────
  ['دلم برای اون روزای قدیم تنگ شده', -1],
  ['یاد بچگیام افتادم، چه روزای خوبی بود', 1],

  // ── Persian colloquial: casual / neutral everyday ────────────
  ['امروز رفتم بیرون یه چرخی زدم', 0],
  ['کارم رو تموم کردم و رفتم خونه', 0],
  ['چیز خاصی نشد امروز', 0],
  ['هوا امروز ابری بود', 0],
  ['غذا خوردم و خوابیدم', 0],

  // ── Persian colloquial: surprise ─────────────────────────────
  ['اصلا فکرشو نمیکردم، خیلی شوکه شدم', 1],
  ['وای باورم نمیشه چه خبر خوبی', 2],
  ['یهو یه اتفاق بدی افتاد که اصلا انتظارشو نداشتم', -1],

  // ── Persian: negation ─────────────────────────────────────────
  ['من امروز خوشحال نیستم اصلا', -1],
  ['اصلا ناراحت نیستم', 1],
  ['خوب نیستم امروز', -1],

  // ── Persian: contrastive "ولی/اما" ───────────────────────────
  ['باهاش خوش گذشت ولی خیلی خسته‌ام', -1],
  ['خیلی خسته‌ام ولی باهاش خوش گذشت', 1],
  ['روز سختی بود اما در نهایت خوب تموم شد', 1],
  ['همه چی خوب پیش رفت اما آخرش خیلی ناراحت شدم', -1],

  // ── Persian: intensifiers/diminishers ────────────────────────
  ['خیلی خیلی خوشحالم امروز', 2],
  ['یکم خوشحالم فقط', 0],
  ['کاملا مطمئنم که درست میشه', 1],
  ['یه‌کم نگرانم', 0],

  // ── English: joy/sadness/anger/fear/love ─────────────────────
  ['I am so happy today, everything feels amazing', 2],
  ['I feel really sad and empty inside', -2],
  ['I am extremely angry about what happened', -2],
  ['I am terrified of what might happen next', -2],
  ['I love you more than anything', 2],
  ['just an ordinary day at work', 0],
  ['nothing special happened today', 0],

  // ── English: negation ──────────────────────────────────────────
  ["I'm not happy about this at all", -1],
  ["I don't feel sad anymore", 1],

  // ── English: contrastive "but" ────────────────────────────────
  ['it was fun but I feel sad now', -1],
  ['I feel sad but it was fun', 1],
  ['the trip was exhausting but totally worth it', 1],

  // ── English: intensifiers/diminishers ─────────────────────────
  ['extremely happy right now', 2],
  ['slightly happy, nothing major', 0],
  ['I am absolutely devastated', -2],

  // ── Mixed EN/FA ────────────────────────────────────────────────
  ['I am so خوشحال today, واقعا!', 2],
  ['امروز a bit tired و خسته‌ام', -1],
  ['just چیز خاصی نشد today', 0],

  // ── Punctuation-driven cases ───────────────────────────────────
  ['چطوری؟ خوبی؟', 0],
  ['واقعا؟! باورم نمیشه!', 1],
  ['خیلی خسته‌ام...', -1],
  ['وای چه خبر عالی!!', 2],

  // ── Formal/neutral Persian (no colloquial slang) ──────────────
  ['گزارش ماهانه آماده شد و برای بررسی ارسال گردید', 0],
  ['جلسه فردا ساعت ده برگزار می‌شود', 0],
  ['هوا در روزهای آینده بارانی پیش‌بینی می‌شود', 0],

  // ── Known-hard cases (sarcasm / rhetorical — included honestly
  //    to expose real weaknesses, not to inflate the score) ──────
  ['عالی شد، دقیقا همینو کم داشتم', -1], // sarcastic "great" — system will likely misread as positive
  ['چه روز فوق‌العاده‌ای، ماشینم هم خراب شد', -1], // sarcastic
  ["oh great, another Monday", -1], // sarcastic
  ['واقعا که! باز هم همون داستان همیشگی', -1],
  // ── Additional coverage using newly-added lexicon entries ────
  ['I am absolutely elated today', 2],
  ['feeling grounded and at peace', 1],
  ['heartbroken and grieving right now', -2],
  ['livid about what happened', -2],
  ['stunned, did not see that coming', 1],
  ['reminiscing about the good times', -1],
  ['baffled by this whole situation', 0],
  ['staying hopeful things will improve', 1],
  ['خیلی خوشحال شدم امروز', 2],
  ['قلبم برات میتپه هر روز', 2],
  ['دلم قرصه و آرومم کامل', 1],
  ['قلبم درد میکنه از تنهایی', -2],
  ['خشمم کنترل نشدنیه الان', -2],
  ['واقعا غافلگیر شدم از این خبر', 1],
  ['یاد اون آدما افتادم امروز', -1],
  ['سردرگمم واقعا نمیدونم چیکار کنم', 0],
];

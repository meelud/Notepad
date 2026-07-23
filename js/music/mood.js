import { MODE_ORDER } from './scales.js';

export const EMOTION_LEXICON = {
  joy: { weight: 1.1, tense: 0, words: [
    'happy','joy','joyful','delight','delighted','glad','cheerful','elated','bliss','blissful',
    'wonderful','great','fantastic','amazing','laugh','laughing','smile','smiling','fun','playful',
    'excited','sunny','bright','radiant','vibrant','lively',
    'stoked','pumped','thrilled','buzzing','chuffed','hyped','giddy','tickled','ecstatic',
    'jazzed','psyched','jolly','merry','gleeful','giggling',
    'elated','jubilant','overjoyed','delighted','cheerful','cheery','bubbly','perky','spirited',
    'exuberant','radiating','glowing','beaming','grinning','laughing','chuckling','celebratory',
    'festive','playful','silly','goofy','carefree','lighthearted','blissful','euphoric',
    'شاد','خوشحال','شادمان','خنده','لبخند','سرخوش','بانمک','هیجان','شور','شعف','مسرور','سرزنده',
  ]},
  love: { weight: 1.0, tense: 0, words: [
    'love','loving','adore','affection','sweetheart','darling','cherish','beloved','romance',
    'kiss','embrace','tender','devotion','soulmate','warmth','caring',
    'crush','smitten','infatuated','babe','honey','boo','cuddle','snuggle','flirt','flirting',
    'romantic','valentine','mate','partner',
    'عشق','دلبر','محبوب','دوست‌داشتن','عاشق','نازنین','دلتنگ','مهربان','صمیمی','محبت','دلداده',
  ]},
  calm: { weight: 0.7, tense: -0.3, words: [
    'calm','peace','peaceful','serene','quiet','still','gentle','soft','tranquil','rest','resting',
    'breathe','ease','relax','relaxed','soothing','silence','stillness',
    'chill','chilling','mellow','laid-back','easygoing','unwind','unwinding','relaxing',
    'cozy','comfy','breezy','low-key',
    'آرام','آرامش','سکوت','ساکت','راحت','استراحت','نرم','ملایم','صلح','هدوء','سکون',
  ]},
  hope: { weight: 0.8, tense: -0.1, words: [
    'hope','hopeful','dream','dreaming','future','faith','believe','wish','light','promise',
    'grateful','gratitude','free','freedom','alive','beginning','new','grow','growth',
    'optimistic','upbeat','motivated','ambitious','driven','determined','striving','aspire',
    'امید','امیدوار','رویا','آینده','ایمان','آرزو','نور','شکرگزار','آزاد','زندگی','رشد','شروع',
  ]},
  sadness: { weight: -1.0, tense: 0.1, words: [
    'sad','sadness','sorrow','grief','grieving','cry','crying','tears','weep','heartbroken',
    'lonely','alone','loneliness','empty','emptiness','hollow','loss','lost','miss','missing',
    'hurt','hurting','broken','depressed','down','blue','gloom','gloomy','melancholy','heavy',
    'غم','غمگین','اندوه','گریه','اشک','تنها','تنهایی','خالی','شکست','شکسته','از دست دادن',
    'دلتنگی','درد','افسرده','سنگین','ملال','اندوهگین',
  ]},
  fear: { weight: -0.9, tense: 0.5, words: [
    'fear','afraid','scared','terrified','terror','dread','anxious','anxiety','worry','worried',
    'nervous','panic','threat','danger','unsafe','trembling','frightened','horror','nightmare',
    'ترس','ترسیده','وحشت','نگران','نگرانی','اضطراب','استرس','خطر','کابوس','لرزان','هراس',
  ]},
  anger: { weight: -0.7, tense: 1.0, words: [
    'anger','angry','furious','fury','rage','enraged','mad','hate','hatred','resent','resentment',
    'bitter','bitterness','outrage','irritated','frustrated','frustration','scream','screaming',
    'fuck','fucking','fucked','shit','shitty','damn','dammit','hell','ass','asshole','bitch',
    'خشم','عصبانی','غضب','نفرت','کینه','خشمگین','عصبانیت','جنگ','هرج و مرج','وحشی','انفجار',
  ]},
  dark: { weight: -0.8, tense: 0.4, words: [
    'dark','darkness','cold','coldness','death','dying','dead','despair','desperate','hopeless',
    'void','abyss','shadow','shadows','bleak','doom','suffering','pain','painful','wound','wounded',
    'تاریک','تاریکی','سرد','سرما','مرگ','مردن','ناامید','نومیدی','رنج','درد','زخم','سایه','تباهی',
  ]},
  nostalgia: { weight: -0.2, tense: -0.1, words: [
    'remember','memory','memories','past','once','childhood','old','faded','distant',
    'longing','yearning','bittersweet','farewell','goodbye','gone','fading','nostalgia','nostalgic',
    'یاد','خاطره','خاطرات','گذشته','کودکی','دلتنگی','خداحافظ','رفته','محو','دور',
  ]},
  vice: { weight: -0.3, tense: 0.2, words: [
    'smoke','smoking','cigarette','cigarettes','cigs','vape','vaping','drunk','wasted','booze',
    'beer','alcohol','hangover','buzzed','stoned','high','weed','joint','shots','bar','pub',
    'party','hungover',
  ]},
  casual: { weight: 0, tense: 0, words: [
    'dude','bro','man','guy','buddy','pal','mate','yo','hey','sup','nah','yeah','yep','nope',
    'okay','fine','sure','cool','awesome','whatever','literally','basically','honestly',
    'omg','lol','lmao','tbh','imo','fr','no cap','low key','high key','deadass','bet',
  ]},
  confusion: { weight: 0, tense: 0.3, words: [
    'confused','confusing','puzzled','puzzling','bewildered','baffled','perplexed','lost',
    'unclear','ambiguous','ambivalent','torn','undecided','second guessing',
  ]},
  surprise: { weight: 0.4, tense: 0.5, words: [
    'surprised','shocked','stunned','astonished','amazed','astounded','taken aback',
    'wow','whoa','holy cow','oh my god','unbelievable','mind blown',
    'jaw dropped','speechless','flabbergasted','gobsmacked','blindsided','unexpected',
  ]},
};

const WORD_LOOKUP = (() => {
  const map = {};
  Object.values(EMOTION_LEXICON).forEach(({ weight, tense, words }) => {
    words.forEach(w => { map[w] = { weight, tense }; });
  });
  return map;
})();

export function detectMood(text) {
  const lower = text.toLowerCase();
  const words = lower.match(/[a-zA-Zا-ی]+/g) || [];
  let score = 0, tense = 0;

  words.forEach(w => {
    const hit = WORD_LOOKUP[w];
    if (hit) { score += hit.weight; tense += hit.tense; }
  });

  const exclaim  = (text.match(/!/g) || []).length;
  const question = (text.match(/\?/g) || []).length;
  const ellipsis = (text.match(/\.\.\./g) || []).length;
  score += exclaim * 0.4;
  score -= question * 0.25;
  score -= ellipsis * 0.3;
  tense += exclaim * 0.5;

  const norm = score / Math.max(3, Math.sqrt(words.length));
  const tenseNorm = tense / Math.max(3, Math.sqrt(words.length));

  const clamped = Math.max(-1.5, Math.min(1.5, norm));
  let idx = Math.round(((clamped + 1.5) / 3.0) * (MODE_ORDER.length - 1));

  if (tenseNorm > 0.5 && idx > 3) idx = Math.max(1, idx - 4);
  idx = Math.max(0, Math.min(MODE_ORDER.length - 1, idx));

  return { mode: MODE_ORDER[idx], normScore: norm, tenseScore: tenseNorm };
}

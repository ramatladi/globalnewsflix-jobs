// Horoscopes, astrology, tarot, lottery draws and daily puzzle answers are service
// content, not news. They are dropped before writing and never shown as Good News.
// Patterns cover en, es, fr, de, pt, it, nl and tr headlines; matching is on the title.

const STEMS = [
  // Horoscopes and astrology (stems also match plurals: horoscopes, horóscopos, oroscopi, Horoskope, horoscopen).
  'horoscop', 'horóscop', 'oroscop', 'horoskop', 'horoscoop', 'astrolog', 'astrólog', 'astroloji',
  'tarot', 'tarô', 'tarocchi', 'numerolog',
  'zodiac sign', 'signo del zodiaco', 'signo del zodíaco', 'signos del zodiaco', 'signos del zodíaco',
  'signe du zodiaque', 'signes du zodiaque', 'signe astrologique', 'signes astrologiques',
  'signo do zodíaco', 'signos do zodíaco', 'signo do zodiaco', 'signos do zodiaco',
  'segno zodiacale', 'segni zodiacali', 'sternzeichen', 'sterrenbeeld',
  'burç yorum', 'burçlar', 'günlük burç', 'haftalık burç', 'aylık burç',
  // Lottery draws and results.
  'lottery result', 'lotto result', 'lottery numbers', 'lotto numbers', 'winning numbers', 'powerball result', 'powerball numbers',
  'mega millions result', 'mega millions numbers', 'euromillions result', 'euromillions numbers',
  'resultados de la lotería', 'resultados de la loteria', 'resultados del loto', 'números ganadores', 'numeros ganadores',
  'résultats du loto', 'resultat du loto', 'résultat du loto', 'tirage du loto', 'numéros gagnants',
  'lottozahlen', 'lotto-zahlen', 'gewinnzahlen', 'eurojackpot-zahlen', 'eurojackpot zahlen',
  'resultado da mega-sena', 'resultado da mega sena', 'resultado da lotofácil', 'resultado da quina', 'resultado do euromilhões', 'números sorteados',
  'estrazione del lotto', 'estrazioni del lotto', 'estrazione superenalotto', 'numeri vincenti',
  'lotto uitslag', 'uitslag lotto', 'lottouitslag', 'winnende nummers', 'winnende getallen',
  'loto sonuçları', 'milli piyango sonuçları', 'şans topu sonuçları', 'çılgın sayısal loto',
  // Daily puzzle answers.
  'wordle answer', 'wordle hint', 'wordle today', 'connections hints', 'connections answer', 'strands hints', 'quordle',
];

// Punctuation becomes a space so each stem must begin a word (' superstar signs' never matches).
const fold = s => ' ' + String(s || '').normalize('NFC').toLocaleLowerCase('en').replace(/[‐-―]/g, '-').replace(/[^\p{L}\p{N}-]+/gu, ' ').trim();
const NORMALIZED = STEMS.map(s => fold(s));

// Returns a short reason when a headline is service content rather than news, else ''.
export function nonNewsReason(title) {
  const t = fold(title);
  if (t === ' ') return '';
  const hit = NORMALIZED.find(s => t.includes(s));
  return hit ? `non-news title (${hit.trim()})` : '';
}
export const isNonNews = title => nonNewsReason(title) !== '';

// SQL guard for an articles query. SQLite's lower() folds ASCII only; accented stems are
// lowercase already and headlines capitalize at most the first letter. Common punctuation
// becomes a space so the stem must start a word, as in the JavaScript check.
const PUNCT = [':', '(', ')', '"', "'", '«', '»', '“', '”', '‘', '’', '|', ',', '.', ';', '!', '?', '/'];
const SQL_STEMS = JSON.stringify([...new Set(NORMALIZED)]).replace(/'/g, "''");
export const NON_NEWS_SQL = (column = 'title') => {
  const text = PUNCT.reduce((expr, p) => `replace(${expr},'${p.replace(/'/g, "''")}',' ')`, `' ' || lower(COALESCE(${column},''))`);
  return `NOT EXISTS (SELECT 1 FROM json_each('${SQL_STEMS}') stem WHERE instr(${text}, stem.value) > 0)`;
};

// Good News on pages built from an already loaded list (same rule as the database query).
export const isGoodNews = a => !!a && typeof a.sentiment === 'number' && a.sentiment >= 0.5 && !isNonNews(a.title);

// The language a short text (a tender's title, an offer's title) is written in, from its script, its letters and its
// common words, for listing each edition in its own language (owner, 23 Oct 2026). Short titles often carry no
// evidence: the answer is then '' (unknown), never a guess. Shared by the public collectors and the site.

// Scripts that name their language outright (Han without kana is Chinese; Cyrillic needs the letters below).
const SCRIPTS = [
  [/[가-힯ᄀ-ᇿ]/g, 'ko'], [/[぀-ヿ]/g, 'ja'], [/[฀-๿]/g, 'th'], [/[֐-׿]/g, 'he'],
  [/[Ͱ-Ͽ]/g, 'el'], [/[ऀ-ॿ]/g, 'hi'], [/[ঀ-৿]/g, 'bn'], [/[一-鿿]/g, 'zh'],
];
const ARABIC = /[؀-ۿ]/g, PERSIAN = /[پچژگکی]/, CYRILLIC = /[Ѐ-ӿ]/g;
const LATIN = /[a-zÀ-ɏ]/gi;

// Letters that belong to few languages, with the weight each occurrence adds.
const LETTERS = [
  [/ß/g, { de: 3 }], [/ñ/g, { es: 3 }], [/[ãõ]/g, { pt: 2, et: 0.5 }], [/ł/g, { pl: 3 }], [/[ąęśżźćń]/g, { pl: 2, lt: 0.5 }],
  [/[őű]/g, { hu: 3 }], [/[řůě]/g, { cs: 3 }], [/[ľĺŕ]/g, { sk: 3 }], [/ô/g, { sk: 1, fr: 1, pt: 0.5 }], [/[șțş]/g, { ro: 2, tr: 1 }],
  [/ă/g, { ro: 2, vi: 1 }], [/î/g, { ro: 1, fr: 0.5 }], [/đ/g, { hr: 2, vi: 1 }], [/[ćč]/g, { hr: 1, cs: 0.7, sk: 0.7, sl: 1, lv: 0.5, lt: 0.5 }],
  [/[ħġ]/g, { mt: 3 }], [/[ığ]/g, { tr: 3 }], [/[āēīūļņķģ]/g, { lv: 2 }], [/[ėįų]/g, { lt: 3 }], [/[æø]/g, { da: 1.5, no: 1.5 }],
  [/å/g, { sv: 1, da: 0.8, no: 0.8 }], [/œ/g, { fr: 3 }], [/ç/g, { fr: 1, pt: 1, tr: 0.7 }], [/[èêë]/g, { fr: 1.5, it: 0.3, nl: 0.3 }],
  [/[ìòù]/g, { it: 1.5 }], [/à/g, { fr: 0.8, it: 0.8, pt: 0.4 }], [/[äö]/g, { de: 0.8, sv: 0.8, fi: 1, et: 0.6, sk: 0.2, hu: 0.4 }],
  [/ü/g, { de: 1, tr: 0.8, hu: 0.6, et: 0.5 }], [/[ơư]/g, { vi: 3 }], [/[ạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/g, { vi: 3 }],
  [/ý/g, { cs: 0.8, sk: 0.8 }], [/[áíóú]/g, { es: 0.4, pt: 0.4, cs: 0.3, sk: 0.3, hu: 0.4, it: 0.1 }], [/é/g, { fr: 0.6, es: 0.2, hu: 0.3, cs: 0.2, pt: 0.2 }],
  [/[šž]/g, { cs: 0.5, sk: 0.5, sl: 0.8, hr: 0.8, lv: 0.4, lt: 0.4, et: 0.2 }],
];

// Common words of each language (function words weigh more than procurement and job vocabulary). Words that several
// languages share ("de", "en", "in", "service", "national") are left out or weigh little.
const W = (weight, words) => words.split(' ').map(w => [w, weight]);
const WORDS = {
  en: [...W(2, 'the of and for to with on at by from'), ...W(1, 'supply supplies works provision delivery purchase procurement agreement maintenance construction equipment support cleaning repair school road building buildings university hospital request proposals quotation quotations tender tenders renewal upgrade installation hire rental training assessment study intern internship internships engineer engineering analyst developer graduate graduates apprentice apprenticeship apprenticeships students summer associate specialist scholarship scholarships bursary bursaries grants fellowship funding research water health security office care food energy vehicles vehicle goods various expression interest invitation bid bids works services consultancy consulting framework programme provision'), ...W(0.5, 'manager program student services officer'), ...W(1.5, 'internship internships apprenticeship apprenticeships scholarship scholarships bursary bursaries fellowship fellowships graduates'),
    ...W(1, 'vacancy vacancies position senior junior lead head team customer driver nurse teacher accountant clerk technician cashier coordinator supervisor executive receptionist cleaner security guard warehouse')],
  de: [...W(2, 'der die das und für von zur zum mit des im auf bei den dem ein eine einer über nach sowie oder vom am zu'), ...W(1.5, 'lieferung leistungen dienstleistungen beschaffung rahmenvertrag rahmenvereinbarung ausschreibung vergabe bauleistungen neubau sanierung wartung umbau erweiterung praktikum praktikant praktikantin werkstudent werkstudentin ausbildung duales studium abschlussarbeit stipendium mitarbeiter mitarbeiterin auszubildende abschlussarbeiten')],
  fr: [...W(2, 'le la les des du et pour au aux sur dans une avec par'), ...W(0.5, 'de en un'), ...W(1.5, 'fourniture fournitures travaux prestations prestation marché marchés accord-cadre entretien réalisation location nettoyage stage stagiaire alternance alternant alternante apprenti apprentie bourse bourses appel offres avis acquisition')],
  es: [...W(2, 'el los las y para del con por una al'), ...W(0.5, 'de en un'), ...W(1.5, 'suministro servicio servicios obras contratación adquisición mantenimiento prácticas becario becaria practicante convocatoria beca becas licitación')],
  pt: [...W(2, 'os da do dos das com em na uma'), ...W(0.5, 'e para o'), ...W(1.5, 'fornecimento aquisição prestação serviços obras manutenção contratação estágio estagiário estagiária jovem aprendiz bolsa bolsas edital')],
  it: [...W(2, 'il lo gli della delle dei degli di per nel nella alla'), ...W(0.5, 'e con una un al'), ...W(1.5, 'fornitura servizi servizio lavori affidamento manutenzione procedura gara appalto tirocinio stagista borsa borse bando')],
  nl: [...W(2, 'het van voor met een op aan te bij naar uit'), ...W(0.5, 'de en'), ...W(1.5, 'levering diensten dienstverlening werkzaamheden aanbesteding raamovereenkomst onderhoud stagiair afstuderen afstudeerstage')],
  pl: [...W(2, 'oraz dla przez się'), ...W(0.5, 'i w na do z od'), ...W(1.5, 'dostawa dostawy usługi usługa roboty budowlane zamówienie przetarg świadczenie staż praktyki stażysta praktykant')],
  sv: [...W(2, 'och för av till med på ett som vid'), ...W(1.5, 'upphandling ramavtal leverans tjänster entreprenad sommarjobb examensarbete')],
  da: [...W(2, 'og af til med på et som ved'), ...W(1.5, 'udbud levering rammeaftale tjenesteydelser praktik studentermedhjælper')],
  no: [...W(2, 'og av til med på et som ved'), ...W(1.5, 'anskaffelse rammeavtale levering tjenester konkurranse praksis sommerjobb')],
  fi: [...W(2, 'ja sekä tai'), ...W(1.5, 'hankinta hankinnat palvelut palveluiden toimitus puitejärjestely urakka kunnossapito harjoittelija harjoittelu kesätyö')],
  cs: [...W(1, 'pro se'), ...W(1.5, 'dodávka dodávky služby stavební práce veřejná zakázka rámcová dohoda stáž')],
  sk: [...W(1, 'pre so'), ...W(1.5, 'dodávka služby stavebné práce zákazka rámcová dohoda stáž')],
  hu: [...W(2, 'és az egy valamint részére'), ...W(1.5, 'beszerzés szállítás szolgáltatás kivitelezés karbantartás keretmegállapodás gyakornok gyakornoki')],
  ro: [...W(2, 'și pentru în din privind'), ...W(1.5, 'furnizare servicii lucrări achiziție achiziția întreținere acord-cadru stagiu stagiar')],
  hr: [...W(0.5, 'za od sa'), ...W(1.5, 'nabava isporuka usluge radovi održavanje okvirni sporazum pripravnik')],
  sl: [...W(0.5, 'za in'), ...W(1.5, 'dobava storitve izvedba gradbena dela vzdrževanje naročilo pripravnik')],
  et: [...W(2, 'ja ning või'), ...W(1.5, 'hange hanke ostmine teenus teenused ehitustööd raamleping hooldus')],
  lv: [...W(2, 'un par ar uz'), ...W(1.5, 'iepirkums piegāde pakalpojumi būvdarbi apkope līgums prakse')],
  lt: [...W(2, 'ir bei dėl su'), ...W(1.5, 'pirkimas tiekimas paslaugos darbai priežiūra sutartis praktika')],
  tr: [...W(2, 've için ile bir'), ...W(1.5, 'alımı hizmeti hizmet yapım ihale stajyer staj')],
  mt: [...W(2, "u ta għal"), ...W(1.5, 'provvista servizzi xogħlijiet')],
  id: [...W(2, 'dan untuk yang dengan'), ...W(1.5, 'pengadaan magang lowongan')],
};
const LEXICON = new Map();
for (const [lang, list] of Object.entries(WORDS)) for (const [w, n] of list) {
  const at = LEXICON.get(w) || [], have = at.find(x => x[0] === lang);
  if (have) have[1] = Math.max(have[1], n); else at.push([lang, n]);
  LEXICON.set(w, at);
}
// Job-title gender markers: "(m/w/d)" German, "(h/f)" French, "(m/v/x)" Dutch, "(m/k)" Polish...
const MARKERS = [[/\b[mwfd]\s*\/\s*[mwfd]\s*\/\s*[mwfd]\b/i, 'de'], [/\b[hf]\s*\/\s*[hf]\b/i, 'fr'], [/\b[mv]\s*\/\s*[vm]\s*\/\s*x\b/i, 'nl'], [/\bk\s*\/\s*m\b|\bm\s*\/\s*k\b/i, 'pl']];

export function guessLang(text, { hint = '' } = {}) {
  const s = String(text || '').normalize('NFC');
  const letters = (s.match(/\p{L}/gu) || []).length;
  if (!letters) return '';
  for (const [re, lang] of SCRIPTS) { const n = (s.match(re) || []).length; if (n && n * 3 >= letters) return lang === 'zh' && /[぀-ヿ]/.test(s) ? 'ja' : lang; }
  const ar = (s.match(ARABIC) || []).length;
  if (ar && ar * 3 >= letters) return PERSIAN.test(s) ? 'fa' : 'ar';
  const cy = (s.match(CYRILLIC) || []).length;
  if (cy && cy * 3 >= letters) {
    if (/[іїєґ]/i.test(s)) return 'uk';
    if (/[ђјљњћџ]/i.test(s)) return 'sr';
    return ['ru', 'uk', 'bg', 'sr', 'mk', 'kk'].includes(hint) ? hint : 'ru';
  }
  if ((s.match(LATIN) || []).length * 2 < letters) return '';
  const low = s.toLowerCase(), score = {};
  const add = (lang, n) => { score[lang] = (score[lang] || 0) + n; };
  for (const [re, lang] of MARKERS) if (re.test(low)) add(lang, 4);
  for (const [re, weights] of LETTERS) { const n = Math.min(3, (low.match(re) || []).length); if (n) for (const [lang, w] of Object.entries(weights)) add(lang, n * w); }
  // Abbreviations in an otherwise ordinary title ("ZA", "IT") are not words of any language.
  const mixed = /\p{Ll}/u.test(s);
  for (const raw of s.split(/[^\p{L}'-]+/u)) {
    if (!raw || (mixed && raw.length <= 4 && raw === raw.toUpperCase())) continue;
    const word = raw.toLowerCase();
    for (const [lang, w] of LEXICON.get(word) || LEXICON.get(word.replace(/^[ld]'/, '')) || []) add(lang, w);
  }
  const ranked = Object.entries(score).sort((a, b) => b[1] - a[1]);
  if (!ranked.length || ranked[0][1] < 1.5) return '';
  const [best, second] = ranked;
  if (second && best[1] - second[1] < 0.75) return hint && (hint === best[0] || hint === second[0]) ? hint : '';
  return best[0];
}

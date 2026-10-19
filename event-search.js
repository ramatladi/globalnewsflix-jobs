// Coming Up: searches for scheduled events in each edition's own language (elections and referendums, votes, budget
// speeches, court rulings and hearings, strikes and protests, festivals and concerts, summits and state visits,
// launches and openings, finals and tournaments, exams). One search on every collector visit, next to the country's
// name, in turn through three groups of events. The writer decides what (if anything) is scheduled, and the event's
// date is kept only when the sources state it (ai.js groundEvent).

export const EVENT_GROUPS = Object.freeze(['civic', 'street', 'calendar']);

// civic: elections, votes, budgets and courts; street: strikes, protests, festivals and concerts; calendar: summits,
// visits, launches, openings, finals, tournaments and exams. when: words saying it is still ahead.
const E = {
  en: { civic: ['election', 'referendum', 'parliament vote', 'budget speech', 'court ruling', 'verdict', 'hearing'], street: ['strike', 'protest', 'march', 'festival', 'concert'],
    calendar: ['summit', 'state visit', 'launch', 'final', 'tournament', 'exams'], when: ['next week', 'will be held', 'scheduled for', 'set to', 'is due to', 'upcoming'] },
  fr: { civic: ['élection', 'élections', 'référendum', 'vote', 'budget', 'verdict', 'procès', 'audience'], street: ['grève', 'manifestation', 'mobilisation', 'festival', 'concert'],
    calendar: ['sommet', 'visite officielle', 'lancement', 'inauguration', 'finale', 'tournoi', 'examens'], when: ['la semaine prochaine', 'aura lieu', 'se tiendra', 'prévu le', 'prévue le', 'à venir'] },
  es: { civic: ['elecciones', 'referéndum', 'votación', 'presupuesto', 'sentencia', 'juicio', 'audiencia'], street: ['huelga', 'paro', 'marcha', 'protesta', 'festival', 'concierto'],
    calendar: ['cumbre', 'visita oficial', 'lanzamiento', 'inauguración', 'final', 'torneo', 'exámenes'], when: ['la próxima semana', 'se realizará', 'se llevará a cabo', 'está previsto', 'programado para'] },
  pt: { civic: ['eleições', 'referendo', 'votação', 'orçamento', 'julgamento', 'sentença', 'audiência'], street: ['greve', 'paralisação', 'manifestação', 'protesto', 'festival', 'concerto'],
    calendar: ['cimeira', 'cúpula', 'visita oficial', 'lançamento', 'inauguração', 'final', 'torneio', 'exames'], when: ['próxima semana', 'vai realizar-se', 'será realizada', 'está marcado', 'está marcada', 'agendado para'] },
  de: { civic: ['Wahl', 'Volksabstimmung', 'Abstimmung', 'Haushalt', 'Urteil', 'Prozess', 'Anhörung'], street: ['Streik', 'Warnstreik', 'Demonstration', 'Protest', 'Festival', 'Konzert'],
    calendar: ['Gipfel', 'Staatsbesuch', 'Eröffnung', 'Finale', 'Turnier', 'Prüfungen'], when: ['nächste Woche', 'findet statt', 'geplant', 'soll am', 'am kommenden'] },
  it: { civic: ['elezioni', 'referendum', 'voto', 'manovra', 'sentenza', 'processo', 'udienza'], street: ['sciopero', 'manifestazione', 'corteo', 'protesta', 'festival', 'concerto'],
    calendar: ['vertice', 'visita ufficiale', 'lancio', 'inaugurazione', 'finale', 'torneo', 'esami'], when: ['la prossima settimana', 'si terrà', 'in programma', 'previsto per', 'prevista per'] },
  nl: { civic: ['verkiezingen', 'referendum', 'stemming', 'begroting', 'uitspraak', 'rechtszaak', 'zitting'], street: ['staking', 'demonstratie', 'protest', 'festival', 'concert'],
    calendar: ['topontmoeting', 'staatsbezoek', 'lancering', 'opening', 'finale', 'toernooi', 'examens'], when: ['volgende week', 'vindt plaats', 'staat gepland', 'gepland op', 'aanstaande'] },
  ru: { civic: ['выборы', 'референдум', 'голосование', 'бюджет', 'приговор', 'суд', 'заседание'], street: ['забастовка', 'протест', 'митинг', 'фестиваль', 'концерт'],
    calendar: ['саммит', 'визит', 'запуск', 'открытие', 'финал', 'турнир', 'экзамены'], when: ['на следующей неделе', 'состоится', 'пройдет', 'запланирован', 'намечен'] },
  uk: { civic: ['вибори', 'референдум', 'голосування', 'бюджет', 'вирок', 'суд', 'засідання'], street: ['страйк', 'протест', 'мітинг', 'фестиваль', 'концерт'],
    calendar: ['саміт', 'візит', 'запуск', 'відкриття', 'фінал', 'турнір', 'НМТ'], when: ['наступного тижня', 'відбудеться', 'пройде', 'заплановано', 'запланований'] },
  ar: { civic: ['الانتخابات', 'استفتاء', 'التصويت', 'الموازنة', 'الحكم', 'المحاكمة', 'جلسة'], street: ['إضراب', 'احتجاج', 'مظاهرة', 'مهرجان', 'حفل'],
    calendar: ['قمة', 'زيارة رسمية', 'إطلاق', 'افتتاح', 'نهائي', 'بطولة', 'الامتحانات'], when: ['الأسبوع المقبل', 'من المقرر', 'ستقام', 'ستعقد', 'يعقد'] },
  fa: { civic: ['انتخابات', 'همه‌پرسی', 'رأی‌گیری', 'بودجه', 'حکم', 'دادگاه', 'جلسه'], street: ['اعتصاب', 'اعتراض', 'تجمع', 'جشنواره', 'کنسرت'],
    calendar: ['اجلاس', 'سفر', 'رونمایی', 'افتتاح', 'فینال', 'مسابقات', 'کنکور'], when: ['هفته آینده', 'برگزار می‌شود', 'برگزار خواهد شد', 'قرار است'] },
  he: { civic: ['בחירות', 'משאל עם', 'הצבעה', 'תקציב', 'גזר דין', 'משפט', 'דיון'], street: ['שביתה', 'הפגנה', 'מחאה', 'פסטיבל', 'הופעה'],
    calendar: ['פסגה', 'ביקור', 'השקה', 'פתיחה', 'גמר', 'טורניר', 'בגרות'], when: ['בשבוע הבא', 'ייערך', 'תתקיים', 'יתקיים', 'צפוי'] },
  zh: { civic: ['选举', '選舉', '公投', '投票', '预算', '預算', '判决', '判決', '庭审'], street: ['罢工', '罷工', '抗议', '抗議', '游行', '遊行', '音乐节', '演唱会', '演唱會'],
    calendar: ['峰会', '峰會', '访问', '訪問', '开幕', '開幕', '决赛', '決賽', '考试', '考試'], when: ['下周', '下週', '将于', '將於', '举行', '舉行'] },
  ja: { civic: ['選挙', '住民投票', '採決', '予算案', '判決', '公判', '審理'], street: ['ストライキ', 'デモ', '抗議', 'フェスティバル', '祭り', 'コンサート'],
    calendar: ['首脳会談', 'サミット', '訪問', '発売', '開業', '決勝', '大会', '試験'], when: ['来週', '予定', '開催', '行われる'] },
  ko: { civic: ['선거', '국민투표', '표결', '예산안', '선고', '재판', '공판'], street: ['파업', '시위', '집회', '축제', '콘서트'],
    calendar: ['정상회담', '방문', '출시', '개막', '결승', '대회', '시험'], when: ['다음 주', '예정', '열린다', '개최'] },
  tr: { civic: ['seçim', 'referandum', 'oylama', 'bütçe', 'karar', 'dava', 'duruşma'], street: ['grev', 'eylem', 'protesto', 'miting', 'festival', 'konser'],
    calendar: ['zirve', 'resmi ziyaret', 'lansman', 'açılış', 'final', 'turnuva', 'sınav'], when: ['gelecek hafta', 'yapılacak', 'düzenlenecek', 'gerçekleştirilecek'] },
  pl: { civic: ['wybory', 'referendum', 'głosowanie', 'budżet', 'wyrok', 'proces', 'rozprawa'], street: ['strajk', 'protest', 'manifestacja', 'festiwal', 'koncert'],
    calendar: ['szczyt', 'wizyta', 'premiera', 'otwarcie', 'finał', 'turniej', 'egzamin'], when: ['w przyszłym tygodniu', 'odbędzie się', 'zaplanowano', 'zaplanowany'] },
  cs: { civic: ['volby', 'referendum', 'hlasování', 'rozpočet', 'rozsudek', 'soud', 'líčení'], street: ['stávka', 'protest', 'demonstrace', 'festival', 'koncert'],
    calendar: ['summit', 'návštěva', 'spuštění', 'otevření', 'finále', 'turnaj', 'zkoušky'], when: ['příští týden', 'se uskuteční', 'proběhne', 'naplánován'] },
  sk: { civic: ['voľby', 'referendum', 'hlasovanie', 'rozpočet', 'rozsudok', 'súd', 'pojednávanie'], street: ['štrajk', 'protest', 'demonštrácia', 'festival', 'koncert'],
    calendar: ['summit', 'návšteva', 'spustenie', 'otvorenie', 'finále', 'turnaj', 'skúšky'], when: ['budúci týždeň', 'sa uskutoční', 'sa bude konať', 'naplánovaný'] },
  sl: { civic: ['volitve', 'referendum', 'glasovanje', 'proračun', 'sodba', 'sojenje', 'obravnava'], street: ['stavka', 'protest', 'shod', 'festival', 'koncert'],
    calendar: ['vrh', 'obisk', 'predstavitev', 'odprtje', 'finale', 'turnir', 'izpiti'], when: ['prihodnji teden', 'bo potekal', 'bo potekala', 'načrtovan'] },
  hr: { civic: ['izbori', 'referendum', 'glasovanje', 'proračun', 'presuda', 'suđenje', 'ročište'], street: ['štrajk', 'prosvjed', 'festival', 'koncert'],
    calendar: ['summit', 'posjet', 'predstavljanje', 'otvorenje', 'finale', 'turnir', 'ispiti'], when: ['sljedeći tjedan', 'održat će se', 'zakazan', 'zakazano'] },
  sr: { civic: ['избори', 'izbori', 'референдум', 'гласање', 'glasanje', 'буџет', 'пресуда', 'presuda'], street: ['штрајк', 'štrajk', 'протест', 'protest', 'фестивал', 'festival', 'концерт', 'koncert'],
    calendar: ['самит', 'samit', 'посета', 'poseta', 'отварање', 'otvaranje', 'финале', 'finale', 'турнир', 'turnir'], when: ['следеће недеље', 'sledeće nedelje', 'биће одржан', 'biće održan', 'заказан', 'zakazan'] },
  bg: { civic: ['избори', 'референдум', 'гласуване', 'бюджет', 'присъда', 'дело', 'заседание'], street: ['стачка', 'протест', 'шествие', 'фестивал', 'концерт'],
    calendar: ['среща на върха', 'посещение', 'откриване', 'финал', 'турнир', 'изпити'], when: ['следващата седмица', 'ще се проведе', 'ще се състои', 'насрочен', 'насрочено'] },
  ro: { civic: ['alegeri', 'referendum', 'vot', 'buget', 'sentință', 'proces', 'audiere'], street: ['grevă', 'protest', 'miting', 'festival', 'concert'],
    calendar: ['summit', 'vizită oficială', 'lansare', 'inaugurare', 'finală', 'turneu', 'examene'], when: ['săptămâna viitoare', 'va avea loc', 'programat', 'programată'] },
  hu: { civic: ['választás', 'népszavazás', 'szavazás', 'költségvetés', 'ítélet', 'tárgyalás'], street: ['sztrájk', 'tüntetés', 'tiltakozás', 'fesztivál', 'koncert'],
    calendar: ['csúcstalálkozó', 'látogatás', 'bemutató', 'megnyitó', 'döntő', 'torna', 'vizsga'], when: ['jövő héten', 'kerül sor', 'rendezik', 'tartják'] },
  el: { civic: ['εκλογές', 'δημοψήφισμα', 'ψηφοφορία', 'προϋπολογισμός', 'απόφαση', 'δίκη'], street: ['απεργία', 'διαμαρτυρία', 'συλλαλητήριο', 'φεστιβάλ', 'συναυλία'],
    calendar: ['σύνοδος κορυφής', 'επίσκεψη', 'εγκαίνια', 'πρεμιέρα', 'τελικός', 'τουρνουά', 'εξετάσεις'], when: ['την επόμενη εβδομάδα', 'θα πραγματοποιηθεί', 'θα διεξαχθεί', 'προγραμματίζεται'] },
  lt: { civic: ['rinkimai', 'referendumas', 'balsavimas', 'biudžetas', 'nuosprendis', 'teismas', 'posėdis'], street: ['streikas', 'protestas', 'mitingas', 'festivalis', 'koncertas'],
    calendar: ['viršūnių susitikimas', 'vizitas', 'pristatymas', 'atidarymas', 'finalas', 'turnyras', 'egzaminai'], when: ['kitą savaitę', 'vyks', 'numatytas', 'numatyta'] },
  lv: { civic: ['vēlēšanas', 'referendums', 'balsojums', 'budžets', 'spriedums', 'tiesa', 'sēde'], street: ['streiks', 'protests', 'pikets', 'festivāls', 'koncerts'],
    calendar: ['samits', 'vizīte', 'atklāšana', 'fināls', 'turnīrs', 'eksāmeni'], when: ['nākamnedēļ', 'notiks', 'paredzēts', 'plānots'] },
  et: { civic: ['valimised', 'rahvahääletus', 'hääletus', 'eelarve', 'kohtuotsus', 'kohtuistung'], street: ['streik', 'meeleavaldus', 'protest', 'festival', 'kontsert'],
    calendar: ['tippkohtumine', 'visiit', 'avamine', 'esitlus', 'finaal', 'turniir', 'eksamid'], when: ['järgmisel nädalal', 'toimub', 'on plaanitud', 'peetakse'] },
  fi: { civic: ['vaalit', 'kansanäänestys', 'äänestys', 'budjetti', 'tuomio', 'oikeudenkäynti', 'käsittely'], street: ['lakko', 'mielenosoitus', 'protesti', 'festivaali', 'konsertti'],
    calendar: ['huippukokous', 'vierailu', 'julkistus', 'avajaiset', 'finaali', 'turnaus', 'kokeet'], when: ['ensi viikolla', 'järjestetään', 'pidetään', 'on määrä'] },
  sv: { civic: ['riksdagsval', 'folkomröstning', 'omröstning', 'budget', 'dom', 'rättegång', 'förhandling'], street: ['strejk', 'demonstration', 'protest', 'festival', 'konsert'],
    calendar: ['toppmöte', 'statsbesök', 'lansering', 'invigning', 'final', 'turnering', 'prov'], when: ['nästa vecka', 'äger rum', 'hålls', 'planeras'] },
  no: { civic: ['valg', 'folkeavstemning', 'avstemning', 'statsbudsjett', 'dom', 'rettssak', 'høring'], street: ['streik', 'demonstrasjon', 'protest', 'festival', 'konsert'],
    calendar: ['toppmøte', 'statsbesøk', 'lansering', 'åpning', 'finale', 'turnering', 'eksamen'], when: ['neste uke', 'arrangeres', 'finner sted', 'planlagt'] },
  da: { civic: ['valg', 'folkeafstemning', 'afstemning', 'finanslov', 'dom', 'retssag', 'høring'], street: ['strejke', 'demonstration', 'protest', 'festival', 'koncert'],
    calendar: ['topmøde', 'statsbesøg', 'lancering', 'åbning', 'finale', 'turnering', 'eksamen'], when: ['næste uge', 'finder sted', 'afholdes', 'planlagt'] },
  id: { civic: ['pemilu', 'pilkada', 'pemungutan suara', 'APBN', 'putusan', 'sidang', 'vonis'], street: ['mogok kerja', 'unjuk rasa', 'demo', 'festival', 'konser'],
    calendar: ['KTT', 'kunjungan kenegaraan', 'peluncuran', 'peresmian', 'final', 'turnamen', 'ujian'], when: ['pekan depan', 'minggu depan', 'akan digelar', 'dijadwalkan', 'akan berlangsung'] },
  ms: { civic: ['pilihan raya', 'PRU', 'undian', 'belanjawan', 'keputusan mahkamah', 'perbicaraan', 'prosiding'], street: ['mogok', 'demonstrasi', 'perhimpunan', 'festival', 'konsert'],
    calendar: ['sidang kemuncak', 'lawatan rasmi', 'pelancaran', 'perasmian', 'final', 'kejohanan', 'peperiksaan'], when: ['minggu depan', 'akan diadakan', 'dijadualkan', 'akan berlangsung'] },
  vi: { civic: ['bầu cử', 'trưng cầu dân ý', 'biểu quyết', 'ngân sách', 'tuyên án', 'xét xử', 'phiên tòa'], street: ['đình công', 'biểu tình', 'lễ hội', 'hòa nhạc'],
    calendar: ['hội nghị thượng đỉnh', 'chuyến thăm', 'ra mắt', 'khai trương', 'chung kết', 'giải đấu', 'kỳ thi'], when: ['tuần tới', 'sẽ diễn ra', 'dự kiến', 'sẽ được tổ chức'] },
  th: { civic: ['เลือกตั้ง', 'ประชามติ', 'ลงมติ', 'งบประมาณ', 'คำพิพากษา', 'พิจารณาคดี'], street: ['นัดหยุดงาน', 'ประท้วง', 'ชุมนุม', 'เทศกาล', 'คอนเสิร์ต'],
    calendar: ['การประชุมสุดยอด', 'เยือน', 'เปิดตัว', 'เปิดให้บริการ', 'รอบชิงชนะเลิศ', 'การแข่งขัน', 'สอบ'], when: ['สัปดาห์หน้า', 'มีกำหนด', 'จะจัดขึ้น', 'เตรียมจัด'] },
  bn: { civic: ['নির্বাচন', 'গণভোট', 'বাজেট', 'রায়', 'বিচার', 'শুনানি'], street: ['ধর্মঘট', 'হরতাল', 'বিক্ষোভ', 'সমাবেশ', 'উৎসব', 'কনসার্ট'],
    calendar: ['শীর্ষ সম্মেলন', 'সফর', 'উদ্বোধন', 'ফাইনাল', 'টুর্নামেন্ট', 'পরীক্ষা'], when: ['আগামী সপ্তাহে', 'অনুষ্ঠিত হবে', 'নির্ধারিত', 'হতে যাচ্ছে'] },
};
export const EVENT_SEARCH_LANGS = Object.freeze(Object.keys(E));
export const eventTerms = (lang, group) => E[lang]?.[group] || [];

const term = w => /[\s'’.,:-]/.test(w) ? `"${w.replace(/"/g, '')}"` : w;
const any = list => `(${list.map(term).join(' OR ')})`;
// The search for one group of events in one language: the country's name, the group's words and (unless short) words
// saying the event is still ahead ('' when the language has no list). Bing gets the short form (see changes.js).
export function eventQuery(lang, group, countryName = '', { short = false } = {}) {
  const e = E[lang];
  if (!e || !EVENT_GROUPS.includes(group)) return '';
  return `${countryName ? `"${String(countryName).replace(/"/g, '')}" ` : ''}${any(e[group])}${short ? '' : ' ' + any(e.when)}`;
}

// Whether a report's title or summary names a scheduled event of any group in the edition's language (accents, case and
// joining marks aside). Alphabetic words match whole words; a word of six letters or more may carry a different ending
// of up to four letters ("elections"), one of four or five letters up to two more ("grèves"). Other scripts match anywhere.
const fold = s => String(s || '').normalize('NFKD').replace(/[\p{M}‌‍]/gu, '').toLowerCase();
const ALPHA = /^[\p{Script=Latin}\p{Script=Cyrillic}\p{Script=Greek}\s'’.-]+$/u;
const MATCHERS = new Map(Object.entries(E).map(([lang, e]) => [lang, [...new Set(EVENT_GROUPS.flatMap(g => e[g]).map(fold))].map(f => {
  if (!ALPHA.test(f)) return { any: f };
  const last = f.split(/\s+/).pop(), esc = (last.length >= 6 ? f.slice(0, -2) : f).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const ending = last.length >= 6 ? '\\p{L}{0,4}' : last.length >= 4 ? '\\p{L}{0,2}' : '';
  return { re: new RegExp(`(?<![\\p{L}\\p{N}])${esc}${ending}(?![\\p{L}\\p{N}])`, 'u') };
})]));
export function namesEvent(lang, text) {
  const m = MATCHERS.get(lang), t = fold(text);
  return !!m && m.some(x => x.any ? t.includes(x.any) : x.re.test(t));
}

// Which group a collector visit searches for, and on which engine: every visit, in turn through the groups, on the
// other engine from the visit's change search (changes.js changeRotation), so each engine gets one Coming Up search.
export function eventRotation(rot, changeGoogle) {
  const r = Math.max(0, Math.floor(Number(rot) || 0));
  return { group: EVENT_GROUPS[r % EVENT_GROUPS.length], google: !changeGoogle };
}

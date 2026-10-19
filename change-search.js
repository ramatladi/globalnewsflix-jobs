// Coming Up change searches: the search terms for announced changes in each edition language, the query and title
// checks built from them, and official-publisher ranking. Pure (no database), so the news collector (news-collect.js)
// can run it on GitHub's network; changes.js re-exports it with the stored change records.
export const CHANGE_TYPES = Object.freeze(['fees', 'tariffs', 'employment', 'education', 'taxes', 'services']);

// A change report published by a government, regulator or other official body ranks above news about it.
export const OFFICIAL_SOURCE_BONUS = 15;

// Official publishers: government domains (gov.za, gouv.fr, gob.mx, go.ke, admin.ch, bund.de, *.gov, gc.ca,
// europa.eu, ...). Used only to rank a report, never to decide what is true.
// Country-code domains only (so news.go.com is not official).
const OFFICIAL_HOST = /(?:^|\.)(?:gov|gouv|gob|govt|go|gv|admin|bund|government|regjeringen|regeringen|rijksoverheid|gouvernement)\.[a-z]{2}$|\.(?:gov|mil|int)$|(?:^|\.)(?:gc\.ca|europa\.eu)$/;
export function isOfficialHost(urlOrHost) {
  let host = String(urlOrHost || '').toLowerCase();
  try { if (/^https?:/.test(host)) host = new URL(host).hostname; } catch { return false; }
  return OFFICIAL_HOST.test(host.replace(/^www\./, ''));
}

// Search terms per edition language: what each kind of change is called, and words that say a change is about
// to start. A search asks for both, next to the country's name. Languages without a list are not searched for
// changes (their change stories still come from ordinary reports).
const T = {
  en: {
    fees: ['fee increase', 'new fees', 'fee hike', 'levy', 'licence fee', 'toll fees'],
    tariffs: ['tariffs', 'import duty', 'customs duty', 'electricity tariff', 'water tariff', 'fare increase'],
    employment: ['minimum wage', 'labour law', 'labor law', 'work permit', 'employment law', 'work visa'],
    education: ['school fees', 'admission requirements', 'curriculum', 'tuition fees', 'university applications', 'exam'],
    taxes: ['tax increase', 'new tax', 'VAT', 'income tax', 'tax changes', 'tax rate'],
    services: ['passport', 'driving licence', "driver's license", 'ID card', 'public transport', 'new service'],
    when: ['takes effect', 'will take effect', 'come into effect', 'comes into force', 'effective from', 'with effect from', 'from next month', 'will rise'],
  },
  fr: {
    fees: ['hausse des frais', 'nouveaux frais', 'redevance', 'péage', 'frais de dossier'],
    tariffs: ['droits de douane', 'tarifs douaniers', "tarif de l'électricité", "prix de l'électricité", 'tarifs'],
    employment: ['salaire minimum', 'SMIC', 'code du travail', 'permis de travail', 'droit du travail'],
    education: ['frais de scolarité', "conditions d'admission", 'programme scolaire', 'baccalauréat', 'rentrée scolaire'],
    taxes: ['impôt', 'TVA', 'nouvelle taxe', 'hausse des impôts', 'loi de finances'],
    services: ['passeport', 'permis de conduire', "carte d'identité", 'service public', 'transports publics'],
    when: ['entrera en vigueur', 'entre en vigueur', 'à compter du', 'à partir du', 'dès le'],
  },
  es: {
    fees: ['tasas', 'nuevas tasas', 'aumento de tarifas', 'peaje', 'cobro'],
    tariffs: ['aranceles', 'tarifas eléctricas', 'tarifa de luz', 'tarifa del agua', 'tarifas de transporte'],
    employment: ['salario mínimo', 'reforma laboral', 'permiso de trabajo', 'ley laboral', 'jornada laboral'],
    education: ['matrícula', 'requisitos de admisión', 'plan de estudios', 'examen de admisión', 'reforma educativa'],
    taxes: ['impuesto', 'IVA', 'nuevo impuesto', 'reforma tributaria', 'reforma fiscal'],
    services: ['pasaporte', 'licencia de conducir', 'cédula de identidad', 'DNI', 'transporte público'],
    when: ['entrará en vigor', 'entra en vigor', 'a partir del', 'desde el', 'regirá'],
  },
  pt: {
    fees: ['taxas', 'novas taxas', 'aumento das taxas', 'portagens', 'pedágio'],
    tariffs: ['tarifas', 'tarifa de energia', 'tarifa de eletricidade', 'tarifas aduaneiras', 'tarifa de água'],
    employment: ['salário mínimo', 'lei laboral', 'legislação trabalhista', 'autorização de trabalho', 'Código do Trabalho'],
    education: ['propinas', 'mensalidades', 'requisitos de admissão', 'vestibular', 'exames nacionais'],
    taxes: ['imposto', 'IVA', 'IRS', 'novo imposto', 'reforma tributária'],
    services: ['passaporte', 'carta de condução', 'carteira de motorista', 'bilhete de identidade', 'transporte público'],
    when: ['entra em vigor', 'entrará em vigor', 'a partir de', 'passa a vigorar', 'a partir do dia'],
  },
  de: {
    fees: ['Gebühren', 'Gebührenerhöhung', 'neue Gebühren', 'Maut', 'Abgabe'],
    tariffs: ['Zölle', 'Strompreise', 'Stromtarif', 'Wassergebühren', 'Ticketpreise'],
    employment: ['Mindestlohn', 'Arbeitsrecht', 'Arbeitserlaubnis', 'Arbeitszeitgesetz', 'Kündigungsschutz'],
    education: ['Studiengebühren', 'Lehrplan', 'Zulassung', 'Abitur', 'Schulreform'],
    taxes: ['Steuer', 'Mehrwertsteuer', 'Steuererhöhung', 'neue Steuer', 'Grundsteuer'],
    services: ['Reisepass', 'Führerschein', 'Personalausweis', 'Bürgerservice', 'Nahverkehr'],
    when: ['tritt in Kraft', 'treten in Kraft', 'ab dem', 'gilt ab', 'ab Januar'],
  },
  it: {
    fees: ['tariffe', 'nuove tasse', 'pedaggi', 'aumento delle tariffe', 'canone'],
    tariffs: ['dazi', 'bollette luce', 'tariffe elettriche', "tariffe dell'acqua", 'biglietti'],
    employment: ['salario minimo', 'riforma del lavoro', 'permesso di lavoro', 'contratto nazionale', 'decreto lavoro'],
    education: ['tasse universitarie', 'requisiti di ammissione', 'maturità', 'riforma della scuola', "test d'ingresso"],
    taxes: ['tasse', 'IVA', 'Irpef', 'nuova tassa', 'legge di bilancio'],
    services: ['passaporto', 'patente', "carta d'identità", 'servizio pubblico', 'trasporto pubblico'],
    when: ['entra in vigore', 'entrerà in vigore', 'a partire dal', 'dal prossimo', 'scatta'],
  },
  nl: {
    fees: ['tarieven', 'leges', 'tolheffing', 'heffing', 'hogere kosten'],
    tariffs: ['importheffingen', 'invoerrechten', 'energietarieven', 'stroomprijs', 'ov-tarieven'],
    employment: ['minimumloon', 'arbeidsrecht', 'werkvergunning', 'arbeidswet', 'werkgevers'],
    education: ['collegegeld', 'schoolgeld', 'toelatingseisen', 'curriculum', 'eindexamen'],
    taxes: ['belasting', 'btw', 'belastingverhoging', 'nieuwe belasting', 'accijns'],
    services: ['paspoort', 'rijbewijs', 'identiteitskaart', 'openbaar vervoer', 'dienstverlening'],
    when: ['gaat in op', 'treedt in werking', 'vanaf 1', 'per 1', 'vanaf volgend jaar'],
  },
  ru: {
    fees: ['пошлина', 'сборы', 'плата за', 'новые тарифы', 'штрафы'],
    tariffs: ['тарифы', 'пошлины', 'тарифы ЖКХ', 'тарифы на электроэнергию', 'импортные пошлины'],
    employment: ['МРОТ', 'минимальная зарплата', 'трудовой кодекс', 'разрешение на работу', 'патент'],
    education: ['ЕГЭ', 'правила приема', 'плата за обучение', 'школьная программа', 'приемная кампания'],
    taxes: ['налог', 'НДС', 'НДФЛ', 'новый налог', 'повышение налогов'],
    services: ['паспорт', 'водительские права', 'госуслуги', 'общественный транспорт', 'поликлиники'],
    when: ['вступит в силу', 'вступает в силу', 'с 1 января', 'начнет действовать', 'с 1'],
  },
  uk: {
    fees: ['збір', 'збори', 'плата за', 'мито', 'штрафи'],
    tariffs: ['мита', 'тарифи', 'тарифи на електроенергію', 'тарифи на газ', 'ціни на проїзд'],
    employment: ['мінімальна зарплата', 'трудовий кодекс', 'дозвіл на працевлаштування', 'трудове законодавство'],
    education: ['НМТ', 'вступна кампанія', 'плата за навчання', 'правила прийому', 'навчальна програма'],
    taxes: ['податок', 'ПДВ', 'ПДФО', 'новий податок', 'акциз'],
    services: ['паспорт', 'посвідчення водія', 'Дія', 'ЦНАП', 'громадський транспорт'],
    when: ['набуде чинності', 'набуває чинності', 'з 1', 'почне діяти', 'запрацює'],
  },
  ar: {
    fees: ['رسوم', 'رسوم جديدة', 'زيادة الرسوم', 'غرامات'],
    tariffs: ['الرسوم الجمركية', 'جمارك', 'تعرفة الكهرباء', 'أسعار الكهرباء', 'تعريفة'],
    employment: ['الحد الأدنى للأجور', 'قانون العمل', 'تصريح العمل', 'تأشيرة العمل'],
    education: ['الرسوم الدراسية', 'شروط القبول', 'المناهج', 'الثانوية العامة'],
    taxes: ['ضريبة', 'ضريبة القيمة المضافة', 'ضرائب جديدة', 'الضرائب'],
    services: ['جواز السفر', 'رخصة القيادة', 'بطاقة الهوية', 'الخدمات الحكومية', 'النقل العام'],
    when: ['حيز التنفيذ', 'اعتبارا من', 'ابتداء من', 'بدءا من', 'يبدأ تطبيق'],
  },
  fa: {
    fees: ['عوارض', 'هزینه', 'افزایش قیمت', 'جریمه'],
    tariffs: ['تعرفه', 'تعرفه گمرکی', 'قیمت برق', 'قیمت بلیت', 'تعرفه آب'],
    employment: ['حداقل دستمزد', 'قانون کار', 'مجوز کار', 'دستمزد کارگران'],
    education: ['کنکور', 'شهریه', 'پذیرش دانشجو', 'برنامه درسی'],
    taxes: ['مالیات', 'مالیات بر ارزش افزوده', 'مالیات جدید', 'معافیت مالیاتی'],
    services: ['گذرنامه', 'گواهینامه رانندگی', 'کارت ملی', 'حمل و نقل عمومی', 'خدمات دولتی'],
    when: ['اجرایی می شود', 'از ابتدای', 'لازم الاجرا', 'از اول'],
  },
  he: {
    fees: ['אגרה', 'אגרות', 'היטל', 'העלאת מחירים'],
    tariffs: ['מכס', 'תעריף החשמל', 'מחיר החשמל', 'תעריפי המים', 'מחיר הנסיעה'],
    employment: ['שכר המינימום', 'דיני עבודה', 'היתר עבודה', 'חוק שעות עבודה'],
    education: ['בגרות', 'תנאי קבלה', 'שכר לימוד', 'תוכנית לימודים'],
    taxes: ['מס', 'מס הכנסה', 'מס חדש', 'העלאת מסים'],
    services: ['דרכון', 'רישיון נהיגה', 'תעודת זהות', 'תחבורה ציבורית', 'קופות החולים'],
    when: ['ייכנס לתוקף', 'נכנס לתוקף', 'החל מ', 'יחול'],
  },
  zh: {
    fees: ['收费', '收費', '费用', '費用', '加价'],
    tariffs: ['关税', '關稅', '电价', '電費', '水费'],
    employment: ['最低工资', '最低工資', '劳动法', '勞工', '工作签证'],
    education: ['学费', '學費', '招生', '高考', '课程'],
    taxes: ['税', '稅', '增值税', '个税', '薪俸稅'],
    services: ['护照', '護照', '驾照', '駕照', '身份证', '身份證'],
    when: ['实施', '實施', '生效', '施行', '起实施'],
  },
  ja: {
    fees: ['手数料', '料金改定', '値上げ', '利用料'],
    tariffs: ['関税', '電気料金', '水道料金', '運賃'],
    employment: ['最低賃金', '労働基準法', '就労ビザ', '働き方改革'],
    education: ['入試', '学費', '授業料', '学習指導要領'],
    taxes: ['消費税', '増税', '減税', '所得税', '税制改正'],
    services: ['マイナンバー', '旅券', '運転免許', '保険証', '行政サービス'],
    when: ['施行', '開始', '適用', '導入'],
  },
  ko: {
    fees: ['수수료', '요금 인상', '이용료', '통행료'],
    tariffs: ['관세', '전기요금', '수도요금', '교통요금'],
    employment: ['최저임금', '근로기준법', '취업비자', '노동법'],
    education: ['입시', '등록금', '수능', '교육과정'],
    taxes: ['세금', '부가세', '소득세', '증세', '세법'],
    services: ['여권', '운전면허', '신분증', '주민등록', '대중교통'],
    when: ['시행', '적용', '도입', '부터'],
  },
  tr: {
    fees: ['harç', 'ücret', 'zam', 'yeni ücret', 'otoyol'],
    tariffs: ['gümrük vergisi', 'elektrik tarifesi', 'doğalgaz zammı', 'elektrik zammı', 'tarife'],
    employment: ['asgari ücret', 'iş kanunu', 'çalışma izni', 'kıdem tazminatı'],
    education: ['YKS', 'okul ücretleri', 'müfredat', 'kayıt şartları', 'LGS'],
    taxes: ['vergi', 'KDV', 'ÖTV', 'yeni vergi', 'vergi artışı'],
    services: ['pasaport', 'ehliyet', 'kimlik kartı', 'e-Devlet', 'toplu taşıma'],
    when: ['yürürlüğe girecek', 'yürürlüğe giriyor', 'itibaren', 'başlıyor'],
  },
  pl: {
    fees: ['opłaty', 'nowe opłaty', 'podwyżka opłat', 'myto'],
    tariffs: ['cła', 'taryfy', 'ceny prądu', 'taryfa na prąd', 'ceny biletów'],
    employment: ['płaca minimalna', 'kodeks pracy', 'zezwolenie na pracę', 'minimalne wynagrodzenie'],
    education: ['matura', 'rekrutacja', 'podstawa programowa', 'czesne', 'egzamin ósmoklasisty'],
    taxes: ['podatek', 'VAT', 'PIT', 'nowy podatek', 'akcyza'],
    services: ['paszport', 'prawo jazdy', 'dowód osobisty', 'mObywatel', 'komunikacja miejska'],
    when: ['wchodzi w życie', 'wejdzie w życie', 'od 1', 'od stycznia', 'zacznie obowiązywać'],
  },
  cs: {
    fees: ['poplatky', 'poplatek', 'zdražení', 'mýto', 'dálniční známka'],
    tariffs: ['cla', 'ceny energií', 'cena elektřiny', 'jízdné', 'tarify'],
    employment: ['minimální mzda', 'zákoník práce', 'pracovní povolení', 'zaručená mzda'],
    education: ['přijímací zkoušky', 'maturita', 'školné', 'přijímačky'],
    taxes: ['daň', 'DPH', 'zvýšení daní', 'nová daň', 'daňový balíček'],
    services: ['pas', 'řidičský průkaz', 'občanský průkaz', 'eDoklady', 'veřejná doprava'],
    when: ['vstoupí v platnost', 'nabývá účinnosti', 'od 1.', 'platí od', 'začne platit'],
  },
  sk: {
    fees: ['poplatky', 'poplatok', 'zdraženie', 'diaľničná známka', 'mýto'],
    tariffs: ['clá', 'ceny energií', 'cena elektriny', 'cestovné', 'tarify'],
    employment: ['minimálna mzda', 'Zákonník práce', 'pracovné povolenie'],
    education: ['maturita', 'prijímacie skúšky', 'školné', 'školská reforma'],
    taxes: ['daň', 'DPH', 'zvýšenie daní', 'nová daň', 'konsolidácia'],
    services: ['pas', 'vodičský preukaz', 'občiansky preukaz', 'verejná doprava'],
    when: ['nadobudne účinnosť', 'od 1.', 'platí od', 'začne platiť', 'účinnosť od'],
  },
  sl: {
    fees: ['takse', 'pristojbine', 'podražitev', 'vinjeta', 'dajatve'],
    tariffs: ['carine', 'cene elektrike', 'omrežnina', 'tarife', 'cene vozovnic'],
    employment: ['minimalna plača', 'zakon o delovnih razmerjih', 'delovno dovoljenje'],
    education: ['matura', 'vpis', 'šolnine', 'učni načrt', 'vpisni pogoji'],
    taxes: ['davek', 'DDV', 'nov davek', 'davčna reforma', 'trošarine'],
    services: ['potni list', 'vozniško dovoljenje', 'osebna izkaznica', 'javni prevoz', 'eUprava'],
    when: ['začne veljati', 'stopi v veljavo', 'od 1.', 'velja od'],
  },
  hr: {
    fees: ['naknade', 'pristojbe', 'poskupljenje', 'cestarine', 'naknada'],
    tariffs: ['carine', 'cijene struje', 'cijena struje', 'tarife', 'cijene karata'],
    employment: ['minimalna plaća', 'Zakon o radu', 'radna dozvola', 'minimalac'],
    education: ['državna matura', 'upisi', 'školarine', 'kurikulum', 'upisne kvote'],
    taxes: ['porez', 'PDV', 'porezna reforma', 'novi porez', 'trošarine'],
    services: ['putovnica', 'vozačka dozvola', 'osobna iskaznica', 'javni prijevoz', 'e-Građani'],
    when: ['stupa na snagu', 'stupit će na snagu', 'od 1.', 'primjenjuje se od'],
  },
  sr: {
    fees: ['таксе', 'накнаде', 'поскупљење', 'takse', 'putarine'],
    tariffs: ['царине', 'цена струје', 'cena struje', 'тарифе', 'carine'],
    employment: ['минимална зарада', 'minimalna zarada', 'Закон о раду', 'Zakon o radu', 'радна дозвола'],
    education: ['мала матура', 'упис', 'школарина', 'upis', 'školarina'],
    taxes: ['порез', 'ПДВ', 'porez', 'PDV', 'акцизе'],
    services: ['пасош', 'возачка дозвола', 'лична карта', 'pasoš', 'lična karta'],
    when: ['ступа на снагу', 'stupa na snagu', 'од 1.', 'od 1.', 'почиње да важи'],
  },
  bg: {
    fees: ['такси', 'такса', 'поскъпване', 'винетка', 'нови такси'],
    tariffs: ['мита', 'цената на тока', 'цени на електроенергията', 'тарифи', 'цената на билета'],
    employment: ['минималната заплата', 'Кодекса на труда', 'разрешение за работа', 'минимална работна заплата'],
    education: ['матури', 'прием', 'такси за обучение', 'учебна програма', 'кандидатстудентски'],
    taxes: ['данък', 'ДДС', 'нов данък', 'данъчни промени', 'акциз'],
    services: ['паспорт', 'шофьорска книжка', 'лична карта', 'градски транспорт', 'електронни услуги'],
    when: ['влиза в сила', 'ще влезе в сила', 'от 1 януари', 'считано от'],
  },
  ro: {
    fees: ['taxe', 'taxe noi', 'rovinieta', 'majorarea taxelor', 'tarife'],
    tariffs: ['taxe vamale', 'tarife', 'prețul energiei', 'tarife la energie', 'prețul biletelor'],
    employment: ['salariul minim', 'Codul muncii', 'permis de muncă', 'legea salarizării'],
    education: ['bacalaureat', 'admitere', 'taxe de școlarizare', 'programa școlară', 'evaluarea națională'],
    taxes: ['impozit', 'TVA', 'impozite noi', 'creșterea TVA', 'Codul fiscal'],
    services: ['pașaport', 'permis de conducere', 'carte de identitate', 'buletin', 'transport public'],
    when: ['intră în vigoare', 'va intra în vigoare', 'de la 1', 'începând cu', 'începând de la'],
  },
  hu: {
    fees: ['díj', 'díjak', 'illeték', 'díjemelés', 'matrica'],
    tariffs: ['vám', 'vámok', 'áramár', 'rezsi', 'jegyárak'],
    employment: ['minimálbér', 'munka törvénykönyve', 'munkavállalási engedély', 'garantált bérminimum'],
    education: ['érettségi', 'felvételi', 'tandíj', 'nemzeti alaptanterv'],
    taxes: ['adó', 'áfa', 'szja', 'új adó', 'adóemelés'],
    services: ['útlevél', 'jogosítvány', 'személyi igazolvány', 'tömegközlekedés', 'ügyfélkapu'],
    when: ['lép hatályba', 'hatályba lép', 'életbe lép', '1-jétől'],
  },
  el: {
    fees: ['τέλη', 'χρεώσεις', 'αύξηση τελών', 'διόδια', 'παράβολο'],
    tariffs: ['δασμοί', 'τιμολόγια ρεύματος', 'τιμές ρεύματος', 'τιμή εισιτηρίου', 'τιμολόγια'],
    employment: ['κατώτατος μισθός', 'εργασιακό νομοσχέδιο', 'άδεια εργασίας', 'εργατικό δίκαιο'],
    education: ['πανελλαδικές', 'δίδακτρα', 'πρόγραμμα σπουδών', 'βάση εισαγωγής'],
    taxes: ['φόρος', 'ΦΠΑ', 'νέος φόρος', 'φορολογικές αλλαγές', 'ΕΝΦΙΑ'],
    services: ['διαβατήριο', 'δίπλωμα οδήγησης', 'ταυτότητα', 'gov.gr', 'συγκοινωνίες'],
    when: ['τίθεται σε ισχύ', 'θα τεθεί σε ισχύ', 'από 1η', 'ισχύει από', 'από την 1η'],
  },
  lt: {
    fees: ['mokesčiai', 'rinkliava', 'brangsta', 'nauji mokesčiai'],
    tariffs: ['muitai', 'elektros kaina', 'tarifai', 'bilieto kaina', 'šildymo kainos'],
    employment: ['MMA', 'minimali alga', 'Darbo kodeksas', 'leidimas dirbti'],
    education: ['brandos egzaminai', 'priėmimas', 'studijų kaina', 'ugdymo programa'],
    taxes: ['mokestis', 'PVM', 'GPM', 'naujas mokestis', 'mokesčių reforma'],
    services: ['pasas', 'vairuotojo pažymėjimas', 'asmens tapatybės kortelė', 'viešasis transportas'],
    when: ['įsigalios', 'įsigalioja', 'nuo sausio 1', 'nuo 1', 'pradės galioti'],
  },
  lv: {
    fees: ['nodevas', 'maksa', 'sadārdzinājums', 'nodeva'],
    tariffs: ['muitas', 'elektrības cena', 'tarifi', 'biļešu cenas', 'apkures tarifi'],
    employment: ['minimālā alga', 'Darba likums', 'darba atļauja', 'minimālās algas'],
    education: ['centralizētie eksāmeni', 'uzņemšana', 'mācību maksa', 'mācību programma'],
    taxes: ['nodoklis', 'PVN', 'IIN', 'jauns nodoklis', 'nodokļu reforma'],
    services: ['pase', 'vadītāja apliecība', 'personas apliecība', 'sabiedriskais transports'],
    when: ['stāsies spēkā', 'stājas spēkā', 'no 1.', 'sākot ar', 'no nākamā gada'],
  },
  et: {
    fees: ['tasu', 'tasud', 'lõiv', 'hinnatõus', 'uued tasud'],
    tariffs: ['tollid', 'elektri hind', 'võrgutasu', 'tariifid', 'piletihinnad'],
    employment: ['alampalk', 'töölepingu seadus', 'tööluba', 'miinimumpalk'],
    education: ['riigieksam', 'vastuvõtt', 'õppemaks', 'õppekava', 'sisseastumine'],
    taxes: ['maks', 'käibemaks', 'tulumaks', 'uus maks', 'maksutõus'],
    services: ['pass', 'juhiluba', 'ID-kaart', 'ühistransport', 'perearst'],
    when: ['jõustub', 'hakkab kehtima', 'alates 1.', 'alates jaanuarist', 'kehtima hakkab'],
  },
  fi: {
    fees: ['maksu', 'maksut', 'maksujen korotus', 'asiakasmaksut'],
    tariffs: ['tullit', 'sähkön hinta', 'siirtohinta', 'lippujen hinnat', 'taksat'],
    employment: ['työlainsäädäntö', 'työlupa', 'työsopimuslaki', 'vähimmäispalkka', 'työttömyysturva'],
    education: ['opiskelijavalinta', 'lukukausimaksut', 'opetussuunnitelma', 'ylioppilaskoe', 'pääsykoe'],
    taxes: ['vero', 'arvonlisävero', 'alv', 'veronkorotus', 'uusi vero'],
    services: ['passi', 'ajokortti', 'henkilökortti', 'joukkoliikenne', 'terveyskeskus'],
    when: ['tulee voimaan', 'astuu voimaan', 'alkaen', 'voimaan'],
  },
  sv: {
    fees: ['avgift', 'avgifter', 'höjda avgifter', 'trängselskatt'],
    tariffs: ['tullar', 'elpris', 'elnätsavgift', 'taxa', 'biljettpriser'],
    employment: ['arbetsrätt', 'arbetstillstånd', 'LAS', 'minimilön', 'arbetsgivare'],
    education: ['antagning', 'läroplan', 'studieavgifter', 'nationella prov', 'behörighet'],
    taxes: ['skatt', 'moms', 'skattehöjning', 'skattesänkning', 'ny skatt'],
    services: ['pass', 'körkort', 'ID-kort', 'kollektivtrafik', 'vårdcentral'],
    when: ['träder i kraft', 'från och med', 'från 1', 'gäller från', 'införs'],
  },
  no: {
    fees: ['avgift', 'avgifter', 'bompenger', 'gebyr', 'økte avgifter'],
    tariffs: ['toll', 'strømpris', 'nettleie', 'billettpriser', 'takster'],
    employment: ['arbeidsmiljøloven', 'arbeidstillatelse', 'minstelønn', 'arbeidsgivere'],
    education: ['opptak', 'læreplan', 'skolepenger', 'eksamen', 'opptakskrav'],
    taxes: ['skatt', 'moms', 'merverdiavgift', 'skatteøkning', 'ny skatt'],
    services: ['pass', 'førerkort', 'ID-kort', 'kollektivtrafikk', 'fastlege'],
    when: ['trer i kraft', 'fra 1.', 'fra og med', 'gjelder fra', 'innføres'],
  },
  da: {
    fees: ['afgift', 'afgifter', 'gebyr', 'højere afgifter', 'brugerbetaling'],
    tariffs: ['told', 'elpris', 'nettarif', 'billetpriser', 'takster'],
    employment: ['arbejdsret', 'arbejdstilladelse', 'mindsteløn', 'ferieloven', 'arbejdsgivere'],
    education: ['optagelse', 'adgangskrav', 'læreplan', 'eksamen', 'SU'],
    taxes: ['skat', 'moms', 'skattestigning', 'ny skat', 'topskat'],
    services: ['pas', 'kørekort', 'MitID', 'kollektiv trafik', 'borgerservice'],
    when: ['træder i kraft', 'fra 1.', 'fra og med', 'gælder fra', 'indføres'],
  },
  id: {
    fees: ['biaya', 'kenaikan tarif', 'retribusi', 'biaya administrasi'],
    tariffs: ['bea masuk', 'tarif listrik', 'tarif air', 'tarif tol', 'tarif impor'],
    employment: ['upah minimum', 'UMP', 'UMR', 'Cipta Kerja', 'izin kerja'],
    education: ['uang kuliah', 'UKT', 'penerimaan siswa baru', 'SPMB', 'kurikulum'],
    taxes: ['pajak', 'PPN', 'pajak baru', 'kenaikan pajak', 'PPh'],
    services: ['paspor', 'SIM', 'KTP', 'BPJS', 'layanan publik', 'transportasi umum'],
    when: ['mulai berlaku', 'berlaku mulai', 'mulai 1', 'diberlakukan', 'efektif'],
  },
  ms: {
    fees: ['caj', 'yuran', 'kenaikan caj', 'fi', 'tol'],
    tariffs: ['tarif', 'duti import', 'tarif elektrik', 'tarif air'],
    employment: ['gaji minimum', 'akta kerja', 'permit kerja', 'undang-undang buruh'],
    education: ['kemasukan', 'kurikulum', 'peperiksaan', 'syarat kemasukan'],
    taxes: ['cukai', 'SST', 'cukai baharu', 'cukai pendapatan'],
    services: ['pasport', 'lesen memandu', 'kad pengenalan', 'perkhidmatan awam', 'pengangkutan awam'],
    when: ['berkuat kuasa', 'mulai 1', 'bermula', 'dilaksanakan'],
  },
  vi: {
    fees: ['phí', 'lệ phí', 'tăng phí', 'thu phí'],
    tariffs: ['thuế quan', 'giá điện', 'giá nước', 'giá vé', 'thuế nhập khẩu'],
    employment: ['lương tối thiểu', 'Bộ luật Lao động', 'giấy phép lao động', 'bảo hiểm xã hội'],
    education: ['học phí', 'tuyển sinh', 'chương trình giáo dục', 'thi tốt nghiệp'],
    taxes: ['thuế', 'VAT', 'thuế giá trị gia tăng', 'thuế thu nhập cá nhân'],
    services: ['hộ chiếu', 'giấy phép lái xe', 'căn cước', 'dịch vụ công', 'giao thông công cộng'],
    when: ['có hiệu lực', 'từ ngày 1', 'áp dụng từ', 'bắt đầu từ'],
  },
  th: {
    fees: ['ค่าธรรมเนียม', 'ขึ้นค่า', 'ค่าบริการ', 'ค่าผ่านทาง'],
    tariffs: ['ภาษีนำเข้า', 'ค่าไฟ', 'ค่าน้ำ', 'ค่าโดยสาร'],
    employment: ['ค่าแรงขั้นต่ำ', 'กฎหมายแรงงาน', 'ใบอนุญาตทำงาน', 'ค่าจ้างขั้นต่ำ'],
    education: ['ค่าเทอม', 'TCAS', 'หลักสูตร', 'การสอบเข้า'],
    taxes: ['ภาษี', 'ภาษีมูลค่าเพิ่ม', 'ภาษีเงินได้', 'ภาษีใหม่'],
    services: ['หนังสือเดินทาง', 'ใบขับขี่', 'บัตรประชาชน', 'ขนส่งสาธารณะ'],
    when: ['มีผล', 'บังคับใช้', 'มีผลบังคับใช้', 'เริ่ม'],
  },
  bn: {
    fees: ['ফি', 'ফি বৃদ্ধি', 'চার্জ', 'টোল'],
    tariffs: ['শুল্ক', 'বিদ্যুতের দাম', 'গ্যাসের দাম', 'আমদানি শুল্ক'],
    employment: ['ন্যূনতম মজুরি', 'শ্রম আইন', 'ওয়ার্ক পারমিট'],
    education: ['ভর্তি পরীক্ষা', 'টিউশন ফি', 'পাঠ্যক্রম', 'এইচএসসি'],
    taxes: ['কর', 'ভ্যাট', 'আয়কর', 'নতুন কর'],
    services: ['পাসপোর্ট', 'ড্রাইভিং লাইসেন্স', 'জাতীয় পরিচয়পত্র', 'গণপরিবহন'],
    when: ['কার্যকর হবে', 'থেকে কার্যকর', 'চালু হবে', 'শুরু হবে'],
  },
};
export const CHANGE_SEARCH_LANGS = Object.freeze(Object.keys(T));
const term = w => /[\s'’.,:-]/.test(w) ? `"${w.replace(/"/g, '')}"` : w;
const any = list => `(${list.map(term).join(' OR ')})`;
// The search for one kind of change in one language: the country's name, the kind of change and (unless short)
// a word saying it is about to start ('' when the language has no list). Bing reads a long boolean query loosely
// and answers with unrelated reports, so it gets the short form.
export function changeQuery(lang, type, countryName = '', { short = false } = {}) {
  const t = T[lang];
  if (!t || !CHANGE_TYPES.includes(type)) return '';
  return `${countryName ? `"${String(countryName).replace(/"/g, '')}" ` : ''}${any(t[type])}${short ? '' : ' ' + any(t.when)}`;
}
// Whether a report's title or summary names a kind of change in the edition's language (accents and case aside;
// a long word may differ in its last two letters: "brangsta"/"brangs", "increase"/"increases").
const fold = s => String(s || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
const STEMS = new Map(Object.entries(T).map(([lang, t]) => [lang, [...new Set(CHANGE_TYPES.flatMap(type => t[type]).map(fold))].map(f => {
  const last = f.split(/\s+/).pop(), alphabetic = /^[\p{Script=Latin}\p{Script=Cyrillic}\p{Script=Greek}]+$/u.test(last);
  // Alphabetic terms match whole words; a long final word may carry a different ending. Other scripts match anywhere.
  if (!alphabetic) return { any: f };
  const esc = (last.length >= 6 ? f.slice(0, -2) : f).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return { re: new RegExp(`(?<![\\p{L}\\p{N}])${esc}${last.length >= 6 ? '\\p{L}{0,4}' : ''}(?![\\p{L}\\p{N}])`, 'u') };
})]));
// Compounding languages join words ("Mautgebühren", "collegegeldverhoging"): their terms match inside words.
const COMPOUNDING = new Set(['de', 'nl', 'sv', 'no', 'da', 'fi', 'et', 'hu']);
export function namesChange(lang, text) {
  if (COMPOUNDING.has(lang)) { const t = fold(text); return (T[lang] ? CHANGE_TYPES.flatMap(type => T[lang][type]) : []).some(w => { const f = fold(w); return t.includes(f.length >= 6 ? f.slice(0, -2) : f); }); }
  const stems = STEMS.get(lang), t = fold(text);
  return !!stems && stems.some(x => x.any ? t.includes(x.any) : x.re.test(t));
}

// Which kind of change a collector visit searches for: one on every visit, in turn through the six kinds, each kind
// alternating between Google News and Bing on its successive turns. (Every other visit filled Coming Up too slowly:
// one search per kind per edition about every twelve hours.)
export function changeRotation(rot) {
  const r = Math.max(0, Math.floor(Number(rot) || 0));
  return { type: CHANGE_TYPES[r % CHANGE_TYPES.length], google: (r + Math.floor(r / CHANGE_TYPES.length)) % 2 === 0 };
}

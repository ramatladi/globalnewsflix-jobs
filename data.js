// GlobalNewsFlix static data: countries, languages, categories, celebrities.

// CC|Name|primary language|region|Google News edition "hl;gl;ceid" (blank = none)|local search term (optional)
const COUNTRY_ROWS = `
AF|Afghanistan|ps|Asia||
AL|Albania|sq|Europe||Shqipëri
DZ|Algeria|ar|Africa||الجزائر
AD|Andorra|ca|Europe||Andorra
AO|Angola|pt|Africa||Angola
AG|Antigua and Barbuda|en|Americas||
AR|Argentina|es|Americas|es-419;AR;AR:es-419|
AM|Armenia|hy|Asia||
AU|Australia|en|Oceania|en-AU;AU;AU:en|
AT|Austria|de|Europe|de-AT;AT;AT:de|
AZ|Azerbaijan|az|Asia||
BS|Bahamas|en|Americas||
BH|Bahrain|ar|Asia||البحرين
BD|Bangladesh|bn|Asia|bn;BD;BD:bn|
BB|Barbados|en|Americas||
BY|Belarus|be|Europe||Беларусь
BE|Belgium|nl|Europe|nl;BE;BE:nl|
BZ|Belize|en|Americas||
BJ|Benin|fr|Africa||Bénin
BT|Bhutan|en|Asia||
BO|Bolivia|es|Americas||Bolivia
BA|Bosnia and Herzegovina|bs|Europe||BiH
BW|Botswana|en|Africa|en-BW;BW;BW:en|
BR|Brazil|pt|Americas|pt-BR;BR;BR:pt-419|
BN|Brunei|ms|Asia||
BG|Bulgaria|bg|Europe|bg;BG;BG:bg|
BF|Burkina Faso|fr|Africa||Burkina Faso
BI|Burundi|fr|Africa||Burundi
CV|Cabo Verde|pt|Africa||Cabo Verde
KH|Cambodia|km|Asia||
CM|Cameroon|fr|Africa||Cameroun
CA|Canada|en|Americas|en-CA;CA;CA:en|
CF|Central African Republic|fr|Africa||Centrafrique
TD|Chad|fr|Africa||Tchad
CL|Chile|es|Americas|es-419;CL;CL:es-419|
CN|China|zh|Asia|zh-CN;CN;CN:zh-Hans|
CO|Colombia|es|Americas|es-419;CO;CO:es-419|
KM|Comoros|fr|Africa||Comores
CG|Congo|fr|Africa||Congo-Brazzaville
CD|DR Congo|fr|Africa||RDC Congo
CR|Costa Rica|es|Americas||Costa Rica
CI|Côte d'Ivoire|fr|Africa||Côte d'Ivoire
HR|Croatia|hr|Europe||Hrvatska
CU|Cuba|es|Americas|es-419;CU;CU:es-419|
CY|Cyprus|el|Europe||Κύπρος
CZ|Czechia|cs|Europe|cs;CZ;CZ:cs|
DK|Denmark|da|Europe||Danmark
DJ|Djibouti|fr|Africa||Djibouti
DM|Dominica|en|Americas||
DO|Dominican Republic|es|Americas||República Dominicana
EC|Ecuador|es|Americas||Ecuador
EG|Egypt|ar|Africa|ar;EG;EG:ar|
SV|El Salvador|es|Americas||El Salvador
GQ|Equatorial Guinea|es|Africa||Guinea Ecuatorial
ER|Eritrea|en|Africa||
EE|Estonia|et|Europe||Eesti
SZ|Eswatini|en|Africa||
ET|Ethiopia|am|Africa|en-ET;ET;ET:en|
FJ|Fiji|en|Oceania||
FI|Finland|fi|Europe||Suomi
FR|France|fr|Europe|fr;FR;FR:fr|
GA|Gabon|fr|Africa||Gabon
GM|Gambia|en|Africa||
GE|Georgia|ka|Asia||Georgia Tbilisi
DE|Germany|de|Europe|de;DE;DE:de|
GH|Ghana|en|Africa|en-GH;GH;GH:en|
GR|Greece|el|Europe|el;GR;GR:el|
GD|Grenada|en|Americas||
GT|Guatemala|es|Americas||Guatemala
GN|Guinea|fr|Africa||Guinée Conakry
GW|Guinea-Bissau|pt|Africa||Guiné-Bissau
GY|Guyana|en|Americas||
HT|Haiti|fr|Americas||Haïti
HN|Honduras|es|Americas||Honduras
HK|Hong Kong|zh|Asia|zh-HK;HK;HK:zh-Hant|
HU|Hungary|hu|Europe|hu;HU;HU:hu|
IS|Iceland|is|Europe||
IN|India|hi|Asia|en-IN;IN;IN:en|
ID|Indonesia|id|Asia|id;ID;ID:id|
IR|Iran|fa|Asia||
IQ|Iraq|ar|Asia||العراق
IE|Ireland|en|Europe|en-IE;IE;IE:en|
IL|Israel|he|Asia|he;IL;IL:he|
IT|Italy|it|Europe|it;IT;IT:it|
JM|Jamaica|en|Americas||
JP|Japan|ja|Asia|ja;JP;JP:ja|
JO|Jordan|ar|Asia||الأردن
KZ|Kazakhstan|kk|Asia||Казахстан
KE|Kenya|sw|Africa|en-KE;KE;KE:en|
KI|Kiribati|en|Oceania||
KW|Kuwait|ar|Asia||الكويت
KG|Kyrgyzstan|ru|Asia||Кыргызстан
LA|Laos|lo|Asia||
LV|Latvia|lv|Europe|lv;LV;LV:lv|
LB|Lebanon|ar|Asia|ar;LB;LB:ar|
LS|Lesotho|en|Africa||
LR|Liberia|en|Africa||
LY|Libya|ar|Africa||ليبيا
LI|Liechtenstein|de|Europe||Liechtenstein
LT|Lithuania|lt|Europe|lt;LT;LT:lt|
LU|Luxembourg|fr|Europe||Luxembourg
MO|Macau|zh|Asia||澳門
MG|Madagascar|mg|Africa||Madagascar
MW|Malawi|en|Africa||
MY|Malaysia|ms|Asia|en-MY;MY;MY:en|
MV|Maldives|en|Asia||
ML|Mali|fr|Africa||Mali Bamako
MT|Malta|en|Europe||
MH|Marshall Islands|en|Oceania||
MR|Mauritania|ar|Africa||Mauritanie
MU|Mauritius|en|Africa||
MX|Mexico|es|Americas|es-419;MX;MX:es-419|
FM|Micronesia|en|Oceania||
MD|Moldova|ro|Europe||Moldova
MC|Monaco|fr|Europe||Monaco
MN|Mongolia|mn|Asia||
ME|Montenegro|sr|Europe||Crna Gora
MA|Morocco|ar|Africa|fr;MA;MA:fr|
MZ|Mozambique|pt|Africa||Moçambique
MM|Myanmar|my|Asia||
NA|Namibia|en|Africa|en-NA;NA;NA:en|
NR|Nauru|en|Oceania||
NP|Nepal|ne|Asia||
NL|Netherlands|nl|Europe|nl;NL;NL:nl|
NZ|New Zealand|en|Oceania|en-NZ;NZ;NZ:en|
NI|Nicaragua|es|Americas||Nicaragua
NE|Niger|fr|Africa||Niger Niamey
NG|Nigeria|en|Africa|en-NG;NG;NG:en|
KP|North Korea|ko|Asia||
MK|North Macedonia|mk|Europe||Македонија
NO|Norway|no|Europe|no;NO;NO:no|
OM|Oman|ar|Asia||سلطنة عمان
PK|Pakistan|ur|Asia|en-PK;PK;PK:en|
PW|Palau|en|Oceania||
PS|Palestine|ar|Asia||فلسطين
PA|Panama|es|Americas||Panamá
PG|Papua New Guinea|en|Oceania||
PY|Paraguay|es|Americas||Paraguay
PE|Peru|es|Americas|es-419;PE;PE:es-419|
PH|Philippines|tl|Asia|en-PH;PH;PH:en|
PL|Poland|pl|Europe|pl;PL;PL:pl|
PT|Portugal|pt|Europe|pt-PT;PT;PT:pt-150|
PR|Puerto Rico|es|Americas||Puerto Rico
QA|Qatar|ar|Asia||قطر
RO|Romania|ro|Europe|ro;RO;RO:ro|
RU|Russia|ru|Europe|ru;RU;RU:ru|
RW|Rwanda|en|Africa||
KN|Saint Kitts and Nevis|en|Americas||
LC|Saint Lucia|en|Americas||
VC|Saint Vincent and the Grenadines|en|Americas||
WS|Samoa|en|Oceania||
SM|San Marino|it|Europe||San Marino
ST|São Tomé and Príncipe|pt|Africa||São Tomé
SA|Saudi Arabia|ar|Asia|ar;SA;SA:ar|
SN|Senegal|fr|Africa|fr;SN;SN:fr|
RS|Serbia|sr|Europe|sr;RS;RS:sr|
SC|Seychelles|en|Africa||
SL|Sierra Leone|en|Africa||
SG|Singapore|en|Asia|en-SG;SG;SG:en|
SK|Slovakia|sk|Europe|sk;SK;SK:sk|
SI|Slovenia|sl|Europe|sl;SI;SI:sl|
SB|Solomon Islands|en|Oceania||
SO|Somalia|so|Africa||
ZA|South Africa|en|Africa|en-ZA;ZA;ZA:en|
KR|South Korea|ko|Asia|ko;KR;KR:ko|
SS|South Sudan|en|Africa||
ES|Spain|es|Europe|es;ES;ES:es|
LK|Sri Lanka|si|Asia||
SD|Sudan|ar|Africa||السودان
SR|Suriname|nl|Americas||Suriname
SE|Sweden|sv|Europe|sv;SE;SE:sv|
CH|Switzerland|de|Europe|de-CH;CH;CH:de|
SY|Syria|ar|Asia||سوريا
TW|Taiwan|zh|Asia|zh-TW;TW;TW:zh-Hant|
TJ|Tajikistan|ru|Asia||Таджикистан
TZ|Tanzania|sw|Africa|en-TZ;TZ;TZ:en|
TH|Thailand|th|Asia|th;TH;TH:th|
TL|Timor-Leste|pt|Asia||Timor-Leste
TG|Togo|fr|Africa||Togo Lomé
TO|Tonga|en|Oceania||
TT|Trinidad and Tobago|en|Americas||
TN|Tunisia|ar|Africa||Tunisie
TR|Türkiye|tr|Europe|tr;TR;TR:tr|
TM|Turkmenistan|ru|Asia||Туркменистан
TV|Tuvalu|en|Oceania||
UG|Uganda|en|Africa|en-UG;UG;UG:en|
UA|Ukraine|uk|Europe|uk;UA;UA:uk|
AE|United Arab Emirates|ar|Asia|ar;AE;AE:ar|
GB|United Kingdom|en|Europe|en-GB;GB;GB:en|
US|United States|en|Americas|en-US;US;US:en|
UY|Uruguay|es|Americas||Uruguay
UZ|Uzbekistan|uz|Asia||Узбекистан
VU|Vanuatu|en|Oceania||
VA|Vatican City|it|Europe||Vaticano
VE|Venezuela|es|Americas|es-419;VE;VE:es-419|
VN|Vietnam|vi|Asia|vi;VN;VN:vi|
YE|Yemen|ar|Asia||اليمن
ZM|Zambia|en|Africa||
ZW|Zimbabwe|en|Africa|en-ZW;ZW;ZW:en|
`;

// Edition used to search for countries that have no Google News edition of their own.
const SEARCH_EDITION = {
  fr: 'fr;FR;FR:fr', ar: 'ar;EG;EG:ar', es: 'es-419;MX;MX:es-419', pt: 'pt-PT;PT;PT:pt-150',
  ru: 'ru;RU;RU:ru', de: 'de;DE;DE:de', it: 'it;IT;IT:it', nl: 'nl;NL;NL:nl', el: 'el;GR;GR:el',
  sr: 'sr;RS;RS:sr', zh: 'zh-HK;HK;HK:zh-Hant', default: 'en-US;US;US:en'
};

export const COUNTRIES = COUNTRY_ROWS.trim().split('\n').map(line => {
  const [code, name, lang, region, edition, q] = line.split('|');
  return { code, name, lang, region, edition: edition || '', q: q || '' };
});
export const COUNTRY = Object.fromEntries(COUNTRIES.map(c => [c.code, c]));

export function searchEditionFor(c) {
  if (!c.q) return SEARCH_EDITION.default;
  const nonLatin = /[^\u0000-ɏ\s'’.-]/.test(c.q);
  if (nonLatin) {
    if (/[؀-ۿ]/.test(c.q)) return SEARCH_EDITION.ar;
    if (/[Ѐ-ӿ]/.test(c.q)) return SEARCH_EDITION.ru;
    if (/[Ͱ-Ͽ]/.test(c.q)) return SEARCH_EDITION.el;
    if (/[一-鿿]/.test(c.q)) return SEARCH_EDITION.zh;
  }
  return SEARCH_EDITION[c.lang] || SEARCH_EDITION.default;
}

// m2m100 language codes with English and native names. rtl = right-to-left script.
const LANG_ROWS = `
en|English|English
af|Afrikaans|Afrikaans
am|Amharic|አማርኛ
ar|Arabic|العربية|rtl
ast|Asturian|Asturianu
az|Azerbaijani|Azərbaycanca
ba|Bashkir|Башҡортса
be|Belarusian|Беларуская
bg|Bulgarian|Български
bn|Bengali|বাংলা
br|Breton|Brezhoneg
bs|Bosnian|Bosanski
ca|Catalan|Català
ceb|Cebuano|Cebuano
cs|Czech|Čeština
cy|Welsh|Cymraeg
da|Danish|Dansk
de|German|Deutsch
el|Greek|Ελληνικά
es|Spanish|Español
et|Estonian|Eesti
fa|Persian|فارسی|rtl
ff|Fula|Fulfulde
fi|Finnish|Suomi
fr|French|Français
fy|Western Frisian|Frysk
ga|Irish|Gaeilge
gd|Scottish Gaelic|Gàidhlig
gl|Galician|Galego
gu|Gujarati|ગુજરાતી
ha|Hausa|Hausa
he|Hebrew|עברית|rtl
hi|Hindi|हिन्दी
hr|Croatian|Hrvatski
ht|Haitian Creole|Kreyòl ayisyen
hu|Hungarian|Magyar
hy|Armenian|Հայերեն
id|Indonesian|Bahasa Indonesia
ig|Igbo|Igbo
ilo|Ilocano|Ilokano
is|Icelandic|Íslenska
it|Italian|Italiano
ja|Japanese|日本語
jv|Javanese|Basa Jawa
ka|Georgian|ქართული
kk|Kazakh|Қазақша
km|Khmer|ខ្មែរ
kn|Kannada|ಕನ್ನಡ
ko|Korean|한국어
lb|Luxembourgish|Lëtzebuergesch
lg|Ganda|Luganda
ln|Lingala|Lingála
lo|Lao|ລາວ
lt|Lithuanian|Lietuvių
lv|Latvian|Latviešu
mg|Malagasy|Malagasy
mk|Macedonian|Македонски
ml|Malayalam|മലയാളം
mn|Mongolian|Монгол
mr|Marathi|मराठी
ms|Malay|Bahasa Melayu
my|Burmese|မြန်မာ
ne|Nepali|नेपाली
nl|Dutch|Nederlands
no|Norwegian|Norsk
ns|Northern Sotho|Sesotho sa Leboa
oc|Occitan|Occitan
or|Odia|ଓଡ଼ିଆ
pa|Punjabi|ਪੰਜਾਬੀ
pl|Polish|Polski
ps|Pashto|پښتو|rtl
pt|Portuguese|Português
ro|Romanian|Română
ru|Russian|Русский
sd|Sindhi|سنڌي|rtl
si|Sinhala|සිංහල
sk|Slovak|Slovenčina
sl|Slovenian|Slovenščina
so|Somali|Soomaali
sq|Albanian|Shqip
sr|Serbian|Српски
ss|Swati|SiSwati
su|Sundanese|Basa Sunda
sv|Swedish|Svenska
sw|Swahili|Kiswahili
ta|Tamil|தமிழ்
th|Thai|ไทย
tl|Filipino|Filipino
tn|Tswana|Setswana
tr|Turkish|Türkçe
uk|Ukrainian|Українська
ur|Urdu|اردو|rtl
uz|Uzbek|Oʻzbek
vi|Vietnamese|Tiếng Việt
wo|Wolof|Wolof
xh|Xhosa|isiXhosa
yi|Yiddish|ייִדיש|rtl
yo|Yoruba|Yorùbá
zh|Chinese|中文
zu|Zulu|isiZulu
`;
export const LANGUAGES = LANG_ROWS.trim().split('\n').map(l => {
  const [code, name, native, rtl] = l.split('|');
  return { code, name, native, rtl: rtl === 'rtl' };
});
export const LANG = Object.fromEntries(LANGUAGES.map(l => [l.code, l]));

export const CATEGORIES = [
  { id: 'world', name: 'World' },
  { id: 'politics', name: 'Politics' },
  { id: 'business', name: 'Business' },
  { id: 'technology', name: 'Technology' },
  { id: 'science', name: 'Science' },
  { id: 'health', name: 'Health' },
  { id: 'sports', name: 'Sports' },
  { id: 'entertainment', name: 'Entertainment' },
  { id: 'celebrity', name: 'Celebrity' },
  { id: 'climate', name: 'Climate' },
  { id: 'lifestyle', name: 'Lifestyle' },
  { id: 'crime', name: 'Crime & Justice' },
{ id: 'ai', name: 'AI & Cyber' },
{ id: 'space', name: 'Space' },
{ id: 'upcoming', name: 'Coming Up' },
{ id: 'odd', name: 'Random News' },
{ id: 'living', name: 'Cost of Living' },
{ id: 'jobs', name: 'Jobs' },
{ id: 'goodnews', name: 'Good News' },
];
export const CATEGORY = Object.fromEntries(CATEGORIES.map(c => [c.id, c]));

// Google News topic sections rotated through for countries with an edition.
export const TOPICS = ['BUSINESS', 'TECHNOLOGY', 'SPORTS', 'ENTERTAINMENT', 'SCIENCE', 'HEALTH', 'WORLD'];

// Top celebrities followed by the celebrity desk (rotated through, most-followed first).
export const CELEBRITIES = [
  'Cristiano Ronaldo', 'Lionel Messi', 'Selena Gomez', 'Kylie Jenner', 'Dwayne Johnson',
  'Taylor Swift', 'Ariana Grande', 'Kim Kardashian', 'Beyoncé', 'Khloé Kardashian',
  'Justin Bieber', 'Kendall Jenner', 'Nicki Minaj', 'Rihanna', 'Virat Kohli', 'Jennifer Lopez',
  'Kevin Hart', 'Cardi B', 'Zendaya', 'Drake', 'Billie Eilish', 'Bad Bunny', 'Shakira',
  'Neymar', 'Miley Cyrus', 'Lady Gaga', 'Katy Perry', 'Shah Rukh Khan', 'Priyanka Chopra',
  'BTS', 'Blackpink', 'Lisa Manobal', 'Burna Boy', 'Wizkid', 'Tyla', 'Davido', 'Kylian Mbappé',
  'LeBron James', 'Travis Scott', 'Doja Cat', 'Ed Sheeran', 'Dua Lipa', 'Sabrina Carpenter',
  'Olivia Rodrigo', 'Timothée Chalamet', 'Kanye West', 'Elon Musk', 'MrBeast', 'Erling Haaland',
  'Anitta', 'Karol G', 'Deepika Padukone', 'Alia Bhatt', 'Gigi Hadid', 'Hailey Bieber',
];

export function slugify(s) {
  return String(s || '').replace(/ß/g, 'ss').replace(/[Ææ]/g, 'ae').replace(/[Øø]/g, 'o').replace(/[Œœ]/g, 'oe').replace(/[Łł]/g, 'l').replace(/[Đđ]/g, 'd').replace(/[Þþ]/g, 'th').normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}
export const CELEB_BY_SLUG = Object.fromEntries(CELEBRITIES.map(n => [slugify(n), n]));

export function flagUrl(cc) {
  if (!cc || cc === 'WW') return '';
  // Served from the site itself (public/flags), so no third party sees which pages readers open.
  return `/flags/${cc.toLowerCase()}.svg`;
}

// Language each edition publishes in: the edition's main news language, or a widely read regional language.
const STRONG = new Set(['en', 'fr', 'es', 'pt', 'ar', 'ru', 'de', 'it', 'nl', 'tr', 'zh', 'ja', 'ko', 'id', 'vi', 'th', 'pl', 'uk', 'el', 'he', 'cs', 'sk', 'hu', 'ro', 'bg', 'sr', 'hr', 'sv', 'no', 'da', 'fi', 'fa', 'ms', 'bn', 'hi', 'sl', 'lt', 'lv', 'et']);
const FORCE = { IN: 'en', PK: 'en', PH: 'en', KE: 'en', TZ: 'en', UG: 'en', NG: 'en', GH: 'en', ZA: 'en', ET: 'en', MY: 'en', SG: 'en', MA: 'fr', DZ: 'fr', TN: 'fr', LB: 'ar', BE: 'nl', CH: 'de', LU: 'fr', HK: 'zh', MO: 'zh', TW: 'zh', KZ: 'ru', KG: 'ru', TJ: 'ru', TM: 'ru', UZ: 'ru', BY: 'ru', AM: 'ru', AZ: 'ru', GE: 'en', MN: 'en', AF: 'en', MM: 'en', KH: 'en', LA: 'en', NP: 'en', LK: 'en', SO: 'en', MG: 'fr', RW: 'en', BI: 'fr', HT: 'fr', PR: 'es', BA: 'hr', ME: 'sr', MK: 'en', AL: 'en', IS: 'en', MT: 'en', CY: 'el', EE: 'et', BN: 'ms', BD: 'bn', IR: 'fa' };
export function newsLang(cc) {
  if (!cc || cc === 'WW') return 'en';
  if (FORCE[cc]) return FORCE[cc];
  const c = COUNTRY[cc];
  if (!c) return 'en';
  if (c.edition) { const hl = c.edition.split(';')[0].toLowerCase(); const l = hl.split('-')[0]; if (STRONG.has(l)) return l; }
  return STRONG.has(c.lang) ? c.lang : 'en';
}

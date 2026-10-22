import { automaticSourceRequestLimit, NTU_AUTOMATIC_SOURCE_ID, REFRESHABLE_AUTOMATIC_READERS, emptyWorkdayDetailReasons, validWorkdayDetailReasons, workdayDetailSummaries } from './jobs-request-policy.js';
import { boardNamesOrganization } from './jobs-identity-name.js';
// Jobs from employers' own career sites: listed companies, large or well-known private companies, governments and
// international organisations.
// Collected by a GitHub Actions job every six hours; the site lists them by country, with categories and filters.
// Pay is shown only where the employer publishes it.
import discoveredManifest from './data/discovered-sources/manifest.json' with { type: 'json' };
import { registeredDiscoveredSources, discoveredJobAllowed } from './jobs-discovered-sources.js';
import { COUNTRY } from './data.js';
import { iso3To2 } from './iso-codes.js';
import { workdayQueryFacets } from './jobs-workday-query.js';
import { platformForReader } from './jobs-pacing.js';
import { auditAutomaticOutput, automaticRefreshHealth } from './jobs-source-health.js';
import { AFRICA_EXTRA_SOURCES } from './jobs-africa-sources.js';
import { SHOPRITE_BROWSE_URL, parseShopriteCategories, parseShopriteList, parseShopriteDetail } from './jobs-erecruit.js';
import { parseSimplifyList, parseSimplifyDetail } from './jobs-simplify.js';
import { parseOracleDetail } from './jobs-oracle-detail.js';
import { UCT_SEARCH_URL, parseUctSearch, parseUctDetail } from './jobs-uct.js';
import { parseJobDates } from './jobs-dates.js';
import { parseJobPostings } from './jobs-adapters.js';
import { employerMetadata } from './jobs-employers.js';
import { ZA_EXTRA_SOURCES, ZA_GOVERNMENT_SOURCES } from './jobs-za-sources.js';
import { parseGautengJobs, parseGautengDetail, GAUTENG_JOBS_URL } from './jobs-gauteng.js';

// ---------- Employers ----------
// id|name|stock ticker (blank for a private company)|type (c = company, g = government, i = international organisation)|careers system|arguments
const SOURCE_ROWS = `
airbnb|Airbnb|ABNB|c|gh|airbnb
pinterest|Pinterest|PINS|c|gh|pinterest
robinhood|Robinhood|HOOD|c|gh|robinhood
coinbase|Coinbase|COIN|c|gh|coinbase
datadog|Datadog|DDOG|c|gh|datadog
cloudflare|Cloudflare|NET|c|gh|cloudflare
dropbox|Dropbox|DBX|c|gh|dropbox
reddit|Reddit|RDDT|c|gh|reddit
roblox|Roblox|RBLX|c|gh|roblox
lyft|Lyft|LYFT|c|gh|lyft
doordash|DoorDash|DASH|c|gh|doordashusa
instacart|Instacart|CART|c|gh|instacart
duolingo|Duolingo|DUOL|c|gh|duolingo
twilio|Twilio|TWLO|c|gh|twilio
okta|Okta|OKTA|c|gh|okta
gitlab|GitLab|GTLB|c|gh|gitlab
mongodb|MongoDB|MDB|c|gh|mongodb
elastic|Elastic|ESTC|c|gh|elastic
toast|Toast|TOST|c|gh|toast
affirm|Affirm|AFRM|c|gh|affirm
sofi|SoFi|SOFI|c|gh|sofi
asana|Asana|ASAN|c|gh|asana
samsara|Samsara|IOT|c|gh|samsara
pagerduty|PagerDuty|PD|c|gh|pagerduty
udemy|Udemy|UDMY|c|gh|udemy
figma|Figma|FIG|c|gh|figma
klaviyo|Klaviyo|KVYO|c|gh|klaviyo
braze|Braze|BRZE|c|gh|braze
rubrik|Rubrik|RBRK|c|gh|rubrik
upstart|Upstart|UPST|c|gh|upstart
carvana|Carvana|CVNA|c|gh|carvana
peloton|Peloton|PTON|c|gh|peloton
block|Block|XYZ|c|gh|block
zscaler|Zscaler|ZS|c|gh|zscaler
fastly|Fastly|FSLY|c|gh|fastly
payoneer|Payoneer|PAYO|c|gh|payoneer
riskified|Riskified|RSKD|c|gh|riskified
similarweb|Similarweb|SMWB|c|gh|similarweb
jumia|Jumia|JMIA|c|gh|jumia
spotify|Spotify|SPOT|c|lever|spotify
palantir|Palantir|PLTR|c|lever|palantir
veeva|Veeva Systems|VEEV|c|lever|veeva
prosus|Prosus|PRX|c|ashby|prosus
absa|Absa Group|ABG|c|wd|absa.wd3.myworkdayjobs.com|absa|ABSAcareersite
accenture|Accenture|ACN|c|wd|accenture.wd103.myworkdayjobs.com|accenture|AccentureCareers
bp|BP|BP|c|wd|bpinternational.wd3.myworkdayjobs.com|bpinternational|bpCareers
cocacola|Coca-Cola|KO|c|wd|coke.wd1.myworkdayjobs.com|coke|coca-cola-careers
dbs|DBS Bank|D05|c|wd|dbs.wd3.myworkdayjobs.com|dbs|DBS_Careers
mastercard|Mastercard|MA|c|wd|mastercard.wd1.myworkdayjobs.com|mastercard|CorporateCareers
pg|Procter & Gamble|PG|c|wd|pg.wd5.myworkdayjobs.com|pg|1000
unilever|Unilever|ULVR|c|wd|unilever.wd3.myworkdayjobs.com|unilever|Unilever_Experienced_Professionals
visa|Visa|V|c|wd|visa.wd5.myworkdayjobs.com|visa|Visa
abb|ABB|ABBN|c|wd|abb.wd3.myworkdayjobs.com|abb|External_Career_Page
samsung|Samsung Electronics|005930|c|wd|sec.wd3.myworkdayjobs.com|sec|Samsung_Careers
mondelez|Mondelez International|MDLZ|c|wd|wd3.myworkdaysite.com|mdlz|External
riotinto|Rio Tinto|RIO|c|wd|wd3.myworkdaysite.com|riotinto|RioTinto_Careers
nedbank|Nedbank Group|NED|c|sf|jobs.nedbank.co.za
stanchart|Standard Chartered|STAN|c|sf|jobs.standardchartered.com
bhp|BHP|BHP|c|sf|careers.bhp.com
colgate|Colgate-Palmolive|CL|c|sf|jobs.colgate.com
kcb|KCB Group|KCB|c|orc|eoin.fa.em3.oraclecloud.com|CX_3001
agoda|Agoda (Booking Holdings)|BKNG|c|gh|agoda
nubank|Nu Holdings (Nubank)|NU|c|ashby|nubank
gotogroup|GoTo Group|GOTO|c|lever|GoToGroup
dlocal|dLocal|DLO|c|lever|dlocal
bbva|BBVA|BBVA|c|wd|bbva.wd3.myworkdayjobs.com|bbva|BBVA
aia|AIA Group|1299|c|wd|aia.wd3.myworkdayjobs.com|aia|External
concentrix|Concentrix|CNXC|c|wd|cnx.wd1.myworkdayjobs.com|cnx|external_global
kelectric|K-Electric|KEL|c|sf|careers.ke.com.pk
firstbank|FirstBank Nigeria (First HoldCo)|FIRSTHOLDCO|c|orc|hdbc.fa.em2.oraclecloud.com|CX
safaricomet|Safaricom Ethiopia|SCOM|c|orc|egjd.fa.us6.oraclecloud.com|STEP
ugandaairlines|Uganda Airlines||g|orc|fa-eptm-saasfaprod1.fa.ocs.oraclecloud.com|CX_4001
meesho|Meesho|MEESHO|c|lever|meesho
ey|EY||c|sf|careers.ey.com
pwc|PwC||c|wd|pwc.wd3.myworkdayjobs.com|pwc|Global_Experienced_Careers
kpmgindia|KPMG in India||c|orc|ejgk.fa.em2.oraclecloud.com|CX_3
kpmgindiakdn|KPMG in India||c|orc|ejgk.fa.em2.oraclecloud.com|CX_3001
kpmggulf|KPMG Lower Gulf||c|orc|elzw.fa.em8.oraclecloud.com|CX_1001
mars|Mars||c|wd|mars.wd3.myworkdayjobs.com|mars|External
zf|ZF Group||c|sf|jobs.zf.com
foundever|Foundever||c|sf|jobs.foundever.com
scjohnson|SC Johnson||c|wd|scj.wd5.myworkdayjobs.com|scj|External_Career_Site
trafigura|Trafigura||c|wd|trafigura.wd3.myworkdayjobs.com|trafigura|TrafiguraCareerSite
ofi|ofi (olam food ingredients)||c|sf|careers.ofi.com
tataelectronics|Tata Electronics||c|sf|careers.tataelectronics.com
stripe|Stripe||c|gh|stripe
moniepoint|Moniepoint||c|gh|moniepoint
mkopa|M-KOPA||c|ashby|m-kopa
yassir|Yassir||c|lever|Yassir
bosta|Bosta||c|lever|Bosta
tamara|Tamara||c|gh|tamara
careem|Careem||c|gh|careem
trendyol|Trendyol||c|lever|trendyol
insiderone|Insider One||c|lever|insiderone
quintoandar|QuintoAndar||c|gh|quintoandar
ebanx|EBANX||c|gh|ebanx
wildlifestudios|Wildlife Studios||c|gh|wildlifestudios
kavak|Kavak||c|wd|kavak.wd10.myworkdayjobs.com|kavak|External_Career_KAVAK_MX
rappi|Rappi||c|wd|rappi.wd12.myworkdayjobs.com|rappi|Rappi_jobs
addi|Addi||c|ashby|addi
lalamove|Lalamove||c|lever|lalamove
ninjavan|Ninja Van||c|lever|ninjavan
xendit|Xendit||c|gh|xendit
razorpay|Razorpay||c|gh|razorpaysoftwareprivatelimited
bosch|Bosch||c|sr|BoschGroup
louisdreyfus|Louis Dreyfus Company||c|sr|LouisDreyfusCompany
deloitteafrica|Deloitte Africa||c|sr|Deloitte6
phonepe|PhonePe||c|sr|PHONEPELIMITED
canva|Canva||c|sr|Canva
vitol|Vitol||c|sr|Vitol
amazon|Amazon|AMZN|c|amazon|
nhs|NHS||g|nhs|
un|United Nations||i|un|
unhcr|UNHCR||i|wd|unhcr.wd3.myworkdayjobs.com|unhcr|External
wfp|World Food Programme||i|wd|wd3.myworkdaysite.com|wfp|job_openings
globalfund|The Global Fund||i|wd|theglobalfund.wd1.myworkdayjobs.com|theglobalfund|External
wto|World Trade Organization||i|wd|wto.wd103.myworkdayjobs.com|wto|External
unicef|UNICEF||i|unicef|
undp|UNDP||i|orc|estm.fa.em2.oraclecloud.com|CX_1
unfpa|UNFPA||i|orc|estm.fa.em2.oraclecloud.com|CX_2003
unwomen|UN Women||i|orc|estm.fa.em2.oraclecloud.com|CX_1001
iom|International Organization for Migration (IOM)||i|orc|fa-evlj-saasfaprod1.fa.ocs.oraclecloud.com|CX_1001
savethechildren|Save the Children International||i|orc|hcri.fa.em2.oraclecloud.com|CX_1
worldvision|World Vision International||i|wd|worldvision.wd1.myworkdayjobs.com|worldvision|WorldVisionInternational
irc|International Rescue Committee||i|wd|theirc.wd1.myworkdayjobs.com|theirc|External_Careers
ilo|International Labour Organization||i|sf|jobs.ilo.org
unesco|UNESCO||i|sf|careers.unesco.org
unido|UNIDO||i|sf|careers.unido.org
itu|International Telecommunication Union||i|sf|jobs.itu.int
au|African Union Commission||i|sf|jobs.au.int
ebrd|EBRD||i|sf|jobs.ebrd.com
oecd|OECD||i|sr|OECD
`;
export const SOURCES = SOURCE_ROWS.trim().split('\n').map(l => {
  const [id, name, ticker, type, ats, ...args] = l.split('|');
  const source = { id, name, ticker, type, ats, args };
  return { ...source, ...employerMetadata(source) };
}).concat([...ZA_EXTRA_SOURCES, ...ZA_GOVERNMENT_SOURCES, ...AFRICA_EXTRA_SOURCES].map(source => ({ ...source, ...employerMetadata(source, source) }))).concat(registeredDiscoveredSources(discoveredManifest).map(source => ({ ...source, ...employerMetadata(source, source) })));
export const EMPLOYERS = SOURCES.map(({ args, type, ...metadata }) => metadata);
const BY_ID = new Map(SOURCES.map(s => [s.id, s]));
export const JOB_TYPES = { c: 'jtC', g: 'jtG', i: 'jtI' };

// ---------- Text ----------
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '-', mdash: '-', '#39': "'", pound: '£', euro: '€', yen: '¥', rsquo: "'", lsquo: "'" };
const decode = s => s.replace(/&(#(?:x[0-9a-f]+|[0-9]+)|[a-z0-9]+);/gi, (m, e) => {
  if (e[0] !== '#') return ENT[e.toLowerCase()] ?? m;
  const point = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
  return Number.isInteger(point) && point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : '\ufffd';
});
export const plain = s => decode(decode(String(s || '')))
  .replace(/<[^>]+>/g, ' ').replace(/[\u2012-\u2015\u2212]/g, '-').replace(/\u00a0|\u202f/g, ' ').replace(/\s+/g, ' ').trim();

// ---------- Salary ----------
const SYMBOL = { 'US$': 'USD', 'CA$': 'CAD', 'C$': 'CAD', 'A$': 'AUD', 'AU$': 'AUD', 'NZ$': 'NZD', 'S$': 'SGD', 'HK$': 'HKD', 'R$': 'BRL', 'MX$': 'MXN', '$': 'USD', '£': 'GBP', '€': 'EUR', '₹': 'INR', '¥': 'JPY', '₪': 'ILS', 'zł': 'PLN', 'R': 'ZAR' };
const CODES = 'USD|CAD|AUD|NZD|SGD|HKD|GBP|EUR|INR|JPY|CHF|SEK|NOK|DKK|PLN|ILS|BRL|MXN|ZAR|KRW|CNY|AED|CZK|HUF|RON|TRY|NGN|KES';
const AMT = String.raw`(\d{1,3}(?:[,.\s]\d{3})+(?:\.\d{2})?|\d+(?:\.\d+)?)\s?([kK])?`;
const PRE = String.raw`(US\$|CA\$|C\$|A\$|AU\$|NZ\$|S\$|HK\$|R\$|MX\$|\$|£|€|₹|¥|₪|(?:${CODES})\s?)`;
const RANGE = new RegExp(`${PRE}\\s?${AMT}\\s*(?:${CODES})?\\s*(?:-|to|and)\\s*${PRE}?\\s?${AMT}\\s*(${CODES})?`, 'g');
const toNum = (s, k) => {
  let t = String(s).replace(/\s/g, '');
  if (/^\d{1,3}([.,]\d{3})+$/.test(t)) t = t.replace(/[.,]/g, '');
  else t = t.replace(/,/g, '');
  const n = Number(t);
  return Number.isFinite(n) ? n * (k ? 1000 : 1) : null;
};
// The first pay range in a posting: currency, minimum, maximum and period (year, month or hour).
export function parseSalary(text) {
  const t = plain(text);
  RANGE.lastIndex = 0;
  let m;
  while ((m = RANGE.exec(t))) {
    const [all, p1, a1, k1, p2, a2, k2, code] = m;
    const min = toNum(a1, k1 || k2), max = toNum(a2, k2 || k1);
    const pre = (p1 || '').trim(), pre2 = (p2 || '').trim();
    const cur = code || (new RegExp(`^(${CODES})$`).test(pre) ? pre : new RegExp(`^(${CODES})$`).test(pre2) ? pre2 : SYMBOL[pre]);
    if (!cur || !min || !max || max < min || max > min * 4) continue;
    if (pre === 'R' && !/\bR\s?\d/.test(all)) continue;
    const after = t.slice(m.index, m.index + all.length + 80).toLowerCase();
    const period = /per hour|\/\s?h(ou)?r|hourly|an hour|p\/h/.test(after) ? 'hour' : /per month|\/\s?month|monthly|a month|p\/m/.test(after) ? 'month' : 'year';
    const floor = { hour: 5, month: 500, year: 8000 }[period];
    if (min < floor && cur !== 'JPY' && cur !== 'KRW') continue;
    return { cur, min, max, period };
  }
  // "from $119,000/year in our lowest geographic market up to $221,000/year in our highest"
  const f = t.match(new RegExp(`from\\s+${PRE}\\s?${AMT}\\s*\\/?\\s*(year|yr|hour|hr|month)?[^$£€]{0,90}?up to\\s+${PRE}?\\s?${AMT}`, 'i'));
  if (f) {
    const pre = f[1].trim(), min = toNum(f[2], f[3]), max = toNum(f[6], f[7]);
    const cur = new RegExp(`^(${CODES})$`).test(pre) ? pre : SYMBOL[pre];
    const period = /h/.test(f[4] || '') ? 'hour' : /month/.test(f[4] || '') ? 'month' : 'year';
    if (cur && min && max && max >= min && max <= min * 4) return { cur, min, max, period };
  }
  // "137,800.00 - 186,400.00 USD annually"
  const g = t.match(new RegExp(`(?:^|[^\\d.,])${AMT}\\s*(?:-|to)\\s*${AMT}\\s*(${CODES})\\b\\s*(annually|yearly|per year|a year|hourly|per hour|an hour|monthly|per month)?`, 'i'));
  if (g) {
    const min = toNum(g[1], g[2] || g[4]), max = toNum(g[3], g[4] || g[2]), cur = g[5].toUpperCase();
    const period = /hour/i.test(g[6] || '') ? 'hour' : /month/i.test(g[6] || '') ? 'month' : 'year';
    if (min && max && max >= min && max <= min * 4 && min >= { hour: 5, month: 500, year: 8000 }[period]) return { cur, min, max, period };
  }
  return null;
}

// ---------- Country of a job ----------
const fold = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim();
const ALIASES = {
  zaf: 'ZA',
  'united states of america': 'US', 'united states': 'US', usa: 'US', 'u s a': 'US', 'united kingdom of great britain and northern ireland': 'GB', 'united kingdom': 'GB', uk: 'GB', england: 'GB', scotland: 'GB', wales: 'GB', 'northern ireland': 'GB',
  'cote d ivoire': 'CI', 'ivory coast': 'CI', 'democratic republic of the congo': 'CD', 'congo democratic republic of the': 'CD', 'congo dem rep': 'CD', 'dr congo': 'CD', drc: 'CD', 'republic of the congo': 'CG', 'congo republic of': 'CG', congo: 'CG',
  'viet nam': 'VN', turkiye: 'TR', turkey: 'TR', 'republic of korea': 'KR', 'korea republic of': 'KR', 'south korea': 'KR', korea: 'KR', 'democratic people s republic of korea': 'KP', 'north korea': 'KP',
  'united republic of tanzania': 'TZ', 'tanzania united republic of': 'TZ', 'syrian arab republic': 'SY', 'iran islamic republic of': 'IR', 'bolivia plurinational state of': 'BO', 'venezuela bolivarian republic of': 'VE',
  'lao people s democratic republic': 'LA', laos: 'LA', 'republic of moldova': 'MD', 'moldova republic of': 'MD', 'russian federation': 'RU', 'czech republic': 'CZ', 'state of palestine': 'PS', 'occupied palestinian territory': 'PS', palestine: 'PS',
  swaziland: 'SZ', 'cape verde': 'CV', burma: 'MM', 'micronesia federated states of': 'FM', 'holy see': 'VA', vatican: 'VA', 'north macedonia': 'MK', macedonia: 'MK', 'the gambia': 'GM', 'gambia the': 'GM', 'hong kong sar': 'HK', 'hong kong sar china': 'HK',
  'brunei darussalam': 'BN', 'timor leste': 'TL', 'east timor': 'TL', 'kyrgyz republic': 'KG', 'slovak republic': 'SK', 'macao': 'MO', 'macau': 'MO', 'uae': 'AE', 'the netherlands': 'NL', holland: 'NL', 'the bahamas': 'BS', 'sao tome and principe': 'ST',
  'saint kitts and nevis': 'KN', 'saint lucia': 'LC', 'saint vincent and the grenadines': 'VC', 'trinidad tobago': 'TT', 'bosnia herzegovina': 'BA', 'puerto rico': 'PR', 'taiwan province of china': 'TW', 'chinese taipei': 'TW', 'mainland china': 'CN', 'prc': 'CN',
};
const NAME_TO_CC = new Map();
for (const [cc, c] of Object.entries(COUNTRY)) NAME_TO_CC.set(fold(c.name), cc);
for (const [k, cc] of Object.entries(ALIASES)) NAME_TO_CC.set(k, cc);
// ISO code for a country name ("Viet Nam", "Côte d'Ivoire", "Kenya ").
export function countryCode(name) {
  const f = fold(name);
  if (!f) return null;
  if (NAME_TO_CC.has(f)) return NAME_TO_CC.get(f);
  const g = f.replace(/^the /, '').replace(/ the$/, '');
  return NAME_TO_CC.get(g) || null;
}
const US_STATES = 'AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC'.split(' ');
const CA_PROV = 'AB BC MB NB NL NS ON PE QC SK'.split(' ');
// Explicit ISO3 codes, checked against the collectors' country map in tests.
// Do not classify every three-letter word as a code: Rye and Ede are cities.
const ISO3_COUNTRIES = new Set('AFG ALB DZA AND AGO ATG ARG ARM AUS AUT AZE BHS BHR BGD BRB BLR BEL BLZ BEN BTN BOL BIH BWA BRA BRN BGR BFA BDI CPV KHM CMR CAN CAF TCD CHL CHN COL COM COG COD CRI CIV HRV CUB CYP CZE DNK DJI DMA DOM ECU EGY SLV GNQ ERI EST SWZ ETH FJI FIN FRA GAB GMB GEO DEU GHA GRC GRD GTM GIN GNB GUY HTI HND HKG HUN ISL IND IDN IRN IRQ IRL ISR ITA JAM JPN JOR KAZ KEN KIR KWT KGZ LAO LVA LBN LSO LBR LBY LIE LTU LUX MAC MDG MWI MYS MDV MLI MLT MHL MRT MUS MEX FSM MDA MCO MNG MNE MAR MOZ MMR NAM NRU NPL NLD NZL NIC NER NGA PRK MKD NOR OMN PAK PLW PSE PAN PNG PRY PER PHL POL PRT PRI QAT ROU RUS RWA KNA LCA VCT WSM SMR STP SAU SEN SRB SYC SLE SGP SVK SVN SLB SOM ZAF KOR SSD ESP LKA SDN SUR SWE CHE SYR TWN TJK TZA THA TLS TGO TON TTO TUN TUR TKM TUV UGA UKR ARE GBR USA URY UZB VUT VAT VEN VNM YEM ZMB ZWE'.split(' '));
const LOCATION_CODES = new Set([...Object.keys(COUNTRY), ...ISO3_COUNTRIES, ...US_STATES, ...CA_PROV, 'UK', 'UAE', 'DRC', 'NYC', 'NCR', 'EMEA', 'APAC', 'LATAM', 'MENA', 'GCC', 'ASEAN', 'EU', 'HQ']);
const NON_LOCALITY = /^(?:remote|hybrid|anywhere|worldwide|global|regional|national|corporate|main|multiple(?: locations)?|various(?: locations)?|general office|head office|office|branch|headquarters)$/i;
// Preserve geography supplied by the employer; only discard an office suffix
// when a named place remains. Apply on reads as well as writes for older rows.
export function normalizeJobLocation(value) {
  return plain(value).split(/(\s*[,;|/]\s*|\s+[-–]\s+)/).map((part, i) => {
    if (i % 2) return part;
    let place = part.trim();
    if (ISO3_COUNTRIES.has(place.toUpperCase())) return place.toUpperCase();
    const candidate = place.replace(/(?:\s+|\s*\(\s*)(?:general office|head office|hq|branch)\s*\)?$/i, '').trim();
    if (candidate !== place && /\p{L}/u.test(candidate) && !NON_LOCALITY.test(candidate) && !LOCATION_CODES.has(candidate.toUpperCase()) && !countryCode(candidate)) place = candidate;
    if (place === place.toUpperCase() && /\p{Lu}/u.test(place)) {
      if (LOCATION_CODES.has(place)) return place;
      place = place.replace(/\p{L}+/gu, (word, offset) => LOCATION_CODES.has(word) && (word.length > 2 || offset + word.length === place.length) ? word : word[0] + word.slice(1).toLowerCase());
    }
    return place;
  }).join('').trim().slice(0, 120);
}
const CITIES = {
  US: ['new york', 'san francisco', 'seattle', 'austin', 'chicago', 'boston', 'los angeles', 'denver', 'atlanta', 'washington d', 'miami', 'palo alto', 'mountain view', 'sunnyvale', 'san jose', 'oakland', 'phoenix', 'dallas', 'houston', 'nashville', 'salt lake', 'us remote', 'remote us'],
  GB: ['london', 'manchester', 'edinburgh', 'bristol', 'glasgow', 'birmingham', 'leeds'], CA: ['toronto', 'vancouver', 'montreal', 'ottawa', 'calgary', 'waterloo'], IE: ['dublin'], DE: ['berlin', 'munich', 'munchen', 'hamburg', 'frankfurt'],
  FR: ['paris'], NL: ['amsterdam'], ES: ['madrid', 'barcelona'], PT: ['lisbon'], PL: ['warsaw', 'krakow'], SE: ['stockholm'], CH: ['zurich', 'geneva', 'basel'], IL: ['tel aviv'], IN: ['bangalore', 'bengaluru', 'hyderabad', 'mumbai', 'pune', 'gurgaon', 'gurugram', 'new delhi', 'chennai', 'noida'],
  SG: ['singapore'], JP: ['tokyo', 'osaka'], AU: ['sydney', 'melbourne', 'brisbane', 'perth'], NZ: ['auckland', 'wellington'], BR: ['sao paulo', 'rio de janeiro'], MX: ['mexico city', 'ciudad de mexico', 'monterrey', 'guadalajara'],
  ZA: ['johannesburg', 'cape town', 'durban', 'pretoria', 'sandton', 'centurion', 'midrand', 'secunda', 'sasolburg'], NG: ['lagos', 'abuja'], KE: ['nairobi', 'mombasa'], AE: ['dubai', 'abu dhabi'], KR: ['seoul'], CN: ['shanghai', 'beijing', 'shenzhen'], TW: ['taipei'], CZ: ['prague'], RO: ['bucharest'],
  AR: ['buenos aires'], CO: ['bogota', 'medellin'], PH: ['manila'], DK: ['copenhagen'], NO: ['oslo'], FI: ['helsinki'], IT: ['milan', 'rome'], BE: ['brussels'], AT: ['vienna'], GR: ['athens'], HU: ['budapest'], MY: ['kuala lumpur'], TH: ['bangkok'], VN: ['ho chi minh', 'hanoi'], ID: ['jakarta'], EG: ['cairo'], MA: ['casablanca'], GH: ['accra'],
};
const CUR_HOME = { USD: 'US', GBP: 'GB', CAD: 'CA', AUD: 'AU', NZD: 'NZ', SGD: 'SG', INR: 'IN', JPY: 'JP', ZAR: 'ZA', BRL: 'BR', MXN: 'MX', ILS: 'IL', PLN: 'PL', CHF: 'CH', SEK: 'SE', NOK: 'NO', DKK: 'DK', KRW: 'KR', NGN: 'NG', KES: 'KE', AED: 'AE' };
// Country of a job from its location text ("Berlin, Germany", "Austin, TX", "Johannesburg, ZA", "Remote").
export function countryOf(location, cur, given) {
  if (given && /^[A-Za-z]{2}$/.test(given)) { const g = given.toUpperCase(); return g === 'UK' ? 'GB' : COUNTRY[g] ? g : null; }
  const loc = String(location || '');
  const whole = countryCode(loc);
  if (whole) return whole;
  const parts = loc.split(/[,;|/()]+|\s[-\u2013]\s/).map(s => s.trim()).filter(Boolean);
  for (const p of [...parts].reverse()) { const cc = countryCode(p); if (cc) return cc; }
  // Town, region code, country code ("Mumbai, MH, IND", "Hosur, TN, IN", "Shanghai, SH, CN, 201814"): the last
  // code is the country, so a region code such as MH (Maharashtra) or TN (Tamil Nadu) is never read as one.
  const tail = loc.match(/^[^,]*\p{L}[^,]*,\s*[A-Z]{2,3}\s*,\s*([A-Z]{2,3})\s*(?:,\s*(?:\d[\w -]*)?)?\s*$/u);
  const tailCc = tail && (tail[1].length === 3 ? iso3To2(tail[1]) : COUNTRY[tail[1]] ? tail[1] : null);
  if (tailCc) return tailCc;
  const code = (loc.match(/,\s*([A-Z]{2})\b/) || [])[1];
  if (code && US_STATES.includes(code)) return 'US';
  if (code && CA_PROV.includes(code)) return 'CA';
  if (code && COUNTRY[code]) return code;
  const l = ' ' + fold(loc) + ' ';
  for (const [cc, words] of Object.entries(CITIES)) if (words.some(w => l.includes(' ' + w + ' ') || l.includes(' ' + w))) return cc;
  if (/remote|anywhere|distributed/.test(l) || !loc) return CUR_HOME[cur] || null;
  return null;
}

// ---------- Categories ----------
const CATS = [
  ['intern', /\b(intern|internship|graduate programme|graduate program|trainee|apprentice|learnership|young professional|fellowship|jpo)\b/i],
  ['health', /\b(nurse|nursing|doctor|physician|medical|clinical|clinic|health|pharmac\w*|therapist|therapy|midwi\w*|dentist|dental|surgeon|surgery|radiograph\w*|paramedic|care assistant|healthcare|psycholog\w*|anaesthe\w*|hospital|patient|epidemiolog\w*)\b/i],
  ['it', /\b(software|developer|devops|sre|site reliability|programmer|full ?stack|front ?end|back ?end|ios|android|cloud|cyber\w*|infosec|information security|network|systems? (engineer|administrator|analyst)|it|ict|technical support|data engineer\w*|machine learning|ml|ai|database|qa|test automation|solutions? architect|platform engineer\w*|security engineer\w*|technology|tech lead|web)\b/i],
  ['data', /\b(data scien\w*|data analy\w*|analytics|business intelligence|bi|statistic\w*|quantitative|quant|economist|research analyst|data)\b/i],
  ['legal', /\b(legal|lawyer|counsel|attorney|compliance|paralegal|regulatory|ethics|governance|audit and investigations|investigat\w*)\b/i],
  ['hr', /\b(hr|human resources|people partner|people operations|talent|recruit\w*|learning and development|payroll)\b/i],
  ['finance', /\b(financ\w*|accountant|accounting|accounts|audit\w*|tax|treasury|controller|actuar\w*|credit|risk|investment|banking|banker|budget|fund|lending|underwrit\w*|wealth)\b/i],
  ['marketing', /\b(marketing|brand|communications?|content|social media|public relations|pr|media|editor|writer|advocacy|digital campaign|creative|designer|design)\b/i],
  ['sales', /\b(sales|account executive|account manager|business development|relationship manager|commercial|retail|store|merchandis\w*|customer success|partnerships?)\b/i],
  ['customer', /\b(customer|client service|call cent\w*|contact cent\w*|support (specialist|agent|associate|representative)|teller|cashier)\b/i],
  ['programme', /\b(programme|program officer|project (officer|manager|associate|assistant)|humanitarian|protection|development (officer|specialist|coordination)|field|policy|coordination|monitoring|evaluation|relief|emergency|refugee|livelihood|child protection|nutrition|wash|resilience|climate|gender|partnership officer)\b/i],
  ['education', /\b(teacher|lecturer|professor|education|tutor|academic|researcher|research fellow|scientist|science|librar\w*)\b/i],
  ['engineering', /\b(engineer|engineering|mechanical|electrical|civil|technician|maintenance|manufactur\w*|production|plant|process|quality|construction|architect|mining|geolog\w*|metallurg\w*|operator|artisan|fitter|electrician|welder)\b/i],
  ['operations', /\b(operations|logistic\w*|supply chain|warehouse|fulfil\w*|transport|driver|fleet|procurement|purchas\w*|sourcing|facilit\w*|admin\w*|office|assistant|coordinator|secretar\w*|clerk|receptionist|security officer|guard)\b/i],
  ['management', /\b(director|head of|chief|vice president|vp|general manager|country manager|managing|representative|executive)\b/i],
];
export const JOB_CATS = [...CATS.map(c => c[0]), 'other'];
export function categorize(title, hint = '') {
  for (const t of [title, hint]) { const s = plain(t); if (!s) continue; for (const [k, re] of CATS) if (re.test(s)) return k; }
  return 'other';
}

// ---------- Collection (GitHub Actions) ----------
const UA = 'GlobalNewsflixJobs/1.0 (+https://globalnewsflix.com/contact)';
// No limit on how many jobs an employer or a country gets (owner, 22 Oct 2026): configured employers are read to the
// end of their boards. PER_SOURCE only stops a feed that never ends; job pages fetched only for pay stay bounded.
// Automatically discovered employers keep their reviewed request budget and 1,500-job bound.
const PER_SOURCE = 100000, PAY_DETAILS = 250, AUTOMATIC_PER_SOURCE = 1500;
const PAY_COUNTRIES = new Set(['ZA', 'NG', 'KE', 'IN', 'US', 'CA', 'GB', 'IE', 'AU', 'NZ', 'NL', 'DE', 'AT', 'CH', 'SG', 'ES', 'PL', 'BE', 'FR', 'SE', 'DK', 'NO']);
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function req(fetchImpl, url, opt = {}, type = 'json') {
  for (let a = 0; a < 2; a++) {
    try {
      const r = await fetchImpl(url, { ...opt, headers: { 'user-agent': UA, accept: type === 'json' ? 'application/json' : 'text/html', ...(opt.headers || {}) }, signal: AbortSignal.timeout(30000) });
      if (r.ok) return { body: type === 'json' ? await r.json() : await r.text(), headers: r.headers };
      if (r.status === 429) {
        const retry = r.headers.get('retry-after');
        const seconds = /^\d+$/.test(retry || '') ? Number(retry) : null;
        const until = seconds != null ? Date.now() + seconds * 1000 : Date.parse(retry || '');
        // A long provider cooldown ends this request; never retry earlier than asked.
        if (a > 0 || !Number.isFinite(until) || until - Date.now() > 30000) return null;
        await sleep(Math.max(0, until - Date.now()));
        continue;
      }
      if (r.status < 500) return null;
    } catch (error) { if(['AUTOMATIC_BUDGET_EXHAUSTED','AUTOMATIC_SOURCE_REQUEST_CAP','AUTOMATIC_ROBOTS_DISALLOWED'].includes(error?.code))return null; }
    if (a === 0) await sleep(1500);
  }
  return null;
}
export function createJobFetch(fetchImpl, delayMs = fetchImpl === fetch ? 1000 : 0, platformPace = async(_url,send)=>send()) {
  const delay = Number.isFinite(delayMs) ? Math.max(0, Math.min(60000, delayMs)) : 1000;
  const hosts = new Map();
  return async (url, options, platform) => {
    const queuedAt=performance.now();
    const host = new URL(url).host, previous = hosts.get(host) || { tail: Promise.resolve(), next: 0 };
    const task = previous.tail.then(async () => {
      if (previous.blockedUntil > Date.now()) return new Response('', { status: 429, headers: { 'retry-after': String(Math.ceil((previous.blockedUntil - Date.now()) / 1000)) } });
      if (previous.next > Date.now()) await sleep(previous.next - Date.now());
      try {
        const response = await platformPace(url,()=>fetchImpl(url, options),platform,'manual',performance.now()-queuedAt);
        if (response.status === 429) {
          const value = response.headers.get('retry-after');
          const until = /^\d+$/.test(value || '') ? Date.now() + Number(value) * 1000 : Date.parse(value || '');
          previous.blockedUntil = Math.max(Date.now() + delay, Number.isFinite(until) ? until : Date.now() + 60000);
        }
        return response;
      } finally { previous.next = Date.now() + delay; }
    });
    previous.tail = task.catch(() => {}); hosts.set(host, previous);
    return task;
  };
}
const getJson = async (f, u, o) => (await req(f, u, o, 'json'))?.body ?? null;
const getText = async (f, u, o) => (await req(f, u, o, 'text'))?.body ?? null;
const postJson = (f, u, b, h = {}) => getJson(f, u, { method: 'POST', headers: { 'content-type': 'application/json', ...h }, body: JSON.stringify(b) });
const snapshot = (rows, complete = true, reason = '') => ({ rows, complete, reason });
const dateTs = s => { const t = Date.parse(s || ''); return Number.isFinite(t) ? t : null; };
const dmy = s => { const m = String(s || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/); return m ? Date.UTC(+m[3], +m[2] - 1, +m[1]) : null; };
const ago = s => { const m = String(s || '').match(/(\d+)\+?\s+Days? Ago/i); return /today/i.test(s || '') ? Date.now() : /yesterday/i.test(s || '') ? Date.now() - 864e5 : m ? Date.now() - m[1] * 864e5 : null; };

// One raw job → stored row (or null when the country cannot be told).
export function normalizeCollectedJob(src, j, fx) {
  if (src.automatic && !discoveredJobAllowed(src, { ...j, country: j.country || countryOf(j.location) })) return null;
  if (Object.hasOwn(j, 'payObserved') && typeof j.payObserved !== 'boolean') return null;
  if (j.countryUnresolved) return null;
  const pay = j.pay === undefined ? (j.text ? parseSalary(j.text) : null) : j.pay;
  const country = j.country || countryOf(j.location);
  if (!country || !COUNTRY[country] || j.id == null || String(j.id).trim() === '' || !j.title || !/^https:\/\//.test(j.url || '')) return null;
  const usd = (v, cur) => fx?.[cur] ? Math.round(v / fx[cur] * (v < 1000 ? 100 : 1)) / (v < 1000 ? 100 : 1) : null;
  const umin = pay ? usd(pay.min, pay.cur) : null, umax = pay ? usd(pay.max, pay.cur) : null;
  const ok = pay && /^[A-Z]{3}$/.test(pay.cur || '') && Number.isFinite(pay.min) && Number.isFinite(pay.max);
  return {
    id: `${src.id}:${j.id}`.slice(0, 120), src: src.id, country, employer: plain(j.employer || src.name).slice(0, 100), ticker: src.ticker, etype: src.type,
    title: plain(j.title).slice(0, 160), location: normalizeJobLocation(j.location), url: j.url.slice(0, 400), category: categorize(j.title, j.hint),
    cur: ok ? pay.cur : null, min: ok ? pay.min : null, max: ok ? pay.max : null, period: ok ? pay.period : null, usd_min: ok ? umin : null, usd_max: ok ? umax : null,
    posted_ts: j.posted || j.posted_ts || null, closing_ts: j.closing || j.closing_ts || null,
    reference: j.reference || null, source_url: j.source_url || j.url, salary_text: j.salary_text ? plain(j.salary_text).slice(0, 1200) : null, salary_url: j.salary_text ? (j.salary_url || j.url) : null,
    ...(Object.hasOwn(j, 'payObserved') ? { pay_observed: j.payObserved } : {}),
  };
}

// Greenhouse and Lever boards (pay is usually in the posting text).
// Employer-supplied remote eligibility still names a country. Strip only the
// remote label, then require explicit country or exact known city evidence; never treat CA/IN/GA as ISO
// codes here because they can also be states or ordinary words.
const greenhousePlaces = value => String(value || '').split(/\s*;\s*/).filter(part => part && !/^(?:hybrid|on-site|in-office)$/i.test(part));
const greenhouseCountry = place => {
  const remote = plain(place).match(/^remote(?:\s*[-:]\s*|\s+)(.+)$/i);
  const name = (remote ? remote[1].trim() : place.trim()).replace(/^\((.*)\)$/, '$1').replace(/:\s*(?:select|all) locations$/i, '').replace(/\s*\(DNU\)$/i, '').trim();
  if (name === 'US') return 'US';
  if (/^Georgia$/i.test(name)) return null; // Country/state ambiguity needs more evidence.
  const explicit = countryCode(name);
  if (explicit) return explicit;
  // Observed labels also use 'Remote - Canberra, Australia' and
  // 'Remote (USA - Boston, MA)'. Require an explicit country component or
  // an exact established city; never infer from exclusion/eligibility prose.
  if (remote) {
    if (/\b(?:except|excluding|outside|not|or|worldwide|global)\b/i.test(name)) return null;
    const countries = [...new Set(name.split(/,|\s+-\s+/).map(s => s.trim() === 'US' ? 'US' : countryCode(s)).filter(Boolean))];
    const lastCountry = countryCode(name.split(',').at(-1));
    if (lastCountry === 'US' && countries.includes('GE')) countries.splice(countries.indexOf('GE'), 1);
    if (countries.length) return countries.length === 1 ? countries[0] : null;
    return Object.entries(CITIES).find(([, cities]) => cities.includes(fold(name)))?.[0] || null;
  }
  return countryOf(place);
};
export function greenhouseJobs(postings, sourceId) {
  let complete = true;
  const rows = postings.flatMap(x => {
    let url = x.absolute_url;
    // The employer's Greenhouse feed publishes HTTP links, but this exact
    // official host/path has been checked to serve the same posting over HTTPS.
    if (sourceId === 'block') {
      try { const u = new URL(url); if (u.protocol === 'http:' && u.hostname === 'block.xyz' && !u.username && !u.password && /^\/careers\/jobs\//.test(u.pathname)) { u.protocol = 'https:'; url = u.href; } } catch { /* rejected by normalization */ }
    }
    const raw = { id: x.id, title: x.title, location: x.location?.name, url, text: x.content, posted: dateTs(x.first_published || x.updated_at), closing: dateTs(x.application_deadline), hint: x.departments?.[0]?.name };
    const metadataPlaces = (x.metadata || []).filter(m => m.name === 'Job Posting Location').flatMap(m => [m.value].flat()).filter(v => typeof v === 'string' && v.trim());
    const officePlaces = (x.offices || []).map(o => o.location).filter(v => typeof v === 'string' && v.trim());
    // Keep the base ID for the country that the previous reader emitted.
    // Partial sources cannot prune old IDs when a listing gains more countries.
    const legacyPlaces = metadataPlaces.length ? metadataPlaces : raw.location && countryOf(raw.location) ? [raw.location] : officePlaces;
    const legacyCountries = new Set(legacyPlaces.map(place => place.trim() === 'US' ? 'US' : countryOf(place) || (place.trim() === 'Ohio' && (x.offices || []).some(o => /,\s*OH$/.test(o.name || '')) ? 'US' : null)).filter(Boolean));
    const listedPlaces = greenhousePlaces(raw.location);
    // Five observed Okta postings label the US state Georgia ambiguously.
    // Their exact attached office and US-only place list establish the scope.
    const oktaUsPlaces = new Set(['Florida', 'Georgia', 'North Carolina', 'Tennessee', 'South Carolina', 'Virginia', 'Massachusetts', 'New York, New York', 'Washington, DC']);
    const oktaUsScope = sourceId === 'okta' && !metadataPlaces.length && (x.offices || []).some(o => o.id === 21497 && o.name === 'US Remote East Coast') && listedPlaces.length > 0 && listedPlaces.every(p => oktaUsPlaces.has(p));
    if (oktaUsScope && legacyCountries.size === 1 && legacyCountries.has('GE')) { legacyCountries.delete('GE'); legacyCountries.add('US'); }
    const places = (metadataPlaces.length ? metadataPlaces : oktaUsScope || listedPlaces.some(greenhouseCountry) ? listedPlaces : officePlaces).flatMap(greenhousePlaces);
    if (!places.length || x.id == null || String(x.id).trim() === '') { complete = false; return [{ ...raw, countryUnresolved: true }]; }
    const grouped = new Map();
    for (const place of places) {
      // Standalone US is explicit in the observed metadata, unlike ambiguous
      // state/province abbreviations. Office strings can resolve an unknown
      // metadata place only with corroborating employer-supplied geography.
      const cc = (oktaUsScope ? 'US' : !metadataPlaces.length && place === 'Porto' && listedPlaces.includes('Portugal') ? 'PT' : greenhouseCountry(place)) || (place.trim() === 'Ohio' && (x.offices || []).some(o => /,\s*OH$/.test(o.name || '')) ? 'US' : null);
      if (!cc) { complete = false; continue; }
      if (!grouped.has(cc)) grouped.set(cc, []);
      grouped.get(cc).push(place);
    }
    if (!grouped.size) return [{ ...raw, countryUnresolved: true }];
    return [...grouped].map(([country, names]) => ({ ...raw, id: legacyCountries.size === 1 && legacyCountries.has(country) || legacyCountries.size === 0 && grouped.size === 1 ? x.id : `${x.id}:${country}`, country, location: [...new Set(names)].join('; ') }));
  });
  return snapshot(rows, complete, complete ? '' : 'location-scope-unresolved');
}
async function greenhouse(f, src) {
  const j = await getJson(f, `https://boards-api.greenhouse.io/v1/boards/${src.args[0]}/jobs?content=true`);
  if (!Array.isArray(j?.jobs)) return null;
  return greenhouseJobs(j.jobs, src.id);
}

async function lever(f, src) {
  const j = await getJson(f, `https://api.lever.co/v0/postings/${src.args[0]}?mode=json`);
  if (!Array.isArray(j)) return null;
  return snapshot(j.map(x => ({
    id: x.id, title: x.text, location: x.categories?.location, url: x.hostedUrl, country: x.country && COUNTRY[x.country.toUpperCase()] ? x.country.toUpperCase() : null, posted: Number(x.createdAt) || null, hint: x.categories?.team,
    text: [x.salaryRange ? `${x.salaryRange.currency} ${x.salaryRange.min} - ${x.salaryRange.max} ${x.salaryRange.currency} per ${x.salaryRange.interval === 'per-hour-wage' ? 'hour' : 'year'}` : '', x.additionalPlain, x.descriptionPlain, ...(x.lists || []).map(l => l.content)].join(' '),
  })));
}
async function ashby(f, src) {
  const j = await getJson(f, `https://api.ashbyhq.com/posting-api/job-board/${src.args[0]}?includeCompensation=true`);
  if (!Array.isArray(j?.jobs)) return null;
  return snapshot(j.jobs.map(x => ({ id: x.id, title: x.title, location: x.location, url: x.jobUrl, country: countryCode(x.address?.postalAddress?.addressCountry), posted: dateTs(x.publishedAt), hint: x.department, text: x.compensation?.compensationTierSummary || '', salary_text: x.compensation?.compensationTierSummary || '' })));
}
// Strict opt-in: a country facet is eligibility evidence only when the exact
// posting detail also names that country. Additional locations need a literal
// country label, never a city/currency guess or a similar-job recommendation.
export function strictWorkdayPlace(info, row, site) {
  if (!info || typeof info !== 'object' || info.jobReqId !== row.id || info.jobPostingSiteId !== site) return null;
  const key = value => plain(value).normalize('NFKC').toLowerCase();
  if (!row.title || key(info.title) !== key(row.title)) return null;
  try { if (new URL(info.externalUrl).href !== new URL(row.url).href) return null; } catch { return null; }
  if (!Object.hasOwn(COUNTRY, row.country) || typeof info.location !== 'string' || !plain(info.location)) return null;
  const primary = countryCode(info.country?.descriptor);
  if (!primary) return null;
  const requisitionCountry = info.jobRequisitionLocation?.country;
  if (requisitionCountry && ((requisitionCountry.descriptor && countryCode(requisitionCountry.descriptor) !== primary) || (requisitionCountry.alpha2Code && requisitionCountry.alpha2Code !== primary))) return null;
  const suffixCountry = location => {
    if (typeof location !== 'string') return null;
    const label = plain(location).split(',').at(-1).trim();
    // A plain state/country homonym in an additional label is not enough.
    if (fold(label) === 'georgia') return null;
    return countryCode(label);
  };
  const primaryLabel = suffixCountry(info.location);
  if (primaryLabel && primaryLabel !== primary) return null;
  if (info.additionalLocations != null && (!Array.isArray(info.additionalLocations) || info.additionalLocations.some(x => typeof x !== 'string'))) return null;
  if (row.country === primary) return { country: row.country, location: plain(info.location) };
  const match = (info.additionalLocations || []).find(location => suffixCountry(location) === row.country);
  return match ? { country: row.country, location: plain(match) } : null;
}
// Fixed diagnostics explain strict rejection; they never relax placement checks.
export function workdayDetailRejection(info,row,site) {
 try {
  if(!info||typeof info!=='object')return 'place-null';
  if(info.jobReqId!==row.id)return 'reqid-mismatch';
  if(info.jobPostingSiteId!==site)return 'site-mismatch';
  const key=value=>plain(value).normalize('NFKC').toLowerCase();
  if(!row.title||key(info.title)!==key(row.title))return 'title-mismatch';
  try{if(new URL(info.externalUrl).href!==new URL(row.url).href)return 'external-url-mismatch';}catch{return 'external-url-mismatch';}
  return 'place-null';
 } catch(error) {if(['AUTOMATIC_SOURCE_REQUEST_CAP','AUTOMATIC_BUDGET_EXHAUSTED'].includes(error?.code))throw error;return 'other'; }
}
// Automatic Workday sources retain the exact registered listing scope.
// Metadata discovery is not a job snapshot and its unfiltered rows are not accepted.
function registeredWorkdayScope(first, source) {
  const requested = workdayQueryFacets(source.careerUrl), nodes = [];
  if(!requested)return null;
  if(Object.keys(requested).length===0)return {facets:{},bounds:[]};
  if(!Number.isSafeInteger(first.total)||first.total<0||!Array.isArray(first.facets))return null;
  const visit = (value, depth=0) => {
    if (!value || typeof value !== 'object' || depth>8) return;
    if (typeof value.facetParameter==='string' && Array.isArray(value.values)) nodes.push(value);
    for (const child of Array.isArray(value.values)?value.values:[]) visit(child,depth+1);
  };
  for (const facet of first.facets) visit(facet);
  const facets={},bounds=[];
  for (const [key,values] of Object.entries(requested)) {
    const matches=nodes.filter(node=>node.facetParameter===key);
    if(matches.length!==1)return null;
    let sum=0;
    for(const value of values){
      const options=matches[0].values.filter(option=>option?.id===value);
      if(options.length!==1)return null;
      const count=options[0].count;
      if(!Number.isSafeInteger(count)||count<0||count>first.total||count>1000000)return null;
      sum+=count;
    }
    facets[key]=values;bounds.push(sum);
  }
  return {facets,bounds};
}
export function registeredWorkdayFacets(first, source) {
  return registeredWorkdayScope(first,source)?.facets??null;
}
// NTU's observed posting URLs append '-1' to a separate R+8-digit requisition.
// Permit only the recorded shape with independent listing/detail agreement and
// an exact posting slug. This is a temporary placement ID, never the stored ID.
function ntuWorkdayPlacementId(info,row,source) {
  if(source.id!==NTU_AUTOMATIC_SOURCE_ID||source.args.join('|')!=='ntu.wd3.myworkdayjobs.com|ntu|Careers')return row.id;
  const req=info?.jobReqId;
  if(typeof req!=='string'||!/^R\d{8}$/.test(req)||row.id!==req+'-1')return row.id;
  if(!Array.isArray(row.bulletFields)||row.bulletFields.length!==1||row.bulletFields[0]!==req)return row.id;
  if(typeof row.path!=='string'||info.jobPostingId!==row.path.split('/').at(-1))return row.id;
  if(info.externalUrl!==row.url)return row.id;
  return req;
}
export async function automaticWorkday(f, src, log=()=>{}) {
  const [host,tenant,site]=src.args,base=`https://${host}/wday/cxs/${tenant}/${site}`;
  const pub=host.includes('myworkdaysite')?`https://${host}/recruiting/${tenant}/${site}`:`https://${host}/${site}`;
  const phaseHttp={listing:0,detail:0},detailReasons=emptyWorkdayDetailReasons(),requestLimit=automaticSourceRequestLimit(src.id);let phase='listing',attempts=0,detailValidated=0,listingRejected=0,sourceRequestCap=false;
  const counted=async(...args)=>{
    const before=f.diagnostics?.().httpRequests;
    attempts++;
    if(attempts>requestLimit){sourceRequestCap=true;throw Object.assign(new Error('Automatic source request cap exhausted'),{code:'AUTOMATIC_SOURCE_REQUEST_CAP'});}
    try{return await f(...args);}catch(error){if(error?.code==='AUTOMATIC_SOURCE_REQUEST_CAP')sourceRequestCap=true;throw error;}finally{
      const after=f.diagnostics?.().httpRequests;
      phaseHttp[phase]+=Number.isSafeInteger(before)&&Number.isSafeInteger(after)?Math.max(0,after-before):1;
    }
  };
  const page=(facets,offset)=>postJson(counted,base+'/jobs',{limit:20,offset,searchText:'',appliedFacets:facets});
  const rows=[],seen=new Set();let paginationComplete=false,scopedTotal=null,pagesFetched=0,paginationEnd='unavailable';
  const result=reason=>({rows,complete:false,reason,paginationComplete,scopedTotal,reportedTotal:scopedTotal,pagesFetched,paginationEnd,phaseHttp,detailReasons,listingRejected,detailValidated,sourceRequestCap});
  const probe=await page({},0);
  if(!probe||!Array.isArray(probe.jobPostings)||!Number.isSafeInteger(probe.total)||probe.total<0)return result('invalid-workday-list');
  if(probe.total===0){paginationEnd=probe.jobPostings.length?'total-zero-with-rows':'empty-tenant';return result(probe.jobPostings.length?'total-zero-with-rows':'empty-workday-tenant');}
  const scope=registeredWorkdayScope(probe,src);
  if(!scope){paginationEnd='registered-filter-unconfirmed';return result('registered-workday-filter-unconfirmed');}
  const {facets,bounds}=scope;
  let current=Object.keys(facets).length?await page(facets,0):probe;
  if(!current||!Array.isArray(current.jobPostings)||!Number.isSafeInteger(current.total)||current.total<0)return result('invalid-workday-list');
  if(current.total===0&&current.jobPostings.length){paginationEnd='total-zero-with-rows';return result('total-zero-with-rows');}
  if(bounds.length&&(current.total>=probe.total||bounds.some(bound=>current.total>bound))){paginationEnd='registered-filter-unconfirmed';return result('registered-workday-filter-unconfirmed');}
  scopedTotal=current.total;
  if(scopedTotal===0){paginationEnd='empty-scope';return result('empty-workday-scope');}
  paginationEnd='row-limit';
  for(let offset=0;offset<AUTOMATIC_PER_SOURCE;offset+=20){
    if(offset)current=await page(facets,offset);
    if(!current||!Array.isArray(current.jobPostings)||current.jobPostings.length>20){paginationEnd=attempts>=requestLimit?'request-cap':'invalid-page';break;}
    pagesFetched++;
    // Workday's observed continuation pages use total:0; only page zero owns the total.
    if(current.total!==scopedTotal&&!(offset>0&&current.total===0)){paginationEnd='changed-total';break;}
    for(const posting of current.jobPostings){
      let acceptedListing=false;
      try {
      if(!posting||typeof posting!=='object'||Array.isArray(posting))continue;
      const path=posting.externalPath,id=typeof path==='string'?path.split('_').at(-1):'';
      if(!id||!/^\/job\/[^?#]+$/.test(path)||path.includes('..')||/%2e|%2f|%5c/i.test(path)||/[\\\x00-\x20\x7f]/.test(path)||typeof posting.title!=='string'||!posting.title.trim()||seen.has(path))continue;
      // Reject normalization that would escape either the exact API tenant or public job prefix.
      const apiUrl=new URL(base+path),publicUrl=new URL(pub+path);
      if(apiUrl.origin!==new URL(base).origin||publicUrl.origin!==new URL(pub).origin||
         apiUrl.pathname!==new URL(base).pathname+path||publicUrl.pathname!==new URL(pub).pathname+path||
         !apiUrl.pathname.startsWith(new URL(base).pathname+'/job/')||!publicUrl.pathname.startsWith(new URL(pub).pathname+'/job/'))continue;
      const listed={id,title:posting.title,location:posting.locationsText,url:pub+path,path,bulletFields:Array.isArray(posting.bulletFields)&&posting.bulletFields.length===1&&typeof posting.bulletFields[0]==='string'?[posting.bulletFields[0]]:null,posted:ago(posting.postedOn),country:null,countryUnresolved:true,payObserved:false};
      seen.add(path);rows.push(listed);acceptedListing=true;
      } catch(error) {if(['AUTOMATIC_SOURCE_REQUEST_CAP','AUTOMATIC_BUDGET_EXHAUSTED'].includes(error?.code))throw error;}
      finally {if(!acceptedListing)listingRejected++;}
    }
    if(offset+current.jobPostings.length>=scopedTotal){paginationComplete=rows.length===scopedTotal;paginationEnd=paginationComplete?'reported-total':'invalid-or-duplicate-rows';break;}
    if(current.jobPostings.length<20){paginationEnd='short-before-total';break;}
    if(attempts>=requestLimit){paginationEnd='request-cap';sourceRequestCap=true;break;}
  }
  phase='detail';
  for(const [index,row] of rows.entries()){
    if(attempts>=requestLimit){sourceRequestCap=true;detailReasons['unattempted-cap']+=rows.length-index;break;}
    const detailBefore=phaseHttp.detail;
    let failure=null,stopped=null;
    // Preserve the existing headers, timeout, retry and provider-cooldown policy
    // while retaining a fixed last-failure category; no provider body is stored.
    const observed=async(...args)=>{
      let response;
      try{response=await counted(...args);}catch(error){if(error?.code==='AUTOMATIC_SOURCE_REQUEST_CAP')stopped='unattempted-cap';else if(error?.code==='AUTOMATIC_BUDGET_EXHAUSTED')stopped='other';else failure='detail-http-error';throw error;}
      if(!response.ok)failure='detail-http-error';
      return {ok:response.ok,status:response.status,headers:response.headers,json:async()=>{
        try{const value=await response.json();failure=null;return value;}catch(error){failure='detail-invalid-json';throw error;}
      }};
    };
    const d=await getJson(observed,base+row.path);
    if(!d&&stopped){
      if(stopped==='unattempted-cap')sourceRequestCap=true;
      // A failed first attempt followed by a blocked retry is still an attempted
      // detail. Only the untouched rows belong to the unattempted count.
      const attempted=phaseHttp.detail>detailBefore;
      if(attempted)detailReasons[failure||'other']++;
      detailReasons['unattempted-cap']+=rows.length-index-(attempted?1:0);break;
    }
    if(!d&&failure){if(phaseHttp.detail>detailBefore)detailReasons[failure]++;continue;}
    // Treat every provider-derived conversion as fallible. Commit row fields only
    // after placement and metadata are both validated, so one malformed JSON
    // object cannot abort the source or leave a partly accepted row behind.
    let detail;
    try {
      const info=d?.jobPostingInfo;
      if(info?.title!=null&&typeof info.title!=='string'||info?.externalUrl!=null&&typeof info.externalUrl!=='string'||info?.country?.descriptor!=null&&typeof info.country.descriptor!=='string'){detailReasons.other++;continue;}
      const placement={...row,id:ntuWorkdayPlacementId(info,row,src),country:countryCode(info?.country?.descriptor)};
      const place=strictWorkdayPlace(info,placement,site);
      if(!place){detailReasons[workdayDetailRejection(info,placement,site)]++;continue;}
      if(place.country!==src.country){detailReasons['wrong-country']++;continue;}
      const payObserved=typeof info.jobDescription==='string';
      detail={country:place.country,location:place.location,countryUnresolved:false,payObserved,text:payObserved?info.jobDescription:'',posted:dateTs(info.startDate)||row.posted,closing:dateTs(info.endDate)||null};
    } catch(error) {if(['AUTOMATIC_SOURCE_REQUEST_CAP','AUTOMATIC_BUDGET_EXHAUSTED'].includes(error?.code))throw error;detailReasons.other++;continue;}
    Object.assign(row,detail);detailValidated++;
  }
  const detailSummary=workdayDetailSummaries([{src:src.id,rawCount:rows.length,phaseHttp,detailReasons}])[0];
  if(detailSummary)log(`${src.id}: Workday detail rejection counts: ${detailSummary.summary}; listingRejected=${listingRejected}`);
  log(`${src.name}: ${phaseHttp.listing} listing HTTP; ${phaseHttp.detail} detail HTTP; ${detailValidated}/${rows.length} detailed; pagination complete ${paginationComplete}`);
  return result(!paginationComplete?'workday-pagination-incomplete':detailValidated<rows.length?'workday-details-incomplete':'workday-scope-verified');
}
// Workday: jobs are read country by country (using the site's own country filter), pay from the job page where it is published.
async function workday(f, src, log) {
  if(src.automatic)return automaticWorkday(f,src,log);
  const [host, tenant, site] = src.args;
  const base = `https://${host}/wday/cxs/${tenant}/${site}`;
  const pub = host.includes('myworkdaysite') ? `https://${host}/recruiting/${tenant}/${site}` : `https://${host}/${site}`;
  const page = (facets, offset) => postJson(f, `${base}/jobs`, { limit: 20, offset, searchText: '', appliedFacets: facets });
  const first = await page({}, 0);
  if (!Array.isArray(first?.jobPostings) || !Number.isFinite(first.total)) return null;
  let complete = true;
  let param = null, values = [];
  for (const fc of first.facets || []) {
    if (/country/i.test(fc.facetParameter || '') && fc.values?.length) { param = fc.facetParameter; values = fc.values; }
    for (const sub of fc.values || []) if (sub.values && /country/i.test(sub.facetParameter || sub.descriptor || '')) { param = sub.facetParameter; values = sub.values; }
  }
  const out = [], workdaySeen = new Map();
  const take = (list, country) => { for (const x of list || []) if (x.externalPath) {
    const countries = [...new Set((x.bulletFields || []).map(countryCode).filter(Boolean))];
    const id = x.externalPath.split('_').pop() || x.externalPath;
    if (workdaySeen.has(id)) { if (country) workdaySeen.get(id).country ||= country; continue; }
    const row = { id, title: x.title, location: x.locationsText || x.bulletFields?.[0], url: pub + x.externalPath, path: x.externalPath, country: country || (countries.length === 1 ? countries[0] : null), posted: ago(x.postedOn) };
    out.push(row); workdaySeen.set(id, row);
  } };
  // Preserve the already received first page even if a subsequent country query fails.
  take(first.jobPostings);
  if (param && values.length) {
    for (const v of values) {
      const cc = countryCode(v.descriptor);
      if (!cc) { complete = false; continue; }
      if (!Number.isFinite(v.count)) complete = false;
      for (let off = 0; off < (v.count || 0) && out.length < PER_SOURCE; off += 20) {
        const p = await page({ [param]: [v.id] }, off);
        if (!p?.jobPostings?.length) { complete = false; break; }
        take(p.jobPostings, cc);
      }
    }
  } else {
    take(first.jobPostings);
    for (let off = 20; off < Math.min(first.total || 0, PER_SOURCE); off += 20) { const p = await page({}, off); if (!p?.jobPostings?.length) { complete = false; break; } take(p.jobPostings); }
  }
  if (new Set(out.map(x => x.id)).size !== first.total) complete = false;
  // Job pages: the country where the list could not tell it, and pay where employers publish it.
  // Geography determines whether a row can be retained at all. Spend the same
  // bounded detail budget on unresolved rows before optional pay enrichment;
  // keep the original output order and the source's completeness checks.
  for (const x of out) {
    // This observed Workday office label names the US state, not the country.
    // Explicit country facets/bullets already on the row keep priority.
    if (src.strictDetailGeography) x.countryUnresolved = true;
    else x.country ||= /^Atlanta,\s*Georgia(?:\s*\([^()]*\))?$/i.test(plain(x.location)) ? 'US' : countryOf(x.location);
    x.payObserved = false;
  }
  const preferred = new Set(src.countries || []);
  const detailOrder = src.strictDetailGeography
    ? [...out.filter(x => preferred.has(x.country)), ...out.filter(x => !preferred.has(x.country))]
    : [...out.filter(x => !x.country), ...out.filter(x => PAY_COUNTRIES.has(x.country))];
  // Pages that decide a job's country are all read; pages read only for pay stay bounded.
  let payChecks = 0, pagesRead = 0;
  for (const x of detailOrder) {
    if (!src.strictDetailGeography && x.country && payChecks++ >= PAY_DETAILS) break;
    const cc = x.country;
    pagesRead++;
    const d = await getJson(f, base + x.path);
    const i = d?.jobPostingInfo;
    if (src.strictDetailGeography) {
      // Employer-scoped automatic sources may have no country facet at all.
      // The exact posting detail can supply the explicit country in that case.
      const placementRow = src.automatic && !x.country ? { ...x, country: countryCode(i?.country?.descriptor) } : x;
      const place = strictWorkdayPlace(i, placementRow, site);
      if (!place) { complete = false; continue; }
      x.country = place.country; x.location = place.location; x.countryUnresolved = false;
    } else {
      if (!i) { x.country = cc; continue; }
      x.country = cc || countryCode(i.country?.descriptor);
      x.location = i.location || x.location;
    }
    x.payObserved = typeof i.jobDescription === 'string';
    x.text = x.payObserved ? i.jobDescription : '';
    x.posted = dateTs(i.startDate) || x.posted;
    if (src.automatic) x.closing = dateTs(i.endDate) || null;
  }
  if (src.strictDetailGeography && out.some(x => x.countryUnresolved)) complete = false;
  log(`${src.name}: ${values.length} countries in filter, ${pagesRead} job pages read`);
  return snapshot(out, complete, complete ? '' : 'incomplete-or-capped');
}
// Opt-in geography is accepted only from one detail posting bound to the exact
// listed URL/title. Plant names and the employer's home country are not evidence.
export function parseJobGeography(html, row, { employerName } = {}) {
  if (typeof html !== 'string' || html.length > 2000000) return null;
  const key = value => plain(value).normalize('NFKC').toLowerCase();
  const explicitCountry = value => Object.hasOwn(COUNTRY, plain(value)) ? plain(value) : countryCode(value);
  const sameUrl = value => { try { return new URL(plain(value)).href === new URL(plain(row.url)).href; } catch { return false; } };
  const nodes = [];
  const visit = x => { if (Array.isArray(x)) return x.forEach(visit); if (!x || typeof x !== 'object') return; if ([x['@type']].flat().includes('JobPosting')) nodes.push(x); if (x['@graph']) visit(x['@graph']); if (Array.isArray(x.itemListElement)) x.itemListElement.forEach(i => visit(i?.item || i)); };
  for (const m of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi)) { try { visit(JSON.parse(m[1])); } catch { /* fail closed below */ } }
  // Small inert tag tree: exact attributes, boolean itemscope and parent scopes.
  // Comments and script/style bodies cannot create fake metadata elements.
  const elements = [], stack = [], voids = new Set('area base br col embed hr img input link meta param source track wbr'.split(' '));
  for (const token of html.matchAll(/<!--[\s\S]*?-->|<script\b[^>]*>[\s\S]*?<\/script\s*>|<style\b[^>]*>[\s\S]*?<\/style\s*>|<\/?[a-z][^>]*>/gi)) {
    const raw = token[0];
    if (/^<!--|^<(?:script|style)\b/i.test(raw)) continue;
    const tag = raw.match(/^<\/?([a-z][\w:-]*)/i)?.[1].toLowerCase();
    if (!tag) continue;
    if (/^<\//.test(raw)) {
      const at = stack.findLastIndex(e => e.tag === tag);
      if (at < 0) continue;
      for (let i = stack.length - 1; i >= at; i--) { const e = stack.pop(); e.end = token.index + raw.length; if (i !== at) e.malformed = true; }
      continue;
    }
    const attrs = Object.create(null); let invalid = false;
    const body = raw.slice(raw.match(/^<[a-z][\w:-]*/i)[0].length).replace(/\/?>$/, '');
    for (const m of body.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
      const name = m[1].toLowerCase(); if (Object.hasOwn(attrs, name)) invalid = true;
      attrs[name] = plain(m[2] ?? m[3] ?? m[4] ?? '');
    }
    const e = { tag, attrs, parent: stack.at(-1) || null, start: token.index, openEnd: token.index + raw.length, end: null, malformed: invalid };
    elements.push(e);
    if (voids.has(tag)) e.end = e.openEnd; else stack.push(e);
  }
  const typed = (e, type) => !e.malformed && Object.hasOwn(e.attrs, 'itemscope') && new RegExp(`^https?://schema\\.org/${type}$`).test(e.attrs.itemtype || '');
  const prop = (e, value) => (e.attrs.itemprop || '').split(/\s+/).includes(value);
  const enclosingScope = e => { for (let p = e.parent; p; p = p.parent) if (Object.hasOwn(p.attrs, 'itemscope')) return p; return null; };
  const scopes = elements.filter(e => typed(e, 'JobPosting'));
  const visibleCompanyMatches = scope => {
    const companies = elements.filter(e => e.attrs.id === 'job-company' && (!scope || enclosingScope(e) === scope));
    return companies.length <= 1 && companies.every(e => !e.malformed && e.end && key(html.slice(e.openEnd, e.end)).replace(/^company\s*:\s*/, '') === key(employerName));
  };
  if (nodes.length) {
    if (nodes.length !== 1 || scopes.length || !sameUrl(nodes[0].url || nodes[0]['@id']) || key(nodes[0].title) !== key(row.title)) return null;
    if (employerName) {
      const org = nodes[0].hiringOrganization;
      if (key(typeof org === 'string' ? org : org?.name) !== key(employerName) || !visibleCompanyMatches(null)) return null;
    }
    const bound = `<script type="application/ld+json">${JSON.stringify(nodes[0])}</script>`;
    const records = parseJobPostings(bound, row.url);
    if (records.length !== 1) return null;
    const country = explicitCountry(records[0].countryName);
    return country ? { country, location: records[0].location, datesHtml: bound } : null;
  }
  if (scopes.length !== 1 || !scopes[0].end) return null;
  const scope = scopes[0];
  if (employerName) {
    const employers = elements.filter(e => e.tag === 'meta' && prop(e, 'hiringOrganization') && enclosingScope(e) === scope);
    if (employers.length !== 1 || employers[0].malformed || key(employers[0].attrs.content) !== key(employerName)) return null;
    // Visible Company is supplementary evidence, never a substitute for the bound organization.
    if (!visibleCompanyMatches(scope)) return null;
  }
  const canonical = elements.filter(e => e.tag === 'link' && !e.malformed && e.attrs.rel?.toLowerCase() === 'canonical');
  if (canonical.length !== 1 || !sameUrl(canonical[0].attrs.href)) return null;
  const titles = elements.filter(e => e.tag === 'h1' && prop(e, 'title') && enclosingScope(e) === scope && !e.malformed && e.end);
  if (titles.length !== 1 || key(html.slice(titles[0].openEnd, titles[0].end)) !== key(row.title)) return null;
  const locations = elements.filter(e => prop(e, 'jobLocation') && enclosingScope(e) === scope);
  if (locations.length !== 1 || !typed(locations[0], 'Place') || !locations[0].end) return null;
  const addresses = elements.filter(e => prop(e, 'address') && enclosingScope(e) === locations[0]);
  if (addresses.length !== 1 || !typed(addresses[0], 'PostalAddress') || !addresses[0].end) return null;
  const fields = elements.filter(e => e.tag === 'meta' && !e.malformed && enclosingScope(e) === addresses[0]);
  const countries = fields.filter(e => prop(e, 'addressCountry'));
  if (countries.length !== 1) return null;
  const country = explicitCountry(countries[0].attrs.content);
  const localities = fields.filter(e => prop(e, 'addressLocality') && e.attrs.content);
  return country ? { country, location: localities.length === 1 ? localities[0].attrs.content : row.location, datesHtml: html.slice(scope.start, scope.end) } : null;
}
// SAP SuccessFactors career sites, in either the older page layout or the newer one with a search service.
// Country code at the end of a career-site location ("Pune, MH, IN", "Mumbai, MH, IND,", "Wroclaw, DS, PL, 53-238").
const sfCountry = loc => {
  const code = (String(loc || '').match(/,\s*([A-Z]{2,3})(?:\s*,\s*\d[\w -]*)?\s*,?\s*$/) || [])[1];
  return !code ? null : code.length === 3 ? iso3To2(code) : COUNTRY[code] ? code : null;
};
async function successfactors(f, src) {
  const host = `https://${src.args[0]}`;
  const scope = src.sfScope;
  // Opt-in scopes are explicit registry assertions; never guess a brand from a label.
  if (scope && (!/^\/go\/[A-Za-z0-9-]+\/\d+\/$/.test(scope.listPath || '') || !/^\/[A-Za-z0-9-]+\/job\/$/.test(scope.jobPath || '') || typeof scope.employerName !== 'string' || !scope.employerName.trim() || !Object.hasOwn(COUNTRY, scope.country))) return null;
  const listPath = scope?.listPath || '/search/';
  const allowed = row => {
    if (!scope) return true;
    try { const url = new URL(row.url); return url.origin === host && url.pathname.startsWith(scope.jobPath) && !url.search && !url.hash && !/%(?:2f|5c|2e)/i.test(row.url) && !/(?:^|\/)\.\.?(?:\/|$)/.test(row.url); } catch { return false; }
  };
  const out = [];
  const first = await req(f, `${host}${listPath}?q=&sortColumn=referencedate&sortDirection=desc&startrow=0`, {}, 'text');
  if (!first) return null;
  const tableRows = t => (t.split(/<tr class="data-row/).slice(1)).map(r => {
    const a = r.match(/href="(\/(?:[A-Za-z-]+\/)?job\/[^"]+)"[^>]*>([^<]+)</);
    const loc = (r.match(/class="jobLocation">\s*([^<]+)</) || [])[1];
    const date = (r.match(/class="jobDate[^"]*">\s*([^<]+)</) || [])[1];
    const dept = (r.match(/class="jobDepartment">\s*([^<]+)</) || [])[1];
    if (!a) return null;
    return { id: (a[1].match(/\/(\d+)\/?$/) || [])[1] || a[1], title: a[2], location: loc, country: sfCountry(loc), url: host + a[1], posted: dateTs(date), hint: dept };
  }).filter(Boolean);
  const tileRows = t => t.split(/<li class="job-tile /).slice(1).map(block => {
    const a = block.match(scope ? /href="(\/(?:[A-Za-z-]+\/)?job\/[^"]+)"[^>]*>\s*([^<]+)</ : /href="(\/job\/[^"]+)"[^>]*>\s*([^<]+)</);
    const field = key => plain((block.match(new RegExp(`id="[^"]+-desktop-section-${key}-value">([^<]+)<`)) || [])[1]);
    if (!a) return null;
    const location = field('location') || field('city');
    return { id: (a[1].match(/\/(\d+)\/?$/) || [])[1] || a[1], title: plain(a[2]), location, country: sfCountry(location), url: host + plain(a[1]), posted: dateTs(field('date')) };
  }).filter(Boolean);
  const rowsOf = t => t.includes('class="job-tile ') ? tileRows(t) : tableRows(t);
  let rows = rowsOf(first.body);
  if (rows.length) {
    out.push(...rows.filter(allowed));
    // Page size from the page's own label ("Results 1 – 10 of 456", "Showing 1 to 25 of 132 Jobs"); 25 otherwise.
    const label = first.body.match(/(?:Results|Showing)\s*(?:<[^>]+>\s*)*1\s*(?:[–-]|to)\s*(\d+)\s*(?:<[^>]+>\s*)*of\s*(?:<[^>]+>\s*)*([\d,.]+)/);
    const size = Number(label?.[1]), total = Number(String(label?.[2] || '').replace(/[,.]/g, ''));
    const step = size >= 5 && size <= 100 && size === rows.length ? size : 25;
    // With the page's stated total, a page that does not answer is skipped (up to three) instead of ending the read.
    const cap = PER_SOURCE;
    let missed = 0;
    for (let s = step; (total ? s < total : rows.length >= step) && (scope ? s < cap : out.length < cap); s += step) {
      const t = await getText(f, `${host}${listPath}?q=&sortColumn=referencedate&sortDirection=desc&startrow=${s}`);
      rows = t ? rowsOf(t) : [];
      if (!rows.length) { if (total && ++missed <= 3) continue; break; }
      out.push(...rows.filter(allowed));
    }
    return snapshot(out, false, 'html-total-unverified');
  }
  // An empty scoped page must never fall back to a shared all-brand service.
  if (scope) return snapshot([], false, 'scoped-html-empty-or-unverified');
  // Newer layout: the page carries a token for its job search service.
  const token = (first.body.match(/CSRFToken\s*=\s*["']([^"']+)/) || [])[1];
  if (!token) return null;
  const cookie = (first.headers.getSetCookie?.() || []).map(c => c.split(';')[0]).join('; ');
  const locale = (first.body.match(/"locale"\s*:\s*"([a-z]{2}_[A-Z]{2})"/) || first.body.match(/locale=([a-z]{2}_[A-Z]{2})/) || [])[1] || 'en_US';
  for (let p = 0; p < PER_SOURCE / 10 && out.length < PER_SOURCE; p++) {
    const j = await postJson(f, `${host}/services/recruiting/v1/jobs`, { locale, pageNumber: p, sortBy: 'date', keywords: '', location: '', facetFilters: {}, brand: '', skills: [], categoryId: 0, alertId: '', rcmCandidateId: '' }, { 'x-csrf-token': token, cookie });
    if (!Array.isArray(j?.jobSearchResult)) return snapshot(out, false, 'page-failed');
    const list = j.jobSearchResult;
    if (!list.length) return snapshot(out);
    for (const { response: r } of list) {
      const loc = (r.jobLocationShort || [])[0] || '';
      const parts = loc.split(',').map(s => s.trim()).filter(Boolean);
      out.push({ id: r.id, title: r.unifiedStandardTitle, location: loc, country: countryCode(parts[parts.length - 1]) || countryOf(loc), url: `${host}/job/${r.urlTitle}/${r.id}-${(r.supportedLocales || [locale])[0]}/`, posted: dmy(r.unifiedStandardStart) });
    }
  }
  return snapshot(out, false, 'page-limit');
}
// Oracle Recruiting Cloud.
async function oracle(f, src) {
  const [host, site] = src.args;
  const out = [];
  for (let off = 0; off < PER_SOURCE; off += 25) {
    const j = await getJson(f, `https://${host}/hcmRestApi/resources/latest/recruitingCEJobRequisitions?onlyData=true&expand=requisitionList.secondaryLocations&finder=findReqs;siteNumber=${site},limit=25,offset=${off},sortBy=POSTING_DATES_DESC`);
    const it = j?.items?.[0];
    if (!it || !Array.isArray(it.requisitionList)) return off ? snapshot(out, false, 'page-failed') : null;
    for (const r of it.requisitionList || []) out.push({ id: r.Id, title: r.Title, location: r.PrimaryLocation, country: r.PrimaryLocationCountry, url: `https://${host}/hcmUI/CandidateExperience/en/sites/${site}/job/${r.Id}`, posted: dateTs(r.PostedDate), text: r.ShortDescriptionStr || '' });
    const total = it.TotalJobsCount;
    if (Number.isSafeInteger(total) && total >= 0 && out.length === total) return snapshot(out);
    if (Number.isSafeInteger(total) && out.length > total) return snapshot(out, false, 'contradictory-total');
    if (it.requisitionList.length < 25) return snapshot(out, false, 'total-unverified');
  }
  return snapshot(out, false, 'page-limit');
}
async function smartrecruiters(f, src) {
  const out = [];
  for (let off = 0; off < PER_SOURCE; off += 100) {
    const j = await getJson(f, `https://api.smartrecruiters.com/v1/companies/${src.args[0]}/postings?limit=100&offset=${off}`);
    if (!Array.isArray(j?.content)) return off ? snapshot(out, false, 'page-failed') : null;
    for (const x of j.content || []) out.push({ id: x.id, title: x.name, location: x.location?.fullLocation, country: (x.location?.country || '').toUpperCase(), url: `https://jobs.smartrecruiters.com/${src.args[0]}/${x.id}`, posted: dateTs(x.releasedDate), hint: x.function?.label || x.department?.label });
    if (Number.isSafeInteger(j.totalFound) && j.totalFound >= 0 && out.length === j.totalFound) return snapshot(out);
    if (j.content.length < 100) return snapshot(out, j.totalFound === undefined, j.totalFound === undefined ? '' : 'total-mismatch');
  }
  return snapshot(out, false, 'page-limit');
}
// Amazon: country by country.
const AMAZON = 'USA:US CAN:CA GBR:GB IRL:IE DEU:DE FRA:FR ESP:ES ITA:IT NLD:NL POL:PL CZE:CZ LUX:LU BEL:BE SWE:SE AUT:AT IND:IN JPN:JP CHN:CN SGP:SG AUS:AU NZL:NZ BRA:BR MEX:MX ARG:AR CHL:CL COL:CO CRI:CR ZAF:ZA EGY:EG ARE:AE SAU:SA ISR:IL TUR:TR KOR:KR TWN:TW HKG:HK PHL:PH MYS:MY IDN:ID VNM:VN THA:TH ROU:RO BGR:BG GRC:GR PRT:PT DNK:DK FIN:FI NOR:NO KEN:KE NGA:NG MAR:MA PER:PE URY:UY SVK:SK HUN:HU'.split(' ').map(s => s.split(':'));
async function amazon(f, src) {
  const out = [];
  let ok = false, complete = true;
  for (const [iso3, cc] of AMAZON) {
    // Every page of the country's results. Amazon's own search stops at 10,000 a country.
    let hits = null, read = 0;
    for (let offset = 0; offset < PER_SOURCE && (hits === null || offset < Math.min(hits, 10000)); offset += 100) {
      const j = await getJson(f, `https://www.amazon.jobs/en/search.json?result_limit=100&offset=${offset}&sort=recent&country=${iso3}`);
      if (!Array.isArray(j?.jobs)) { complete = false; break; }
      ok = true;
      if (j.hits !== undefined) { if (Number.isSafeInteger(j.hits) && j.hits >= 0) hits = j.hits; else complete = false; }
      read += j.jobs.length;
      for (const x of j.jobs || []) out.push({ id: x.id_icims || x.id, title: x.title, location: x.normalized_location || x.location, country: cc, url: 'https://www.amazon.jobs' + x.job_path, posted: dateTs(x.posted_date), hint: x.job_category, text: x.preferred_qualifications + ' ' + x.description });
      if (j.jobs.length < 100) break;
    }
    if (hits !== null && (read !== hits || hits >= 10000)) complete = false;
  }
  // Pay is published on the job page in the US and Canada.
  let n = 0;
  for (const x of out) if ((x.country === 'US' || x.country === 'CA') && n++ < 150) { const t = await getText(f, x.url); if (t) x.text = t.replace(/<script[\s\S]*?<\/script>/g, ' ').slice(0, 300000); }
  return ok ? snapshot(out, complete, complete ? '' : 'country-failed-or-capped') : null;
}
// United Nations Secretariat (careers.un.org): duty stations are matched to countries with the site's own list.
async function un(f) {
  const base = 'https://careers.un.org/api/public/opening';
  const filt = await getJson(f, `${base}/jo-filter/list/en`);
  const ds = new Map();
  for (const g of filt?.data || []) if (/duty/i.test(g.name)) for (const v of g.values || []) ds.set(String(v.name || '').toUpperCase(), countryCode(v.countryName));
  const out = [];
  for (let p = 0; p < PER_SOURCE / 100; p++) {
    const j = await postJson(f, `${base}/jo/list/filteredV2/en`, { filterConfig: { keyword: '' }, pagination: { page: p, itemPerPage: 100, sortBy: 'startDate', sortDirection: -1 } });
    if (!Array.isArray(j?.data?.list)) return p ? snapshot(out, false, 'page-failed') : null;
    const list = j.data.list;
    if (!list.length) return snapshot(out);
    for (const x of list) {
      const st = (x.dutyStation || [])[0]?.description || '';
      out.push({ id: x.jobId, title: x.postingTitle || x.jobTitle, employer: `United Nations${x.dept?.name ? ' (' + x.dept.name + ')' : ''}`, location: st.replace(/\b\w+/g, w => w[0] + w.slice(1).toLowerCase()), country: ds.get(st.toUpperCase()) || null, url: `https://careers.un.org/jobSearchDescription/${x.jobId}?language=en`, posted: dateTs(x.startDate), hint: x.jobCodeTitle });
    }
    if (list.length < 100) return snapshot(out);
  }
  return snapshot(out, false, 'page-limit');
}
async function unicef(f) {
  const out = [];
  for (let p = 1; p <= PER_SOURCE / 100; p++) {
    const t = await getText(f, `https://jobs.unicef.org/en-us/listing/?page=${p}&page-items=100`);
    if (!t) return p > 1 ? snapshot(out, false, 'page-failed') : null;
    const blocks = t.split('class="job-link"').slice(1);
    for (const b of blocks) {
      const a = b.match(/href="(\/en-us\/job\/(\d+)\/[^"]*)"[^>]*>([^<]+)</);
      if (!a) continue;
      const loc = (b.match(/class="location">([^<]+)</) || [])[1] || '';
      out.push({ id: a[2], title: a[3], location: loc, country: countryCode(loc.split(',')[0]) || countryOf(loc), url: 'https://jobs.unicef.org' + a[1] });
    }
    if (blocks.length < 100) break;
  }
  return snapshot(out, false, 'html-total-unverified');
}
// NHS Jobs (England and Wales): NHS bodies only, with the pay they advertise.
async function nhs(f) {
  const out = [];
  for (let p = 1; p <= PER_SOURCE / 10; p++) {
    const t = await getText(f, `https://www.jobs.nhs.uk/candidate/search/results?sort=publicationDateDesc&page=${p}&language=en`);
    if (!t) return p > 1 ? snapshot(out, false, 'page-failed') : null;
    const items = t.split('data-test="search-result"').slice(1);
    for (const b of items) {
      const a = b.match(/href="(\/candidate\/jobadvert\/([^"?]+)[^"]*)"[^>]*>\s*([^<]+?)\s*</);
      const head = (b.match(/data-test="search-result-location"[\s\S]*?<h3[^>]*>\s*([^<]+?)\s*<div[^>]*>\s*([^<]+?)\s*</) || []);
      const salary = (b.match(/search-result-salary[\s\S]*?<strong[^>]*>\s*([^<]+?)\s*</) || [])[1] || '';
      const posted = (b.match(/search-result-publicationDate[\s\S]*?<strong[^>]*>\s*([^<]+?)\s*</) || [])[1];
      if (!a || !head[1] || !/\bNHS\b|Health Board|Integrated Care Board/i.test(head[1])) continue;
      out.push({ id: a[2], title: a[3], employer: head[1], location: head[2], country: 'GB', url: 'https://www.jobs.nhs.uk' + a[1].replace(/&amp;/g, '&').split('?')[0], posted: dateTs(posted), text: salary, salary_text: salary });
    }
    if (items.length < 10) break;
  }
  return snapshot(out, false, 'html-total-unverified');
}
async function jsonld(f, src) {
  const url = src.args[0];
  if (!/^https:\/\//.test(url || '')) return null;
  const html = await getText(f, url);
  if (!html) return null;
  const rows = parseJobPostings(html, url).map(row => ({ ...row, country: countryCode(row.countryName) }));
  return snapshot(rows, false, 'detail-or-list-scope-unverified');
}
async function gauteng(f) {
  const html = await getText(f, GAUTENG_JOBS_URL);
  const result = html ? parseGautengJobs(html) : null;
  if (!result) return null;
  // Bound detail enrichment; stop on an unavailable/changed page instead of
  // retrying access barriers or assigning an unverified reference to a job.
  let checked = 0;
  for (const row of result.rows.slice(0, 120)) {
    await sleep(150);
    const detailHtml = await getText(f, row.url);
    const detail = detailHtml ? parseGautengDetail(detailHtml, row) : null;
    if (!detail) break;
    Object.assign(row, detail); checked++;
  }
  if (checked !== result.rows.length) result.reason = 'detail-enrichment-partial';
  result.rows = result.rows.filter(row => !row.closed);
  return result;
}
async function erecruit(f) {
  const categories = parseShopriteCategories(await getText(f, SHOPRITE_BROWSE_URL));
  const rows = [], seen = new Set();
  for (const category of categories) {
    const list = parseShopriteList(await getText(f, category.url), { sourceUrl: category.url });
    for (const listed of list.rows) {
      if (seen.has(listed.url) || seen.size >= PER_SOURCE) continue;
      seen.add(listed.url);
      const html = await getText(f, listed.url);
      const row = html && parseShopriteDetail(html, listed);
      if (row && !row.closed) rows.push(row);
    }
  }
  return snapshot(rows, false, 'detail-validated-partial-list');
}
async function simplify(f, src) {
  const base = `https://${src.args[0]}/`;
  const html = await getText(f, `${base}vacancy/vacancies?query=&displayOrder=4&ats_referrer=`);
  const result = parseSimplifyList(html, base);
  if (!result) return null;
  for (let i = 0; i < result.rows.length; i++) {
    const detail = await getText(f, result.rows[i].url);
    const enriched = detail && parseSimplifyDetail(detail, result.rows[i]);
    if (enriched) result.rows[i] = enriched;
  }
  return result;
}
async function uct(f) {
  const result = parseUctSearch(await getText(f, UCT_SEARCH_URL));
  if (!result) return null;
  const rows = [];
  for (const listed of result.rows) {
    const detail = await getText(f, listed.url);
    const row = detail && parseUctDetail(detail, listed);
    if (row && !row.closed) rows.push(row);
  }
  return snapshot(rows, false, 'detail-validated-partial-list');
}
async function oracleWithDetails(f, src) {
  const result = await oracle(f, src);
  if (!result || !src.detailOracle) return result;
  const [host, site] = src.args;
  const validated = [];
  for (let i = 0; i < result.rows.length; i++) {
    const row = result.rows[i];
    const payload = await getJson(f, `https://${host}/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails?onlyData=true&expand=all&finder=ById;Id=${encodeURIComponent(row.id)},siteNumber=${encodeURIComponent(site)}`);
    const enriched = parseOracleDetail(payload, row);
    if (enriched) validated.push(enriched);
    else { result.complete = false; result.reason = 'detail-failed'; }
  }
  result.rows = validated;
  return result;
}
// ---------- Automatic applicant-tracking boards ----------
// Readers for employer boards that daily discovery activates. Each reads only the
// platform's documented public listing (Greenhouse Job Board API, Lever Postings
// API, Ashby Job Postings API, Recruitee Careers Site API, Personio XML feed,
// Teamtailor RSS feed), places a posting only in a country the employer named for
// it, binds the board to the registered employer where the platform names the
// organization, and reports how it knows the listing is complete: a reported
// total, a final short or empty page, or one documented complete response.
const ATS_READER_FAILURES = ['board-response-invalid', 'board-total-mismatch', 'board-pagination-unconfirmed', 'board-organization-mismatch', 'board-row-limit'];
// One explicit country for a place: the whole label, or exactly one country among
// its comma/dash parts ("Lagos, Nigeria", "France - Paris", "Remote - Kenya"), or
// an exact established city ("Nairobi"). Never a state, region or the employer's
// own country. "Georgia" alone is the US state as often as the country.
export function explicitPlaceCountry(value) {
  let place = plain(value).trim();
  const wrapped = place.match(/^(?:remote|hybrid|on-?site)\s*\((.*)\)$/i);
  place = wrapped ? wrapped[1].trim() : place.replace(/^(?:remote|hybrid|on-?site)\s*(?:[-–:|]\s*|\s+(?=\S))/i, '').trim();
  if (!place || place.length > 200 || /\b(?:except|excluding|outside|not)\b/i.test(place)) return null;
  const named = part => fold(part) === 'georgia' ? null : countryCode(part);
  const whole = named(place);
  if (whole) return whole;
  const parts = place.split(/\s*,\s*|\s+[-–]\s+/).filter(Boolean);
  const found = [...new Set(parts.map(named).filter(Boolean))];
  if (found.length === 1) return found[0];
  if (found.length > 1) return null;
  return Object.entries(CITIES).find(([, cities]) => cities.includes(fold(place)))?.[0] || null;
}
const zonedTs = value => {
  const s = String(value || '').trim().replace(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) UTC$/, '$1T$2Z');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/.test(s)) return null;
  const t = Date.parse(s); return Number.isFinite(t) ? t : null;
};
const PAY_PERIOD = { year: 'year', yearly: 'year', annual: 'year', month: 'month', monthly: 'month', hour: 'hour', hourly: 'hour', 'per-year-salary': 'year', 'per-month-salary': 'month', 'per-hour-wage': 'hour' };
const structuredPay = (currency, min, max, period) => {
  const cur = String(currency || '').toUpperCase(), lo = Number(min), hi = Number(max), per = PAY_PERIOD[String(period || '').toLowerCase()];
  return /^[A-Z]{3}$/.test(cur) && per && lo > 0 && hi >= lo && hi <= lo * 4 ? { cur, min: lo, max: hi, period: per } : undefined;
};
// Board organization names are compared with legal-form words removed; the
// registered name or the verified domain's own label must be the board's name.
const boardBound = (src, label) => {
  let domain = ''; try { domain = new URL(src.officialDomain).hostname.replace(/^www\./, '').split('.')[0]; } catch { /* no domain label */ }
  return boardNamesOrganization(label, [src.name, ...(domain.length >= 3 ? [domain] : [])]);
};
// A posting kept for the source country with the places that name it, or held
// with the first other explicit country (rejected later), or unresolved.
function placedRow(src, row, places) {
  const named = places.map(place => [place, explicitPlaceCountry(place)]);
  const local = named.filter(([, cc]) => cc === src.country).map(([place]) => plain(place));
  if (local.length) return { ...row, country: src.country, location: [...new Set(local)].join('; '), countryUnresolved: false };
  const other = named.find(([, cc]) => cc)?.[1];
  return other ? { ...row, country: other, location: places.map(plain).join('; '), countryUnresolved: false } : { ...row, country: null, location: places.map(plain).join('; '), countryUnresolved: true };
}
function structuredRow(src, row, countries, location) {
  const list = [...new Set(countries.filter(cc => typeof cc === 'string' && Object.hasOwn(COUNTRY, cc)))];
  if (list.includes(src.country)) return { ...row, country: src.country, location, countryUnresolved: false };
  return list.length ? { ...row, country: list[0], location, countryUnresolved: false } : { ...row, country: null, location, countryUnresolved: true };
}
const atsResult = () => ({ rows: [], complete: false, reason: '', paginationComplete: false, reportedTotal: null, pagesFetched: 0, paginationEnd: 'unavailable' });
const atsFail = (out, reason) => ({ ...out, rows: reason === 'board-organization-mismatch' ? [] : out.rows, reason, paginationComplete: false });
const xmlBlocks = (xml, tag) => [...String(xml).matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'g'))].map(m => m[1]);
const xmlValue = (xml, tag) => { const m = String(xml).match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`)); return m ? m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim() : null; };
const postingId = value => (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) || (typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value)) ? String(value) : null;
const httpsLink = value => { try { const u = new URL(String(value)); return u.protocol === 'https:' && !u.username && !u.password ? u.href : null; } catch { return null; } };
export async function automaticGreenhouse(f, src) {
  const out = atsResult(), board = await getJson(f, `https://boards-api.greenhouse.io/v1/boards/${src.args[0]}/jobs?content=true`);
  if (!board || !Array.isArray(board.jobs) || board.jobs.length > AUTOMATIC_PER_SOURCE) return atsFail(out, 'board-response-invalid');
  out.pagesFetched = 1; out.reportedTotal = Number.isSafeInteger(board.meta?.total) ? board.meta.total : null;
  const seen = new Set();let bound = 0;
  for (const x of board.jobs) {
    const id = postingId(x?.id);
    if (!id || seen.has(id) || typeof x.title !== 'string' || !x.title.trim()) return atsFail(out, 'board-response-invalid');
    seen.add(id);
    const own = typeof x.company_name === 'string' && boardBound(src, x.company_name);if (own) bound++;
    const row = { id, title: x.title, url: httpsLink(x.absolute_url), text: typeof x.content === 'string' ? x.content : '', posted: dateTs(x.first_published || x.updated_at), closing: zonedTs(x.application_deadline), hint: x.departments?.[0]?.name };
    const places = [...greenhousePlaces(x.location?.name), ...(x.metadata || []).filter(m => m?.name === 'Job Posting Location').flatMap(m => [m.value].flat()).filter(v => typeof v === 'string')];
    const offices = (x.offices || []).flatMap(o => [o?.location, o?.name]).filter(v => typeof v === 'string' && v.trim());
    let placed = placedRow(src, row, places);
    if (placed.countryUnresolved && offices.length) placed = placedRow(src, row, offices);
    out.rows.push(own ? placed : { ...placed, country: null, countryUnresolved: true });
  }
  if (out.rows.length && !bound) return atsFail(out, 'board-organization-mismatch');
  if (out.reportedTotal !== out.rows.length) return atsFail(out, 'board-total-mismatch');
  return { ...out, paginationComplete: true, paginationEnd: 'reported-total', reason: 'board-complete' };
}
export async function automaticLever(f, src) {
  const out = atsResult(), [site, region] = src.args, host = region === 'eu' ? 'api.eu.lever.co' : 'api.lever.co', seen = new Set();
  for (let page = 0; page <= AUTOMATIC_PER_SOURCE / 100; page++) {
    const list = await getJson(f, `https://${host}/v0/postings/${site}?mode=json&limit=100&skip=${page * 100}`);
    if (!Array.isArray(list) || list.length > 100) return atsFail(out, 'board-response-invalid');
    out.pagesFetched++;
    for (const x of list) {
      const id = postingId(x?.id);
      if (!id || seen.has(id) || typeof x.text !== 'string' || !x.text.trim()) return atsFail(out, id && seen.has(id) ? 'board-pagination-unconfirmed' : 'board-response-invalid');
      seen.add(id);
      const range = x.salaryRange, pay = range ? structuredPay(range.currency, range.min, range.max, range.interval) : undefined;
      const row = { id, title: x.text, url: httpsLink(x.hostedUrl), posted: Number.isSafeInteger(x.createdAt) ? x.createdAt : null, hint: x.categories?.team, text: [x.descriptionPlain, ...(x.lists || []).map(l => l?.content), x.additionalPlain].filter(v => typeof v === 'string').join(' '), ...(pay ? { pay } : {}) };
      const where = [x.categories?.location, ...[x.categories?.allLocations].flat()].filter(v => typeof v === 'string' && v.trim());
      out.rows.push(structuredRow(src, row, [typeof x.country === 'string' ? x.country.toUpperCase() : null], [...new Set(where.map(plain))].join('; ')));
    }
    if (list.length < 100) return { ...out, paginationComplete: true, paginationEnd: list.length || !page ? 'short-page' : 'empty-page', reason: 'board-complete' };
    if (out.rows.length > 1000) return atsFail(out, 'board-row-limit');
  }
  return atsFail(out, 'board-row-limit');
}
export async function automaticAshby(f, src) {
  const out = atsResult(), board = await getJson(f, `https://api.ashbyhq.com/posting-api/job-board/${src.args[0]}?includeCompensation=true`);
  if (!board || !Array.isArray(board.jobs) || board.jobs.length > AUTOMATIC_PER_SOURCE) return atsFail(out, 'board-response-invalid');
  out.pagesFetched = 1;const seen = new Set();
  for (const x of board.jobs) {
    if (x?.isListed === false) continue;
    const id = postingId(x?.id);
    if (!id || seen.has(id) || typeof x.title !== 'string' || !x.title.trim()) return atsFail(out, 'board-response-invalid');
    seen.add(id);
    const summary = typeof x.compensation?.compensationTierSummary === 'string' ? x.compensation.compensationTierSummary : '';
    const row = { id, title: x.title, url: httpsLink(x.jobUrl), posted: dateTs(x.publishedAt), hint: x.department, text: summary, salary_text: summary || null };
    const places = [{ label: x.location, address: x.address }, ...(Array.isArray(x.secondaryLocations) ? x.secondaryLocations.map(s => ({ label: s?.location, address: s?.address })) : [])];
    const countries = places.map(p => countryCode(p.address?.postalAddress?.addressCountry));
    const local = places.filter((_, i) => countries[i] === src.country).map(p => plain(p.label)).filter(Boolean);
    out.rows.push(structuredRow(src, row, countries, (local.length ? local : places.map(p => plain(p.label)).filter(Boolean)).join('; ')));
  }
  return { ...out, paginationComplete: true, paginationEnd: 'single-document', reason: 'board-complete' };
}
export async function automaticRecruitee(f, src) {
  const out = atsResult(), board = await getJson(f, `https://${src.args[0]}.recruitee.com/api/offers/`);
  if (!board || !Array.isArray(board.offers) || board.offers.length > AUTOMATIC_PER_SOURCE) return atsFail(out, 'board-response-invalid');
  out.pagesFetched = 1;const seen = new Set();let bound = 0;
  for (const x of board.offers) {
    if (x?.status != null && x.status !== 'published') continue;
    const id = postingId(x?.id);
    if (!id || seen.has(id) || typeof x.title !== 'string' || !x.title.trim()) return atsFail(out, 'board-response-invalid');
    seen.add(id);
    const own = typeof x.company_name === 'string' && boardBound(src, x.company_name);if (own) bound++;
    const pay = x.salary ? structuredPay(x.salary.currency, x.salary.min, x.salary.max, x.salary.period) : undefined;
    const row = { id, title: x.title, url: httpsLink(x.careers_url), posted: zonedTs(x.published_at), closing: zonedTs(x.close_at), hint: x.department, text: typeof x.description === 'string' ? x.description : '', ...(pay ? { pay } : {}) };
    const locations = Array.isArray(x.locations) ? x.locations : [];
    const codes = [x.country_code, ...locations.map(l => l?.country_code)].map(c => typeof c === 'string' ? c.toUpperCase() : null);
    const local = locations.filter(l => typeof l?.country_code === 'string' && l.country_code.toUpperCase() === src.country).map(l => plain(l.city || l.name)).filter(Boolean);
    const placed = structuredRow(src, row, codes, (local.length ? local : [plain(x.location)]).filter(Boolean).join('; '));
    out.rows.push(own ? placed : { ...placed, country: null, countryUnresolved: true });
  }
  if (out.rows.length && !bound) return atsFail(out, 'board-organization-mismatch');
  return { ...out, paginationComplete: true, paginationEnd: 'single-document', reason: 'board-complete' };
}
export async function automaticPersonio(f, src) {
  const out = atsResult(), [company, tld] = src.args, origin = `https://${company}.jobs.personio.${tld}`;
  const xml = await getText(f, `${origin}/xml`);
  if (typeof xml !== 'string' || !/<workzag-jobs\b/.test(xml) || !/<\/workzag-jobs>|<workzag-jobs\s*\/>/.test(xml)) return atsFail(out, 'board-response-invalid');
  out.pagesFetched = 1;const seen = new Set();
  const positions = xmlBlocks(xml, 'position');
  if (positions.length > AUTOMATIC_PER_SOURCE) return atsFail(out, 'board-response-invalid');
  for (const block of positions) {
    const descriptions = xmlValue(block, 'jobDescriptions') || '', head = block.replace(/<jobDescriptions\b[\s\S]*?<\/jobDescriptions>/g, ''), additional = xmlValue(head, 'additionalOffices') || '';
    const id = xmlValue(head, 'id'), title = plain(xmlValue(head.replace(/<additionalOffices\b[\s\S]*?<\/additionalOffices>/g, ''), 'name'));
    if (!/^\d{1,12}$/.test(id || '') || seen.has(id) || !title) return atsFail(out, 'board-response-invalid');
    seen.add(id);
    const primary = xmlValue(head.replace(/<additionalOffices\b[\s\S]*?<\/additionalOffices>/g, ''), 'office');
    const offices = [primary, ...xmlBlocks(additional, 'office')].map(v => v == null ? '' : plain(v.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1'))).filter(Boolean);
    const row = { id, title, url: `${origin}/job/${id}`, posted: zonedTs(xmlValue(head, 'createdAt')), hint: plain(xmlValue(head, 'department')), text: xmlBlocks(descriptions, 'value').map(v => v.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')).join(' ') };
    out.rows.push(placedRow(src, row, offices));
  }
  return { ...out, paginationComplete: true, paginationEnd: 'single-document', reason: 'board-complete' };
}
export async function automaticTeamtailor(f, src) {
  const out = atsResult(), origin = `https://${src.args[0]}.teamtailor.com`, seen = new Set();
  for (let page = 0; page <= AUTOMATIC_PER_SOURCE / 100 + 1; page++) {
    const xml = await getText(f, `${origin}/jobs.rss?per_page=100&offset=${page * 100}`);
    if (typeof xml !== 'string' || !/<rss\b/.test(xml) || !/<channel\b/.test(xml)) return atsFail(out, 'board-response-invalid');
    out.pagesFetched++;
    // The feed's channel title is the employer's career site name.
    const channel = xml.split(/<item\b/)[0];
    if (!boardBound(src, plain(xmlValue(channel, 'title')))) return atsFail(out, 'board-organization-mismatch');
    const items = xmlBlocks(xml, 'item');
    if (items.length > 100) return atsFail(out, 'board-response-invalid');
    if (!items.length) return { ...out, paginationComplete: true, paginationEnd: 'empty-page', reason: 'board-complete' };
    for (const item of items) {
      const id = xmlValue(item, 'guid'), title = plain(xmlValue(item, 'title'));
      if (!postingId(id) || seen.has(id) || !title) return atsFail(out, id && seen.has(id) ? 'board-pagination-unconfirmed' : 'board-response-invalid');
      seen.add(id);
      const locations = xmlBlocks(item, 'tt:location').map(l => ({ city: plain(xmlValue(l, 'tt:city')), country: plain(xmlValue(l, 'tt:country')) }));
      const countries = locations.map(l => countryCode(l.country));
      const local = locations.filter((_, i) => countries[i] === src.country).map(l => l.city || l.country);
      const row = { id, title, url: httpsLink(plain(xmlValue(item, 'link'))), posted: dateTs(plain(xmlValue(item, 'pubDate'))), hint: plain(xmlValue(item, 'tt:department')), text: xmlValue(item, 'description') || '' };
      out.rows.push(structuredRow(src, row, countries, (local.length ? local : locations.map(l => [l.city, l.country].filter(Boolean).join(', '))).filter(Boolean).join('; ')));
    }
    if (out.rows.length > 1000) return atsFail(out, 'board-row-limit');
  }
  return atsFail(out, 'board-row-limit');
}
const AUTOMATIC_COLLECT = { gh: automaticGreenhouse, lever: automaticLever, ashby: automaticAshby, recruitee: automaticRecruitee, personio: automaticPersonio, teamtailor: automaticTeamtailor };
const COLLECT = { erecruit, simplify, uct, gauteng, jsonld, gh: greenhouse, lever, ashby, wd: workday, sf: successfactors, orc: oracleWithDetails, sr: smartrecruiters, amazon, un, unicef, nhs };

export async function fxRates(fetchImpl = fetch) {
  const j = await getJson(fetchImpl, 'https://api.frankfurter.app/latest?from=USD');
  return j?.rates ? { USD: 1, ...j.rates } : null;
}
// Start the long-running Diageo reader with the first manual wave.
// Preserve selection, membership and every other reader's relative order.
export function manualCollectionOrder(selected) {
  const manual = selected.filter(s => !s.automatic);
  return [...manual.filter(s => s.id === 'diageo'), ...manual.filter(s => s.id !== 'diageo')];
}
// 'source-unavailable', with the last refusal when there was one (e.g. 'source-unavailable-http-403').
export const unavailableReason = last => /^(http-\d{3}|network)$/.test(last || '') ? 'source-unavailable-' + last : 'source-unavailable';
// Only authoritative complete snapshots authorize removal, including confirmed zero.
// Partial lists still contribute jobs and diagnostics without deleting unseen rows.
export async function collectJobs(fetchImpl = fetch, log = () => {}, only = null, options = {}) {
  fetchImpl = createJobFetch(fetchImpl, options.requestDelayMs, options.platformPace);
  const fx = await fxRates(fetchImpl);
  if (!fx) log('Exchange rates unavailable: retaining employer pay in its original currency');
  const rows = [], ok = [], diagnostics = [];
  const selected = (options.sources || SOURCES).filter(s => !only || only.includes(s.id));
  // Complete bounded automatic work before manual readers start; manual per-host pacing is unchanged.
  // Each phase retains the existing six-reader concurrency and source budgets.
  for(const [phase,queue] of [['automatic',selected.filter(s=>s.automatic)],['manual',manualCollectionOrder(selected)]]){
  const phaseStarted=performance.now();
  await Promise.all(Array.from({ length: 6 }, async () => {
    for (let s; (s = queue.shift());) {
      const attemptedAt = Date.now();
      const sourceFetch = s.automatic ? options.automaticFetch?.(s) : (url,options)=>fetchImpl(url,options,platformForReader(s.ats));
      let result = null;
      // Automatic boards use their evidence-reporting readers; manual readers are unchanged.
      const reader = (s.automatic && AUTOMATIC_COLLECT[s.ats]) || COLLECT[s.ats];
      // The employer's last refusal (an HTTP status, or 'network' for no answer) is recorded with a failed source, so a
      // source that fails only from the collector shows why (no response body is kept).
      const refusal = { last: '' };
      const watched = sourceFetch && Object.assign(async (...args) => {
        try { const r = await sourceFetch(...args); if (r && !r.ok) refusal.last = 'http-' + r.status; return r; }
        catch (error) { if (!String(error?.code || '').startsWith('AUTOMATIC_')) refusal.last = 'network'; throw error; }
      }, sourceFetch.diagnostics ? { diagnostics: sourceFetch.diagnostics } : {});
      try { result = watched ? await reader?.(watched, s, log) : null; } catch { /* recorded below without raw provider data */ }
      let transportState=s.automatic ? sourceFetch?.diagnostics?.() : null;
      let telemetry=transportState ? {pagesFetched:result?.pagesFetched,reportedTotal:result?.reportedTotal,paginationEnd:result?.paginationEnd,...(result?.phaseHttp?{phaseHttp:result.phaseHttp}:{}),...(result?.detailReasons?{detailReasons:result.detailReasons,listingRejected:result.listingRejected}:{}),httpRequests:transportState.httpRequests,elapsedMs:transportState.elapsedMs,budgetExhausted:transportState.budgetExhausted,sourceRequestCap:result?.sourceRequestCap===true||transportState.sourceRequestCap,paginationComplete:REFRESHABLE_AUTOMATIC_READERS.has(s.ats)&&result?.paginationComplete===true} : {};
      let budgetReason=transportState?.sourceRequestCap ? 'source-request-cap' : transportState?.budgetExhausted ? (transportState.httpRequests===0 ? 'not-attempted-budget' : 'budget-exhausted') : transportState?.robotsDisallowed ? 'robots-disallowed' : '';
      if (!result) {
        diagnostics.push({ src: s.id, status: 'failed', rawCount: 0, acceptedCount: 0, reason: budgetReason || unavailableReason(refusal.last), attemptedAt, ...telemetry });
        log(`${s.name}: no valid answer`); continue;
      }
      const list = result.rows;
      if (s.detailGeography || s.sfScope) for (const row of list) row.countryUnresolved = true;
      if (s.detailDates || s.detailGeography || s.sfScope) for (const row of list) {
        if (!/^https:\/\//.test(row.url || '')) continue;
        const html = await getText(sourceFetch, row.url);
        if (!html) continue;
        let datesHtml = html;
        if (s.detailGeography || s.sfScope) {
          const geography = parseJobGeography(html, row, { employerName: s.sfScope?.employerName });
          if (!geography || (row.country && row.country !== geography.country) || (s.sfScope && geography.country !== s.sfScope.country)) continue;
          row.country = geography.country; row.location = geography.location;
          row.countryUnresolved = false; datesHtml = geography.datesHtml;
        }
        const dates = parseJobDates(datesHtml, { country: row.country || countryOf(row.location), sourceId: s.id, title: row.title });
        if (dates.posted != null) row.posted = dates.posted;
        if (dates.closing != null) row.closing = dates.closing;
        if (dates.location && countryOf(dates.location) === (row.country || countryOf(row.location))) row.location = dates.location;
      }
      if(s.automatic){transportState=sourceFetch?.diagnostics?.();telemetry={httpRequests:transportState?.httpRequests,elapsedMs:transportState?.elapsedMs,budgetExhausted:transportState?.budgetExhausted,sourceRequestCap:result.sourceRequestCap===true||transportState?.sourceRequestCap,paginationComplete:REFRESHABLE_AUTOMATIC_READERS.has(s.ats)&&result.paginationComplete===true,pagesFetched:result.pagesFetched,reportedTotal:result.reportedTotal,paginationEnd:result.paginationEnd,...(result.phaseHttp?{phaseHttp:result.phaseHttp}:{}),...(result.detailReasons?{detailReasons:result.detailReasons,listingRejected:result.listingRejected}:{})};}
      const got = list.map(x => normalizeCollectedJob(s, x, fx)).filter(Boolean);
      const seen = new Set();
      const uniq = got.filter(r => (!s.automatic || !r.closing_ts || r.closing_ts > Date.now()) && !seen.has(r.id) && seen.add(r.id));
      if (s.automatic && !auditAutomaticOutput(s, uniq, list.length).ok) {
        diagnostics.push({ src:s.id,status:'failed',rawCount:list.length,acceptedCount:0,reason:'automatic-quality-breaker',attemptedAt,...telemetry });
        continue;
      }
      // Invalid/unlocated rows or duplicate IDs cannot prove a full replacement snapshot.
      const complete = !s.automatic && result.complete && got.length === list.length && uniq.length === got.length;
      const refresh=s.automatic?automaticRefreshHealth({src:s.id,ats:s.ats,status:'partial',rawCount:list.length,acceptedCount:uniq.length,...telemetry}):null;
      // A transport stop (robots.txt, request cap or budget) explains a board reader's empty answer.
      const transportFailure=transportState?.robotsDisallowed?'robots-disallowed':s.automatic&&s.ats!=='wd'&&budgetReason?budgetReason:null;
      const readerFailure=transportFailure||(['total-zero-with-rows','empty-workday-tenant','empty-workday-scope','registered-workday-filter-unconfirmed',...ATS_READER_FAILURES].includes(result.reason)?result.reason:null);
      const reason = s.automatic ? (!refresh.healthy&&readerFailure?readerFailure:refresh.reason) : complete ? '' : result.reason || 'rows-rejected-or-duplicated';
      diagnostics.push({ src: s.id, status: s.automatic ? (refresh.healthy?'partial':'failed') : complete ? 'complete' : 'partial', rawCount: list.length, acceptedCount: uniq.length, reason, attemptedAt, ...telemetry });
      log(`${s.name}: ${list.length} jobs, ${uniq.length} placed, ${s.automatic&&!refresh.healthy?'failed':complete?'complete':'partial'} (${Math.round((Date.now() - attemptedAt) / 1000)}s)`);
      // Unhealthy automatic refreshes retain diagnostic candidates only; no upload or seen_ts renewal.
      if(!s.automatic||refresh.healthy)rows.push(...uniq);
      if (complete) ok.push(s.id);
    }
  }));
  options.onPhaseEnd?.(phase,Math.ceil(performance.now()-phaseStarted));
  }
  return { rows, ok, diagnostics };
}


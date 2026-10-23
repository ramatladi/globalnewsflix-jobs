// Tenders: open tenders from international organisations and private companies (owner, 22 Oct 2026) and, in each
// country, from the public sector (owner, 23 Oct 2026), read only from official systems, never from aggregators, each
// linking to the official notice. Shared by the public collector (tenders-collect.js) and the site (tenders.js).
import { COUNTRIES } from './data.js';
import { iso3To2 } from './iso-codes.js';

// Notices closing further ahead than this are not listed (standing calls such as dynamic purchasing systems).
export const TENDER_MAX_AHEAD_MS = 400 * 86400000;

// Kinds of notice, in display order.
export const TENDER_KINDS = Object.freeze(['rfp', 'rfq', 'itb', 'eoi', 'prequal', 'rfi', 'prebid', 'consultant', 'grant', 'partner', 'other']);
export const TENDER_KIND_LABEL = Object.freeze(Object.fromEntries(TENDER_KINDS.map(k => [k, 'tk_' + k])));
// UNGM's notice types.
export const UNGM_KIND = Object.freeze({
  'request for proposal': 'rfp', 'request for quotation': 'rfq', 'invitation to bid': 'itb', 'request for eoi': 'eoi',
  'request for pre-qualification': 'prequal', 'request for information': 'rfi', 'pre-bid notice': 'prebid',
  'call for individual consultants': 'consultant', 'grant support-call for proposal': 'grant', 'call for implementing partners': 'partner',
});

// Who issues a notice: the public sector (government, public bodies and state-owned companies), an international
// organisation, or a private company. In display order.
export const ISSUER_TYPES = Object.freeze(['public', 'io', 'private']);
// What is being bought, where the source says: goods, works (construction) or services.
export const TENDER_NATURES = Object.freeze(['goods', 'works', 'services']);

// The sources the site accepts: the official systems where issuers publish their notices, with the hosts those
// notices (and their documents) live on and the kinds of issuer each may carry.
export const TENDER_SOURCES = Object.freeze({
  ungm: Object.freeze({ id: 'ungm', name: 'United Nations Global Marketplace', issuerTypes: Object.freeze(['io']), hosts: Object.freeze(['www.ungm.org']) }),
  // The EU's official journal for tenders (the Supplement to the Official Journal of the European Union). ted: notices
  // from EU institutions, bodies and agencies and from international organisations (the collector checks each buyer
  // by name); tedn: every other buyer's, the public sector of the EU and EEA countries (and the few bodies TED lists
  // as awarding subsidised contracts, which are private).
  ted: Object.freeze({ id: 'ted', name: 'Tenders Electronic Daily', issuerTypes: Object.freeze(['io']), hosts: Object.freeze(['ted.europa.eu']) }),
  tedn: Object.freeze({ id: 'tedn', name: 'Tenders Electronic Daily', issuerTypes: Object.freeze(['public', 'private']), hosts: Object.freeze(['ted.europa.eu']) }),
  // The World Bank Group's and the African Development Bank Group's own (corporate) procurement.
  wbg: Object.freeze({ id: 'wbg', name: 'World Bank Group corporate procurement', issuerTypes: Object.freeze(['io']), hosts: Object.freeze(['wbgeprocure-rfxnow.worldbank.org']) }),
  afdb: Object.freeze({ id: 'afdb', name: 'African Development Bank Group corporate procurement', issuerTypes: Object.freeze(['io']), hosts: Object.freeze(['www.afdb.org']) }),
  // South Africa's eTenders Publication Portal (National Treasury), where national and provincial departments,
  // municipalities and state-owned companies must advertise their tenders.
  etza: Object.freeze({ id: 'etza', name: 'eTenders Publication Portal (National Treasury)', issuerTypes: Object.freeze(['public']), hosts: Object.freeze(['www.etenders.gov.za']), countries: Object.freeze(['ZA']) }),
  // National public procurement portals (tenders-national.js).
  ppke: Object.freeze({ id: 'ppke', name: 'Public Procurement Information Portal (PPRA, Kenya)', issuerTypes: Object.freeze(['public']), hosts: Object.freeze(['tenders.go.ke']), countries: Object.freeze(['KE']) }),
  gets: Object.freeze({ id: 'gets', name: 'GETS (New Zealand Government Procurement)', issuerTypes: Object.freeze(['public']), hosts: Object.freeze(['www.gets.govt.nz']), countries: Object.freeze(['NZ']) }),
  aust: Object.freeze({ id: 'aust', name: 'AusTender (Australian Government)', issuerTypes: Object.freeze(['public']), hosts: Object.freeze(['www.tenders.gov.au']), countries: Object.freeze(['AU']) }),
  secop: Object.freeze({ id: 'secop', name: 'SECOP II (Colombia Compra Eficiente)', issuerTypes: Object.freeze(['public']), hosts: Object.freeze(['community.secop.gov.co']), countries: Object.freeze(['CO']) }),
  cabuy: Object.freeze({ id: 'cabuy', name: 'CanadaBuys (Public Services and Procurement Canada)', issuerTypes: Object.freeze(['public']), hosts: Object.freeze(['canadabuys.canada.ca']), countries: Object.freeze(['CA']) }),
  pncp: Object.freeze({ id: 'pncp', name: 'Portal Nacional de Contratações Públicas (Brazil)', issuerTypes: Object.freeze(['public']), hosts: Object.freeze(['pncp.gov.br']), countries: Object.freeze(['BR']) }),
});

// TED's language codes (ISO 639-2/B and /T, as its multilingual fields are keyed) to the site's.
export const TED_LANG = Object.freeze({
  bul: 'bg', ces: 'cs', cze: 'cs', dan: 'da', deu: 'de', ger: 'de', ell: 'el', gre: 'el', eng: 'en', spa: 'es', est: 'et', fin: 'fi', fra: 'fr', fre: 'fr',
  gle: 'ga', hrv: 'hr', hun: 'hu', ita: 'it', lit: 'lt', lav: 'lv', mlt: 'mt', nld: 'nl', dut: 'nl', pol: 'pl', por: 'pt', ron: 'ro', rum: 'ro', slk: 'sk',
  slo: 'sk', slv: 'sl', swe: 'sv', nor: 'no', nob: 'no', nno: 'no', isl: 'is', ice: 'is', mkd: 'mk', srp: 'sr', sqi: 'sq', alb: 'sq', ukr: 'uk', tur: 'tr',
  ltz: 'lb', cat: 'ca', eus: 'eu', glg: 'gl',
});

// Country names as UN notices write them ("Tanzania, United Republic of", "Congo, The Democratic Republic of the")
// to the site's country codes. Unknown names, and "Multiple destinations", give no country.
const fold = s => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
const ALIASES = {
  'congo the democratic republic of the': 'CD', 'democratic republic of the congo': 'CD', 'congo democratic republic of the': 'CD', 'dr congo': 'CD',
  'congo': 'CG', 'republic of the congo': 'CG', 'tanzania united republic of': 'TZ', 'united republic of tanzania': 'TZ',
  'palestine state of': 'PS', 'state of palestine': 'PS', 'occupied palestinian territory': 'PS', 'iran islamic republic of': 'IR',
  'bolivia plurinational state of': 'BO', 'venezuela bolivarian republic of': 'VE', 'korea republic of': 'KR', 'republic of korea': 'KR',
  'korea democratic people s republic of': 'KP', 'democratic people s republic of korea': 'KP', 'lao people s democratic republic': 'LA',
  'moldova republic of': 'MD', 'republic of moldova': 'MD', 'syrian arab republic': 'SY', 'viet nam': 'VN', 'turkiye': 'TR', 'turkey': 'TR',
  'russian federation': 'RU', 'united states of america': 'US', 'united states': 'US', 'united kingdom of great britain and northern ireland': 'GB',
  'united kingdom': 'GB', 'cote d ivoire': 'CI', 'ivory coast': 'CI', 'cabo verde': 'CV', 'cape verde': 'CV', 'eswatini': 'SZ', 'swaziland': 'SZ',
  'micronesia federated states of': 'FM', 'north macedonia': 'MK', 'czechia': 'CZ', 'czech republic': 'CZ', 'netherlands kingdom of the': 'NL',
  'brunei darussalam': 'BN', 'timor leste': 'TL', 'holy see': 'VA', 'myanmar': 'MM', 'burma': 'MM', 'gambia': 'GM', 'the gambia': 'GM',
  'bahamas': 'BS', 'the bahamas': 'BS', 'saint kitts and nevis': 'KN', 'saint lucia': 'LC', 'saint vincent and the grenadines': 'VC',
  'sao tome and principe': 'ST', 'kyrgyzstan': 'KG', 'kyrgyz republic': 'KG', 'slovakia': 'SK', 'slovak republic': 'SK', 'taiwan province of china': 'TW',
  'hong kong': 'HK', 'hong kong sar china': 'HK', 'macao': 'MO', 'macau': 'MO', 'puerto rico': 'PR',
};
let BY_NAME = null;
export function countryCode(name) {
  if (!BY_NAME) { BY_NAME = new Map(COUNTRIES.map(c => [fold(c.name), c.code])); for (const [k, v] of Object.entries(ALIASES)) BY_NAME.set(k, v); }
  const f = fold(name);
  return BY_NAME.get(f) || BY_NAME.get(f.replace(/^the /, '')) || BY_NAME.get(f.replace(/ the$/, '')) || '';
}

// ISO 3166 three-letter codes (as TED writes places of performance) to the site's country codes.
export const countryFromIso3 = code => iso3To2(code) || '';

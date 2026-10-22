// Tenders (owner, 22 Oct 2026): open tenders issued by international organisations and private companies only,
// never by governments or state-owned bodies, each linking to the issuer's official notice. Shared by the
// public collector (tenders-collect.js) and the site (tenders.js).
import { COUNTRIES } from './data.js';

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

// The sources the site accepts, each with the hosts its notices live on. issuerType: 'io' (international
// organisation) or 'private' (a company). Government and state-owned issuers are never sources.
export const TENDER_SOURCES = Object.freeze({
  ungm: Object.freeze({ id: 'ungm', name: 'United Nations Global Marketplace', issuerType: 'io', hosts: Object.freeze(['www.ungm.org']) }),
  // The EU's official journal for tenders: only notices from EU institutions, bodies and agencies and from
  // international organisations (the collector checks each buyer by name).
  ted: Object.freeze({ id: 'ted', name: 'Tenders Electronic Daily', issuerType: 'io', hosts: Object.freeze(['ted.europa.eu']) }),
  // The World Bank Group's and the African Development Bank Group's own (corporate) procurement.
  wbg: Object.freeze({ id: 'wbg', name: 'World Bank Group corporate procurement', issuerType: 'io', hosts: Object.freeze(['wbgeprocure-rfxnow.worldbank.org']) }),
  afdb: Object.freeze({ id: 'afdb', name: 'African Development Bank Group corporate procurement', issuerType: 'io', hosts: Object.freeze(['www.afdb.org']) }),
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
const ISO3 = 'AFGAF ALBAL DZADZ ANDAD AGOAO ATGAG ARGAR ARMAM AUSAU AUTAT AZEAZ BHSBS BHRBH BGDBD BRBBB BLRBY BELBE BLZBZ BENBJ BTNBT BOLBO BIHBA BWABW BRABR BRNBN BGRBG BFABF BDIBI CPVCV KHMKH CMRCM CANCA CAFCF TCDTD CHLCL CHNCN COLCO COMKM COGCG CODCD CRICR CIVCI HRVHR CUBCU CYPCY CZECZ DNKDK DJIDJ DMADM DOMDO ECUEC EGYEG SLVSV GNQGQ ERIER ESTEE SWZSZ ETHET FJIFJ FINFI FRAFR GABGA GMBGM GEOGE DEUDE GHAGH GRCGR GRDGD GTMGT GINGN GNBGW GUYGY HTIHT HNDHN HKGHK HUNHU ISLIS INDIN IDNID IRNIR IRQIQ IRLIE ISRIL ITAIT JAMJM JPNJP JORJO KAZKZ KENKE KIRKI KWTKW KGZKG LAOLA LVALV LBNLB LSOLS LBRLR LBYLY LIELI LTULT LUXLU MACMO MDGMG MWIMW MYSMY MDVMV MLIML MLTMT MHLMH MRTMR MUSMU MEXMX FSMFM MDAMD MCOMC MNGMN MNEME MARMA MOZMZ MMRMM NAMNA NRUNR NPLNP NLDNL NZLNZ NICNI NERNE NGANG PRKKP MKDMK NORNO OMNOM PAKPK PLWPW PSEPS PANPA PNGPG PRYPY PERPE PHLPH POLPL PRTPT PRIPR QATQA ROURO RUSRU RWARW KNAKN LCALC VCTVC WSMWS SMRSM STPST SAUSA SENSN SRBRS SYCSC SLESL SGPSG SVKSK SVNSI SLBSB SOMSO ZAFZA KORKR SSDSS ESPES LKALK SDNSD SURSR SWESE CHECH SYRSY TWNTW TJKTJ TZATZ THATH TLSTL TGOTG TONTO TTOTT TUNTN TURTR TKMTM TUVTV UGAUG UKRUA AREAE GBRGB USAUS URYUY UZBUZ VUTVU VATVA VENVE VNMVN YEMYE ZMBZM ZWEZW';
let BY_ISO3 = null;
export function countryFromIso3(code) {
  if (!BY_ISO3) BY_ISO3 = new Map(ISO3.split(' ').map(x => [x.slice(0, 3), x.slice(3)]));
  return BY_ISO3.get(String(code || '').toUpperCase()) || '';
}

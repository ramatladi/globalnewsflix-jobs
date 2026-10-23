// Tenders collector (runs in the public collector repository, tenders-runner.mjs): reads open notices from the
// official systems where issuers publish them, never from aggregators (owner, 23 Oct 2026). International
// organisations: the United Nations Global Marketplace (UNGM), where some 80 UN and other international organisations
// publish their tenders (owner, 22 Oct 2026: listed despite UNGM's terms, his decision); Tenders Electronic Daily
// (TED), the EU's official journal for tenders, through its public search API; and the World Bank Group's and the
// African Development Bank Group's own corporate procurement pages. The public sector: TED for the EU and EEA
// countries (once a day: some 40,000 open notices) and South Africa's eTenders Publication Portal (National
// Treasury). Each notice keeps its title (in each language it is given in), issuer, type, reference, closing time,
// countries and the details its source gives, and links to the official notice. The crawler names itself and keeps
// to one request at a time.
import { UNGM_KIND, countryCode, countryFromIso3, TENDER_MAX_AHEAD_MS, TED_LANG } from './tenders-kinds.js';
import { guessLang } from './lang-guess.js';
import { COUNTRY, newsLang } from './data.js';
import { collectPpke, collectGets, collectAusTender, collectSecop, collectPncp, collectCanadaBuys } from './tenders-national.js';

// The usual form for a named crawler (as the site's photo checks use): it says who is asking and where to reach us.
export const UA = 'Mozilla/5.0 (compatible; GlobalNewsflixTenders/1.0; +https://globalnewsflix.com/contact)';
export const UNGM = 'https://www.ungm.org';
export const UNGM_PAGE_SIZE = 15; // the only page size UNGM's search accepts
export const UNGM_MAX_PAGES = 200;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const decode = s => String(s || '').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
const text = html => decode(String(html || '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

// "22-Oct-2026 14:59 (GMT -4.00)" -> UTC milliseconds; "06-Oct-2026" -> that day, noon UTC.
export function ungmTime(value) {
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})(?:\s+(\d{1,2}):(\d{2}))?(?:\s*\(GMT\s*([+-]?)(\d{1,2})[.:](\d{2})\))?/.exec(String(value || '').trim());
  if (!m || !(m[2].toLowerCase() in MONTHS)) return null;
  const [d, y] = [Number(m[1]), Number(m[3])], mo = MONTHS[m[2].toLowerCase()];
  if (m[4] == null) { const t = Date.UTC(y, mo, d, 12); return new Date(t).getUTCDate() === d ? t : null; }
  const offset = (m[6] === '-' ? -1 : 1) * (Number(m[7] || 0) * 60 + (m[8] === '50' ? 30 : m[8] === '75' ? 45 : Number(m[8] || 0))) * 60000;
  const t = Date.UTC(y, mo, d, Number(m[4]), Number(m[5])) - offset;
  return new Date(Date.UTC(y, mo, d)).getUTCDate() === d ? t : null;
}

// One page of UNGM search results -> notices.
export function parseUngmRows(html) {
  const out = [];
  const rows = String(html || '').split(/<div role="row"[^>]*data-noticeid="/).slice(1);
  for (const chunk of rows) {
    const id = (/^(\d{1,9})"/.exec(chunk) || [])[1];
    if (!id) continue;
    const cells = [...chunk.matchAll(/<div role="cell"([^>]*)>([\s\S]*?)(?=<div role="cell"|<\/div>\s*<script|$)/g)].map(m => ({ attrs: m[1], html: m[2] }));
    const title = text((/<span class="ungm-title[^"]*">([\s\S]*?)<\/span>/.exec(chunk) || [])[1]);
    const deadline = text((/<div role="cell" class="tableCell resultInfo1 deadline"[^>]*>\s*<span>([\s\S]*?)<\/span>/.exec(chunk) || [])[1]);
    const after = cells.findIndex(c => /deadline/.test(c.attrs));
    const plain = cells.slice(after + 1).map(c => text(c.html));
    const [published, agency, type, ref, country] = plain;
    if (!title || !deadline) continue;
    out.push({ id, title, deadline, published: published || '', agency: agency || '', type: type || '', ref: ref || '', country: country || '' });
  }
  return out;
}

// The language of a notice from a system that publishes in English and sometimes in French, Spanish or Portuguese:
// what its title shows, else English.
export const titleLang = (title, hint = 'en') => { const lang = guessLang(title, { hint }) || hint; return { lang, langs: [lang] }; };

// A parsed notice -> the row the site stores, or null.
export function ungmRow(n, now = Date.now()) {
  const closes = ungmTime(n.deadline), published = ungmTime(n.published);
  if (!closes || closes <= now) return null;
  const kind = UNGM_KIND[String(n.type || '').toLowerCase()] || 'other';
  const countries = String(n.country || '').split(/\s*;\s*|\s*\|\s*/).map(countryCode).filter(Boolean);
  const issuer = String(n.agency || '').trim().slice(0, 120);
  if (!issuer || !n.title) return null;
  return {
    id: `ungm:${n.id}`, src: 'ungm', issuer, issuer_type: 'io', title: n.title.slice(0, 300), ...titleLang(n.title), ref: n.ref ? n.ref.slice(0, 120) : null, kind,
    countries: [...new Set(countries)], published_ts: published && published <= now + 86400000 ? published : null, closes_ts: closes,
    closes_text: n.deadline.replace(/\s+[\d.]+$/, '').slice(0, 60), url: `${UNGM}/Public/Notice/${n.id}`,
  };
}

// Cookies a response sets, as one Cookie header (names and values only).
function cookies(res, jar) {
  const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [res.headers.get('set-cookie')].filter(Boolean);
  for (const c of list) { const [pair] = String(c).split(';'); const i = pair.indexOf('='); if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim()); }
  return [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
}

// Every open UNGM notice. The search page is read once (it carries the form's anti-forgery token, as for any
// visitor), then the search results page by page, one request at a time.
export async function collectUngm(fetchImpl = fetch, { now = Date.now(), delayMs = 1200, maxPages = UNGM_MAX_PAGES, log = () => {} } = {}) {
  const jar = new Map(), diag = { src: 'ungm', status: 'failed', reason: '', rawCount: 0, acceptedCount: 0, httpRequests: 0 };
  const rows = [], seen = new Set();
  try {
    const page = await fetchImpl(`${UNGM}/Public/Notice`, { headers: { 'user-agent': UA, accept: 'text/html', 'accept-language': 'en' }, signal: AbortSignal.timeout(30000) });
    diag.httpRequests++;
    if (!page.ok) { diag.reason = `page-http-${page.status}`; return { rows, diagnostics: [diag] }; }
    const html = await page.text(), cookie = cookies(page, jar);
    const token = (/name="__RequestVerificationToken"[^>]*value="([^"]+)"/.exec(html) || /value="([^"]+)"[^>]*name="__RequestVerificationToken"/.exec(html) || [])[1];
    if (!token) { diag.reason = 'no-search-form'; return { rows, diagnostics: [diag] }; }
    let total = null, complete = false;
    for (let p = 0; p < maxPages; p++) {
      if (p) await sleep(delayMs);
      const body = { PageIndex: p, PageSize: UNGM_PAGE_SIZE, Title: '', Description: '', Reference: '', PublishedFrom: '', PublishedTo: '', DeadlineFrom: '', DeadlineTo: '',
        Countries: [], Agencies: [], UNSPSCs: [], NoticeTypes: [], SortField: 'DatePublished', SortAscending: false, isPicker: false, IsSustainable: false, IsActive: true,
        NoticeDisplayType: null, NoticeSearchTotalLabelId: 'noticeSearchTotal', TypeOfCompetitions: [] };
      const res = await fetchImpl(`${UNGM}/Public/Notice/Search`, { method: 'POST', headers: { 'user-agent': UA, accept: 'text/html', 'accept-language': 'en', 'content-type': 'application/json', RequestVerificationToken: token, cookie, referer: `${UNGM}/Public/Notice` }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
      diag.httpRequests++;
      if (!res.ok) { diag.reason = `search-http-${res.status}`; break; }
      const part = await res.text();
      if (total == null) total = Number((/noticeTotal = "(\d+)"/.exec(part) || [])[1]) || null;
      const notices = parseUngmRows(part);
      diag.rawCount += notices.length;
      for (const n of notices) { if (seen.has(n.id)) continue; seen.add(n.id); const r = ungmRow(n, now); if (r) rows.push(r); }
      if (notices.length < UNGM_PAGE_SIZE || (total != null && seen.size >= total)) { complete = true; break; }
    }
    diag.acceptedCount = rows.length;
    diag.status = complete ? 'complete' : rows.length ? 'partial' : 'failed';
    diag.reason = complete ? '' : diag.reason || 'page-limit';
    log(`ungm: ${rows.length} open notices of ${total ?? '?'} listed; ${diag.httpRequests} requests; ${diag.status}`);
  } catch (e) { diag.reason = diag.reason || (e?.name === 'TimeoutError' ? 'timeout' : 'network'); diag.status = rows.length ? 'partial' : 'failed'; diag.acceptedCount = rows.length; }
  return { rows, diagnostics: [diag] };
}

// --- TED (Tenders Electronic Daily) ---
export const TED_API = 'https://api.ted.europa.eu/v3/notices/search';
export const TED = 'https://ted.europa.eu';
export const TED_PAGE_SIZE = 250;
export const TED_MAX_PAGES = 12;
export const TED_FIELDS = Object.freeze(['publication-number', 'notice-type', 'procedure-type', 'procedure-identifier', 'buyer-name', 'buyer-country', 'title-proc',
  'internal-identifier-proc', 'publication-date', 'deadline-receipt-tender-date-lot', 'deadline-receipt-tender-time-lot', 'deadline-receipt-request-date-lot',
  'deadline-receipt-request-time-lot', 'place-of-performance-country-proc', 'place-of-performance-country-lot', 'buyer-legal-type', 'description-proc',
  'estimated-value-proc', 'estimated-value-cur-proc', 'contract-nature-main-proc', 'buyer-city']);
// The public sector's notices (once a day): every open call for competition, read with TED's iteration mode (its
// page numbers stop at 15,000 results).
export const TED_FULL_MAX_PAGES = 300;
const TED_CALLS = 'notice-type IN (cn-standard cn-social cn-desg pin-cfc-standard pin-cfc-social qu-sy)';
export function tedAllQuery(now = Date.now()) {
  const d = new Date(now).toISOString().slice(0, 10).replace(/-/g, '');
  return `${TED_CALLS} AND (deadline-receipt-tender-date-lot >= ${d} OR deadline-receipt-request-date-lot >= ${d})`;
}
// Open calls for competition whose buyer TED labels an EU institution, body or agency or an international
// organisation. Those labels are not reliable (national ministries carry them too), so each buyer is also checked
// by name (tedIssuer).
export function tedQuery(now = Date.now()) {
  const d = new Date(now).toISOString().slice(0, 10).replace(/-/g, '');
  return `buyer-legal-type IN (eu-ins-bod-ag int-org) AND ${TED_CALLS} AND (deadline-receipt-tender-date-lot >= ${d} OR deadline-receipt-request-date-lot >= ${d})`;
}
const foldName = s => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
// EU institutions, bodies, agencies, joint undertakings and missions, and international organisations, by the names
// they publish under (in English, French, German, Italian, Spanish, Portuguese or Dutch).
const TED_IO = [
  /\beuropean (commission|parliament|council|union|central bank|investment (bank|fund)|court of auditors|ombudsman|data protection supervisor|economic and social committee|committee of the regions|external action service|defence agency|environment agency|maritime safety agency|medicines agency|chemicals agency|food safety authority|banking authority|securities and markets authority|insurance and occupational pensions authority|labour authority|centre for disease prevention|centre for the development of vocational training|foundation for the improvement|training foundation|institute for gender equality|institute of innovation and technology|research (council|executive agency)|innovation council|education and culture executive agency|climate infrastructure and environment executive agency|border and coast guard agency|public prosecutor|agency for safety and health at work|schools|patent (office|organisation)|space agency|centre for medium range weather forecasts|organisation for the exploitation of meteorological satellites|southern observatory|molecular biology laboratory|organization for nuclear research|university institute|stability mechanism)\b/,
  /\bjoint undertaking\b/, /\b(health and digital|research|innovation council and smes) executive agency\b/, /\bberec\b/,
  /\b(commission europeenne|commissione europea|europese commissie|europaische kommission|comision europea|comissao europeia)\b/,
  /\b(parlement europeen|europaisches parlament|parlamento europeo|parlamento europeu|europees parlement)\b/,
  /\b(union europeenne|europaischen union|unione europea|union europea|uniao europeia|europese unie)\b/,
  /\b(cour des comptes europeenne|european court of auditors)\b/,
  /\b(united nations|unops|undp|unicef|unhcr|unesco|world food programme|world health organi[sz]ation|food and agriculture organi[sz]ation|international atomic energy agency|international labour (organi[sz]ation|office)|international organi[sz]ation for migration|world bank|oecd|organisation for economic co operation|osce|organization for security and co operation|nato|nspa|council of europe|conseil de l europe|banque de developpement (du )?conseil (de l )?europe|europaische patentorganisation|organisation europeenne des brevets|unified patent court|ecmwf|eumetsat|cern|iter organi[sz]ation|embl|international iberian nanotechnology laboratory|transport community|energy community|union for the mediterranean|cefta|central european free trade agreement|international centre for migration policy development|icmpd)\b/,
];
export function tedIssuer(name, country = '') {
  const f = foldName(name);
  if (!f) return false;
  if (f === 'cour des comptes' && String(country).toUpperCase() === 'LUX') return true; // the European Court of Auditors, Luxembourg
  return TED_IO.some(re => re.test(f));
}
// The buyer's name without TED's repeats: "Health and Digital Executive Agency (HaDEA) , HADEA - Health and Digital
// Executive Agency" -> "Health and Digital Executive Agency (HaDEA)"; "European Centre for the Development of Vocational
// Training, CEDEFOP - European Centre ..." -> "European Centre for the Development of Vocational Training (CEDEFOP)".
export function tedIssuerName(name, country = '') {
  const n = String(name || '').replace(/\s+/g, ' ').trim();
  if (foldName(n) === 'cour des comptes' && String(country).toUpperCase() === 'LUX') return 'Cour des comptes européenne';
  const paren = /^(.+?\([A-Za-z][A-Za-z0-9-]{1,12}\))\s*,\s*[A-Z][A-Za-z0-9-]{1,12}\s+-\s+/.exec(n);
  if (paren) return paren[1];
  const rep = /^(.+?),\s*([A-Z][A-Z0-9-]{1,12})\s+-\s+(.+)$/.exec(n);
  if (rep && foldName(rep[3]).startsWith(foldName(rep[1]).split(' ').slice(0, 3).join(' '))) return `${rep[1]} (${rep[2]})`;
  return n;
}
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// TED's "2026-11-09+01:00" and "17:00:00+01:00" -> the time and the issuer's own wording ("09-Nov-2026 17:00 (GMT 1.00)",
// the form the pages read). A day without a time closes at its end.
export function tedTime(date, time) {
  const d = /^(\d{4})-(\d{2})-(\d{2})(Z|[+-]\d{2}:\d{2})?$/.exec(String(date || '').trim());
  if (!d) return null;
  const [y, mo, day] = [Number(d[1]), Number(d[2]), Number(d[3])];
  if (mo < 1 || mo > 12 || new Date(Date.UTC(y, mo - 1, day)).getUTCDate() !== day) return null;
  const t = /^(\d{2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:\d{2})?$/.exec(String(time || '').trim());
  const off = (t && t[4]) || d[4] || 'Z';
  const ts = Date.parse(`${d[1]}-${d[2]}-${d[3]}T${t ? `${t[1]}:${t[2]}:${t[3] || '00'}` : '23:59:59'}${off}`);
  if (!Number.isFinite(ts)) return null;
  let text = `${d[3]}-${MON[mo - 1]}-${d[1]}`;
  if (t) {
    const sign = off === 'Z' ? '' : off[0] === '-' ? '-' : '', hh = off === 'Z' ? 0 : Number(off.slice(1, 3)), mm = off === 'Z' ? 0 : Number(off.slice(4, 6));
    text += ` ${t[1]}:${t[2]} (GMT ${sign}${hh}.${mm === 30 ? '50' : mm === 45 ? '75' : '00'})`;
  }
  return { ts, text };
}
const list = v => v == null ? [] : Array.isArray(v) ? v : [v];
// A multilingual TED value ({ eng: 'x' } or { fra: ['x', 'y'] }): the English one where given, else the first.
const pick = v => { if (!v || typeof v !== 'object') return list(v); return list(v.eng ?? v[Object.keys(v)[0]]); };
// The earliest deadline still ahead across lots, or null.
function nextDeadline(dates, times, now) {
  let best = null;
  list(dates).forEach((d, i) => { const x = tedTime(d, list(times)[i]); if (x && x.ts > now && (!best || x.ts < best.ts)) best = x; });
  return best;
}
const first = v => String(list(v)[0] || '').replace(/\s+/g, ' ').trim();
// Countries whose notices TED gives in English as their own language.
const ENGLISH_HOME = new Set(['IRL', 'MLT', 'GBR']);
const MULTI = ['mul', 'MUL'];
// A summary of at most 400 characters, cut at a word.
export const shorten = (t, n = 400) => { const s = String(t || '').replace(/\s+/g, ' ').trim(); if (s.length <= n) return s; const cut = s.slice(0, n - 1); return cut.slice(0, Math.max(cut.lastIndexOf(' '), n - 40)).replace(/[\s,;:.-]+$/, '') + '…'; };
// A notice's title and summary in each language TED gives them in, with the language its title is first read in:
// English where given, else the language of its country's edition, else the first. TED files some notices'
// own-language text under English as well; such a version counts as its real language.
export function tedTexts(n) {
  const country3 = String(list(n['buyer-country'])[0] || '').toUpperCase(), home = COUNTRY[countryFromIso3(country3)] ? newsLang(countryFromIso3(country3)) : '';
  const obj = v => v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  const titles = obj(n['title-proc']), descs = obj(n['description-proc']), names = obj(n['buyer-name']);
  const byLang = new Map();
  for (const [key, value] of Object.entries(titles)) {
    let lang = TED_LANG[key.toLowerCase()];
    const title = first(value);
    if (!lang || title.length < 4) continue;
    if (lang === 'en' && !ENGLISH_HOME.has(country3)) { const seen = guessLang(title, { hint: home }); if (seen && seen !== 'en') lang = seen; }
    if (byLang.has(lang)) continue;
    byLang.set(lang, [title.slice(0, 300), shorten(first(descs[key])) || null, first(names[key]) || null]);
  }
  if (!byLang.size) return null;
  const lang = byLang.has('en') ? 'en' : byLang.has(home) ? home : [...byLang.keys()][0];
  const [title, summary, buyer] = byLang.get(lang);
  byLang.delete(lang);
  // Each other language's buyer name only where it differs ("FOD Justitie" for "SPF Justice").
  const texts = [...byLang].slice(0, 7).map(([l, [t, d, b]]) => [l, b && b !== buyer ? [t, d, b] : [t, d]]);
  return { title, summary, lang, langs: [lang, ...byLang.keys()].slice(0, 8), texts: texts.length ? Object.fromEntries(texts) : null, buyer };
}
const NATURE = { supplies: 'goods', works: 'works', services: 'services' };
// What TED adds to every notice: goods/works/services, the estimated value and the buyer's town.
function tedDetails(n) {
  const amount = Number(first(n['estimated-value-proc'])), cur = first(n['estimated-value-cur-proc']).toUpperCase();
  const city = n['buyer-city'] && typeof n['buyer-city'] === 'object' ? first(n['buyer-city'][MULTI.find(k => k in n['buyer-city'])] ?? Object.values(n['buyer-city'])[0]) : first(n['buyer-city']);
  // Buyers sometimes state a token value ("1"): only a real amount is shown.
  const value = Number.isFinite(amount) && amount >= 1000 && amount < 1e13 && /^[A-Z]{3}$/.test(cur);
  return { nature: NATURE[first(n['contract-nature-main-proc'])] || null, value_amount: value ? amount : null, value_cur: value ? cur : null, place: city.slice(0, 80) || null };
}
// The notice's timing, kind, places and reference, shared by both TED readers.
function tedCommon(n, now) {
  const pub = String(n?.['publication-number'] || '');
  if (!/^\d{1,8}-\d{4}$/.test(pub)) return null;
  const tender = nextDeadline(n['deadline-receipt-tender-date-lot'], n['deadline-receipt-tender-time-lot'], now);
  const request = tender ? null : nextDeadline(n['deadline-receipt-request-date-lot'], n['deadline-receipt-request-time-lot'], now);
  const closes = tender || request;
  if (!closes || closes.ts > now + TENDER_MAX_AHEAD_MS) return null;
  const texts = tedTexts(n);
  if (!texts) return null;
  const type = String(n['notice-type'] || '');
  const kind = type === 'cn-desg' ? 'other' : /^pin-cfc/.test(type) ? 'eoi' : type === 'qu-sy' || !tender ? 'prequal' : 'itb';
  const places = [...new Set([...list(n['place-of-performance-country-proc']), ...list(n['place-of-performance-country-lot'])].map(countryFromIso3).filter(Boolean))];
  const day = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(n['publication-date'] || ''));
  const published = day ? Date.UTC(+day[1], +day[2] - 1, +day[3], 12) : null;
  const ref = first(n['internal-identifier-proc']);
  return { pub, kind, places, ...texts, ref: ref ? ref.slice(0, 120) : null, published_ts: published && published <= now + 86400000 ? published : null, closes_ts: closes.ts, closes_text: closes.text,
    url: `${TED}/en/notice/-/detail/${pub}`, ...tedDetails(n) };
}
const issuerOf = n => String(pick(n['buyer-name'])[0] || '').replace(/\s+/g, ' ').trim();
const IO_TYPES = ['eu-ins-bod-ag', 'int-org'];
// A TED notice from an EU institution, body or agency or an international organisation -> the row the site stores,
// or null (another buyer's, or no deadline ahead).
export function tedRow(n, now = Date.now()) {
  const issuer = issuerOf(n), country3 = list(n['buyer-country'])[0];
  if (!tedIssuer(issuer, country3)) return null;
  // Read in full, a notice not labelled as an international buyer's is a national one, whatever its name.
  if (n['buyer-legal-type'] != null && !list(n['buyer-legal-type']).some(t => IO_TYPES.includes(t))) return null;
  const c = tedCommon(n, now);
  if (!c) return null;
  const { pub, places, buyer, ...row } = c;
  return { id: `ted:${pub}`, src: 'ted', issuer: tedIssuerName(buyer || issuer, country3).slice(0, 120), issuer_type: 'io', ...row, countries: places.slice(0, 60) };
}
// Any other buyer's notice: the public sector of the EU and EEA countries (bodies that award subsidised contracts,
// as TED labels them, are private). Notices without a place of performance are listed in the buyer's country.
export function tednRow(n, now = Date.now()) {
  const issuer = issuerOf(n), country3 = list(n['buyer-country'])[0];
  if (issuer.length < 2 || tedRow(n, now)) return null;
  const c = tedCommon(n, now);
  if (!c) return null;
  const { pub, places, buyer, ...row } = c, home = countryFromIso3(country3);
  const countries = places.length ? places : home ? [home] : [];
  if (!countries.length) return null;
  return { id: `tedn:${pub}`, src: 'tedn', issuer: tedIssuerName(buyer || issuer, country3).slice(0, 120), issuer_type: list(n['buyer-legal-type']).includes('org-sub') ? 'private' : 'public', ...row, countries: countries.slice(0, 60) };
}

// Every open TED notice from EU institutions and international organisations, through the public search API, page
// by page; with `full`, every other buyer's too (the public sector, tedn). Where a procedure has several notices, its
// latest one.
export async function collectTed(fetchImpl = fetch, { now = Date.now(), delayMs = 1000, maxPages, full = false, log = () => {} } = {}) {
  const pages = maxPages ?? (full ? TED_FULL_MAX_PAGES : TED_MAX_PAGES);
  const diag = { src: 'ted', status: 'failed', reason: '', rawCount: 0, acceptedCount: 0, httpRequests: 0 };
  const byProcedure = { ted: new Map(), tedn: new Map() }, query = full ? tedAllQuery(now) : tedQuery(now);
  const keep = (map, key, r) => { const prev = map.get(key); if (!prev || (r.published_ts || 0) > (prev.published_ts || 0) || ((r.published_ts || 0) === (prev.published_ts || 0) && r.id > prev.id)) map.set(key, r); };
  let total = null, complete = false, token = null;
  try {
    for (let page = 1; page <= pages; page++) {
      if (page > 1) await sleep(delayMs);
      const body = { query, fields: TED_FIELDS, limit: TED_PAGE_SIZE, onlyLatestVersions: true, ...(full ? { paginationMode: 'ITERATION', ...(token ? { iterationNextToken: token } : {}) } : { page, paginationMode: 'PAGE_NUMBER' }) };
      const res = await fetchImpl(TED_API, { method: 'POST', headers: { 'user-agent': UA, accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(90000) });
      diag.httpRequests++;
      if (!res.ok) { diag.reason = `search-http-${res.status}`; break; }
      const data = await res.json().catch(() => null);
      if (!data || !Array.isArray(data.notices)) { diag.reason = 'bad-response'; break; }
      if (data.timedOut === true) { diag.reason = 'search-timed-out'; break; }
      if (total == null && Number.isSafeInteger(data.totalNoticeCount)) total = data.totalNoticeCount;
      diag.rawCount += data.notices.length;
      for (const n of data.notices) {
        const key = String(n['procedure-identifier'] || n['publication-number']);
        const r = tedRow(n, now);
        if (r) { keep(byProcedure.ted, key, r); continue; }
        const p = full ? tednRow(n, now) : null;
        if (p) keep(byProcedure.tedn, key, p);
      }
      token = typeof data.iterationNextToken === 'string' && data.iterationNextToken ? data.iterationNextToken : null;
      // Iterating, the last page is the one without a token for the next (or an empty one); by page number, a short one.
      if ((total != null && diag.rawCount >= total) || (full ? !token || !data.notices.length : data.notices.length < TED_PAGE_SIZE)) { complete = true; break; }
    }
  } catch (e) { diag.reason = diag.reason || (e?.name === 'TimeoutError' ? 'timeout' : 'network'); }
  diag.status = complete ? 'complete' : 'failed';
  diag.reason = complete ? '' : diag.reason || 'page-limit';
  const out = [], diagnostics = [];
  for (const src of full ? ['ted', 'tedn'] : ['ted']) {
    const rows = [...byProcedure[src].values()];
    out.push(...rows);
    const d = { ...diag, src, acceptedCount: rows.length, status: complete ? 'complete' : rows.length ? 'partial' : 'failed' };
    diagnostics.push(d);
    log(`${src}: ${rows.length} open notices${src === 'ted' ? ' from international organisations' : ' from the public sector'} of ${total ?? '?'} listed; ${diag.httpRequests} requests; ${d.status}${d.reason ? ' ' + d.reason : ''}`);
  }
  return { rows: out, diagnostics };
}

// "2026-10-30T03:59:00.000+0000" (or "+00:00") -> the time and its wording, in the time zone given.
export function isoTime(value) {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}(?::\d{2})?)(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})$/.exec(String(value || '').trim());
  if (!m) return null;
  const off = m[3] === 'Z' ? 'Z' : m[3].replace(/^([+-]\d{2}):?(\d{2})$/, '$1:$2');
  return tedTime(m[1] + off, m[2] + off);
}
const closesOk = (ts, now) => Number.isFinite(ts) && ts > now && ts <= now + TENDER_MAX_AHEAD_MS;
const noonOf = v => { const d = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || '')); return d ? Date.UTC(+d[1], +d[2] - 1, +d[3], 12) : null; };

// --- World Bank Group corporate procurement (RFx Now): its public list of open requests for expressions of interest ---
export const WBG = 'https://wbgeprocure-rfxnow.worldbank.org/rfxnow';
export const WBG_LIST = `${WBG}/json/advertisement/activeAdvertisements.json`;
// One advertisement -> the row the site stores, or null. Only the notice itself is kept: never the names or contacts
// of the staff who posted it.
export function wbgRow(a, now = Date.now()) {
  if (!a || typeof a !== 'object' || a.draft === true) return null;
  const id = Number(a.id);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const closes = isoTime(a.eoiDeadline);
  if (!closes || !closesOk(closes.ts, now)) return null;
  const body = String(a.text || '');
  // The title as the notice states it in full ("Assignment Title: ..."); the list's own title can be cut short.
  const title = text((/Assignment Title:\s*([\s\S]*?)<\/p>/i.exec(body) || [])[1]) || text(a.procurementTitle);
  if (title.length < 4) return null;
  const list = (/Assignment Countries:\s*(?:<\/p>)?\s*<ul>([\s\S]*?)<\/ul>/i.exec(body) || [])[1] || '';
  const countries = [...new Set([...list.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map(m => countryCode(text(m[1]))).filter(Boolean))];
  const published = noonOf(a.publicationDate), ref = text(a.procurementNumber);
  return { id: `wbg:${id}`, src: 'wbg', issuer: 'World Bank Group', issuer_type: 'io', title: title.slice(0, 300), ...titleLang(title), ref: ref ? ref.slice(0, 120) : null, kind: 'eoi',
    countries, published_ts: published && published <= now + 86400000 ? published : null, closes_ts: closes.ts, closes_text: closes.text, url: `${WBG}/public/advertisement/${id}/view.html` };
}
export async function collectWbg(fetchImpl = fetch, { now = Date.now(), log = () => {} } = {}) {
  const diag = { src: 'wbg', status: 'failed', reason: '', rawCount: 0, acceptedCount: 0, httpRequests: 0 };
  const rows = [];
  try {
    const res = await fetchImpl(WBG_LIST, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: AbortSignal.timeout(60000) });
    diag.httpRequests++;
    if (!res.ok) diag.reason = `list-http-${res.status}`;
    else {
      const data = await res.json().catch(() => null);
      if (!data || !Array.isArray(data.advertisementList)) diag.reason = 'bad-response';
      else {
        diag.rawCount = data.advertisementList.length;
        for (const a of data.advertisementList) { const r = wbgRow(a, now); if (r) rows.push(r); }
        diag.status = 'complete';
      }
    }
  } catch (e) { diag.reason = e?.name === 'TimeoutError' ? 'timeout' : 'network'; }
  diag.acceptedCount = rows.length;
  log(`wbg: ${rows.length} open notices of ${diag.rawCount} listed; ${diag.status}${diag.reason ? ' ' + diag.reason : ''}`);
  return { rows, diagnostics: [diag] };
}

// --- African Development Bank Group corporate procurement: its "current solicitations" pages ---
export const AFDB = 'https://www.afdb.org';
export const AFDB_LIST = `${AFDB}/en/about-us/corporate-procurement/procurement-notices/current-solicitations`;
export const AFDB_MAX_PAGES = 4;
export const AFDB_DELAY_MS = 10000; // the site's robots.txt asks for ten seconds between requests
const AFDB_KIND = { RFP: 'rfp', RFQ: 'rfq', EOI: 'eoi', ITB: 'itb', IFB: 'itb', RFI: 'rfi' };
export function parseAfdb(html) {
  const out = [];
  for (const chunk of String(html || '').split(/<div class="views-field views-field-title">/).slice(1)) {
    const a = /<a href="(\/(?:en|fr)\/corporate-procurement\/[a-z0-9-]+)"[^>]*>([\s\S]*?)<\/a>/.exec(chunk);
    if (!a) continue;
    const ref = text((/views-field-field-procurement-reference[\s\S]*?<div class="field-content">([\s\S]*?)<\/div>/.exec(chunk) || [])[1]);
    const published = (/views-field-field-procurement-pub-date[\s\S]*?content="([^"]+)"/.exec(chunk) || [])[1] || '';
    const deadline = (/views-field-field-procurement-end-date[\s\S]*?content="([^"]+)"/.exec(chunk) || [])[1] || '';
    out.push({ path: a[1], title: text(a[2]), ref, published, deadline });
  }
  return out;
}
export function afdbRow(n, now = Date.now()) {
  const id = (/-(\d{2,9})$/.exec(n?.path || '') || [])[1];
  if (!id || !n.title || n.title.length < 4) return null;
  const closes = isoTime(n.deadline);
  if (!closes || !closesOk(closes.ts, now)) return null;
  const code = (/\/(RFP|RFQ|EOI|ITB|IFB|RFI)\//i.exec(n.ref || '') || [])[1];
  const kind = code ? AFDB_KIND[code.toUpperCase()] : /request for proposal|demande de proposition/i.test(n.title) ? 'rfp' : /quotation|cotation/i.test(n.title) ? 'rfq'
    : /expression of interest|manifestation d.int[eé]r[eê]t/i.test(n.title) ? 'eoi' : /invitation to (bid|tender)|appel d.offres/i.test(n.title) ? 'itb' : 'other';
  const published = noonOf(n.published);
  return { id: `afdb:${id}`, src: 'afdb', issuer: 'African Development Bank Group', issuer_type: 'io', title: n.title.slice(0, 300), ...titleLang(n.title, n.path.startsWith('/fr/') ? 'fr' : 'en'), ref: n.ref ? n.ref.slice(0, 120) : null, kind,
    countries: [], published_ts: published && published <= now + 86400000 ? published : null, closes_ts: closes.ts, closes_text: closes.text, url: AFDB + n.path };
}
// The newest solicitations first, page by page, until a page lists nothing still open. A challenge page or a refusal
// ends the run: the crawler does not try to get past it.
export async function collectAfdb(fetchImpl = fetch, { now = Date.now(), afdbDelayMs = AFDB_DELAY_MS, maxPages = AFDB_MAX_PAGES, log = () => {} } = {}) {
  const diag = { src: 'afdb', status: 'failed', reason: '', rawCount: 0, acceptedCount: 0, httpRequests: 0 };
  const rows = [], seen = new Set();
  let complete = false;
  try {
    for (let p = 0; p < maxPages; p++) {
      if (p) await sleep(afdbDelayMs);
      const res = await fetchImpl(p ? `${AFDB_LIST}?page=${p}` : AFDB_LIST, { headers: { 'user-agent': UA, accept: 'text/html', 'accept-language': 'en' }, signal: AbortSignal.timeout(30000) });
      diag.httpRequests++;
      if (!res.ok) { diag.reason = `page-http-${res.status}`; break; }
      const html = await res.text();
      if (/cf-chl|challenge-platform|Just a moment\.\.\./i.test(html)) { diag.reason = 'challenge-page'; break; }
      const notices = parseAfdb(html);
      if (!notices.length) { if (p === 0) diag.reason = 'no-list'; else complete = true; break; }
      diag.rawCount += notices.length;
      let open = 0;
      for (const n of notices) { const r = afdbRow(n, now); if (r && !seen.has(r.id)) { seen.add(r.id); rows.push(r); open++; } }
      if (!open || !/[?&]page=\d+"[^>]*>\s*next|class="next"/i.test(html)) { complete = true; break; }
    }
  } catch (e) { diag.reason = diag.reason || (e?.name === 'TimeoutError' ? 'timeout' : 'network'); }
  diag.acceptedCount = rows.length;
  diag.status = complete ? 'complete' : rows.length ? 'partial' : 'failed';
  diag.reason = complete ? '' : diag.reason || 'page-limit';
  log(`afdb: ${rows.length} open notices; ${diag.httpRequests} requests; ${diag.status}${diag.reason ? ' ' + diag.reason : ''}`);
  return { rows, diagnostics: [diag] };
}

// --- South Africa: the eTenders Publication Portal (National Treasury) ---
// Its list of advertised tenders, as its own Opportunities page reads it, 500 at a time (some 2,200 are open).
export const ETZA = 'https://www.etenders.gov.za';
export const ETZA_LIST = `${ETZA}/Home/PaginatedTenderOpportunities`;
export const ETZA_PAGE = 500;
export const ETZA_MAX_PAGES = 20;
const ETZA_KIND = [[/^request for bid/i, 'itb'], [/^request for quotation/i, 'rfq'], [/^request for proposal/i, 'rfp'], [/^expression of interest/i, 'eoi'], [/^request for information/i, 'rfi']];
// Goods, works or services, from the portal's category.
export function etzaNature(category) {
  const c = String(category || '');
  if (/^disposals/i.test(c)) return null;
  if (/^supplies|^manufacture|^mining|^agriculture/i.test(c)) return 'goods';
  if (/construction|^services: (building|civil)|civil engineering|^specialised construction/i.test(c)) return 'works';
  return c ? 'services' : null;
}
// "2026-12-08T10:00:00" (South African time, two hours ahead of GMT all year) -> the time and its wording.
export function zaTime(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(v || ''));
  if (!m || +m[2] < 1 || +m[2] > 12) return null;
  const ts = Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00+02:00`);
  return Number.isFinite(ts) ? { ts, text: `${m[3]}-${MON[+m[2] - 1]}-${m[1]} ${m[4]}:${m[5]} (GMT 2.00)` } : null;
}
const titleWords = s => String(s || '').toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (x, a, b) => a + b.toUpperCase());
const clean = (v, n) => String(v ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const ETZA_DOC = d => `${ETZA}/home/Download?blobName=${encodeURIComponent(d.supportDocumentID + (d.extension || ''))}&downloadedFileName=${encodeURIComponent(d.fileName || 'document')}`;
// One advertised tender -> the row the site stores, or null. The notice links to its documents on the portal (the
// portal has no page per tender). Contact people's names, e-mail addresses and telephone numbers are not kept.
export function etzaRow(x, now = Date.now()) {
  if (!x || typeof x !== 'object') return null;
  const id = Number(x.id);
  if (!Number.isSafeInteger(id) || id <= 0 || (x.status && x.status !== 'Published')) return null;
  const title = clean(x.description, 300), issuer = clean(x.organ_of_State || x.department, 120);
  if (title.length < 4 || issuer.length < 2) return null;
  const closes = zaTime(x.closing_Date);
  if (!closes || !closesOk(closes.ts, now)) return null;
  const type = clean(x.type, 80), kind = (ETZA_KIND.find(([re]) => re.test(type)) || [])[1] || 'other';
  const docs = (Array.isArray(x.supportDocument) ? x.supportDocument : []).filter(d => d && d.active !== false && /^[0-9a-f-]{36}$/i.test(String(d.supportDocumentID || '')) && /^\.[a-z0-9]{2,5}$/i.test(String(d.extension || '')))
    .slice(0, 6).map(d => ({ n: clean(d.fileName, 120) || 'Document', u: ETZA_DOC(d) }));
  const brief = x.briefingSession === true ? zaTime(x.compulsory_briefing_session) : null;
  const info = { ...(brief ? { brief: { ts: brief.ts, text: brief.text, compulsory: x.briefingCompulsory === true, venue: clean(x.briefingVenue, 200) || null } } : {}), ...(x.eSubmission === true ? { esub: true } : {}), ...(docs.length ? { docs } : {}) };
  const published = noonOf(x.date_Published), category = clean(x.category, 80), province = clean(x.province, 60);
  return { id: `etza:${id}`, src: 'etza', issuer, issuer_type: 'public', title, lang: 'en', langs: ['en'], ref: clean(x.tender_No, 120) || null, kind, countries: ['ZA'],
    published_ts: published && published <= now + 86400000 ? published : null, closes_ts: closes.ts, closes_text: closes.text,
    url: docs.length ? docs[0].u : `${ETZA}/Home/opportunities?id=1`, category: category || null, nature: etzaNature(category), region: province || null,
    place: x.town ? titleWords(clean(x.town, 80)) : null, info: Object.keys(info).length ? info : null };
}
export async function collectEtza(fetchImpl = fetch, { now = Date.now(), delayMs = 2000, maxPages = ETZA_MAX_PAGES, log = () => {} } = {}) {
  const diag = { src: 'etza', status: 'failed', reason: '', rawCount: 0, acceptedCount: 0, httpRequests: 0 };
  const rows = [], seen = new Set();
  let complete = false, total = null;
  try {
    for (let p = 0; p < maxPages; p++) {
      if (p) await sleep(delayMs);
      const res = await fetchImpl(`${ETZA_LIST}?draw=${p + 1}&start=${p * ETZA_PAGE}&length=${ETZA_PAGE}&status=1`, { headers: { 'user-agent': UA, accept: 'application/json', 'accept-language': 'en' }, signal: AbortSignal.timeout(60000) });
      diag.httpRequests++;
      if (!res.ok) { diag.reason = `list-http-${res.status}`; break; }
      const data = await res.json().catch(() => null);
      if (!data || !Array.isArray(data.data)) { diag.reason = 'bad-response'; break; }
      if (total == null && Number.isSafeInteger(data.recordsTotal)) total = data.recordsTotal;
      diag.rawCount += data.data.length;
      for (const x of data.data) { const r = etzaRow(x, now); if (r && !seen.has(r.id)) { seen.add(r.id); rows.push(r); } }
      if (data.data.length < ETZA_PAGE || (total != null && diag.rawCount >= total)) { complete = true; break; }
    }
  } catch (e) { diag.reason = diag.reason || (e?.name === 'TimeoutError' ? 'timeout' : 'network'); }
  diag.acceptedCount = rows.length;
  diag.status = complete ? 'complete' : rows.length ? 'partial' : 'failed';
  diag.reason = complete ? '' : diag.reason || 'page-limit';
  log(`etza: ${rows.length} open tenders of ${total ?? '?'} listed; ${diag.httpRequests} requests; ${diag.status}${diag.reason ? ' ' + diag.reason : ''}`);
  return { rows, diagnostics: [diag] };
}

// Every source, one after another. `full` (once a day) adds the EU and EEA public sector's notices from TED and
// Brazil's from PNCP (some 40,000 each).
export async function collectTenders(fetchImpl = fetch, opts = {}) {
  const parts = [await collectUngm(fetchImpl, opts), await collectTed(fetchImpl, opts), await collectWbg(fetchImpl, opts), await collectAfdb(fetchImpl, opts), await collectEtza(fetchImpl, opts),
    await collectPpke(fetchImpl, opts), await collectGets(fetchImpl, opts), await collectAusTender(fetchImpl, opts), await collectSecop(fetchImpl, opts), await collectCanadaBuys(fetchImpl, opts), ...(opts.full ? [await collectPncp(fetchImpl, opts)] : [])];
  const diagnostics = parts.flatMap(p => p.diagnostics);
  return { rows: parts.flatMap(p => p.rows), diagnostics, complete: diagnostics.filter(d => d.status === 'complete').map(d => d.src) };
}

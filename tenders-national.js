// Tenders from national public procurement systems (owner, 23 Oct 2026): each country's official portal, never an
// aggregator. Kenya's Public Procurement Information Portal (PPRA), New Zealand's GETS (MBIE), Australia's AusTender
// (Department of Finance), Colombia's SECOP II (Colombia Compra Eficiente, through the national open data portal),
// Brazil's PNCP (Portal Nacional de Contratações Públicas, once a day: some 39,000 open notices), CanadaBuys (Public
// Services and Procurement Canada), the UK's Find a Tender (Cabinet Office) and Contracts Finder, and the United
// States' SAM.gov (General Services Administration). Each notice keeps
// what its portal states, links to its official page, and never the names, e-mail addresses or telephone numbers of
// the officials who posted it. The crawler names itself (tenders-collect.js) and keeps to one request at a time.
import { TENDER_MAX_AHEAD_MS } from './tenders-kinds.js';

const UA = 'Mozilla/5.0 (compatible; GlobalNewsflixTenders/1.0; +https://globalnewsflix.com/contact)';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const clean = (v, n) => String(v ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const NAMED = { quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', ndash: '–', mdash: '—', hellip: '…', laquo: '«', raquo: '»', deg: '°', euro: '€' };
const ACCENT = { acute: '\u0301', grave: '\u0300', circ: '\u0302', uml: '\u0308', tilde: '\u0303', cedil: '\u0327', ring: '\u030A' };
// Character references, numeric and named ("&eacute;" -> "é"); "&amp;" last, so "&amp;eacute;" stays as written.
const decode = s => String(s || '').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&([a-zA-Z]{2,8});/g, (m, name) => { if (NAMED[name]) return NAMED[name]; const a = /^([a-zA-Z])(acute|grave|circ|uml|tilde|cedil|ring)$/.exec(name); return a ? (a[1] + ACCENT[a[2]]).normalize('NFC') : name === 'szlig' ? 'ß' : name === 'aelig' ? 'æ' : name === 'oslash' ? 'ø' : m; })
  .replace(/&amp;/g, '&');
const text = html => decode(String(html || '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
// No e-mail addresses or telephone numbers in what the site keeps of a notice's text.
const noContacts = s => String(s || '').replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '').replace(/(?:\+\d{1,3}[ -]?)?(?:\(\d{2,4}\)[ -]?)?\b\d{2,4}[ -]\d{3,4}[ -]\d{3,4}\b/g, '')
  // ... and no words left pointing at what was removed ("contact us on ." -> "contact us.").
  .replace(/\s+(?:on|at|via|to|e-?mail|tel(?:ephone)?|phone)\s*:?\s*(?=[.,;)]|$)/gi, '').replace(/\s{2,}/g, ' ').trim();
const summaryOf = (s, n = 400) => { const t = noContacts(clean(s, 2000).replace(/\*\*/g, '')).replace(/^[?\s]+(?=\p{Lu})/u, ''); if (t.length <= n) return t || null; const cut = t.slice(0, n - 1); return cut.slice(0, Math.max(cut.lastIndexOf(' '), n - 40)).replace(/[\s,;:.-]+$/, '') + '…'; };
const closesOk = (ts, now) => Number.isFinite(ts) && ts > now && ts <= now + TENDER_MAX_AHEAD_MS;
const noon = (y, m, d) => Date.UTC(y, m - 1, d, 12);

// A local time in a time zone -> UTC milliseconds and the wording the site reads ("26-Oct-2026 10:00 (GMT 11.00)").
function offsetMinutes(ts, zone) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(ts).map(x => [x.type, x.value]));
  return Math.round((Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute) - (ts - (((ts % 60000) + 60000) % 60000))) / 60000) || 0;
}
const zoneText = (y, m, d, h, mi, off) => {
  const sign = off < 0 ? '-' : '', a = Math.abs(off), frac = a % 60 === 30 ? '50' : a % 60 === 45 ? '75' : '00';
  return `${String(d).padStart(2, '0')}-${MON[m - 1]}-${y}${h == null ? '' : ` ${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')} (GMT ${sign}${Math.floor(a / 60)}.${frac})`}`;
};
export function zonedTime(y, m, d, h, mi, zone) {
  if (![y, m, d].every(Number.isInteger) || m < 1 || m > 12 || new Date(Date.UTC(y, m - 1, d)).getUTCDate() !== d) return null;
  // A day without a time closes at its end.
  const [hh, mm] = h == null ? [23, 59] : [h, mi];
  let ts = Date.UTC(y, m - 1, d, hh, mm);
  for (let i = 0; i < 2; i++) ts = Date.UTC(y, m - 1, d, hh, mm) - offsetMinutes(ts, zone) * 60000;
  return { ts, text: zoneText(y, m, d, h, mi, offsetMinutes(ts, zone)) };
}
// "2026-10-24 11:00:00" or "2026-11-06T09:00" in a time zone.
export function isoLocal(v, zone) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(String(v || ''));
  return m ? zonedTime(+m[1], +m[2], +m[3], m[4] == null ? null : +m[4], m[5] == null ? null : +m[5], zone) : null;
}
const published = (v, now) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || '')); const t = m ? noon(+m[1], +m[2], +m[3]) : null; return t && t <= now + 86400000 ? t : null; };
const diagnostic = src => ({ src, status: 'failed', reason: '', rawCount: 0, acceptedCount: 0, httpRequests: 0 });
// One request, tried again when the portal asks the crawler to slow down (429) or is briefly unavailable (5xx): after
// the wait it asks for (Retry-After), else a little longer each time. `init` makes each attempt's options; `count`
// is told of every request made.
// A connection the portal drops (reset, refused, unreachable for a moment) is tried again the same way.
const DROPPED = new Set(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE', 'EAI_AGAIN', 'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT']);
export async function retrying(fetchImpl, url, init, { attempts = 5, retryMs = 20000, count = () => {} } = {}) {
  for (let a = 1; ; a++) {
    let res;
    try { res = await fetchImpl(url, init()); }
    catch (e) {
      count();
      if (a >= attempts || !DROPPED.has(e?.cause?.code || e?.code)) throw e;
      await sleep(retryMs * a);
      continue;
    }
    count();
    if ((res.status !== 429 && res.status < 500) || a >= attempts) return res;
    const after = Number(res.headers?.get?.('retry-after'));
    await sleep(retryMs ? (Number.isFinite(after) && after > 0 ? Math.min(after, 120) * 1000 : retryMs * a) : 0);
  }
}
const finish = (diag, rows, complete, log, note = '') => {
  diag.acceptedCount = rows.length;
  diag.status = complete ? 'complete' : rows.length ? 'partial' : 'failed';
  diag.reason = complete ? '' : diag.reason || 'page-limit';
  log(`${diag.src}: ${rows.length} open tenders${note}; ${diag.httpRequests} requests; ${diag.status}${diag.reason ? ' ' + diag.reason : ''}`);
  return { rows, diagnostics: [diag] };
};
// Why a request failed, for the run's report: a timeout, or the network's own reason ("network-econnreset").
const failure = e => { const code = String(e?.cause?.code || e?.code || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30); return e?.name === 'TimeoutError' ? 'timeout' : code ? `network-${code}` : 'network'; };

// --- Kenya: the Public Procurement Information Portal (tenders.go.ke) ---
export const PPKE = 'https://tenders.go.ke';
const PPKE_KIND = { 'open tender': 'itb', 'request for proposals': 'rfp', 'expression of interest': 'eoi', 'request for quotation': 'rfq', 'framework agreements': 'itb', 'restricted tender': 'itb', 'two-stage tendering': 'itb' };
const PPKE_NATURE = { works: 'works', goods: 'goods', 'consultancy services': 'services', 'non consultancy services': 'services' };
// One active tender -> the row the site stores, or null. Each record carries the officer who posted it (created_by):
// it is never read.
export function ppkeRow(t, now = Date.now()) {
  if (!t || typeof t !== 'object' || !Number.isSafeInteger(t.id) || t.id <= 0 || t.terminated === 1 || t.published === 0) return null;
  const title = clean(t.title, 300), issuer = clean(t.pe?.name, 120);
  const closes = isoLocal(t.close_at, 'Africa/Nairobi');
  if (title.length < 4 || issuer.length < 2 || !closes || !closesOk(closes.ts, now)) return null;
  const method = clean(t.procurement_method?.title, 60).toLowerCase(), category = clean(t.procurement_category?.title, 60);
  const docs = (Array.isArray(t.documents) ? t.documents : []).filter(d => /^\/storage\/Documents\/[^?#]+\.[a-z0-9]{2,5}$/i.test(String(d?.url || ''))).slice(0, 6)
    .map(d => ({ n: clean(d.type?.description || d.description, 120) || 'Document', u: new URL(d.url, PPKE).href }));
  return { id: `ppke:${t.id}`, src: 'ppke', issuer, issuer_type: 'public', title, lang: 'en', langs: ['en'], ref: clean(t.tender_ref, 120) || null, kind: PPKE_KIND[method] || 'other', countries: ['KE'],
    published_ts: published(t.published_at, now), closes_ts: closes.ts, closes_text: closes.text, url: `${PPKE}/tenders/${t.id}`, category: category || null, nature: PPKE_NATURE[category.toLowerCase()] || null,
    place: clean(t.pe?.city, 80) || null, summary: t.description ? summaryOf(t.description) : null, info: docs.length ? { docs } : null };
}
export async function collectPpke(fetchImpl = fetch, { now = Date.now(), delayMs = 2000, maxPages = 40, log = () => {} } = {}) {
  const diag = diagnostic('ppke'), rows = [], seen = new Set();
  let complete = false;
  try {
    for (let page = 1; page <= maxPages; page++) {
      if (page > 1) await sleep(delayMs);
      const res = await fetchImpl(`${PPKE}/api/active-tenders?perpage=50&page=${page}`, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: AbortSignal.timeout(60000) });
      diag.httpRequests++;
      if (!res.ok) { diag.reason = `list-http-${res.status}`; break; }
      const data = await res.json().catch(() => null);
      if (!data || !Array.isArray(data.data)) { diag.reason = 'bad-response'; break; }
      diag.rawCount += data.data.length;
      for (const t of data.data) { const r = ppkeRow(t, now); if (r && !seen.has(r.id)) { seen.add(r.id); rows.push(r); } }
      if (!data.next_page_url || page >= Number(data.last_page || 0) || !data.data.length) { complete = true; break; }
    }
  } catch (e) { diag.reason = diag.reason || failure(e); }
  return finish(diag, rows, complete, log);
}

// --- New Zealand: GETS (Government Electronic Tender Service, MBIE), its feed of open tenders ---
export const GETS = 'https://www.gets.govt.nz';
export const GETS_FEED = `${GETS}/ExternalRSSFeed.htm`;
const NZ_REGIONS = new Set(['Northland', 'Auckland', 'Waikato', 'Bay of Plenty', 'Gisborne', "Hawke's Bay", 'Taranaki', 'Manawatu-Wanganui', 'Wellington', 'Tasman', 'Nelson', 'Marlborough', 'West Coast', 'Canterbury', 'Otago', 'Southland', 'Chatham Islands']);
// What a title says the notice is ("RFP", "Registration of Interest", ...); else a tender.
export function kindOfTitle(title, fallback = 'other') {
  const t = String(title || '');
  if (/\bRFQ\b|request for quot/i.test(t)) return 'rfq';
  if (/\bRFP\b|request for proposals?/i.test(t)) return 'rfp';
  if (/\bROI\b|\bEOI\b|registrations? of interest|expressions? of interest/i.test(t)) return 'eoi';
  if (/\bRFI\b|request for information/i.test(t)) return 'rfi';
  if (/\bRFT\b|request for tenders?|invitation to tender|\bITT\b/i.test(t)) return 'itb';
  if (/\bfund(?:ing)?\b|\bgrants?\b/i.test(t)) return 'grant';
  return fallback;
}
const unspscNature = code => { const s = Number(String(code || '').slice(0, 2)); return !s ? null : s === 72 || s === 95 ? 'works' : s >= 70 ? 'services' : 'goods'; };
// "Monday, 31 December 2029 5:00 PM +13:00" -> the time and its wording.
export function getsTime(v) {
  const m = /(\d{1,2}) ([A-Za-z]+) (\d{4}) (\d{1,2}):(\d{2}) ([AP]M) ([+-])(\d{2}):(\d{2})/.exec(String(v || ''));
  const mo = m ? ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'].indexOf(m[2].toLowerCase()) + 1 : 0;
  if (!m || !mo) return null;
  const h = (+m[4] % 12) + (m[6] === 'PM' ? 12 : 0), off = (m[7] === '-' ? -1 : 1) * (+m[8] * 60 + +m[9]);
  const ts = Date.UTC(+m[3], mo - 1, +m[1], h, +m[5]) - off * 60000;
  return new Date(Date.UTC(+m[3], mo - 1, +m[1])).getUTCDate() === +m[1] ? { ts, text: zoneText(+m[3], mo, +m[1], h, +m[5], off) } : null;
}
const field = (html, label) => { const m = new RegExp(`<b>${label}:\\s*(?:</b>)?\\s*</td>\\s*<td[^>]*>([\\s\\S]*?)</td>`, 'i').exec(html); return m ? m[1] : ''; };
export function parseGets(xml) {
  return String(xml || '').split(/<item>/).slice(1).map(item => {
    const tag = n => decode((new RegExp(`<${n}>([\\s\\S]*?)</${n}>`).exec(item) || [])[1] || '');
    const html = tag('description');
    return { title: clean(tag('title'), 300), link: tag('link').trim(), rfx: text(field(html, 'RFx ID')), org: text(field(html, 'Organisation')), opened: text(field(html, 'Open date')), closes: text(field(html, 'Close date')),
      categories: field(html, 'Categories').split(/<br\s*\/?>/i).map(text).filter(Boolean), regions: field(html, 'Region').split(/<br\s*\/?>/i).map(text).filter(Boolean), overview: text(field(html, 'Overview')) };
  });
}
export function getsRow(n, now = Date.now()) {
  if (!/^\d{4,12}$/.test(n?.rfx || '') || n.title.length < 4 || n.org.length < 2) return null;
  const closes = getsTime(n.closes), opened = getsTime(n.opened);
  let url;
  try { const u = new URL(n.link.replace(/^(https:\/\/www\.gets\.govt\.nz)\/+/, '$1/')); url = u.host === 'www.gets.govt.nz' && u.searchParams.get('id') === n.rfx ? u.href : ''; } catch { url = ''; }
  if (!closes || !closesOk(closes.ts, now) || !url) return null;
  const region = n.regions.length === 1 && NZ_REGIONS.has(n.regions[0]) ? n.regions[0] : null;
  const first = n.categories[0] || '';
  return { id: `gets:${n.rfx}`, src: 'gets', issuer: clean(n.org, 120), issuer_type: 'public', title: n.title, lang: 'en', langs: ['en'], ref: n.rfx, kind: kindOfTitle(`${n.title} ${n.overview.slice(0, 160)}`), countries: ['NZ'],
    published_ts: opened && opened.ts <= now + 86400000 ? opened.ts : null, closes_ts: closes.ts, closes_text: closes.text, url, category: clean(first.replace(/^\d+\s*-\s*/, ''), 80) || null,
    nature: unspscNature(first), region, summary: summaryOf(n.overview) };
}
export async function collectGets(fetchImpl = fetch, { now = Date.now(), log = () => {} } = {}) {
  const diag = diagnostic('gets'), rows = [];
  let complete = false;
  try {
    const res = await fetchImpl(GETS_FEED, { headers: { 'user-agent': UA, accept: 'application/rss+xml, application/xml' }, signal: AbortSignal.timeout(60000) });
    diag.httpRequests++;
    if (!res.ok) diag.reason = `feed-http-${res.status}`;
    else {
      const xml = await res.text();
      if (!/<rss[\s>]/.test(xml)) diag.reason = 'bad-response';
      else {
        const items = parseGets(xml), seen = new Set();
        diag.rawCount = items.length;
        for (const n of items) { const r = getsRow(n, now); if (r && !seen.has(r.id)) { seen.add(r.id); rows.push(r); } }
        complete = true;
      }
    }
  } catch (e) { diag.reason = diag.reason || failure(e); }
  return finish(diag, rows, complete, log);
}

// --- Australia: AusTender (Department of Finance), its list of current approaches to market ---
export const AUSTENDER = 'https://www.tenders.gov.au';
export const AUSTENDER_LIST = `${AUSTENDER}/atm`;
export function parseAusTender(html) {
  const out = [];
  for (const chunk of String(html || '').split(/<p class="lead" role="heading" aria-level="2">/).slice(1)) {
    const desc = label => { const m = new RegExp(`<span>${label}:</span>\\s*<div class="list-desc-inner">([\\s\\S]*?)</div>`).exec(chunk); return m ? m[1] : ''; };
    const atm = /<a href="\/Atm\/Show\/([0-9a-f-]{36})">([^<]+)<\/a>/.exec(chunk);
    if (!atm) continue;
    out.push({ title: text(chunk.slice(0, chunk.indexOf('</p>'))), uuid: atm[1], atmId: text(atm[2]), closes: text(desc('Close Date &amp; Time')), agency: text(desc('Agency')), category: text(desc('Category')), description: text(desc('Description')) });
  }
  return out;
}
// "26-Oct-2026 10:00 am (ACT Local Time)": Canberra time.
export function ausTime(v) {
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4}) (\d{1,2}):(\d{2}) ([ap]m)/i.exec(String(v || '').trim());
  const mo = m ? MON.findIndex(x => x.toLowerCase() === m[2].toLowerCase()) + 1 : 0;
  return m && mo ? zonedTime(+m[3], mo, +m[1], (+m[4] % 12) + (m[6].toLowerCase() === 'pm' ? 12 : 0), +m[5], 'Australia/Sydney') : null;
}
export function ausTenderRow(n, now = Date.now()) {
  const closes = ausTime(n?.closes);
  if (!n || n.title.length < 4 || n.agency.length < 2 || !closes || !closesOk(closes.ts, now)) return null;
  // A description that only repeats the title adds nothing.
  const d = n.description.toLowerCase(), t = n.title.toLowerCase();
  const description = n.description && !t.startsWith(d) && !d.startsWith(t) ? n.description : '';
  return { id: `aust:${n.uuid}`, src: 'aust', issuer: clean(n.agency, 120), issuer_type: 'public', title: clean(n.title, 300), lang: 'en', langs: ['en'], ref: clean(n.atmId, 120) || null,
    kind: kindOfTitle(`${n.title} ${description}`, 'itb'), countries: ['AU'], published_ts: null, closes_ts: closes.ts, closes_text: closes.text, url: `${AUSTENDER}/Atm/Show/${n.uuid}`,
    category: clean(n.category, 80) || null, nature: /construction|building/i.test(n.category) ? 'works' : null, summary: description ? summaryOf(description) : null };
}
export async function collectAusTender(fetchImpl = fetch, { now = Date.now(), delayMs = 2000, maxPages = 30, log = () => {} } = {}) {
  const diag = diagnostic('aust'), rows = [], seen = new Set();
  let complete = false;
  try {
    for (let page = 1; page <= maxPages; page++) {
      if (page > 1) await sleep(delayMs);
      const res = await fetchImpl(`${AUSTENDER_LIST}?page=${page}`, { headers: { 'user-agent': UA, accept: 'text/html' }, signal: AbortSignal.timeout(60000) });
      diag.httpRequests++;
      if (!res.ok) { diag.reason = `list-http-${res.status}`; break; }
      const html = await res.text(), notices = parseAusTender(html);
      if (!notices.length) { if (page === 1) diag.reason = 'no-list'; else complete = true; break; }
      diag.rawCount += notices.length;
      for (const n of notices) { const r = ausTenderRow(n, now); if (r && !seen.has(r.id)) { seen.add(r.id); rows.push(r); } }
      if (!new RegExp(`href="\\?page=${page + 1}"`).test(html)) { complete = true; break; }
    }
    // When each was published: the list does not say, its feed does.
    if (rows.length) {
      await sleep(delayMs);
      const feed = await fetchImpl(AUSTENDER_FEED, { headers: { 'user-agent': UA, accept: 'application/rss+xml, application/xml' }, signal: AbortSignal.timeout(60000) }).catch(() => null);
      diag.httpRequests++;
      const dates = feed?.ok ? ausFeedDates(await feed.text().catch(() => ''), now) : new Map();
      for (const r of rows) r.published_ts = dates.get(r.id.slice(5)) ?? null;
    }
  } catch (e) { diag.reason = diag.reason || failure(e); }
  return finish(diag, rows, complete, log);
}
export const AUSTENDER_FEED = `${AUSTENDER}/public_data/rss/rss.xml`;
// The feed of current ATMs: each one's address and publication day ("Tue, 20 Oct 2026 00:00:00 GMT").
export function ausFeedDates(xml, now = Date.now()) {
  const out = new Map();
  for (const item of String(xml || '').split('<item>').slice(1)) {
    const id = /\/Atm\/Show\/([0-9a-f-]{36})/.exec(item)?.[1], d = /<pubDate>\s*\w{3}, (\d{1,2}) (\w{3}) (\d{4})/.exec(item);
    const mo = d ? MON.indexOf(d[2]) + 1 : 0, ts = mo ? noon(+d[3], mo, +d[1]) : null;
    if (id && ts && ts <= now + 86400000) out.set(id, ts);
  }
  return out;
}

// --- Colombia: SECOP II processes (Colombia Compra Eficiente), from the national open data portal ---
export const SECOP_DATA = 'https://www.datos.gov.co/resource/p6dx-8zbt.json';
export const SECOP_PAGE = 1000;
const SECOP_KIND = [[/^licitaci/i, 'itb'], [/subasta inversa/i, 'itb'], [/^selecci/i, 'itb'], [/^concurso de m/i, 'rfp'], [/^m[ií]nima cuant/i, 'rfq'], [/^solicitud de informaci/i, 'rfi'], [/r[ée]gimen especial/i, 'rfp'], [/^contrataci[oó]n directa \(con ofertas\)/i, 'rfq']];
const SECOP_NATURE = [[/^obra/i, 'works'], [/^(compraventa|suministro)/i, 'goods'], [/^(prestaci[oó]n de servicios|consultor[ií]a|interventor[ií]a)/i, 'services']];
const undefinedValue = v => !v || /^no (definido|aplica)$/i.test(String(v).trim());
// The open processes: published, still receiving offers, by any method except direct contracting without bids.
export function secopQuery(now = Date.now(), offset = 0) {
  const day = new Date(now - 5 * 3600000).toISOString().slice(0, 10);
  const q = { $where: `estado_del_procedimiento = 'Publicado' AND fecha_de_recepcion_de >= '${day}T00:00:00' AND modalidad_de_contratacion != 'Contratación directa'`, $order: 'id_del_proceso', $limit: String(SECOP_PAGE), $offset: String(offset) };
  return Object.entries(q).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
}
export function secopRow(p, now = Date.now()) {
  if (!p || typeof p !== 'object') return null;
  let url = '', uid = '';
  try { const u = new URL(p.urlproceso?.url || ''); uid = u.searchParams.get('noticeUID') || ''; url = u.host === 'community.secop.gov.co' && /^\/Public\/Tendering\/OpportunityDetail\//.test(u.pathname) && /^CO1\.NTC\.\d+$/.test(uid) ? u.href : ''; } catch { url = ''; }
  const closes = isoLocal(String(p.fecha_de_recepcion_de || '').slice(0, 10), 'America/Bogota');
  const name = clean(p.nombre_del_procedimiento, 300), desc = clean(p.descripci_n_del_procedimiento, 2000), issuer = clean(p.entidad, 120);
  if (!url || !closes || !closesOk(closes.ts, now) || issuer.length < 2) return null;
  // A generic name ("CONTRATO DE COMPRAVENTA") gives way to the description.
  const generic = name.length < 30 && desc.length > name.length;
  const title = (generic ? desc : name).slice(0, 300);
  if (title.length < 4) return null;
  const amount = Number(p.precio_base), modality = clean(p.modalidad_de_contratacion, 80), type = clean(p.tipo_de_contrato, 60);
  return { id: `secop:${uid}`, src: 'secop', issuer, issuer_type: 'public', title, lang: 'es', langs: ['es'], ref: clean(p.referencia_del_proceso, 120) || null, kind: (SECOP_KIND.find(([re]) => re.test(modality)) || [])[1] || 'other',
    countries: ['CO'], published_ts: published(p.fecha_de_publicacion_del, now), closes_ts: closes.ts, closes_text: closes.text, url, category: modality || null, nature: (SECOP_NATURE.find(([re]) => re.test(type)) || [])[1] || null,
    region: undefinedValue(p.departamento_entidad) ? null : clean(p.departamento_entidad, 60), place: undefinedValue(p.ciudad_entidad) ? null : clean(p.ciudad_entidad, 80),
    value_amount: Number.isFinite(amount) && amount >= 1000 ? amount : null, value_cur: Number.isFinite(amount) && amount >= 1000 ? 'COP' : null, summary: !generic && desc && desc.toLowerCase() !== name.toLowerCase() ? summaryOf(desc) : null };
}
export async function collectSecop(fetchImpl = fetch, { now = Date.now(), delayMs = 1000, maxPages = 20, retryMs = 20000, log = () => {} } = {}) {
  const diag = diagnostic('secop'), rows = [], seen = new Set();
  let complete = false;
  try {
    for (let page = 0; page < maxPages; page++) {
      if (page) await sleep(delayMs);
      const res = await retrying(fetchImpl, `${SECOP_DATA}?${secopQuery(now, page * SECOP_PAGE)}`, () => ({ headers: { 'user-agent': UA, accept: 'application/json' }, signal: AbortSignal.timeout(60000) }), { retryMs, count: () => diag.httpRequests++ });
      if (!res.ok) { diag.reason = `data-http-${res.status}`; break; }
      const data = await res.json().catch(() => null);
      if (!Array.isArray(data)) { diag.reason = 'bad-response'; break; }
      diag.rawCount += data.length;
      for (const p of data) { const r = secopRow(p, now); if (r && !seen.has(r.id)) { seen.add(r.id); rows.push(r); } }
      if (data.length < SECOP_PAGE) { complete = true; break; }
    }
  } catch (e) { diag.reason = diag.reason || failure(e); }
  return finish(diag, rows, complete, log);
}

// --- Brazil: PNCP (Portal Nacional de Contratações Públicas), notices still receiving proposals ---
// Its search reads at most 10,000 results per query, so the notices are read state by state.
export const PNCP = 'https://pncp.gov.br';
export const PNCP_SEARCH = `${PNCP}/api/search/`;
export const PNCP_PAGE = 100;
export const BR_STATES = Object.freeze({ AC: 'Acre', AL: 'Alagoas', AP: 'Amapá', AM: 'Amazonas', BA: 'Bahia', CE: 'Ceará', DF: 'Distrito Federal', ES: 'Espírito Santo', GO: 'Goiás', MA: 'Maranhão',
  MT: 'Mato Grosso', MS: 'Mato Grosso do Sul', MG: 'Minas Gerais', PA: 'Pará', PB: 'Paraíba', PR: 'Paraná', PE: 'Pernambuco', PI: 'Piauí', RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte',
  RS: 'Rio Grande do Sul', RO: 'Rondônia', RR: 'Roraima', SC: 'Santa Catarina', SP: 'São Paulo', SE: 'Sergipe', TO: 'Tocantins' });
const PNCP_KIND = [[/^preg/i, 'itb'], [/^concorr/i, 'itb'], [/^dispensa/i, 'rfq'], [/^di[aá]logo competitivo/i, 'rfp'], [/^manifesta[cç][aã]o de interesse/i, 'eoi'], [/^pr[eé]-qualifica/i, 'prequal']];
export function pncpRow(n, now = Date.now()) {
  if (!n || typeof n !== 'object' || n.cancelado === true || n.document_type !== 'edital') return null;
  const m = /^\/compras\/(\d{14})\/(\d{4})\/(\d{1,9})$/.exec(String(n.item_url || ''));
  const closes = isoLocal(n.data_fim_vigencia, 'America/Sao_Paulo');
  const title = clean(n.description, 300), issuer = clean(n.orgao_nome, 120);
  if (!m || !closes || !closesOk(closes.ts, now) || title.length < 4 || issuer.length < 2) return null;
  const amount = Number(n.valor_total_estimado), modality = clean(n.modalidade_licitacao_nome, 80);
  return { id: `pncp:${m[1]}-${m[2]}-${m[3]}`, src: 'pncp', issuer, issuer_type: 'public', title, lang: 'pt', langs: ['pt'], ref: clean(n.title, 120) || null, kind: (PNCP_KIND.find(([re]) => re.test(modality)) || [])[1] || 'other',
    countries: ['BR'], published_ts: published(n.data_publicacao_pncp, now), closes_ts: closes.ts, closes_text: closes.text, url: `${PNCP}/app/editais/${m[1]}/${m[2]}/${m[3]}`, category: modality || null,
    region: BR_STATES[n.uf] || null, place: clean(n.municipio_nome, 80) || null, value_amount: Number.isFinite(amount) && amount >= 1000 ? amount : null, value_cur: Number.isFinite(amount) && amount >= 1000 ? 'BRL' : null,
    summary: n.informacao_complementar ? summaryOf(n.informacao_complementar) : null };
}
export async function collectPncp(fetchImpl = fetch, { now = Date.now(), delayMs = 1000, retryMs = 20000, log = () => {} } = {}) {
  const diag = diagnostic('pncp'), rows = [], seen = new Set();
  let complete = true;
  // A state whose connection the portal drops past every retry leaves the reading partial and the next state is
  // read (three such states end it); a refusal ends it at once.
  let dropped = 0;
  states: for (const uf of Object.keys(BR_STATES)) {
    try {
      for (let page = 1; page <= 100; page++) {
        await sleep(delayMs);
        const res = await retrying(fetchImpl, `${PNCP_SEARCH}?tipos_documento=edital&status=recebendo_proposta&ordenacao=-data&ufs=${uf}&pagina=${page}&tam_pagina=${PNCP_PAGE}`,
          () => ({ headers: { 'user-agent': UA, accept: 'application/json' }, signal: AbortSignal.timeout(60000) }), { retryMs, count: () => diag.httpRequests++ });
        if (!res.ok) { diag.reason = `search-http-${res.status}`; complete = false; break states; }
        const data = await res.json().catch(() => null);
        if (!data || !Array.isArray(data.items)) { diag.reason = 'bad-response'; complete = false; break states; }
        diag.rawCount += data.items.length;
        for (const n of data.items) { const r = pncpRow(n, now); if (r && !seen.has(r.id)) { seen.add(r.id); rows.push(r); } }
        if (data.items.length < PNCP_PAGE || page * PNCP_PAGE >= Number(data.total || 0)) break;
        if (page === 100) { diag.reason = diag.reason || 'state-over-limit'; complete = false; }
      }
    } catch (e) { diag.reason = diag.reason || failure(e); complete = false; if (++dropped >= 3) break; }
  }
  return finish(diag, rows, complete, log);
}

// --- Canada: CanadaBuys (Public Services and Procurement Canada), its daily open data file of open tender notices ---
// Notices are in English and French; contact people's names, e-mail addresses and telephone numbers are not kept.
export const CANADABUYS = 'https://canadabuys.canada.ca';
export const CANADABUYS_CSV = `${CANADABUYS}/opendata/pub/openTenderNotice-ouvertAvisAppelOffres.csv`;
// RFC 4180: quoted fields may hold commas, quotes and line breaks.
export function parseCsv(s) {
  const rows = [];
  let row = [], f = '', q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"') { if (s[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && s[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
    else f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  return rows;
}
const CA_KIND = { 'request for proposal': 'rfp', 'request for supply arrangement': 'rfp', 'rfp against supply arrangement': 'rfp', 'request for standing offer': 'rfp', 'invitation to qualify': 'prequal',
  'request for information': 'rfi', 'advance contract award notice': 'other', 'not applicable': 'other' };
const CA_NATURE = { '*GD': 'goods', '*SRV': 'services', '*SRVTGD': 'services', '*CNST': 'works' };
const lines = v => String(v || '').split(/\r?\n/).map(x => x.replace(/^\*/, '').trim()).filter(Boolean);
const caRegion = v => { const l = lines(v).map(x => x.replace(/ \(except NCR\)$/, '').replace(/^National Capital Region \(NCR\)$/, 'National Capital Region')); return l.length === 1 && !['Canada', 'World', 'Foreign'].includes(l[0]) ? l[0] : null; };
export const caSlug = ref => String(ref || '').toLowerCase().replace(/[^a-z0-9-]+/g, '');
export function canadaBuysRow(r, now = Date.now()) {
  const g = k => r?.[k] ?? '';
  if (g('tenderStatus-appelOffresStatut-eng') !== 'Open') return null;
  const type = g('noticeType-avisType-eng').trim().toLowerCase();
  if (type === 'directed contract') return null;
  const slug = caSlug(g('referenceNumber-numeroReference')), title = clean(decode(g('title-titre-eng')), 300), issuer = clean(g('contractingEntityName-nomEntitContractante-eng'), 120);
  const closes = isoLocal(g('tenderClosingDate-appelOffresDateCloture'), 'America/Toronto');
  if (!/^[a-z0-9][a-z0-9-]{2,69}$/.test(slug) || title.length < 4 || issuer.length < 2 || !closes || !closesOk(closes.ts, now)) return null;
  const kind = CA_KIND[type] || (/^APN[_ -]/.test(title) ? 'other' : /open bidding/i.test(g('procurementMethod-methodeApprovisionnement-eng')) ? 'itb' : 'other');
  const titleFr = clean(decode(g('title-titre-fra')), 300), issuerFr = clean(g('contractingEntityName-nomEntitContractante-fra'), 120);
  const summary = summaryOf(text(g('tenderDescription-descriptionAppelOffres-eng'))), summaryFr = summaryOf(text(g('tenderDescription-descriptionAppelOffres-fra')));
  const docs = String(g('attachment-piecesJointes-eng')).split(/\s+/).filter(u => /^https:\/\/canadabuys\.canada\.ca\/documents\//.test(u)).slice(0, 6).map((u, i) => ({ n: decodeURIComponent(u.split('/').pop() || `Document ${i + 1}`).slice(0, 120), u }));
  return { id: `cabuy:${slug}`, src: 'cabuy', issuer, issuer_type: 'public', title, lang: 'en', langs: titleFr.length >= 4 ? ['en', 'fr'] : ['en'],
    texts: titleFr.length >= 4 ? { fr: issuerFr && issuerFr !== issuer ? [titleFr, summaryFr, issuerFr] : [titleFr, summaryFr] } : null, ref: clean(g('solicitationNumber-numeroSollicitation'), 120) || clean(g('referenceNumber-numeroReference'), 120),
    kind, countries: ['CA'], published_ts: published(g('publicationDate-datePublication'), now), closes_ts: closes.ts, closes_text: closes.text, url: `${CANADABUYS}/en/tender-opportunities/tender-notice/${slug}`,
    category: clean(lines(g('gsinDescription-nibsDescription-eng'))[0] || lines(g('unspscDescription-eng'))[0] || '', 80) || null, nature: CA_NATURE[lines(g('procurementCategory-categorieApprovisionnement')).map(x => '*' + x)[0]] || null,
    region: caRegion(g('regionsOfDelivery-regionsLivraison-eng')), place: clean(g('contractingEntityAddressCity-entiteContractanteAdresseVille-eng'), 80) || null, summary, info: docs.length ? { docs } : null };
}
export async function collectCanadaBuys(fetchImpl = fetch, { now = Date.now(), log = () => {} } = {}) {
  const diag = diagnostic('cabuy'), rows = [];
  let complete = false;
  try {
    const res = await fetchImpl(CANADABUYS_CSV, { headers: { 'user-agent': UA, accept: 'text/csv' }, signal: AbortSignal.timeout(120000) });
    diag.httpRequests++;
    if (!res.ok) diag.reason = `data-http-${res.status}`;
    else {
      const table = parseCsv((await res.text()).replace(/^﻿/, '')), head = table[0] || [];
      if (!head.includes('referenceNumber-numeroReference') || !head.includes('tenderClosingDate-appelOffresDateCloture')) diag.reason = 'bad-response';
      else {
        const seen = new Set();
        for (const cells of table.slice(1)) {
          if (cells.length !== head.length) continue;
          diag.rawCount++;
          const r = canadaBuysRow(Object.fromEntries(head.map((k, i) => [k, cells[i]])), now);
          if (r && !seen.has(r.id)) { seen.add(r.id); rows.push(r); }
        }
        complete = true;
      }
    }
  } catch (e) { diag.reason = diag.reason || failure(e); }
  return finish(diag, rows, complete, log);
}

// --- United Kingdom: Contracts Finder (Crown Commercial Service), its search of open notices ---
// Public bodies' contracts (in England, mostly below the thresholds for Find a Tender), and the sub-contracts that
// companies delivering public contracts must advertise there.
export const CONTRACTS_FINDER = 'https://www.contractsfinder.service.gov.uk';
export const CF_SEARCH = `${CONTRACTS_FINDER}/api/rest/2/search_notices/json`;
export const CF_SIZE = 1000;
const CF_TYPES = { Contract: 'itb', PreProcurement: 'rfi', EarlyEngagement: 'rfi' };
// CPV divisions: 45 is works, those below goods, those above services (48, software packages, goods).
const cpvNature = code => { const d = Number(String(code || '').slice(0, 2)); return !d ? null : d === 45 ? 'works' : d < 45 || d === 48 ? 'goods' : 'services'; };
// Companies by their names: a company's legal form at the end, or a joint venture of companies.
const company = name => /\b(limited|ltd|plc|llp|lp|llc|inc|incorporated|corp|corporation|gmbh|cyfyngedig|cyf)\.?$/i.test(String(name || '').trim()) || /\b(JV|joint venture)\b/i.test(String(name || ''));
// The time in UK time, as the site words it ("13-Nov-2026 17:00 (GMT 0.00)").
const londonText = ts => { const off = offsetMinutes(ts, 'Europe/London'), l = new Date(ts + off * 60000); return zoneText(l.getUTCFullYear(), l.getUTCMonth() + 1, l.getUTCDate(), l.getUTCHours(), l.getUTCMinutes(), off); };
// Titles some e-tendering systems prefix with the place, in the old European style ("GB-Leeds: ...").
// Some repeat themselves either side of a dash ("Taxi and MPV (1-8 seats) - Taxi and MPV (1-8 seats)").
const ukTitle = v => { const t = clean(decode(v), 300).replace(/^GB-[A-Za-z .'&-]{2,40}:\s+/, ''), m = /^(.{4,}?) - \1$/.exec(t); return m ? m[1] : t; };
export function contractsFinderRow(n, now = Date.now()) {
  const x = n?.item;
  if (!x || typeof x !== 'object' || x.noticeStatus !== 'Open' || !CF_TYPES[x.noticeType] || !/^[0-9a-f-]{36}$/.test(String(x.id || ''))) return null;
  const ts = Date.parse(x.deadlineDate || '');
  const title = ukTitle(x.title), issuer = clean(decode(x.organisationName), 120);
  if (!Number.isFinite(ts) || !closesOk(ts, now) || title.length < 4 || issuer.length < 2) return null;
  const closes_text = londonText(ts);
  const value = Number(x.valueHigh) > 0 ? Number(x.valueHigh) : Number(x.valueLow) > 0 ? Number(x.valueLow) : null;
  const region = clean(x.regionText || x.region, 60);
  return { id: `cfgb:${x.id}`, src: 'cfgb', issuer, issuer_type: company(issuer) ? 'private' : 'public', title, lang: 'en', langs: ['en'],
    ref: x.noticeIdentifier && !/^n\s*\/\s*a$/i.test(x.noticeIdentifier) ? clean(x.noticeIdentifier, 120) : null, kind: x.noticeType === 'Contract' ? kindOfTitle(title, 'itb') : 'rfi', countries: ['GB'],
    published_ts: published(x.publishedDate, now), closes_ts: ts, closes_text, url: `${CONTRACTS_FINDER}/Notice/${x.id}`, category: clean(x.cpvDescription, 80) || null,
    nature: cpvNature(x.cpvCodes), region: Object.values(NUTS1).includes(region) ? region : null, value_amount: value && value >= 1000 ? value : null, value_cur: value && value >= 1000 ? 'GBP' : null,
    summary: summaryOf(text(x.description)) };
}
export async function collectContractsFinder(fetchImpl = fetch, { now = Date.now(), retryMs = 20000, log = () => {} } = {}) {
  const diag = diagnostic('cfgb'), rows = [];
  let complete = false;
  try {
    const res = await retrying(fetchImpl, CF_SEARCH, () => ({ method: 'POST', headers: { 'user-agent': UA, accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ searchCriteria: { statuses: ['Open'] }, size: CF_SIZE }), signal: AbortSignal.timeout(90000) }), { retryMs, count: () => diag.httpRequests++ });
    if (!res.ok) diag.reason = `search-http-${res.status}`;
    else {
      const data = await res.json().catch(() => null);
      if (!data || !Array.isArray(data.noticeList)) diag.reason = 'bad-response';
      else {
        const seen = new Set();
        diag.rawCount = data.noticeList.length;
        for (const n of data.noticeList) { const r = contractsFinderRow(n, now); if (r && !seen.has(r.id)) { seen.add(r.id); rows.push(r); } }
        // More open notices than one search returns: a partial reading, so nothing is pruned.
        complete = !(Number(data.hitCount) > data.noticeList.length);
        if (!complete) diag.reason = 'over-limit';
      }
    }
  } catch (e) { diag.reason = diag.reason || failure(e); }
  return finish(diag, rows, complete, log);
}

// --- United Kingdom: Find a Tender (Cabinet Office) ---
// The UK's notices of contracts above the thresholds and, under the Procurement Act 2023, of public bodies' other open
// competitions; Scotland's, Wales's and Northern Ireland's portals publish theirs there too. Its open data (OCDS) lists
// every notice by date, newest first; a procurement is open while its latest notice still invites tenders or requests
// to participate.
export const FIND_A_TENDER = 'https://www.find-tender.service.gov.uk';
export const FTS_RELEASES = `${FIND_A_TENDER}/api/1.0/ocdsReleasePackages`;
// The notices of the last 60 days: a procurement's latest notice is among them (nearly every one closes within two
// months of its last notice; one changed later is read again with its change). Some 300 requests, one at a time.
export const FTS_DAYS = 60;
const NUTS1 = Object.freeze({ UKC: 'North East', UKD: 'North West', UKE: 'Yorkshire and The Humber', UKF: 'East Midlands', UKG: 'West Midlands', UKH: 'East of England', UKI: 'London',
  UKJ: 'South East', UKK: 'South West', UKL: 'Wales', UKM: 'Scotland', UKN: 'Northern Ireland' });
const OPEN_TAGS = ['tender', 'tenderUpdate'];
// "2026-11-20T16:00:00Z", or a day alone ("2026-11-20", which closes at its end, UK time).
function ftsTime(v) {
  const s = String(v || '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return isoLocal(s, 'Europe/London');
  const ts = Date.parse(s);
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s) && Number.isFinite(ts) ? { ts, text: londonText(ts) } : null;
}
// One procurement's notices -> the row the site stores, or null. `since`: the earliest notice read, the most that can
// be said of when a procurement first announced before it was published.
export function findTenderRow(notices, now = Date.now(), { since = null } = {}) {
  const list = (Array.isArray(notices) ? notices : []).filter(x => x && typeof x === 'object' && Array.isArray(x.tag) && Number.isFinite(Date.parse(x.date)))
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  const x = list[0], t = x?.tender;
  // Awarded, cancelled or otherwise moved on: the latest notice is something other than the tender's.
  if (!x || !x.tag.length || x.tag.some(g => !OPEN_TAGS.includes(g)) || !t || typeof t !== 'object' || (t.status != null && t.status !== 'active')) return null;
  if (!/^\d{6}-\d{4}$/.test(String(x.id || ''))) return null;
  const toTender = !!t.tenderPeriod?.endDate, closes = ftsTime(toTender ? t.tenderPeriod.endDate : t.expressionOfInterestDeadline);
  const buyer = (Array.isArray(x.parties) ? x.parties : []).find(p => p?.roles?.includes?.('buyer'));
  const title = ukTitle(t.title), issuer = clean(decode(x.buyer?.name || buyer?.name), 120);
  if (!closes || !closesOk(closes.ts, now) || title.length < 4 || issuer.length < 2) return null;
  const types = (buyer?.details?.classifications || []).map(c => c?.id);
  // Where: the UK region all its places of delivery are in, when there is one.
  const places = new Set((Array.isArray(t.items) ? t.items : []).flatMap(i => (Array.isArray(i?.deliveryAddresses) ? i.deliveryAddresses : []).map(a => NUTS1[String(a?.region || '').slice(0, 3)] || '')));
  const region = places.size === 1 && !places.has('') ? [...places][0] : null;
  const cpv = t.classification?.scheme === 'CPV' ? t.classification : (t.items || []).flatMap(i => i?.additionalClassifications || []).find(c => c?.scheme === 'CPV');
  const v = t.value || {}, amount = Number(v.amount) > 0 ? Number(v.amount) : Number(v.amountGross) > 0 ? Number(v.amountGross) : null, cur = /^[A-Z]{3}$/.test(v.currency || '') ? v.currency : null;
  const first = list.filter(r => r.tag.includes('tender')).pop();
  // Requests to participate first (a restricted procedure, or a flexible one's first stage): a pre-qualification.
  const prequal = !toTender || /restricted/i.test(t.procurementMethodDetails || '');
  return { id: `ftsgb:${x.ocid.replace(/^ocds-/, '').replace(/[^A-Za-z0-9._-]/g, '')}`, src: 'ftsgb', issuer, issuer_type: types.includes('privateUtility') || company(issuer) ? 'private' : 'public', title,
    lang: /^[a-z]{2}$/.test(x.language || '') ? x.language : 'en', langs: [/^[a-z]{2}$/.test(x.language || '') ? x.language : 'en'], ref: t.id && !String(t.id).startsWith('ocds-') ? clean(t.id, 120) : null,
    kind: prequal ? 'prequal' : kindOfTitle(title, 'itb'), countries: ['GB'], published_ts: published(first?.date, now) ?? (since ? noon(...new Date(since).toISOString().slice(0, 10).split('-').map(Number)) : null),
    closes_ts: closes.ts, closes_text: closes.text, url: `${FIND_A_TENDER}/Notice/${x.id}`, category: clean(cpv?.description, 80) || null,
    nature: ['goods', 'works', 'services'].includes(t.mainProcurementCategory) ? t.mainProcurementCategory : cpvNature(cpv?.id), region,
    value_amount: cur && amount >= 1000 ? amount : null, value_cur: cur && amount >= 1000 ? cur : null,
    summary: summaryOf(text(String(t.description || '').replace(/\*\*|__/g, ''))), info: Array.isArray(t.submissionMethod) && t.submissionMethod.includes('electronicSubmission') ? { esub: true } : null };
}
export async function collectFindATender(fetchImpl = fetch, { now = Date.now(), days = FTS_DAYS, delayMs = 2000, maxPages = 600, retryMs = 20000, log = () => {} } = {}) {
  const diag = diagnostic('ftsgb'), byOcid = new Map(), since = now - days * 86400000;
  let url = `${FTS_RELEASES}?limit=100&updatedFrom=${new Date(since).toISOString().slice(0, 19)}`, complete = false;
  try {
    for (let page = 1; page <= maxPages; page++) {
      if (page > 1) await sleep(delayMs);
      const res = await retrying(fetchImpl, url, () => ({ headers: { 'user-agent': UA, accept: 'application/json' }, signal: AbortSignal.timeout(90000) }), { retryMs, count: () => diag.httpRequests++ });
      if (!res.ok) { diag.reason = `list-http-${res.status}`; break; }
      const data = await res.json().catch(() => null);
      if (!data || !Array.isArray(data.releases)) { diag.reason = 'bad-response'; break; }
      diag.rawCount += data.releases.length;
      for (const x of data.releases) {
        if (typeof x?.ocid !== 'string' || !Array.isArray(x.tag)) continue;
        // Of a notice that invites nothing (an award, a cancellation), only its date and kind are kept.
        const keep = x.tag.some(g => OPEN_TAGS.includes(g)) ? x : { ocid: x.ocid, id: x.id, date: x.date, tag: x.tag };
        if (!byOcid.has(x.ocid)) byOcid.set(x.ocid, []);
        byOcid.get(x.ocid).push(keep);
      }
      const next = data.links?.next;
      if (!next) { complete = true; break; }
      // The next page, only ever on the same service.
      if (typeof next !== 'string' || !next.startsWith(`${FTS_RELEASES}?`)) { diag.reason = 'bad-response'; break; }
      url = next;
    }
  } catch (e) { diag.reason = diag.reason || failure(e); }
  const rows = [];
  for (const list of byOcid.values()) { const r = findTenderRow(list, now, { since }); if (r) rows.push(r); }
  return finish(diag, rows, complete, log);
}

// --- United States: SAM.gov (General Services Administration), the federal government's contract opportunities ---
// What its public search lists as active and still taking responses (closing from the day before on: most active
// notices have closed and wait to be archived): solicitations, combined synopses/solicitations, presolicitations
// (notices of a solicitation to come) and sources sought (requests for information), some 7,000. One search returns
// at most 10,000, so a longer list is also read from its other end (oldest changed first). Should the search stop
// taking the closing-date filter, every active notice is read instead (some 30,000).
export const SAM = 'https://sam.gov';
export const SAM_SEARCH = `${SAM}/api/prod/sgs/v1/search/`;
export const SAM_PAGE = 100;
export const SAM_CAP = 10000;
const SAM_KIND = Object.freeze({ o: 'itb', k: 'itb', p: 'prebid', r: 'rfi' });
// Military post offices are not places.
const MILITARY_POST = new Set(['APO', 'FPO', 'DPO']);
const zoneOk = z => { try { return typeof z === 'string' && /^[A-Za-z_]+\/[A-Za-z_\/-]+$/.test(z) && !!new Intl.DateTimeFormat('en', { timeZone: z }); } catch { return false; } };
const capital = s => s.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_, a, b) => a + b.toUpperCase());
// One opportunity -> the row the site stores, or null. Its agency issues it; the contracting office's town is the place.
export function samRow(x, now = Date.now()) {
  if (!x || typeof x !== 'object' || x.isCanceled === true || x.isActive === false || !/^[0-9a-f]{32}$/.test(String(x._id || '')) || !SAM_KIND[x.type?.code]) return null;
  const ts = Date.parse(x.responseDate || ''), org = Array.isArray(x.organizationHierarchy) ? x.organizationHierarchy.filter(o => o && typeof o === 'object') : [];
  const agency = org.find(o => o.level === 2) || org.find(o => o.level === 1), office = org[org.length - 1];
  const title = clean(decode(x.title), 300), issuer = clean(agency?.name, 120);
  if (!Number.isFinite(ts) || !closesOk(ts, now) || title.length < 4 || issuer.length < 2) return null;
  const zone = zoneOk(x.responseTimeZone) ? x.responseTimeZone : 'America/New_York', off = offsetMinutes(ts, zone), l = new Date(ts + off * 60000);
  const city = clean(office?.address?.city, 60), state = clean(office?.address?.state, 4);
  const code = x.type.code, summary = summaryOf(text(x.descriptions?.[0]?.content));
  return { id: `samus:${x._id}`, src: 'samus', issuer, issuer_type: 'public', title, lang: 'en', langs: ['en'], ref: clean(x.solicitationNumber, 120) || null,
    kind: code === 'o' || code === 'k' ? kindOfTitle(title, 'itb') : SAM_KIND[code], countries: ['US'], published_ts: published(x.publishDate, now), closes_ts: ts,
    closes_text: zoneText(l.getUTCFullYear(), l.getUTCMonth() + 1, l.getUTCDate(), l.getUTCHours(), l.getUTCMinutes(), off), url: `${SAM}/opp/${x._id}/view`,
    place: city && !MILITARY_POST.has(city.toUpperCase()) ? `${capital(city)}${/^[A-Z]{2}$/.test(state) ? `, ${state}` : ''}` : null,
    summary: summary && summary.toLowerCase() !== title.toLowerCase() ? summary : null };
}
export async function collectSam(fetchImpl = fetch, { now = Date.now(), delayMs = 1000, retryMs = 20000, log = () => {} } = {}) {
  const diag = diagnostic('samus'), rows = [], seen = new Set();
  let complete = true, since = `&response_date.from=${new Date(now - 86400000).toISOString().slice(0, 10)}-00:00`;
  try {
    kinds: for (const type of Object.keys(SAM_KIND)) {
      let total = null;
      for (const sort of ['-modifiedDate', 'modifiedDate']) {
        if (sort === 'modifiedDate' && !(total > SAM_CAP)) break;
        for (let page = 0; page * SAM_PAGE < Math.min(total ?? SAM_CAP, SAM_CAP); page++) {
          if (diag.httpRequests) await sleep(delayMs);
          const res = await retrying(fetchImpl, `${SAM_SEARCH}?index=opp&page=${page}&mode=search&sort=${sort}&size=${SAM_PAGE}&mfe=true&is_active=true&notice_type=${type}${since}`,
            () => ({ headers: { 'user-agent': UA, accept: 'application/hal+json' }, signal: AbortSignal.timeout(60000) }), { retryMs, count: () => diag.httpRequests++ });
          if (res.status === 400 && since) { since = ''; total = null; page = -1; continue; }
          if (!res.ok) { diag.reason = `search-http-${res.status}`; complete = false; break kinds; }
          const data = await res.json().catch(() => null);
          const n = data?.page?.totalElements, list = data?._embedded?.results ?? (n === 0 ? [] : null);
          if (!Number.isSafeInteger(n) || !Array.isArray(list)) { diag.reason = 'bad-response'; complete = false; break kinds; }
          total = n;
          diag.rawCount += list.length;
          for (const x of list) { const r = samRow(x, now); if (r && !seen.has(r.id)) { seen.add(r.id); rows.push(r); } }
          if (list.length < SAM_PAGE) break;
        }
      }
      // Longer than both ends of the list together: a partial reading, so nothing is pruned.
      if (total > 2 * SAM_CAP) { complete = false; diag.reason = 'over-limit'; }
    }
  } catch (e) { complete = false; diag.reason = diag.reason || failure(e); }
  return finish(diag, rows, complete, log);
}

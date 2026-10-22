// Tenders collector (runs in the public collector repository, tenders-runner.mjs): reads open notices from the
// official issuers' own systems. International organisations: the United Nations Global Marketplace (UNGM), where
// some 80 UN and other international organisations publish their tenders (owner, 22 Oct 2026: listed despite
// UNGM's terms, his decision). Each notice keeps its title, issuer, type, reference, closing time and countries,
// and links to the official notice. The crawler names itself and keeps to one request at a time.
import { UNGM_KIND, countryCode } from './tenders-kinds.js';

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

// A parsed notice -> the row the site stores, or null.
export function ungmRow(n, now = Date.now()) {
  const closes = ungmTime(n.deadline), published = ungmTime(n.published);
  if (!closes || closes <= now) return null;
  const kind = UNGM_KIND[String(n.type || '').toLowerCase()] || 'other';
  const countries = String(n.country || '').split(/\s*;\s*|\s*\|\s*/).map(countryCode).filter(Boolean);
  const issuer = String(n.agency || '').trim().slice(0, 120);
  if (!issuer || !n.title) return null;
  return {
    id: `ungm:${n.id}`, src: 'ungm', issuer, issuer_type: 'io', title: n.title.slice(0, 300), ref: n.ref ? n.ref.slice(0, 120) : null, kind,
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

export async function collectTenders(fetchImpl = fetch, opts = {}) {
  const ungm = await collectUngm(fetchImpl, opts);
  return { rows: ungm.rows, diagnostics: ungm.diagnostics, complete: ungm.diagnostics.filter(d => d.status === 'complete').map(d => d.src) };
}

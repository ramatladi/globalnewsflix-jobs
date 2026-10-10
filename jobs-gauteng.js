// Public Gauteng Professional Job Centre table. Never logs in or follows applications.
export const GAUTENG_JOBS_URL = 'https://jobs.gauteng.gov.za/Public/Jobs.aspx';
const entities = { amp: '&', nbsp: ' ', quot: '"', apos: "'", lt: '<', gt: '>', ndash: '–', mdash: '—' };
const text = value => String(value || '').replace(/<[^>]*>/g, ' ').replace(/&(#(?:x[0-9a-f]+|[0-9]+)|[a-z]+);/gi, (all, ent) => {
  if (ent[0] !== '#') return entities[ent.toLowerCase()] ?? all;
  const n = parseInt(ent.slice(ent[1].toLowerCase() === 'x' ? 2 : 1), ent[1].toLowerCase() === 'x' ? 16 : 10);
  return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : '\ufffd';
}).replace(/\s+/g, ' ').trim();
function closingDay(value) {
  const m = value.match(/^(\d{4})\/(\d{2})\/(\d{2})$/); if (!m) return null;
  const y = +m[1], mo = +m[2], day = +m[3], t = Date.UTC(y, mo - 1, day);
  const d = new Date(t); if (d.getUTCFullYear() !== y || d.getUTCMonth() !== mo - 1 || d.getUTCDate() !== day) return null;
  // The list gives a South African calendar day, no time. Expire at its end;
  // applicants still need to check the original vacancy for an earlier cutoff.
  return t + 86400000 - 2 * 3600000;
}
function annualPay(value) {
  const s = text(value).replace(/[–—]/g, '-');
  if (!/per\s+annum|per\s+year|\bp\.?a\.?\b/i.test(s) || /\b(?:grade\s*[23]|PND\s*(?:II|2))\b/i.test(s)) return null;
  const m = s.match(/\bR\s*(\d[\d\s,.]*?)(?:\s*-\s*(?:R\s*)?(\d[\d\s,.]*?))?\s*(?=per\b|p\.?a\.?\b|\(|$)/i);
  if (!m) return null;
  const number = raw => {
    let v = raw.trim();
    if (!/^(?:\d{1,3}(?:[ ,]\d{3})+|\d+)(?:[.,]\d{2})?$/.test(v)) return null;
    if (/,[0-9]{2}$/.test(v)) v = v.slice(0, -3).replace(/[ ,]/g, '') + '.' + v.slice(-2);
    else v = v.replace(/[ ,]/g, '');
    const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null;
  };
  const min = number(m[1]), max = number(m[2] || m[1]);
  return min && max >= min ? { cur: 'ZAR', min, max, period: 'year' } : null;
}
export function parseGautengJobs(html, { now = Date.now(), sourceUrl = GAUTENG_JOBS_URL } = {}) {
  if (sourceUrl !== GAUTENG_JOBS_URL || typeof html !== 'string' || html.length > 2000000) return null;
  const table = html.match(/<table\b[^>]*\bid\s*=\s*["']tblJobs["'][^>]*>([\s\S]*?)<\/table\s*>/i)?.[1];
  if (!table || !['Position', 'Department', 'Location', 'Package', 'Closing', 'Action'].every(h => new RegExp(`<th\\b[^>]*>\\s*${h}\\s*</th>`, 'i').test(table))) return null;
  const body = table.match(/<tbody\b[^>]*>([\s\S]*?)<\/tbody\s*>/i)?.[1]; if (body == null) return null;
  const rows = [], seen = new Set(); let rawCount = 0, rejected = 0, expired = 0;
  for (const tr of body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi)) {
    rawCount++;
    const cells = [...tr[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td\s*>/gi)].map(m => m[1]);
    if (cells.length !== 6) { rejected++; continue; }
    const [title, department, location, salary, closing] = cells.map(text);
    const href = cells[5].match(/<a\b[^>]*href\s*=\s*["']([^"']+)["']/i)?.[1];
    let url; try { url = new URL(text(href), sourceUrl); } catch { rejected++; continue; }
    const id = url.search.match(/^\?u=([A-Za-z0-9+/=%_-]{8,100})$/)?.[1], cutoff = closingDay(closing);
    if (!id || url.username || url.password || url.origin !== new URL(sourceUrl).origin || url.pathname !== '/Public/ViewJob.aspx' || !title || !department || !location || !cutoff || seen.has(id)) { rejected++; continue; }
    seen.add(id); if (cutoff <= now) { expired++; continue; }
    rows.push({ id, title, employer: /^Gauteng\b/i.test(department) ? department : `Gauteng ${department}`, country: 'ZA', location, url: url.href,
      source_url: sourceUrl, salary_text: salary || null, salary_url: salary ? sourceUrl : null,
      pay: annualPay(salary), posted: null, closing: cutoff, closing_text: closing, reference: null });
  }
  // The page has client-side pagination but no authoritative total/revision.
  // An empty or changed table is never permission to delete previously imported jobs.
  return { rows, complete: false, reason: rejected ? 'rows-rejected' : 'public-list-total-unverified', diagnostics: { rawCount, acceptedCount: rows.length, rejected, expired } };
}

// Match the publicly requested detail page back to the list row before trusting
// its reference. A login, changed posting or unrelated cached page yields null.
export function parseGautengDetail(html, row, { now = Date.now() } = {}) {
  if (typeof html !== 'string' || html.length > 1000000 || !row) return null;
  let url; try { url = new URL(row.url); } catch { return null; }
  if (url.origin !== new URL(GAUTENG_JOBS_URL).origin || url.pathname !== '/Public/ViewJob.aspx' || url.username || url.password) return null;
  const field = id => text(html.match(new RegExp(`<span\\b[^>]*\\bid=["']${id}["'][^>]*>([\\s\\S]*?)</span>`, 'i'))?.[1]);
  const norm = s => text(s).toLowerCase().replace(/[–—]/g, '-');
  const title = field('body_lblDesc'), department = field('body_lblDept'), location = field('body_lblCentre');
  const employer = /^Gauteng\b/i.test(department) ? department : `Gauteng ${department}`;
  if (!title || !department || !location || norm(title) !== norm(row.title) || norm(employer) !== norm(row.employer) || norm(location) !== norm(row.location)) return null;
  const reference = field('body_lblRefNo');
  if (!/^refs\/\d{6}$/i.test(reference)) return null;
  const closingText = field('body_lblClosingDate'), m = closingText.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  const closing = m ? closingDay(`${m[3]}/${m[2]}/${m[1]}`) : null;
  if (!closing) return null;
  return { reference: reference.toUpperCase(), closing, closing_text: closingText, posted: null, closed: closing <= now };
}

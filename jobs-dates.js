// Dates are taken only from the fetched employer JobPosting, never receipt time.
const plain = value => String(value || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim();
function day(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
  if (!match) return null;
  const t = Date.UTC(+match[1], +match[2] - 1, +match[3]);
  return new Date(t).toISOString().slice(0, 10) === value ? t : null;
}
function instant(value) {
  if (typeof value !== 'string') return null;
  if (/^\d{4}-\d{2}-\d{2}T/.test(value)) {
    if (day(value.slice(0, 10)) == null || !/(?:Z|[+-]\d{2}:?\d{2})$/.test(value)) return null;
    const clock = value.match(/T(\d{2}):(\d{2}):(\d{2})/);
    if (!clock || +clock[1] > 23 || +clock[2] > 59 || +clock[3] > 59) return null;
  } else {
    const m = /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) ([A-Z][a-z]{2}) (\d{1,2}) (\d{2}):(\d{2}):(\d{2}) UTC (\d{4})$/.exec(value);
    if (!m) return null;
    const month = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].indexOf(m[1]) + 1;
    if (!month || day(`${m[6]}-${String(month).padStart(2, '0')}-${m[2].padStart(2, '0')}`) == null || +m[3] > 23 || +m[4] > 59 || +m[5] > 59) return null;
  }
  const result = Date.parse(value); return Number.isFinite(result) ? result : null;
}

export function parseJobDates(html, { country, sourceId, title } = {}) {
  if (typeof html !== 'string' || html.length > 2000000 || !/JobPosting/.test(html)) return { posted: null, closing: null };
  const posted = new Set(), closes = new Set(), titles = new Set();
  const titleKey = value => plain(value).normalize('NFKC').toLowerCase();
  const add = object => { if (object.title) titles.add(titleKey(object.title)); if (object.datePosted) posted.add(String(object.datePosted)); if (object.validThrough) closes.add(String(object.validThrough)); };
  const visit = object => {
    if (Array.isArray(object)) return object.forEach(visit);
    if (!object || typeof object !== 'object') return;
    if ([object['@type']].flat().includes('JobPosting')) add(object);
    if (object['@graph']) visit(object['@graph']);
  };
  for (const script of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi)) {
    try { visit(JSON.parse(script[1])); } catch { /* malformed structured data */ }
  }
  for (const tag of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = Object.fromEntries([...tag[0].matchAll(/([a-z-]+)\s*=\s*(["'])(.*?)\2/gi)].map(m => [m[1].toLowerCase(), plain(m[3])]));
    if (attrs.itemprop === 'datePosted' && attrs.content) posted.add(attrs.content);
    if (attrs.itemprop === 'validThrough' && attrs.content) closes.add(attrs.content);
  }
  for (const heading of html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1\s*>/gi)) { const key = titleKey(heading[1]); if (key) titles.add(key); }
  if (title && (!titles.has(titleKey(title)) || [...titles].some(value => value !== titleKey(title)))) return { posted: null, closing: null };
  const postedValue = posted.size === 1 ? [...posted][0] : null;
  const closingValue = closes.size === 1 ? [...closes][0] : null;
  let closing = instant(closingValue);
  // FirstRand explicitly states that applications are NOT accepted on the listed
  // date or afterwards. A date-only field otherwise supplies no safe cutoff time.
  if (closing == null && country === 'ZA' && /applications will not be accepted on the below date and onwards/i.test(plain(html))) {
    const calendarDay = day(closingValue); if (calendarDay != null) closing = calendarDay - 2 * 3600000;
  }
  const location = sourceId === 'sasol' ? plain(html.match(/<h[1-6]\b[^>]*>\s*Location\s*<\/h[1-6]>\s*<\/div>\s*<div>\s*<p[^>]*>([^<]+)<\/p>/i)?.[1]) : '';
  return { posted: instant(postedValue) ?? day(postedValue), closing, ...(location ? { location } : {}) };
}

// Shared strict instant parser for public ATS fields already bound to a job ID.
export { instant as jobDateInstant };

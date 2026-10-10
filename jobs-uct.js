// Public UCT SuccessFactors pages only; no authenticated application endpoints.
export const UCT_SEARCH_URL = 'https://jobs.uct.ac.za/search/';
const ORIGIN = 'https://jobs.uct.ac.za';
const text = value => String(value || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&apos;|&#39;/gi, "'").replace(/&#(x[0-9a-f]+|\d+);/gi, (_, code) => {
  const n = code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : Number(code);
  return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : '\ufffd';
}).replace(/\s+/g, ' ').trim();
const attrs = tag => Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/gs)].map(m => [m[1].toLowerCase(), text(m[3])]));
const titleKey = value => text(value).normalize('NFKC').toLowerCase();
function publicJobUrl(value) {
  try {
    const u = new URL(text(value), ORIGIN);
    if (u.origin !== ORIGIN || u.username || u.password || u.search || u.hash || !/^\/job\/[^/]+\/\d+\/$/.test(u.pathname)) return null;
    return u.href;
  } catch { return null; }
}
export function parseUctSearch(html) {
  const fail = reason => ({ rows: [], complete: false, reason });
  if (typeof html !== 'string' || html.length > 2000000) return fail('invalid-public-list');
  const table = [...html.matchAll(/<table\b([^>]*)>([\s\S]*?)<\/table\s*>/gi)].find(m => attrs(m[1]).id === 'searchresults')?.[2];
  if (!table) return fail('public-list-structure-changed');
  const rows = [], ids = new Set();
  for (const match of table.matchAll(/<tr\b([^>]*)>([\s\S]*?)<\/tr\s*>/gi)) {
    if (!/(?:^|\s)data-row(?:\s|$)/.test(attrs(match[1]).class || '')) continue;
    const links = [...match[2].matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)].filter(m => /(?:^|\s)jobTitle-link(?:\s|$)/.test(attrs(m[1]).class || '')).map(m => ({ url: publicJobUrl(attrs(m[1]).href), title: text(m[2]) }));
    if (!links.length || links.some(x => !x.url || !x.title || x.url !== links[0].url || titleKey(x.title) !== titleKey(links[0].title))) continue;
    const { url, title } = links[0], id = url.match(/\/(\d+)\/$/)[1];
    if (ids.has(id)) continue;
    ids.add(id); rows.push({ id, title, url, location: '', posted: null, closing: null, pay: null, source_url: url });
    if (rows.length >= 100) break;
  }
  return { rows, complete: false, reason: 'public-list-partial' };
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function sourceInstant(value) {
  const m = /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) ([A-Z][a-z]{2}) (\d{2}) (\d{2}):(\d{2}):(\d{2}) UTC (\d{4})$/.exec(value || '');
  if (!m || !MONTHS.includes(m[1]) || +m[3] > 23 || +m[4] > 59 || +m[5] > 59) return null;
  const t = Date.UTC(+m[6], MONTHS.indexOf(m[1]), +m[2], +m[3], +m[4], +m[5]);
  const d = new Date(t);
  return d.getUTCFullYear() === +m[6] && d.getUTCMonth() === MONTHS.indexOf(m[1]) && d.getUTCDate() === +m[2] ? t : null;
}
export function parseUctDetail(html, listed, { now = Date.now() } = {}) {
  const url = publicJobUrl(listed?.url);
  if (!url || !listed?.title || typeof html !== 'string' || html.length > 2000000) return null;
  const canonicals = [...html.matchAll(/<link\b[^>]*>/gi)].map(m => attrs(m[0])).filter(a => a.rel === 'canonical').map(a => publicJobUrl(a.href));
  if (canonicals.length !== 1 || canonicals[0] !== url || (html.match(/itemtype=["']https?:\/\/schema.org\/JobPosting["']/gi) || []).length !== 1) return null;
  const properties = name => [...html.matchAll(/<span\b([^>]*)>([\s\S]*?)<\/span\s*>/gi)].filter(m => attrs(m[1])['data-careersite-propertyid'] === name).map(m => text(m[2]));
  const titles = properties('title'), cities = properties('city');
  if (titles.length !== 1 || titleKey(titles[0]) !== titleKey(listed.title) || cities.length !== 1 || !cities[0]) return null;
  const metadata = name => [...html.matchAll(/<meta\b[^>]*>/gi)].map(m => attrs(m[0])).filter(a => a.itemprop === name).map(a => a.content);
  const unique = name => { const values = [...new Set(metadata(name))]; return values.length === 1 ? values[0] : null; };
  const address = unique('streetAddress');
  // The public listing has no city column. Only the detail's matching explicit
  // city and ZA address establish location; the employer's home is not enough.
  if (!address || titleKey(address) !== titleKey(cities[0] + ', ZA')) return null;
  const organization = unique('hiringOrganization');
  if (organization !== 'University of Cape Town') return null;
  const postedValue = unique('datePosted'), closingValue = unique('validThrough');
  if (metadata('datePosted').length && !postedValue || metadata('validThrough').length && !closingValue) return null;
  const posted = sourceInstant(postedValue), closing = sourceInstant(closingValue);
  if (postedValue && (posted == null || posted > now) || closingValue && closing == null) return null;
  const paragraphs = [...html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p\s*>/gi)].map(m => text(m[1]));
  const advertisedClosing = paragraphs.map(p => p.match(/\bClosing date:\s*(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\s+(\d{4})\b/i)).filter(Boolean);
  if (closing && advertisedClosing.length) {
    const day = new Date(closing - 1 + 2 * 3600000), dayMonth = MONTHS[day.getUTCMonth()].toLowerCase();
    if (advertisedClosing.some(m => +m[1] !== day.getUTCDate() || m[2].slice(0, 3).toLowerCase() !== dayMonth || +m[3] !== day.getUTCFullYear())) return null;
  }
  const salaries = [];
  const nonempty = paragraphs.filter(Boolean);
  for (let i = 0; i < nonempty.length; i++) {
    if (!/\b(?:salary|remuneration|cost of employment)\b/i.test(nonempty[i])) continue;
    const parts = [nonempty[i]];
    // Some UCT advertisements place named grade amounts immediately after the
    // annual-pay heading. Preserve those words together, without merging grade
    // amounts into a fictitious single minimum/maximum salary range.
    for (let j = i + 1; j <= i + 3 && j < nonempty.length && /\bR\s*\d/.test(nonempty[j]); j++) parts.push(nonempty[j]);
    const advertised = parts.join(' ');
    if (/\bR\s*\d/.test(advertised) && !salaries.includes(advertised)) salaries.push(advertised);
    i += parts.length - 1;
  }
  const salary_text = salaries.length ? salaries.join(' ').slice(0, 1200) : null;
  let pay = null;
  if (salaries.length === 1) {
    const m = salaries[0].match(/^The annual remuneration package(?:, including benefits,)? is between R\s*(\d{1,3}(?:[ ,]\d{3})+) and R\s*(\d{1,3}(?:[ ,]\d{3})+)\.$/i);
    if (m) {
      const min = Number(m[1].replace(/[ ,]/g, '')), max = Number(m[2].replace(/[ ,]/g, ''));
      if (min > 0 && max >= min) pay = { cur: 'ZAR', min, max, period: 'year' };
    }
  }
  return { ...listed, url, location: cities[0], country: 'ZA', employer: organization, posted, closing, closed: closing != null && closing <= now, pay, salary_text, source_url: url, salary_url: salary_text ? url : null };
}

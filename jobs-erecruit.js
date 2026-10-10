// Shoprite's publicly linked Graylink pages; no form submission or application actions.
export const SHOPRITE_BROWSE_URL = 'https://shoprite.erecruit.co/candidateapp/jobs/browse/';
const ORIGIN = 'https://shoprite.erecruit.co';
const text = value => String(value ?? '').replace(/<[^>]*>/g, ' ').replace(/&(#(?:x[0-9a-f]+|\d+)|amp|nbsp|quot|apos|lt|gt);/gi, (all, code) => {
  if (code[0] !== '#') return ({ amp:'&', nbsp:' ', quot:'"', apos:"'", lt:'<', gt:'>' })[code.toLowerCase()];
  const hex = code[1].toLowerCase() === 'x', n = parseInt(code.slice(hex ? 2 : 1), hex ? 16 : 10);
  return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : '\ufffd';
}).replace(/\s+/g, ' ').trim();
const attrs = tag => Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/gs)].map(m => [m[1].toLowerCase(), text(m[3])]));
const key = value => text(value).normalize('NFKC').toLowerCase();
function safeUrl(value, kind) {
  try {
    const u = new URL(value, ORIGIN);
    const pattern = kind === 'category' ? /^\/candidateapp\/Jobs\/Categories\/[\w-]+\/[a-f0-9]{32}$/ : /^\/candidateapp\/Jobs\/View\/SHO\d{6}-\d+$/;
    return u.origin === ORIGIN && !u.username && !u.password && !u.search && !u.hash && pattern.test(u.pathname) ? u.href : null;
  } catch { return null; }
}
function day(value) {
  const m = /^(\d{4})\/(\d{2})\/(\d{2})$/.exec(value || ''); if (!m) return null;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3]), d = new Date(t);
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? t : null;
}
export function parseShopriteCategories(html) {
  if (typeof html !== 'string' || html.length > 2000000) return [];
  const rows = [], seen = new Set();
  for (const m of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)) {
    const a = attrs(m[1]), url = safeUrl(a.href, 'category'), label = text(m[2]).match(/^(.+)\s+\((\d+)\)$/);
    if (!/^tvCatagoriest\d+$/.test(a.id || '') || !url || !label || seen.has(url)) continue;
    const count = Number(label[2]); if (!Number.isSafeInteger(count) || count < 1 || count > 10000) continue;
    seen.add(url); rows.push({ url, name: label[1], count });
  }
  return rows.slice(0, 50);
}
export function parseShopriteList(html, { sourceUrl } = {}) {
  const fail = reason => ({ rows: [], complete: false, reason });
  if (!safeUrl(sourceUrl, 'category') || typeof html !== 'string' || html.length > 2000000) return fail('invalid-public-list');
  const table = [...html.matchAll(/<table\b([^>]*)>([\s\S]*?)<\/table\s*>/gi)].find(m => /(?:^|\s)list(?:\s|$)/.test(attrs(m[1]).class || ''))?.[2];
  if (!table) return fail('public-list-structure-changed');
  const headings = [...table.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th\s*>/gi)].map(m => text(m[1]));
  if (headings.join('|') !== 'Job Title|Town or City|Date Closing') return fail('public-list-structure-changed');
  const rows = [], ids = new Set(); let rejected = 0;
  for (const m of table.matchAll(/<tr\b([^>]*)>([\s\S]*?)<\/tr\s*>/gi)) {
    const a = attrs(m[1]); if (!/(?:^|\s)item(?:\s|$)/.test(a.class || '')) continue;
    // Read only the site's exact navigation literal; never execute its script.
    const path = a.onclick?.match(/^javascript:window\.location='([^']+)';$/)?.[1], url = safeUrl(path, 'detail');
    const cells = [...m[2].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td\s*>/gi)].map(c => text(c[1]));
    const id = url?.split('/').at(-1);
    if (!id || cells.length !== 3 || !cells[0] || !cells[1] || day(cells[2]) == null || ids.has(id)) { rejected++; continue; }
    ids.add(id); rows.push({ id, title: cells[0], url, location: cells[1], closing_text: cells[2], country: null, posted: null, closing: null, pay: null, salary_text: null, source_url: sourceUrl });
    if (rows.length >= 500) break;
  }
  return { rows, complete: false, reason: rejected ? 'rows-rejected' : 'public-list-partial', diagnostics: { acceptedCount: rows.length, rejected } };
}
export function parseShopriteDetail(html, listed, { now = Date.now() } = {}) {
  const url = safeUrl(listed?.url, 'detail');
  if (!url || listed?.id !== url.split('/').at(-1) || typeof html !== 'string' || html.length > 2000000) return null;
  const header = html.match(/<span\b[^>]*\bid=["']lblTitle["'][^>]*>([\s\S]*?)<\/span\s*>/i)?.[1];
  if (!header || key(header) !== key(listed.title)) return null;
  const fields = new Map();
  for (const table of html.matchAll(/<table\b([^>]*)>([\s\S]*?)<\/table\s*>/gi)) {
    if (!/(?:^|\s)display(?:\s|$)/.test(attrs(table[1]).class || '')) continue;
    for (const tr of table[2].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi)) {
      const cells = [...tr[1].matchAll(/<td\b([^>]*)>([\s\S]*?)<\/td\s*>/gi)];
      if (cells.length !== 2 || attrs(cells[0][1]).class !== 'label' || attrs(cells[1][1]).class !== 'value') continue;
      const name = key(cells[0][2]), value = text(cells[1][2]);
      if (fields.has(name)) return null;
      fields.set(name, value);
    }
  }
  const title = fields.get('job title'), reference = fields.get('reference number'), country = fields.get('location - country');
  const location = fields.get('location - town or city'), closingText = fields.get('closing date');
  if (reference !== listed.id || key(title) !== key(listed.title) || country !== 'South Africa' || !location || key(location) !== key(listed.location) || closingText !== listed.closing_text) return null;
  const calendarDay = day(closingText); if (calendarDay == null) return null;
  // The source supplies a ZA calendar date only. As with the other government
  // date-only feeds, expire at the end of that SAST day, not at receipt time.
  const closing = calendarDay + 86400000 - 2 * 3600000;
  const salaryText = fields.get('salary') || fields.get('remuneration') || null;
  return { ...listed, url, title, reference, employer: 'Shoprite', country: 'ZA', location, posted: null, closing, closed: closing <= now,
    pay: null, salary_text: salaryText, salary_url: salaryText ? url : null, source_url: url };
}

// Public career-page hints and schema.org JobPosting fallback. Detection does not
// bypass provider access controls or claim that a particular reader is supported.
export function detectJobSystem(url, html = '') {
  let host; try { host = new URL(url).hostname.toLowerCase(); } catch { return null; }
  const rules = [
    ['gh', /(?:^|\.)greenhouse\.io$/], ['lever', /(?:^|\.)lever\.co$/],
    ['ashby', /(?:^|\.)ashbyhq\.com$/], ['wd', /(?:^|\.)(?:myworkdayjobs|myworkdaysite)\.com$/],
    ['sr', /(?:^|\.)smartrecruiters\.com$/], ['icims', /(?:^|\.)icims\.com$/],
    ['workable', /(?:^|\.)workable\.com$/], ['taleo', /(?:^|\.)taleo\.net$/],
    ['recruitee', /\.recruitee\.com$/], ['personio', /\.jobs\.personio\.(?:de|com)$/], ['teamtailor', /\.teamtailor\.com$/],
  ];
  for (const [id, pattern] of rules) if (pattern.test(host)) return id;
  return parseJobPostings(html, url).length ? 'jsonld' : null;
}
const timestamp = value => {
  // Date-only closing dates have no trustworthy timezone/cutoff. Retain only
  // explicit timestamps here; country-specific readers can supply known cutoffs.
  if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:?\d{2})$/.test(value || '')) return null;
  const time = Date.parse(value); return Number.isFinite(time) ? time : null;
};
const https = (value, base) => {
  try { const u = new URL(value, base); return u.protocol === 'https:' ? u.href : null; } catch { return null; }
};
export function parseJobPostings(html, sourceUrl) {
  const nodes = [];
  const visit = value => {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (!value || typeof value !== 'object') return;
    if ([value['@type']].flat().includes('JobPosting')) nodes.push(value);
    if (value['@graph']) visit(value['@graph']);
    if (value.itemListElement) for (const item of value.itemListElement) visit(item?.item || item);
  };
  for (const m of String(html || '').matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi)) {
    try { visit(JSON.parse(m[1])); } catch { /* invalid structured data is not a posting */ }
  }
  return nodes.flatMap(x => {
    const url = https(x.url || x['@id'] || sourceUrl, sourceUrl);
    const locations = [x.jobLocation].flat().filter(Boolean);
    // Multi-country postings need explicit per-location identities; never pick
    // a convenient country or infer eligibility from salary currency.
    const addresses = locations.map(l => l.address).filter(Boolean);
    const countries = [...new Set(addresses.map(a => typeof a.addressCountry === 'object' ? a.addressCountry.name : a.addressCountry).filter(Boolean))];
    if (!url || !x.title || countries.length !== 1 || addresses.length !== locations.length || addresses.some(a => !a.addressCountry || (typeof a.addressCountry === 'object' && !a.addressCountry.name))) return [];
    const address = addresses[0];
    const salary = x.baseSalary, value = salary?.value;
    const unit = String(value?.unitText || '').toLowerCase();
    const period = { year: 'year', month: 'month', hour: 'hour' }[unit];
    const min = Number(value?.minValue ?? value?.value), max = Number(value?.maxValue ?? value?.value);
    const pay = /^[A-Z]{3}$/.test(salary?.currency || '') && period && min > 0 && max >= min ? { cur: salary.currency, min, max, period } : null;
    const id = String(x.identifier?.value || (typeof x.identifier === 'string' ? x.identifier : '') || x['@id'] || url);
    return [{ id, title: x.title, employer: x.hiringOrganization?.name, url, source_url: sourceUrl,
      location: [address.addressLocality, address.addressRegion, countries[0]].filter(Boolean).join(', '), countryName: countries[0],
      posted: Number.isFinite(Date.parse(x.datePosted || '')) ? Date.parse(x.datePosted) : null,
      closing: timestamp(x.validThrough), text: x.description || '', pay,
      salary_text: pay ? `${salary.currency} ${min}${max !== min ? ' – ' + max : ''} per ${period}` : null, salary_url: url,
    }];
  });
}

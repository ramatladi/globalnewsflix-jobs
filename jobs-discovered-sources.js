// Data-only source manifests. This module is shared by the site and collector.
import { COUNTRY } from './data.js';
import { workdayQueryFacets } from './jobs-workday-query.js';
const atsHosts = /(?:^|\.)(?:myworkdayjobs\.com|myworkdaysite\.com|greenhouse\.io|lever\.co|ashbyhq\.com|smartrecruiters\.com|oraclecloud\.com|successfactors\.(?:com|eu)|workable\.com|icims\.com|taleo\.net)$/i;
const excluded = ['indeed.com', 'indeed.co.uk', 'indeed.co.za', 'indeed.ca', 'indeed.com.au', 'indeed.co.in', 'linkedin.com', 'glassdoor.com', 'monster.com', 'ziprecruiter.com', 'careerjet.com', 'jooble.org', 'jobberman.com', 'jobberman.com.gh', 'myjobmag.com', 'myjobmag.co.ke', 'myjobmag.co.za', 'brightermonday.com', 'brightermonday.co.ke', 'brightermonday.co.ug', 'brightermonday.co.tz', 'pnet.co.za', 'careerjunction.co.za', 'careers24.com', 'nav.no', 'arbetsformedlingen.se', 'arbeitsagentur.de', 'francetravail.fr', 'ncs.gov.in', 'seek.com.au', 'seek.co.nz', 'totaljobs.com', 'reed.co.uk', 'adzuna.com', 'jobs.ac.uk'];
export function excludedDiscoveryUrl(value) {
  try { const h = new URL(value).hostname.toLowerCase().replace(/\.$/, ''); return excluded.some(d => h === d || h.endsWith('.' + d)); } catch { return true; }
}
export function strictPublicHttps(value) {
  if (typeof value !== 'string' || value.length > 1000) return null;
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:' || u.username || u.password || u.port || value.includes('#') || /%(?:2f|5c|00|0a|0d)|\\/i.test(u.pathname) || !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i.test(u.hostname) || /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(u.hostname) || excludedDiscoveryUrl(value)) return null;
    return u;
  } catch { return null; }
}
const segment = s => typeof s === 'string' && /^[a-z0-9_-]{1,100}$/i.test(s) && !/^(?:jobs?|search|embed|api|v[01])$/i.test(s);
export function discoveredReader(careerUrl, officialDomain) {
  const u = strictPublicHttps(careerUrl), domain = strictPublicHttps(officialDomain);
  if (!u || !domain || domain.pathname !== '/' || domain.search || atsHosts.test(domain.hostname)) return null;
  const p = u.pathname.split('/').filter(Boolean), host = u.hostname;
  const simple = { 'boards.greenhouse.io': 'gh', 'job-boards.greenhouse.io': 'gh', 'jobs.lever.co': 'lever', 'jobs.ashbyhq.com': 'ashby', 'careers.smartrecruiters.com': 'sr' };
  // These readers collect an entire tenant and have no metadata-bound query
  // filter implementation. Never silently widen a registered filtered URL.
  if (simple[host] && p.length === 1 && segment(p[0])) return u.search ? null : { ats: simple[host], args: [p[0]] };
  if (/^[a-z0-9-]+\.wd\d+\.myworkdayjobs\.com$/.test(host)) {
    const parts = /^[a-z]{2}-[A-Z]{2}$/.test(p[0] || '') ? p.slice(1) : p;
    if (parts.length === 1 && segment(parts[0]) && workdayQueryFacets(u.href) !== null) return { ats: 'wd', args: [host, host.split('.')[0], parts[0]] };
  }
  if (/^(?:www|wd\d+)\.myworkdaysite\.com$/.test(host) && p.length === 3 && p[0] === 'recruiting' && p.slice(1).every(segment) && workdayQueryFacets(u.href) !== null) return { ats: 'wd', args: [host, p[1], p[2]] };
  // Unsupported or shared provider roots stay held; supported does not mean every
  // provider's URL shape has a safely automated reader.
  if (atsHosts.test(host)) return null;
  // Preserving a URL alone does not establish its search/locale semantics.
  return !u.search && employerHost(u.hostname, domain.hostname) ? { ats: 'jsonld', args: [u.href] } : null;
}
function exactKeys(value, keys) { return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && Object.keys(value).every(k => keys.includes(k)); }
function observed(value, now) { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && Date.parse(value) <= now; }
export function validateDiscoveredManifest(manifest, now = Date.now()) {
  if (!exactKeys(manifest, ['version', 'sources']) || manifest.version !== 1 || !Array.isArray(manifest.sources) || manifest.sources.length > 10000) throw new Error('Invalid discovered source manifest');
  const ids = new Set(), identities = new Set();
  for (const s of manifest.sources) {
    if (!exactKeys(s, ['id', 'name', 'country', 'type', 'officialDomain', 'careerUrl', 'ats', 'args', 'identity', 'discoveredAt']) || !/^auto-[a-f0-9]{24}$/.test(s.id) || !['c','g','i'].includes(s.type) || typeof s.name !== 'string' || s.name.length < 2 || s.name.length > 100 || /[<>\x00-\x1f]/.test(s.name) || !COUNTRY[s.country] || s.country === 'WW' || !observed(s.discoveredAt, now)) throw new Error('Invalid discovered source');
    const reader = discoveredReader(s.careerUrl, s.officialDomain);
    if (!reader || !dedicatedTenant(s) || s.ats !== reader.ats || JSON.stringify(s.args) !== JSON.stringify(reader.args)) throw new Error('Reader and identity scope disagree');
    const e = s.identity;
    if (!exactKeys(e, ['method', 'organization', 'country', 'officialDomain', 'evidenceUrl', 'evidenceSha256', 'employerPageSha256', 'observedAt']) || !['automatic-employer-structured-identity','automatic-first-party-name-domain-country','automatic-authoritative-directory-and-employer-page'].includes(e.method) || e.organization !== s.name || e.country !== s.country || e.officialDomain !== s.officialDomain || e.evidenceUrl !== s.officialDomain || !strictPublicHttps(e.evidenceUrl) || !/^[a-f0-9]{64}$/.test(e.evidenceSha256) || !/^[a-f0-9]{64}$/.test(e.employerPageSha256) || !observed(e.observedAt, now)) throw new Error('Invalid automatic identity evidence');
    const key = s.country + ':' + s.officialDomain;
    if (ids.has(s.id) || identities.has(key)) throw new Error('Duplicate source or employer domain');
    ids.add(s.id); identities.add(key);
  }
  return manifest;
}
export function registeredDiscoveredSources(manifest, now = Date.now()) {
  return validateDiscoveredManifest(manifest, now).sources.map(s => ({ ...s, ticker: null, automatic: true, strictDetailGeography: s.ats === 'wd', countries: [s.country], verifiedAt: Date.parse(s.identity.observedAt), provenanceUrl: s.careerUrl }));
}
export function allowedDiscoveredRequest(source, value, method = 'GET') {
  const u = strictPublicHttps(value);
  if (!u || !['GET', 'POST'].includes(method)) return false;
  const [a, b, c] = source.args;
  if (source.ats === 'jsonld') return method === 'GET' && [new URL(source.officialDomain).origin,new URL(source.careerUrl).origin].includes(u.origin);
  if (source.ats === 'wd') return u.hostname === a && (method === 'POST' ? u.pathname === `/wday/cxs/${b}/${c}/jobs` : u.pathname.startsWith(`/wday/cxs/${b}/${c}/job/`) || u.pathname.startsWith(`/${c}/job/`) || /^\/[a-z]{2}-[A-Z]{2}\//.test(u.pathname) && u.pathname.split('/')[2] === c);
  if (method !== 'GET') return false;
  if (source.ats === 'gh') return u.hostname === 'boards-api.greenhouse.io' && u.pathname.startsWith(`/v1/boards/${a}/`) || ['boards.greenhouse.io', 'job-boards.greenhouse.io'].includes(u.hostname) && u.pathname.startsWith(`/${a}/`);
  if (source.ats === 'lever') return u.hostname === 'api.lever.co' && (u.pathname === `/v0/postings/${a}` || u.pathname.startsWith(`/v0/postings/${a}/`)) || u.hostname === 'jobs.lever.co' && u.pathname.startsWith(`/${a}/`);
  if (source.ats === 'ashby') return u.hostname === 'api.ashbyhq.com' && u.pathname === `/posting-api/job-board/${a}` || u.hostname === 'jobs.ashbyhq.com' && u.pathname.startsWith(`/${a}/`);
  if (source.ats === 'sr') return u.hostname === 'api.smartrecruiters.com' && (u.pathname === `/v1/companies/${a}/postings` || u.pathname.startsWith(`/v1/companies/${a}/postings/`)) || ['jobs.smartrecruiters.com', 'careers.smartrecruiters.com'].includes(u.hostname) && u.pathname.startsWith(`/${a}/`);
  return false;
}

export function discoveredJobAllowed(source, row) {
  if (source.ats === 'jsonld' && !row.employer) return false;
  if (row.country !== source.country || row.employer && normalizedIdentity(row.employer) !== normalizedIdentity(source.name)) return false;
  return [row.url, row.source_url || row.url, row.salary_url || row.url].every(url => allowedDiscoveredRequest(source, url));
}
export function normalizedIdentity(value) { return String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, ''); }

export function employerHost(host, officialHost) { const base=officialHost.replace(/^www\./,'');return host===base||host.endsWith('.'+base); }
export function dedicatedTenant(source) {
  if(source.ats==='jsonld')return true;
  const tenant=source.args[source.ats==='wd'?1:0].toLowerCase().replace(/[^a-z0-9]/g,'');
  const words=source.name.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/\b(?:the|limited|ltd|plc|inc|pty)\b/g,' ').match(/[a-z0-9]+/g)||[];
  const domain=new URL(source.officialDomain).hostname.replace(/^www\./,'').split('.')[0].replace(/[^a-z0-9]/g,'');
  return [domain,words.join(''),words.map(w=>w[0]).join('')].filter(n=>n.length>=2).includes(tenant);
}

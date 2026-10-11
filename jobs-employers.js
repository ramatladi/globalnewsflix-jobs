// Registry metadata is derived from configured employer sources, not a claim
// that the career page currently answers or has vacancies in every target country.
import { COUNTRY } from './data.js';
export const JOBS_SOURCE_OBSERVATIONS = {
  "cloudflare": {
    "countries": [
      "AE",
      "AU",
      "BE",
      "CA",
      "CH",
      "CL",
      "CN",
      "CO",
      "DE",
      "ES",
      "FR",
      "GB",
      "IN",
      "JP",
      "KR",
      "MX",
      "MY",
      "NL",
      "PT",
      "SE",
      "SG",
      "US"
    ],
    "provenanceUrl": "https://boards-api.greenhouse.io/v1/boards/cloudflare/jobs?content=true",
    "verifiedAt": 1791609502628
  },
  "block": {
    "countries": [
      "AU",
      "CA",
      "FR",
      "GB",
      "IE",
      "JP",
      "SG",
      "US"
    ],
    "provenanceUrl": "https://boards-api.greenhouse.io/v1/boards/block/jobs?content=true",
    "verifiedAt": 1791609508563
  }
};
export const JOBS_FOCUS_COUNTRIES = ['ZA', 'US', 'GB', 'NG', 'KE', 'IN'];
const AMAZON_COUNTRIES = 'US CA GB IE DE FR ES IT NL PL CZ LU BE SE AT IN JP CN SG AU NZ BR MX AR CL CO CR ZA EG AE SA IL TR KR TW HK PH MY ID VN TH RO BG GR PT DK FI NO KE NG MA PE UY SK HU'.split(' ');
const httpsUrl = value => {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null; } catch { return null; }
};
export function sourceCareerUrls(source) {
  const [a, b, c] = source.args || [];
  const segment = value => encodeURIComponent(value || '');
  let careersUrl = null, collectionUrl = null;
  switch (source.ats) {
    case 'gh': careersUrl = `https://boards.greenhouse.io/${segment(a)}`; collectionUrl = `https://boards-api.greenhouse.io/v1/boards/${segment(a)}/jobs?content=true`; break;
    case 'lever': careersUrl = `https://jobs.lever.co/${segment(a)}`; collectionUrl = `https://api.lever.co/v0/postings/${segment(a)}?mode=json`; break;
    case 'ashby': careersUrl = `https://jobs.ashbyhq.com/${segment(a)}`; collectionUrl = `https://api.ashbyhq.com/posting-api/job-board/${segment(a)}?includeCompensation=true`; break;
    case 'wd': careersUrl = a?.includes('myworkdaysite') ? `https://${a}/recruiting/${segment(b)}/${segment(c)}` : `https://${a}/${segment(c)}`; collectionUrl = `https://${a}/wday/cxs/${segment(b)}/${segment(c)}/jobs`; break;
    case 'sf': careersUrl = `https://${a}${source.sfScope?.listPath || '/search/'}`; collectionUrl = careersUrl; break;
    case 'orc': careersUrl = `https://${a}/hcmUI/CandidateExperience/en/sites/${segment(b)}`; collectionUrl = `https://${a}/hcmRestApi/resources/latest/recruitingCEJobRequisitions`; break;
    case 'sr': careersUrl = `https://careers.smartrecruiters.com/${segment(a)}`; collectionUrl = `https://api.smartrecruiters.com/v1/companies/${segment(a)}/postings`; break;
    case 'amazon': careersUrl = 'https://www.amazon.jobs/'; collectionUrl = 'https://www.amazon.jobs/en/search.json'; break;
    case 'nhs': careersUrl = 'https://www.jobs.nhs.uk/candidate/search/results'; collectionUrl = careersUrl; break;
    case 'un': careersUrl = 'https://careers.un.org/'; collectionUrl = 'https://careers.un.org/api/public/opening/jo/list/filteredV2/en'; break;
    case 'unicef': careersUrl = 'https://jobs.unicef.org/en-us/listing/'; collectionUrl = careersUrl; break;
    case 'simplify': careersUrl = `https://${a}/`; collectionUrl = `${careersUrl}vacancy/vacancies?query=&displayOrder=4&ats_referrer=`; break;
    case 'erecruit':
    case 'uct':
    case 'gauteng':
    case 'jsonld': careersUrl = a; collectionUrl = a; break;
    // A government's actual configured source URL is required; no guessed PDF.
    case 'dpsa': careersUrl = a || null; collectionUrl = careersUrl; break;
  }
  return { careersUrl: httpsUrl(careersUrl), collectionUrl: httpsUrl(collectionUrl) };
}
export function employerMetadata(source, observation = source.verifiedAt ? source : JOBS_SOURCE_OBSERVATIONS[source.id] || null, now = Date.now()) {
  const urls = sourceCareerUrls(source);
  const verified = observation && Number.isSafeInteger(observation.verifiedAt) && observation.verifiedAt > 0 && observation.verifiedAt <= now && httpsUrl(observation.provenanceUrl);
  const configuredCountries = source.ats === 'nhs' ? ['GB'] : source.ats === 'dpsa' ? ['ZA'] : source.ats === 'amazon' ? AMAZON_COUNTRIES : [];
  const observedCountries = verified && Array.isArray(observation.countries) ? [...new Set(observation.countries.filter(cc => COUNTRY[cc] && cc !== 'WW'))] : [];
  return {
    id: source.id, name: source.name, ticker: source.ticker || null, ats: source.ats,
    sector: source.type === 'g' ? 'public' : source.type === 'i' ? 'international' : 'private',
    ownership: source.type === 'g' ? 'government' : source.type === 'i' ? 'international-organisation' : source.ticker ? 'listed-company' : 'unverified',
    ...urls,
    provenanceUrl: verified ? httpsUrl(observation.provenanceUrl) : urls.careersUrl,
    verifiedAt: verified ? observation.verifiedAt : null,
    verification: verified ? 'observed' : 'configured-unverified',
    countries: [...new Set([...configuredCountries, ...observedCountries])].sort(),
    countryEvidence: [
      ...configuredCountries.map(country => ({ country, kind: 'configured-reader-scope', url: urls.collectionUrl, verifiedAt: null })),
      ...observedCountries.map(country => ({ country, kind: 'observed-source', url: httpsUrl(observation.provenanceUrl), verifiedAt: observation.verifiedAt })),
    ],
  };
}
export function employerRegistry(sources, observations = {}, now = Date.now()) {
  return sources.map(source => employerMetadata(source, observations[source.id], now));
}
export function registryCoverage(registry, target = 1000) {
  const countries = JOBS_FOCUS_COUNTRIES.map(country => {
    const configured = registry.filter(source => source.countries.includes(country));
    const observed = configured.filter(source => source.countryEvidence.some(e => e.country === country && e.kind === 'observed-source'));
    return { country, configuredSources: configured.length, observedSources: observed.length, target, sourceShortfall: Math.max(0, target - configured.length) };
  });
  return { totalSources: registry.length, countryUnknownSources: registry.filter(source => !source.countries.length).length, countries,
    note: 'Source counts are not employer or live vacancy counts; shared government boards can represent many employers. Country targets are not current hiring eligibility.' };
}

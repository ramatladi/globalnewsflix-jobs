// Reviewed code-only limits. Manifest fields can never alter request budgets.
export const AUTOMATIC_SOURCE_HARD_LIMIT = 150;
export const NTU_AUTOMATIC_SOURCE_ID = 'auto-8befb80d669fd1078172abfd';
// Per-reader request limit for one automatic source in one run, counting its
// robots.txt check. Workday lists 20 rows per page and must read every posting
// detail. Greenhouse, Ashby, Recruitee and Personio publish a tenant's whole
// board as one documented response (robots.txt, the board, one retry). Lever and
// Teamtailor page 100 postings at a time; 1,000 rows (the health ceiling) is ten
// pages, one empty page and retries. Only these readers prove a complete
// refresh, so only these can be activated automatically.
export const AUTOMATIC_READER_REQUEST_LIMITS = Object.freeze({ wd: 100, gh: 4, ashby: 4, recruitee: 4, personio: 4, lever: 15, teamtailor: 15 });
export const REFRESHABLE_AUTOMATIC_READERS = new Set(Object.keys(AUTOMATIC_READER_REQUEST_LIMITS));
// Readers whose every tenant shares one API host (boards-api.greenhouse.io,
// api.lever.co, api.ashbyhq.com). The transport serialises a host and pauses a
// second before each request, so a request there takes about two seconds of the
// shared deadline instead of one platform slot. Workday, Recruitee, Personio and
// Teamtailor give each employer its own host and are paced per platform.
export const SHARED_HOST_READERS = new Set(['gh', 'lever', 'ashby']);
export function automaticSourceRequestLimit(sourceId, ats = 'wd') {
  const base = Object.hasOwn(AUTOMATIC_READER_REQUEST_LIMITS, ats) ? AUTOMATIC_READER_REQUEST_LIMITS[ats] : 100;
  return Math.min(AUTOMATIC_SOURCE_HARD_LIMIT, sourceId === NTU_AUTOMATIC_SOURCE_ID && ats === 'wd' ? 134 : base);
}
// Worst-case share of the shared deadline, in one-second platform slots.
export function automaticSourceCost(sourceId, ats = 'wd') {
  return automaticSourceRequestLimit(sourceId, ats) * (SHARED_HOST_READERS.has(ats) ? 2 : 1);
}
// Shared budget for every automatic source in one collector run (used by
// automaticTransport). Automatic sources are paced at one request per second
// across their platform, so seconds bound requests too. The budget sets the
// activation ceiling (24 Workday sources at 100 requests beside the 134-request
// exception, more for the cheaper single-document readers); the deadline adds
// 500 s of slack because the last sources in a phase are host-serialised
// (measured ~1.8 s per request alone) and cannot use the full one-per-second
// platform slot. Worst case the automatic phase lasts 3,000 s (50 min) before
// the manual phase begins, which the Jobs workflow timeout (120 min) must cover
// with the measured manual phase (~28 min on 17 Oct 2026) and a healthy margin;
// tests/jobs-capacity enforces it.
export const AUTOMATIC_COLLECTION_MAX_REQUESTS = 2500;
export const AUTOMATIC_COLLECTION_MAX_SECONDS = 3000;
export const AUTOMATIC_PLATFORM_INTERVAL_MS = 1000;
export function automaticRequestBudget() {
  return Math.min(AUTOMATIC_COLLECTION_MAX_REQUESTS, Math.floor(AUTOMATIC_COLLECTION_MAX_SECONDS * 1000 / AUTOMATIC_PLATFORM_INTERVAL_MS));
}
// Sources fit when their per-source request limits fit the shared request
// budget and their worst-case time, counted as if every platform ran one after
// another, fits the same number of seconds. A source past the budget is recorded
// as failed and trips the health breaker. A bare ID is costed as Workday, the
// most expensive reader.
export function automaticSourcesFit(sources) {
  let requests = 0, seconds = 0;
  for (const s of sources) {
    const id = typeof s === 'string' ? s : s?.id, ats = typeof s === 'string' ? 'wd' : s?.ats;
    requests += automaticSourceRequestLimit(id, ats); seconds += automaticSourceCost(id, ats);
  }
  return requests <= automaticRequestBudget() && seconds <= automaticRequestBudget();
}
export const WORKDAY_DETAIL_REASONS = Object.freeze(['place-null','wrong-country','site-mismatch','reqid-mismatch','title-mismatch','external-url-mismatch','detail-http-error','detail-invalid-json','unattempted-cap','other']);
export const emptyWorkdayDetailReasons = () => Object.fromEntries(WORKDAY_DETAIL_REASONS.map(key => [key, 0]));
export function validWorkdayDetailReasons(value, rawCount, detailHttp) {
  return !!value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).sort().join(',') === [...WORKDAY_DETAIL_REASONS].sort().join(',') &&
    Object.values(value).every(n => Number.isSafeInteger(n) && n >= 0 && n <= rawCount) &&
    Object.values(value).reduce((a,b) => a+b, 0) <= rawCount &&
    Number.isSafeInteger(detailHttp) && detailHttp >= 0 &&
    WORKDAY_DETAIL_REASONS.filter(key => key !== 'unattempted-cap').reduce((sum,key) => sum+value[key], 0) <= detailHttp;
}

export function workdayDetailSummaries(diagnostics) {
  return diagnostics.filter(d => /^auto-[a-f0-9]{24}$/.test(d.src) && validWorkdayDetailReasons(d.detailReasons,d.rawCount,d.phaseHttp?.detail))
    .map(d => ({src:d.src,counts:d.detailReasons,...(Number.isSafeInteger(d.listingRejected)&&d.listingRejected>=0&&d.listingRejected<=1500?{listingRejected:d.listingRejected}:{}),summary:WORKDAY_DETAIL_REASONS.map(key => `${key}=${d.detailReasons[key]}`).join('; ')}));
}

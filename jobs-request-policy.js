// Reviewed code-only exception. Manifest fields can never alter request budgets.
export const AUTOMATIC_SOURCE_HARD_LIMIT = 150;
export const NTU_AUTOMATIC_SOURCE_ID = 'auto-8befb80d669fd1078172abfd';
export function automaticSourceRequestLimit(sourceId) {
  return Math.min(AUTOMATIC_SOURCE_HARD_LIMIT, sourceId === NTU_AUTOMATIC_SOURCE_ID ? 134 : 100);
}
// Shared budget for every automatic source in one collector run (used by
// automaticTransport). Automatic sources are paced at one request per second
// across their platform (Workday), so seconds bound requests too. The request
// budget sets the activation ceiling (24 sources at 100 requests beside the
// 134-request exception); the deadline adds 500 s of slack because the last
// sources in a phase are host-serialised (measured ~1.8 s per request alone)
// and cannot use the full one-per-second platform slot. Worst case the
// automatic phase lasts 3,000 s (50 min) before the manual phase begins, which
// the Jobs workflow timeout (120 min) must cover with the measured manual phase
// (~28 min on 17 Oct 2026) and a healthy margin; tests/jobs-capacity enforces it.
export const AUTOMATIC_COLLECTION_MAX_REQUESTS = 2500;
export const AUTOMATIC_COLLECTION_MAX_SECONDS = 3000;
export const AUTOMATIC_PLATFORM_INTERVAL_MS = 1000;
export function automaticRequestBudget() {
  return Math.min(AUTOMATIC_COLLECTION_MAX_REQUESTS, Math.floor(AUTOMATIC_COLLECTION_MAX_SECONDS * 1000 / AUTOMATIC_PLATFORM_INTERVAL_MS));
}
// Sources fit when their per-source request limits fit the shared budget; a
// source past the budget is recorded as failed and trips the health breaker.
export function automaticSourcesFit(sourceIds) {
  return sourceIds.reduce((n, id) => n + automaticSourceRequestLimit(id), 0) <= automaticRequestBudget();
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

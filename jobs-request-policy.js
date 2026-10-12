// Reviewed code-only exception. Manifest fields can never alter request budgets.
export const AUTOMATIC_SOURCE_HARD_LIMIT = 150;
export const NTU_AUTOMATIC_SOURCE_ID = 'auto-8befb80d669fd1078172abfd';
export function automaticSourceRequestLimit(sourceId) {
  return Math.min(AUTOMATIC_SOURCE_HARD_LIMIT, sourceId === NTU_AUTOMATIC_SOURCE_ID ? 134 : 100);
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

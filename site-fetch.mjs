// Calls from a GitHub Actions collector to the site. They retry through passing failures (a deploy in progress,
// a 500/502/504, a 429 or a dropped connection) with a fresh identity token on every attempt; a lasting failure is
// reported as a run annotation, because Actions logs are not readable from the maintenance environment.
export const SITE_RETRY_DELAYS_MS = Object.freeze([3000, 10000, 30000]);
// SITE_RETRY_DELAYS="" turns retries off (tests); a 503 is never retried: the site uses it for a deliberate pause.
const envDelays = () => { const v = process.env.SITE_RETRY_DELAYS; return v === undefined ? SITE_RETRY_DELAYS_MS : v.split(',').filter(x => x.trim() !== '').map(Number).filter(n => Number.isFinite(n) && n >= 0); };
const pause = ms => new Promise(r => setTimeout(r, ms));
export function makeSiteFetch({ auth, userAgent, delays = envDelays(), fetchImpl = fetch, wait = pause, log = console.log }) {
  return async function siteFetch(url, init = {}, label = 'site') {
    let last = '';
    for (let attempt = 0; attempt <= delays.length; attempt++) {
      try {
        const res = await fetchImpl(url, { ...init, headers: { ...(init.headers || {}), ...await auth(), 'user-agent': userAgent } });
        if ((res.status < 500 && res.status !== 429) || res.status === 503) return res;
        last = `HTTP ${res.status}`;
      } catch { last = 'request failed'; } // never echo exception text (it can carry provider responses)
      if (attempt < delays.length) { log(`${label}: ${last}; retrying`); await wait(delays[attempt]); }
    }
    log(`::error title=Collect news (pass ${process.env.PASS || '?'})::${label} failed after ${delays.length + 1} attempts: ${last}`);
    throw new Error(`${label}: ${last}`);
  };
}

// Collector-side (GitHub Actions) resolution of Google News links to publisher article URLs.
// Runs at collection time because Google refuses or challenges many requests from Cloudflare's network;
// the Worker then fetches the publisher page directly and keeps its own decode only as a fallback.
import { isGoogleNewsUrl, resolveGoogleNewsUrl, googleNewsArticleId, decodeGoogleNewsIdOffline } from './google-news-url.js';
import { sponsoredContentReason } from './sponsored-content.js';

// Shared state for one runner invocation: per-run cap, deadline, cache, and a stop after rate limiting.
export function createResolver({ fetch: fetchImpl = globalThis.fetch, max = 300, budgetMs = 180000, concurrency = 3, timeoutMs = 6000, cache = new Map(), now = () => Date.now() } = {}) {
  const deadline = now() + budgetMs;
  const stats = { resolved: 0, offline: 0, cached: 0, failed: 0, skipped: 0, sponsored: 0, reasons: {} };
  let used = 0, stopped = null;
  const pending = new Map();

  // share: optional {left} limiting the network lookups one caller may start (a target's fair share of the run's cap).
  async function resolve(link, share = null) {
    if (!isGoogleNewsUrl(link)) return link;
    if (cache.has(link)) { stats.cached++; return cache.get(link); }
    if (pending.has(link)) return pending.get(link);
    // Older ids carry the URL themselves: no request, no cap.
    const id = googleNewsArticleId(link), offline = id && decodeGoogleNewsIdOffline(id);
    if (offline) { stats.offline++; cache.set(link, offline); return offline; }
    if (stopped || used >= max || now() >= deadline || (share && share.left <= 0)) { stats.skipped++; return null; }
    used++;
    if (share) share.left--;
    const p = resolveGoogleNewsUrl(link, { fetch: fetchImpl, timeoutMs }).then(r => {
      if (r.url) { stats.resolved++; cache.set(link, r.url); return r.url; }
      stats.failed++;
      stats.reasons[r.reason] = (stats.reasons[r.reason] || 0) + 1;
      // Google is throttling this runner: stop asking for the rest of the run.
      if (/HTTP 429|consent page/.test(r.reason) && (stats.reasons[r.reason] >= 3)) stopped = r.reason;
      return null;
    }).finally(() => pending.delete(link));
    pending.set(link, p);
    return p;
  }

  async function pool(items, fn) {
    let i = 0;
    await Promise.all(Array.from({ length: Math.max(1, concurrency) }, async () => {
      while (i < items.length) { const k = i++; await fn(items[k]); }
    }));
  }

  // Resolve the strongest `top` rows of one target: every chosen lead link first, then up to `clusterLinks` other
  // reports per row while lookups remain. `maxRequests` caps this call's network lookups (cache and offline decodes are
  // free); `rank(row)` orders rows (default: trend score); `skip(row)` leaves a row unresolved (a publisher that
  // repeatedly fails). Rows whose resolved publisher URL is sponsored content are removed. Returns the rows to send.
  async function resolveRows(rows, { top = 12, clusterLinks = 3, maxRequests = Infinity, rank = null, skip = null } = {}) {
    const order = rank || (r => r.score || 0);
    const chosen = [...rows].filter(r => !skip?.(r)).sort((a, b) => order(b) - order(a)).slice(0, top);
    const drop = new Set(), share = { left: maxRequests };
    const originals = new Map();
    await pool(chosen, async row => {
      const original = row.gn_link;
      const url = await resolve(original, share);
      if (!url || url === original) return;
      if (sponsoredContentReason({ url, title: row.title, source: row.source })) { stats.sponsored++; drop.add(row); return; }
      row.gn_link = url;
      originals.set(row, original);
    });
    await pool([...originals.keys()], async row => {
      const original = originals.get(row), url = row.gn_link;
      let data;
      try { data = JSON.parse(row.cluster || '{}'); } catch { return; }
      const list = Array.isArray(data) ? data : data?.c;
      if (!Array.isArray(list)) return;
      let others = 0;
      for (const x of list) {
        if (!x?.u || !isGoogleNewsUrl(x.u)) continue;
        if (x.u === original) { x.u = url; continue; }
        if (others >= clusterLinks) continue;
        others++;
        const u = await resolve(x.u, share);
        if (u) x.u = u;
      }
      row.cluster = JSON.stringify(data);
    });
    return rows.filter(r => !drop.has(r));
  }

  return { resolve, resolveRows, stats, get stopped() { return stopped; }, get remaining() { return stopped || now() >= deadline ? 0 : Math.max(0, max - used); } };
}

// Reports from a feed in another language than the edition's cannot ground its stories, so they rank far behind
// (they still fill any lookups the edition's own-language reports leave unused).
export const OTHER_LANGUAGE_WEIGHT = 0.15;
export function languageWeight(feedLang, editionLang) {
  return !feedLang || !editionLang || feedLang === editionLang ? 1 : OTHER_LANGUAGE_WEIGHT;
}
// A target's weight in the run's Google lookups: 1 for an edition with a full day in hand, up to 1 + its need.
export function targetWeight(need) {
  const n = Number(need);
  return 1 + (need != null && Number.isFinite(n) ? Math.max(0, Math.min(24, n)) : 1);
}
// Target k's share of the lookups left: its weight over the weights of the targets still to come (at least 4), so
// equal weights give every target an even share and early targets can never use them all.
export function resolveShare(remaining, weights, k) {
  const rest = weights.slice(k).reduce((a, w) => a + w, 0) || 1;
  return Math.max(4, Math.ceil(Math.max(0, remaining) * (weights[k] || 1) / rest));
}

// Coming Up reports (section 'upcoming') are single-source search results that rarely reach a target's strongest rows,
// so their Google links were almost never resolved and their pages never read: the writer cannot use a report without
// a publisher URL. Each target's few best ones get their own share of the run's lookups (taken from the run's cap, not
// added to it) and their own publisher reads.
export const UPCOMING_RESOLVE_TOP = 2, UPCOMING_ENRICH_TOP = 3;
// The Coming Up rows to read for one target, beside the rows already picked: the best-ranked ones with a publisher URL.
export function upcomingPicks(rows, picked, rank, { isGoogle = u => /news\.google\.com/.test(u || ''), skip = () => false, top = UPCOMING_ENRICH_TOP } = {}) {
  const already = new Set(picked);
  return rows.filter(r => r.section === 'upcoming' && !already.has(r) && !isGoogle(r.gn_link) && !skip(r)).sort((a, b) => rank(b) - rank(a)).slice(0, top);
}

// Publisher reads for one target: the full allowance, or at most four for an edition with a full day in hand.
export const COVERED_ENRICH_TOP = 4;
export function enrichTop(need, max) {
  return need != null && Number(need) === 0 ? Math.min(max, COVERED_ENRICH_TOP) : max;
}

export function loadCache(text) {
  try {
    const v = JSON.parse(text);
    return new Map(Object.entries(v || {}).filter(([k, u]) => isGoogleNewsUrl(k) && typeof u === 'string' && /^https?:\/\//.test(u)));
  } catch { return new Map(); }
}

export function dumpCache(cache, limit = 5000) {
  return JSON.stringify(Object.fromEntries([...cache.entries()].slice(-limit)));
}

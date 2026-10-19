// Per-publisher fetch health: how often a publisher's article page could be read and dated, by the GitHub collector
// and the pipeline. Used only to spend fetches and writer slots on publishers that work, never to disguise requests.
// Counts decay (x0.95 per update batch) so a publisher that starts working again recovers, and a publisher that is
// skipped is re-probed once its record is a day old.
import { sourceTimestamp } from './news-freshness.js';

export const HEALTH_MIN_TRIES = 6;
export const HEALTH_FAIL_SHARE = 0.1;
export const HEALTH_REPROBE_MS = 24 * 3600000;
const DECAY = 0.95;

export function publisherHostOf(url) {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol) || /(^|\.)news\.google\.com$/i.test(u.hostname)) return '';
    return u.hostname.toLowerCase().replace(/^(?:www\d*|m|amp|mobile)\./, '');
  } catch { return ''; }
}

const ready = new WeakMap();
export async function ensurePublisherHealth(db) {
  db = db?.[Symbol.for('gnf.rawDatabase')] || db;
  if (!ready.has(db)) ready.set(db, db.prepare(`CREATE TABLE IF NOT EXISTS publisher_health (host TEXT PRIMARY KEY,
    tries REAL NOT NULL DEFAULT 0, fetched REAL NOT NULL DEFAULT 0, dated REAL NOT NULL DEFAULT 0, last_reason TEXT, updated_ts INTEGER)`).run()
    .catch(e => { ready.delete(db); throw e; }));
  return ready.get(db);
}

// One observation per lead report: was the page read, and did it carry a usable publication date?
// Reports that were never attempted (unresolved link, skipped publisher, sponsored) are not observations.
export function healthObservation(facts) {
  if (!facts || typeof facts !== 'object' || facts.sponsored_reason) return null;
  const host = publisherHostOf(facts.url);
  if (!host || facts.url_reason || /^publisher skipped/.test(String(facts.fetch_reason || ''))) return null;
  const fetched = sourceTimestamp(facts.fetched_ts) !== null;
  const dated = fetched && !facts.publication_date_invalid && sourceTimestamp(facts.published_ts) !== null;
  return { host, fetched, dated, reason: dated ? null : String(facts.fetch_reason || facts.publication_date_reason || (fetched ? 'no publication date' : 'not fetched')).slice(0, 80) };
}

export async function recordPublisherHealth(env, observations, now = Date.now()) {
  const by = new Map();
  for (const o of observations) {
    if (!o?.host) continue;
    const x = by.get(o.host) || { tries: 0, fetched: 0, dated: 0, reason: null };
    x.tries++; if (o.fetched) x.fetched++; if (o.dated) x.dated++; if (o.reason) x.reason = o.reason;
    by.set(o.host, x);
  }
  if (!by.size) return 0;
  await ensurePublisherHealth(env.DB);
  const stmts = [...by].slice(0, 500).map(([host, x]) => env.DB.prepare(`INSERT INTO publisher_health(host,tries,fetched,dated,last_reason,updated_ts) VALUES (?,?,?,?,?,?)
    ON CONFLICT(host) DO UPDATE SET tries=tries*${DECAY}+excluded.tries, fetched=fetched*${DECAY}+excluded.fetched, dated=dated*${DECAY}+excluded.dated,
      last_reason=COALESCE(excluded.last_reason,last_reason), updated_ts=excluded.updated_ts`).bind(host, x.tries, x.fetched, x.dated, x.reason, now));
  for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
  return stmts.length;
}

export async function loadPublisherHealth(env, minTries = 2) {
  try {
    await ensurePublisherHealth(env.DB);
    const { results } = await env.DB.prepare('SELECT host,tries,fetched,dated,updated_ts FROM publisher_health WHERE tries>=? ORDER BY tries DESC LIMIT 5000').bind(minTries).all();
    return new Map(results.map(r => [r.host, r]));
  } catch { return new Map(); }
}

// A publisher whose pages have repeatedly not yielded a dated report. Re-probed once its record is a day old.
export function isFailingPublisher(row, now = Date.now()) {
  if (!row) return false;
  const tries = Number(row.tries) || 0, dated = Number(row.dated) || 0;
  if (tries < HEALTH_MIN_TRIES || dated >= HEALTH_FAIL_SHARE * tries) return false;
  return !(Number(row.updated_ts) > 0) || now - Number(row.updated_ts) < HEALTH_REPROBE_MS;
}

// Smoothed share of reads that gave a dated report (unknown publishers sit at 0.5).
export function datedShare(row) {
  return ((Number(row?.dated) || 0) + 1) / ((Number(row?.tries) || 0) + 2);
}

// Compact form for the collector: {host: [tries, dated, updated_ts]}.
export function healthForCollector(map) {
  return Object.fromEntries([...map].map(([h, r]) => [h, [Math.round(r.tries * 10) / 10, Math.round(r.dated * 10) / 10, r.updated_ts || 0]]));
}
export function healthFromCollector(obj) {
  const out = new Map();
  for (const [h, v] of Object.entries(obj || {})) if (Array.isArray(v) && typeof h === 'string') out.set(h, { tries: +v[0] || 0, dated: +v[1] || 0, updated_ts: +v[2] || 0 });
  return out;
}

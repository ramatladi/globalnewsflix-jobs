// GitHub Actions ingestion runner: collects trending headlines (Google News / Bing) from GitHub's network,
// resolves publisher pages for facts, and sends candidates to the Worker. Auth = GitHub OIDC (no stored secret).
import { readFileSync, writeFileSync } from 'node:fs';
import { makeSiteFetch } from './site-fetch.mjs';
import { collectTarget, enrichMulti, publisherHost } from './news-collect.js';
import { createResolver, loadCache, dumpCache, languageWeight, targetWeight, resolveShare, enrichTop, upcomingPicks, UPCOMING_RESOLVE_TOP, sectionPicks, SECTION_RESOLVE_TOP } from './ingest-resolve.js';
import { sectionForVisit } from './section-search.js';
import { healthFromCollector, isFailingPublisher, datedShare } from './publisher-health.js';
import { newsLang } from './data.js';

const SITE = process.env.SITE || 'https://globalnewsflix.com';
const USER_AGENT = 'GlobalNewsflix-Ingest-Runner/1.0 (+https://globalnewsflix.com)';
const N = Number(process.env.TARGETS_PER_RUN || 25);
const ENRICH_TOP = Number(process.env.ENRICH_TOP ?? 14);
const ENRICH_TIMEOUT_MS = Number(process.env.ENRICH_TIMEOUT_MS || 10000);
// This pass's share of the job's time (the workflow runs several passes before its deadline). Enrichment stops a minute
// before the pass ends so the upload always happens; rows past that point are sent without publisher facts.
const STARTED = Date.now();
const DEADLINE = Number(process.env.INGEST_DEADLINE) || 0;
const PASSES_LEFT = Math.max(1, Number(process.env.PASSES || 1) - Math.max(0, Number(process.env.PASS || 1) - 1));
const PASS_END = DEADLINE > STARTED ? STARTED + (DEADLINE - STARTED) / PASSES_LEFT : STARTED + Number(process.env.ENRICH_BUDGET_MS || 360000);
const enrichOpen = () => Date.now() < PASS_END - 60000;
// Google News links are resolved to publisher URLs here (GitHub's network), within a per-run cap and time budget.
const RESOLVE_TOP = Number(process.env.RESOLVE_TOP ?? 16);
const RESOLVE_CACHE = process.env.RESOLVE_CACHE || '';
let resolveCache = new Map();
if (RESOLVE_CACHE) { try { resolveCache = loadCache(readFileSync(RESOLVE_CACHE, 'utf8')); } catch { /* first run */ } }
const resolver = createResolver({
  max: Number(process.env.RESOLVE_MAX ?? 300), budgetMs: Number(process.env.RESOLVE_BUDGET_MS ?? 180000),
  concurrency: Number(process.env.RESOLVE_CONCURRENCY ?? 3), cache: resolveCache,
});

async function oidc() {
  const u = process.env.ACTIONS_ID_TOKEN_REQUEST_URL, t = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!u || !t) throw new Error('OIDC not available (needs permissions: id-token: write)');
  const assertionUrl = new URL(u);
  assertionUrl.searchParams.set('audience', 'globalnewsflix');
  const r = await fetch(assertionUrl, { headers: { authorization: `Bearer ${t}` } });
  if (!r.ok) throw new Error(`OIDC request failed (${r.status})`);
  const value = (await r.json()).value;
  if (typeof value !== 'string' || !value) throw new Error('OIDC token missing');
  return value;
}

const auth = async () => ({ authorization: `Bearer ${await oidc()}` });

const sleep = ms => new Promise(r => setTimeout(r, ms));

const siteFetch = makeSiteFetch({ auth, userAgent: USER_AGENT });

async function pool(items, size, fn) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: size }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]).catch(e => ({ error: e.message })); } }));
  return out;
}

const targetResponse = await siteFetch(`${SITE}/api/ingest/targets?n=${N}`, {}, 'ingest targets');
if (targetResponse.status === 503) {
  const body = await targetResponse.json().catch(() => null);
  if (body?.code === 'news_ingestion_paused') {
    console.log('news ingestion paused');
    process.exit(0);
  }
}
if (!targetResponse.ok) throw new Error(`ingest targets: HTTP ${targetResponse.status}`);
const targets = await targetResponse.json();
if (!Array.isArray(targets)) throw new Error('ingest targets: invalid response');
// The world and celebrity desks first (as the site lists them), then the editions furthest from a full day, so the
// pass deadline never cuts their publisher reads (stable for ties).
const desk = t => t?.target === 'WORLD' || t?.target === 'CELEB' ? 1 : 0;
targets.sort((a, b) => desk(b) - desk(a) || (Number(b?.need) || 0) - (Number(a?.need) || 0));
console.log('targets', targets.map(t => t.target).join(' '));
if (!targets.length) process.exit(0);

// Publisher read/date success so far (optional: collection works without it).
let health = new Map();
try {
  const h = await fetch(`${SITE}/api/ingest/publishers`, { headers: { ...await auth(), 'user-agent': USER_AGENT } });
  if (h.ok) health = healthFromCollector((await h.json())?.hosts);
} catch { /* collect without publisher history */ }
const hostOf = row => publisherHost(/news\.google\.com/.test(row.gn_link || '') ? row.source_home || '' : row.gn_link || '');
const failing = host => !!host && isFailingPublisher(health.get(host));
// Trend score weighted by how often the publisher's pages could be read and dated, and by whether the feed returns the
// edition's own language (only those reports can ground an edition's story).
const rankFor = lang => row => (row.score || 0) * (0.5 + datedShare(health.get(hostOf(row)))) * languageWeight(row.fl, lang);
const pages = { enriched: 0, enrichedInLanguage: 0, skippedFailing: 0, enrichStopped: 0 };
// Editions furthest from a full day get a larger share of the run's Google lookups (the site sends each target's need).
const weights = targets.map(t => targetWeight(t.need));

const rows = [], errors = [];
for (const [k, t] of targets.entries()) {
  // The site names the edition's sections with too few stories of their own; one is searched on this visit.
  const sections = Array.isArray(t.sections) ? t.sections : [];
  const visit = t.target === 'WORLD' || t.target === 'CELEB' || t.target === 'SOCIAL' ? '' : sectionForVisit(sections, t.rot);
  let { rows: collected, errors: e } = await collectTarget(t.target, t.rot, { sections });
  errors.push(...e);
  const lang = newsLang(t.target === 'WORLD' || t.target === 'CELEB' || t.target === 'SOCIAL' ? 'WW' : t.target);
  const rank = rankFor(lang);
  // Each target gets its weighted share of the run's remaining Google lookups, so early targets cannot use them all.
  const share = resolveShare(resolver.remaining, weights, k);
  // Its best Coming Up reports first, from the same share (one lookup each, no further reports of the cluster).
  const upcoming = collected.filter(row => row.section === 'upcoming');
  let upShare = 0;
  if (RESOLVE_TOP > 0 && upcoming.length) {
    upShare = Math.min(UPCOMING_RESOLVE_TOP, share);
    const kept = new Set(await resolver.resolveRows(upcoming, { top: UPCOMING_RESOLVE_TOP, clusterLinks: 0, maxRequests: upShare, rank, skip: row => failing(hostOf(row)) }));
    collected = collected.filter(row => row.section !== 'upcoming' || kept.has(row));
  }
  // Then the best reports of the section searched on this visit, from what is left of the share.
  const sectionRows = visit ? collected.filter(row => row.section === visit) : [];
  let secShare = 0;
  if (RESOLVE_TOP > 0 && sectionRows.length) {
    secShare = Math.min(SECTION_RESOLVE_TOP, Math.max(0, share - upShare));
    const kept = new Set(await resolver.resolveRows(sectionRows, { top: SECTION_RESOLVE_TOP, clusterLinks: 0, maxRequests: secShare, rank, skip: row => failing(hostOf(row)) }));
    collected = collected.filter(row => row.section !== visit || kept.has(row));
  }
  const r = RESOLVE_TOP > 0 ? await resolver.resolveRows(collected, { top: RESOLVE_TOP, maxRequests: Math.max(0, share - upShare - secShare), rank, skip: row => failing(hostOf(row)) }) : collected;
  // Enrich the strongest stories with a publisher URL (description, image, excerpt, publication date). Publishers that
  // keep failing are not requested; further reports' Google links use the same budgeted resolver.
  const more = { left: 4 };
  const opts = { resolve: link => resolver.resolve(link, more), timeoutMs: ENRICH_TIMEOUT_MS, retries: 1, lang, skipHost: failing };
  // An edition with a full day in hand gets a few reads; the rest of the pass's time goes to editions in need.
  const main = r.filter(row => !/news\.google\.com/.test(row.gn_link || '') && !failing(hostOf(row))).sort((a, b) => rank(b) - rank(a)).slice(0, enrichTop(t.need, ENRICH_TOP));
  // Plus the target's best Coming Up reports, whose pages the writer needs as much as any other report's.
  const withUpcoming = [...main, ...upcomingPicks(r, main, rank, { skip: row => failing(hostOf(row)) })];
  // And the visit's section reports, likewise.
  const pick = [...withUpcoming, ...sectionPicks(r, withUpcoming, rank, visit, { skip: row => failing(hostOf(row)) })];
  pages.skippedFailing += r.filter(row => failing(hostOf(row))).length;
  if (enrichOpen()) {
    await pool(pick, 6, async row => { if (!enrichOpen()) { pages.enrichStopped++; return; } row.facts = JSON.stringify(await enrichMulti(row, 4, opts)); pages.enriched++; if (!row.fl || row.fl === lang) pages.enrichedInLanguage++; });
  } else pages.enrichStopped += pick.length;
  rows.push(...r);
  console.log(t.target, r.length, 'items', e.length ? e : '');
  await sleep(400);
}
console.log('publisher pages', JSON.stringify(pages), 'known publishers', health.size);

const { reasons, ...counts } = resolver.stats;
console.log('google news links', JSON.stringify(counts), resolver.stopped ? `stopped: ${resolver.stopped}` : '', Object.keys(reasons).length ? JSON.stringify(reasons) : '');
// One summary line per pass as a workflow annotation (counts only: no titles, URLs or provider text).
console.log(`::notice title=Collector pass ${Number(process.env.PASS) || 1}::${JSON.stringify({ targets: targets.length, rows: rows.length,
  needy: targets.filter(t => Number(t.need) >= 6).length, google: counts, stopped: resolver.stopped ? String(resolver.stopped).slice(0, 40) : null, pages })}`);
if (RESOLVE_CACHE) { try { writeFileSync(RESOLVE_CACHE, dumpCache(resolveCache)); } catch { /* cache is optional */ } }

let uploadFailed = false;
for (let i = 0; i < rows.length; i += 400) {
  const batch = i / 400 + 1;
  try {
    const res = await siteFetch(`${SITE}/api/ingest`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rows: rows.slice(i, i + 400), errors: errors.slice(0, 15) }) }, `ingest batch ${batch}`);
    if (!res.ok) {
      console.error(`ingest batch ${batch}: HTTP ${res.status}`);
      uploadFailed = true;
    } else console.log(`stored batch ${batch}: HTTP ${res.status}`);
  } catch {
    console.error(`ingest batch ${batch}: request failed`);
    uploadFailed = true;
  }
}
if (!rows.length) { console.error('No rows collected', errors.slice(0, 10)); process.exitCode = 1; }
if (uploadFailed) process.exitCode = 1;

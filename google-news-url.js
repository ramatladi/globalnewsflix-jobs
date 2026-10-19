// Resolve Google News RSS article links (news.google.com/rss/articles/<id>) to the publisher's article URL.
// Pure module (fetch is injectable) so it runs in the Worker and on GitHub Actions.
//
// Two id formats exist:
//  - older ids: base64url protobuf whose string field carries the publisher URL itself (decoded offline);
//  - newer ids ("AU_yqL..." inside the protobuf): need the article page's signature (data-n-a-sg) and
//    timestamp (data-n-a-ts), then a "garturlreq" call to /_/DotsSplashUi/data/batchexecute.

const GOOGLE_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';
// Pre-accepts Google's EU consent interstitial, which otherwise replaces the article page.
const CONSENT_COOKIE = 'CONSENT=YES+cb; SOCS=CAI';
const HTTP_URL = /^https?:\/\/[^\s"'<>]+$/i;

export function isGoogleNewsUrl(link) {
  try { return /(^|\.)news\.google\.com$/i.test(new URL(link).hostname); } catch { return false; }
}

export function googleNewsArticleId(link) {
  try {
    const u = new URL(link);
    if (!/(^|\.)news\.google\.com$/i.test(u.hostname)) return null;
    const m = u.pathname.match(/\/(?:rss\/)?(?:articles|read)\/([A-Za-z0-9_-]+)/);
    return m ? m[1] : null;
  } catch { return null; }
}

function base64UrlBytes(id) {
  let s = String(id).replace(/-/g, '+').replace(/_/g, '/');
  s += '='.repeat((4 - s.length % 4) % 4);
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function varint(bytes, pos) {
  let value = 0, shift = 0;
  while (pos < bytes.length && shift < 35) {
    const b = bytes[pos++];
    value += (b & 0x7f) * 2 ** shift;
    if (!(b & 0x80)) return [value, pos];
    shift += 7;
  }
  throw new Error('bad varint');
}

const latin1 = bytes => Array.from(bytes, b => String.fromCharCode(b)).join('');
const utf8 = bytes => { try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return latin1(bytes); } };

// Top-level length-delimited protobuf fields, in order.
function protobufStrings(bytes) {
  const out = [];
  let pos = 0;
  while (pos < bytes.length) {
    let key; [key, pos] = varint(bytes, pos);
    const wire = key & 7;
    if (wire === 0) [, pos] = varint(bytes, pos);
    else if (wire === 1) pos += 8;
    else if (wire === 5) pos += 4;
    else if (wire === 2) {
      let len; [len, pos] = varint(bytes, pos);
      if (pos + len > bytes.length) { out.push(bytes.subarray(pos)); break; }
      out.push(bytes.subarray(pos, pos + len));
      pos += len;
    } else break;
  }
  return out;
}

// Older ids embed the publisher URL; returns it without any network call, or null (newer "AU_yqL" ids).
export function decodeGoogleNewsIdOffline(id) {
  let bytes;
  try { bytes = base64UrlBytes(id); } catch { return null; }
  try {
    for (const field of protobufStrings(bytes)) {
      const s = utf8(field);
      if (/^AU_yqL/.test(s)) return null;
      if (HTTP_URL.test(s)) return s;
    }
  } catch { /* malformed protobuf: fall through to a scan */ }
  const text = latin1(bytes);
  if (text.includes('AU_yqL')) return null;
  const m = text.match(/https?:\/\/[\x21-\x7e]+/);
  return m ? m[0] : null;
}

const attr = (tag, name) => {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i'));
  return m ? (m[1] ?? m[2]).replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&#61;|&#x3d;/gi, '=') : null;
};

// Signature and timestamp from the Google News article page (on a c-wiz or div element).
export function parseArticleParams(html) {
  const page = String(html || '');
  for (const m of page.matchAll(/<[a-z][a-z0-9-]*\b[^>]*\sdata-n-a-sg\s*=[^>]*>/gi)) {
    const sg = attr(m[0], 'data-n-a-sg'), ts = attr(m[0], 'data-n-a-ts');
    if (sg && ts && /^\d+$/.test(ts)) return { signature: sg, timestamp: Number(ts) };
  }
  // Attributes split across elements: take the first of each.
  const sg = page.match(/data-n-a-sg\s*=\s*["']([^"']+)["']/i)?.[1];
  const ts = page.match(/data-n-a-ts\s*=\s*["'](\d+)["']/i)?.[1];
  return sg && ts ? { signature: sg, timestamp: Number(ts) } : null;
}

export function isConsentPage(html, finalUrl = '') {
  return /consent\.google\./i.test(finalUrl) ||
    /<form[^>]+action=["']https:\/\/consent\.google\.[^"']*["']|Before you continue to Google/i.test(String(html || '').slice(0, 200000));
}

export function batchexecuteBody(id, timestamp, signature) {
  const inner = JSON.stringify(['garturlreq', [['X', 'X', ['X', 'X'], null, null, 1, 1, 'US:en', null, 1, null, null, null, null, null, 0, 1], 'X', 'X', 1, [1, 1, 1], 1, 1, null, 0, 0, null, 0], id, timestamp, signature]);
  return 'f.req=' + encodeURIComponent(JSON.stringify([[['Fbv4je', inner, null, 'generic']]]));
}

function findGarturlres(node, depth = 0) {
  if (depth > 6 || node == null) return null;
  if (typeof node === 'string') {
    if (!node.includes('garturlres')) return null;
    try { return findGarturlres(JSON.parse(node), depth + 1); } catch { return null; }
  }
  if (Array.isArray(node)) {
    if (node[0] === 'garturlres' && typeof node[1] === 'string') return node[1];
    for (const x of node) { const r = findGarturlres(x, depth + 1); if (r) return r; }
  }
  return null;
}

// The publisher URL from a batchexecute response: )]}' prefix, then JSON envelopes (optionally with
// chunk-length lines) like [["wrb.fr","Fbv4je","[\"garturlres\",\"<url>\",1]",null,null,null,"generic"],...].
export function parseBatchexecuteResponse(text) {
  const body = String(text || '').replace(/^\)\]\}'\s*/, '');
  const chunks = [];
  try { chunks.push(JSON.parse(body)); } catch {
    for (const line of body.split('\n')) {
      const t = line.trim();
      if (!t.startsWith('[')) continue;
      try { chunks.push(JSON.parse(t)); } catch { /* not a JSON line */ }
    }
  }
  for (const c of chunks) {
    const url = findGarturlres(c);
    if (url && HTTP_URL.test(url)) return url;
  }
  const m = body.match(/garturlres\\+",\\+"(https?:[^"\\]+)/);
  return m && HTTP_URL.test(m[1]) ? m[1] : null;
}

async function timedFetch(fetchImpl, url, opts, ms) {
  return fetchImpl(url, { ...opts, redirect: 'follow', signal: AbortSignal.timeout(ms) });
}

// Resolve one Google News link. Never throws: returns { url, method } or { url: null, reason }.
export async function resolveGoogleNewsUrl(link, { fetch: fetchImpl = globalThis.fetch, timeoutMs = 6000, userAgent = GOOGLE_UA } = {}) {
  if (!isGoogleNewsUrl(link)) return /^https?:\/\//i.test(String(link || '')) ? { url: link, method: 'direct' } : { url: null, reason: 'not a URL' };
  const id = googleNewsArticleId(link);
  if (!id) return { url: null, reason: 'no article id in Google News link' };
  const offline = decodeGoogleNewsIdOffline(id);
  if (offline) return { url: offline, method: 'offline' };
  const headers = { 'user-agent': userAgent, 'accept-language': 'en-US,en;q=0.9', cookie: CONSENT_COOKIE };
  let params = null, lastReason = 'article page unavailable';
  for (const page of [`https://news.google.com/articles/${id}`, `https://news.google.com/rss/articles/${id}`]) {
    try {
      const r = await timedFetch(fetchImpl, page, { headers: { ...headers, accept: 'text/html' } }, timeoutMs);
      const html = await r.text();
      if (isConsentPage(html, r.url)) { lastReason = 'consent page'; continue; }
      if (!r.ok) { lastReason = `article page HTTP ${r.status}`; continue; }
      params = parseArticleParams(html);
      if (params) break;
      lastReason = 'article page without signature (data-n-a-sg/ts)';
    } catch (e) { lastReason = `article page ${e?.name === 'TimeoutError' ? 'timeout' : 'fetch failed'}`; }
  }
  if (!params) return { url: null, reason: lastReason };
  try {
    const r = await timedFetch(fetchImpl, 'https://news.google.com/_/DotsSplashUi/data/batchexecute', {
      method: 'POST', body: batchexecuteBody(id, params.timestamp, params.signature),
      headers: { ...headers, 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8', referer: 'https://news.google.com/' },
    }, timeoutMs);
    const text = await r.text();
    if (isConsentPage(text, r.url)) return { url: null, reason: 'batchexecute consent page' };
    if (!r.ok) return { url: null, reason: `batchexecute HTTP ${r.status}` };
    const url = parseBatchexecuteResponse(text);
    return url ? { url, method: 'batchexecute' } : { url: null, reason: 'batchexecute response without garturlres URL' };
  } catch (e) { return { url: null, reason: `batchexecute ${e?.name === 'TimeoutError' ? 'timeout' : 'fetch failed'}` }; }
}

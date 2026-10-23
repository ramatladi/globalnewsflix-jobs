// Scheduled Tenders collector (.github/workflows/tenders.yml in the public collector repository). GitHub OIDC is
// short-lived and the site accepts it only from that repository's main tenders workflow. Each run reads every
// source, uploads the open notices and tells the site which sources were read completely (their closed or
// withdrawn notices are then removed). The first run of the day (and a manual run) also reads the EU and EEA public
// sector's notices from TED, some 40,000.
import { writeFile, rename } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { collectTenders } from './tenders-collect.js';

const SITE = 'https://globalnewsflix.com';
// Notices with summaries in several languages are large: 250 a request keeps each well under the site's 2 MB limit.
export const TENDER_ROWS_PER_UPLOAD = 250;
export const UPLOAD_ATTEMPTS = 4;
const pause = ms => new Promise(r => setTimeout(r, ms));
export const fullRun = (runTs, env = process.env) => env.TENDERS_FULL === '1' || new Date(runTs).getUTCHours() < 6;

// One request to the site, tried again after a refusal for too many requests (as long as it asks) or a server error.
export async function postWithRetry(send, { wait = pause, log = () => {} } = {}) {
  let last = null;
  for (let attempt = 1; attempt <= UPLOAD_ATTEMPTS; attempt++) {
    try {
      const r = await send();
      if (r.status !== 429 && r.status < 500) return r;
      last = r;
      if (attempt === UPLOAD_ATTEMPTS) return r;
      const after = Number(r.headers?.get?.('retry-after'));
      const ms = r.status === 429 && Number.isFinite(after) && after > 0 ? Math.min(after, 75) * 1000 : 15000 * attempt;
      log(`tenders upload: ${r.status}, trying again in ${Math.round(ms / 1000)}s`);
      await wait(ms);
    } catch (error) {
      if (attempt === UPLOAD_ATTEMPTS) throw error;
      log('tenders upload: connection failed, trying again');
      await wait(15000 * attempt);
    }
  }
  return last;
}

export async function uploadTenders({ rows, diagnostics, complete, runTs, post, log = console.log }) {
  const failed = new Set();
  for (let i = 0; i < rows.length; i += TENDER_ROWS_PER_UPLOAD) {
    const chunk = rows.slice(i, i + TENDER_ROWS_PER_UPLOAD);
    const out = await post('/api/tenders', { runTs, rows: chunk }).catch(() => null);
    const refused = new Set(Array.isArray(out?.rejected) ? out.rejected : []);
    const ok = out?.ok === true && out.n + refused.size === chunk.length;
    log(`tenders upload: accepted ${ok ? out.n : 0}/${chunk.length}${refused.size ? `, ${refused.size} refused` : ''}${out?.why ? ' (' + out.why + ')' : ''}`);
    // A failed request keeps the source's stored notices: it is not pruned this run.
    if (!ok) for (const r of chunk) failed.add(r.src);
  }
  const sources = complete.filter(s => !failed.has(s));
  const fin = await post('/api/tenders/finish', { runTs, sources, diagnostics: diagnostics.map(d => failed.has(d.src) ? { ...d, status: 'failed', reason: 'upload-failed' } : d) }).catch(() => null);
  log(`tenders finish: ${fin?.ok === true ? `ok, ${fin.removed ?? 0} closed or withdrawn removed` : 'failed'}`);
  return { ok: fin?.ok === true && failed.size === 0, failed: [...failed], finish: fin };
}

async function main() {
  const dryRun = process.env.TENDERS_DRY_RUN === '1';
  const u = process.env.ACTIONS_ID_TOKEN_REQUEST_URL, t = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!dryRun && (!u || !t)) throw new Error('OIDC unavailable (id-token: write required)');
  let token = null, tokenAt = 0;
  const getToken = async () => {
    if (token && Date.now() - tokenAt < 4 * 60000) return token;
    const r = await fetch(`${u}&audience=globalnewsflix`, { headers: { authorization: `Bearer ${t}` } });
    if (!r.ok) throw new Error('OIDC request failed');
    token = (await r.json()).value; tokenAt = Date.now();
    if (!token) throw new Error('OIDC token missing');
    return token;
  };
  const post = async (path, body) => {
    const r = await postWithRetry(async () => fetch(SITE + path, { method: 'POST', headers: { authorization: `Bearer ${await getToken()}`, 'content-type': 'application/json', 'user-agent': 'GlobalNewsflixTenders/1.0' }, body: JSON.stringify(body) }), { log: console.log });
    return r.json().catch(() => ({ ok: false, status: r.status }));
  };
  const runTs = Date.now();
  if (!dryRun) {
    const pre = await post('/api/tenders', { runTs, rows: [] });
    console.log(`tenders preflight: ${pre?.ok === true && pre.n === 0}`);
    if (pre?.ok !== true) throw new Error('Tenders upload preflight failed');
  }
  const full = fullRun(runTs);
  console.log(`tenders: ${full ? 'full run (with the EU and EEA public sector)' : 'regular run'}`);
  const data = await collectTenders(fetch, { now: runTs, full, log: console.log });
  const report = { runTs, rows: data.rows.length, diagnostics: data.diagnostics, ...(dryRun ? { sample: data.rows.slice(0, 20) } : {}) };
  await writeFile('tenders-report.json.tmp', JSON.stringify(report, null, 1)); await rename('tenders-report.json.tmp', 'tenders-report.json');
  console.log(`tenders: ${data.rows.length} open notices; complete: ${data.complete.join(',') || 'none'}`);
  if (dryRun) return;
  const result = await uploadTenders({ ...data, runTs, post });
  for (const d of data.diagnostics.filter(d => d.status !== 'complete')) console.log(`::notice title=Tenders source::${d.src} ${d.status} ${d.reason}`);
  if (!result.ok) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();

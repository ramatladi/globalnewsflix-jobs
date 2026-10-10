// Scheduled collector. GitHub OIDC is short-lived and scoped by the site to this workflow.
import { collectJobs, normalizeCollectedJob, fxRates, SOURCES } from './jobs.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function uploadJobs({ rows, ok, diagnostics = [], runTs, site, getToken, fetchImpl = fetch, log = console.log }) {
  const failed = new Set();
  const tokenHeaders = async () => ({ authorization: `Bearer ${await getToken()}`, 'content-type': 'application/json' });
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    let acknowledged = false;
    try {
      const r = await fetchImpl(`${site}/api/jobs`, { method: 'POST', headers: await tokenHeaders(), body: JSON.stringify({ runTs, rows: chunk }) });
      const out = await r.json().catch(() => ({}));
      acknowledged = r.ok && out.ok === true && out.n === chunk.length;
      log(`jobs upload: ${r.status}, accepted ${Number.isInteger(out.n) ? out.n : 0}/${chunk.length}`);
    } catch { log('jobs upload: failed'); }
    if (!acknowledged) chunk.forEach(x => failed.add(x.src));
  }
  const sources = ok.filter(s => !failed.has(s));
  const reported = diagnostics.map(d => failed.has(d.src) ? {...d,status:'failed',reason:'upload-failed',acceptedCount:0} : d);
  let finished = false;
  try {
    const r = await fetchImpl(`${site}/api/jobs/finish`, { method: 'POST', headers: await tokenHeaders(), body: JSON.stringify({ runTs, sources, diagnostics: reported }) });
    const out = await r.json().catch(() => ({}));
    finished = r.ok && out.ok === true;
    log(`jobs finish: ${r.status}, acknowledged ${finished}`);
  } catch { log('jobs finish: failed'); }
  return { ok: finished && failed.size === 0, failedSources: [...failed], completedSources: sources };
}

export async function governmentJobs(fetchImpl = fetch, log = console.log) {
  const directory = await mkdtemp(join(tmpdir(), 'gnf-jobs-'));
  const output = join(directory, 'government.json');
  const attemptedAt = Date.now();
  try {
    await promisify(execFile)(process.env.PYTHON || 'python3', ['jobs-government.py', '--output', output], { timeout: 600000, maxBuffer: 1000000 });
    const raw = JSON.parse(await readFile(output, 'utf8'));
    const src = SOURCES.find(s => s.id === 'za-dpsa');
    const fx = await fxRates(fetchImpl);
    const rows = raw.rows.map(r => normalizeCollectedJob(src,r,fx)).filter(Boolean);
    log(`South African public service: ${rows.length} dated vacancies from ${raw.diagnostics.employers} department/province labels`);
    return { rows, diagnostic: { src:src.id,status:'partial',reason:'dated-circular',rawCount:raw.rows.length,acceptedCount:rows.length,attemptedAt } };
  } catch {
    log('South African public service: source or parser unavailable; previous dated jobs retained');
    return { rows:[], diagnostic:{src:'za-dpsa',status:'failed',reason:'source-unavailable',rawCount:0,acceptedCount:0,attemptedAt} };
  } finally { await rm(directory,{recursive:true,force:true}); }
}

async function main() {
  const site = process.env.SITE || 'https://globalnewsflix.com';
  if (site !== 'https://globalnewsflix.com') throw new Error('Unexpected destination');
  const u = process.env.ACTIONS_ID_TOKEN_REQUEST_URL, t = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  const dryRun = process.env.JOBS_DRY_RUN === '1';
  if (!dryRun && (!u || !t)) throw new Error('OIDC unavailable (id-token: write required)');
  const getToken = async () => {
    const r = await fetch(`${u}&audience=globalnewsflix`, { headers: { authorization: `Bearer ${t}` } });
    if (!r.ok) throw new Error('OIDC request failed');
    const value = (await r.json()).value;
    if (!value) throw new Error('OIDC token missing');
    const claims = JSON.parse(Buffer.from(value.split('.')[1], 'base64url').toString());
    console.log('jobs identity:', JSON.stringify(Object.fromEntries(['repository','ref','sub','workflow_ref','job_workflow_ref','event_name','aud','nbf','exp'].filter(k=>claims[k]!==undefined).map(k=>[k,claims[k]]))));
    return value;
  };
  const runTs = Date.now();
  const only = process.env.JOB_SOURCES ? process.env.JOB_SOURCES.split(',').map(s=>s.trim()).filter(Boolean) : null;
  if (only?.some(id=>!SOURCES.some(s=>s.id===id))) throw new Error('Unregistered source selection');
  if (!dryRun) {
    const preflight = await fetch(`${site}/api/jobs`, { method:'POST', headers:{authorization:`Bearer ${await getToken()}`,'content-type':'application/json'}, body:JSON.stringify({runTs,rows:[]}) });
    const check = await preflight.json().catch(()=>({}));
    console.log(`jobs preflight: ${preflight.status}, acknowledged ${check.ok===true && check.n===0}`);
    if (!preflight.ok || check.ok!==true || check.n!==0) throw new Error('Jobs upload preflight failed');
  }
  const data = await collectJobs(fetch,console.log,only);
  if (!only || only.includes('za-dpsa')) {
    const gov = await governmentJobs();
    data.rows.push(...gov.rows);
    data.diagnostics = data.diagnostics.filter(d=>d.src!=='za-dpsa').concat(gov.diagnostic);
  }
  console.log(`jobs: ${data.rows.length} from ${new Set(data.rows.map(r=>r.src)).size} sources; ${data.ok.length} complete snapshots`);
  if (dryRun) {
    await (await import('node:fs/promises')).writeFile('jobs-collection-report.json', JSON.stringify({runTs,...data},null,2));
    if (!data.diagnostics.some(d=>d.status!=='failed')) process.exitCode=1;
    return;
  }
  const result = await uploadJobs({...data,runTs,site,getToken});
  if (!result.ok || !data.diagnostics.some(d=>d.status!=='failed')) process.exitCode=1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();

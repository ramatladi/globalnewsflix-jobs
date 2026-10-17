import { workdayDetailSummaries } from './jobs-request-policy.js';
// Scheduled collector. GitHub OIDC is short-lived and scoped by the site to this workflow.
import { createPlatformPacer } from './jobs-pacing.js';
import { automaticTransport, loadDiscoveredManifest } from './jobs-discovered-fetch.mjs';
import { registeredDiscoveredSources } from './jobs-discovered-sources.js';
import { collectJobs, SOURCES } from './jobs.js';
import { writeFile, rename } from 'node:fs/promises';
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
  let finished = false, pruneBlocked = [];
  try {
    const r = await fetchImpl(`${site}/api/jobs/finish`, { method: 'POST', headers: await tokenHeaders(), body: JSON.stringify({ runTs, sources, diagnostics: reported }) });
    const out = await r.json().catch(() => ({}));
    finished = r.ok && out.ok === true;
    // The site's prune breaker (too many of a source's rows would disappear at once) answers 409 with the
    // sources it refused to prune. Their rows and every report were still stored, so this is a warning.
    const blocked = Array.isArray(out.blockedSources) ? out.blockedSources : null;
    if (!finished && r.status === 409 && out.ok === false && blocked?.length && blocked.every(s => typeof s === 'string' && sources.includes(s))) {
      pruneBlocked = [...new Set(blocked)];
      finished = true;
    }
    log(`jobs finish: ${r.status}, acknowledged ${finished}${pruneBlocked.length ? `, prune held for ${pruneBlocked.join(',')}` : ''}`);
  } catch { log('jobs finish: failed'); }
  return { ok: finished && failed.size === 0, failedSources: [...failed], completedSources: sources, pruneBlocked };
}

// Exit decision: expected partial results (unverified totals, capped pages, a held prune, a few unreachable
// sources) are warnings; a rejected upload, a rejected finish or a run where nothing worked fails.
export function jobsRunVerdict({ dryRun = false, result = null, diagnostics = [] }) {
  const failures = [], warnings = [];
  if (!dryRun && result?.ok !== true) failures.push(result?.failedSources?.length ? `upload not acknowledged for ${result.failedSources.length} sources` : 'finish not acknowledged');
  if (!diagnostics.some(d => d.status !== 'failed')) failures.push('no source produced a usable snapshot');
  if (result?.pruneBlocked?.length) warnings.push(`prune held by the site breaker for ${result.pruneBlocked.join(',')}`);
  const counts = {};
  for (const d of diagnostics) if (d.status !== 'complete') { const k = `${d.status}:${d.reason || 'unspecified'}`; counts[k] = (counts[k] || 0) + 1; }
  for (const [k, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) warnings.push(`${n} ${k}`);
  return { exitCode: failures.length ? 1 : 0, failures, warnings };
}

// Publishing is reached only after every collection phase and the initial report succeed.
export async function runCollectedJobs({collect,writeReport,publish,dryRun=false,now=()=>performance.now(),log=console.log}) {
  const data=await collect();
  await writeReport(data,{uploadElapsedMs:null});
  if(dryRun)return {data,result:null};
  const started=now();
  const result=await publish(data);
  const uploadElapsedMs=Math.max(0,Math.ceil(now()-started));
  log('jobs upload telemetry:',JSON.stringify({uploadElapsedMs,ok:result.ok===true}));
  await writeReport(data,{uploadElapsedMs,uploadAcknowledged:result.ok===true});
  return {data,result};
}

async function main() {
  const site = process.env.SITE || 'https://globalnewsflix.com';
  if (site !== 'https://globalnewsflix.com') throw new Error('Unexpected destination');
  const u = process.env.ACTIONS_ID_TOKEN_REQUEST_URL, t = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  const dryRun = process.env.JOBS_DRY_RUN === '1';
  if (!dryRun && (!u || !t)) throw new Error('OIDC unavailable (id-token: write required)');
  // Only public, non-secret claims are printed (never the token). The first identity is also
  // an annotation, so the signed subject the site checks is visible without reading logs.
  let identity = null;
  const getToken = async () => {
    const r = await fetch(`${u}&audience=globalnewsflix`, { headers: { authorization: `Bearer ${t}` } });
    if (!r.ok) throw new Error('OIDC request failed');
    const value = (await r.json()).value;
    if (!value) throw new Error('OIDC token missing');
    const claims = JSON.parse(Buffer.from(value.split('.')[1], 'base64url').toString());
    const first = identity === null;
    identity = JSON.stringify(Object.fromEntries(['repository','repository_id','repository_owner_id','ref','sub','workflow_ref','job_workflow_ref','event_name','aud'].filter(k=>claims[k]!==undefined).map(k=>[k,claims[k]])));
    console.log('jobs identity:', identity);
    if (first) console.log(`::notice title=Jobs identity::${identity}`);
    return value;
  };
  const runTs = Date.now();
  const discovered = registeredDiscoveredSources(await loadDiscoveredManifest());
  const sources = [...new Map([...SOURCES, ...discovered].map(s => [s.id, s])).values()];
  const only = process.env.JOB_SOURCES ? process.env.JOB_SOURCES.split(',').map(s=>s.trim()).filter(Boolean) : null;
  if (only?.some(id=>!sources.some(s=>s.id===id))) throw new Error('Unregistered source selection');
  if (!dryRun) {
    const preflight = await fetch(`${site}/api/jobs`, { method:'POST', headers:{authorization:`Bearer ${await getToken()}`,'content-type':'application/json'}, body:JSON.stringify({runTs,rows:[]}) });
    const check = await preflight.json().catch(()=>({}));
    console.log(`jobs preflight: ${preflight.status}, acknowledged ${check.ok===true && check.n===0}`);
    if (!preflight.ok || check.ok!==true || check.n!==0) {
      console.log(`::error title=Jobs preflight rejected::HTTP ${preflight.status}${typeof check.why==='string'?` (${check.why.slice(0,80)})`:''}; signed identity ${identity}`);
      throw new Error('Jobs upload preflight failed');
    }
  }
  const platformPace=createPlatformPacer(),automaticFetch=automaticTransport({platformPace});
  // Main JavaScript collector duration; government collection is measured separately.
  const collectionStarted=performance.now(),phaseElapsedMs={};
  const pacingSnapshot=()=>({collectionElapsedMs:Math.ceil(performance.now()-collectionStarted),automaticTransport:automaticFetch.diagnostics(),platformPacing:platformPace.diagnostics(),phaseElapsedMs:{...phaseElapsedMs}});
  // Bounded progress survives an Actions timeout even if the final artifact cannot be written.
  const progress=setInterval(()=>console.log('jobs collection telemetry:',JSON.stringify(pacingSnapshot())),60000);progress.unref?.();
  let collectionTelemetry,transport;
  const outcome=await runCollectedJobs({dryRun,collect:async()=>{
  let data;
  try {data=await collectJobs(fetch,console.log,only,{sources,automaticFetch,platformPace,onPhaseEnd:(phase,elapsedMs)=>{phaseElapsedMs[phase]=elapsedMs;}});}
  finally {clearInterval(progress);}
  collectionTelemetry=pacingSnapshot();
  console.log('jobs collection telemetry:',JSON.stringify(collectionTelemetry));
  transport=automaticFetch.diagnostics();
  return data;
  },writeReport:async(data,uploadTelemetry)=>{
  console.log(`jobs: ${data.rows.length} from ${new Set(data.rows.map(r=>r.src)).size} sources; ${data.ok.length} complete snapshots`);
  const report={runTs,...collectionTelemetry,...uploadTelemetry,automaticTransport:transport,diagnostics:data.diagnostics,workdayDetailReasons:workdayDetailSummaries(data.diagnostics),...(dryRun?data:{})};
  const temporary=`jobs-collection-report.${process.pid}.tmp`;
  await writeFile(temporary,JSON.stringify(report,null,2));await rename(temporary,'jobs-collection-report.json');
  },publish:data=>uploadJobs({...data,runTs,site,getToken})});
  const verdict=jobsRunVerdict({dryRun,result:outcome.result,diagnostics:outcome.data.diagnostics});
  for(const w of verdict.warnings)console.log(`::warning title=Jobs partial::${w}`);
  for(const f of verdict.failures)console.log(`::error title=Jobs failed::${f}`);
  if(verdict.exitCode)process.exitCode=verdict.exitCode;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // Name the failure in a check-run annotation (first line only; tokens are never in messages).
  try { await main(); } catch (error) { console.log(`::error title=Jobs failed::${String(error?.message || error).split('\n')[0].slice(0, 200)}`); throw error; }
}

import { automaticSourceRequestLimit } from './jobs-request-policy.js';
// Restricted transport for automatically registered employers only.
import { request } from 'node:https';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { performance } from 'node:perf_hooks';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createPlatformPacer, platformForReader } from './jobs-pacing.js';
import { allowedDiscoveredRequest, validateDiscoveredManifest } from './jobs-discovered-sources.js';
export function publicAddress(a) {
  if (isIP(a) !== 4) return false;
  const [x,y] = a.split('.').map(Number);
  return !(x === 0 || x === 10 || x === 127 || x >= 224 || x === 100 && y >= 64 && y <= 127 || x === 169 && y === 254 || x === 172 && y >= 16 && y <= 31 || x === 192 && [0,168].includes(y) || x === 198 && [18,19,51].includes(y) || x === 203 && y === 0);
}
export function automaticTransport({ resolver = lookup, transport = request, now = () => performance.now(), pause = ms => new Promise(r => setTimeout(r,ms)), maxRequests = 1000, maxSeconds = 300, platformPace } = {}) {
  platformPace ||= createPlatformPacer({now,pause});
  let total = 0, deadline = null, ended = null;
  const timings = new Map();
  const locks = new Map(), counts = new Map(), cooled = new Set(), budgetStopped = new Set(), sourceCapped = new Set();
  const budgetError = source => {budgetStopped.add(source.id);return Object.assign(new Error('Automatic request budget exhausted'),{code:'AUTOMATIC_BUDGET_EXHAUSTED'});};
  const checkBudget = source => {
    if ((counts.get(source.id) || 0) >= automaticSourceRequestLimit(source.id)) {sourceCapped.add(source.id);throw Object.assign(new Error('Automatic source request cap exhausted'),{code:'AUTOMATIC_SOURCE_REQUEST_CAP'});}
    if (now() >= deadline || total >= maxRequests) throw budgetError(source);
  };
  const factory = source => {const perform = async function(value, options = {}) {
    let url = String(value), method = String(options.method || 'GET').toUpperCase();
    if (options.body && (typeof options.body !== 'string' || Buffer.byteLength(options.body) > 10000)) throw new Error('Invalid request body');
    for (let hop = 0; hop < 4; hop++) {
      if (!allowedDiscoveredRequest(source,url,method)) throw new Error('Automatic request outside scope or budget');
      // Manual collectors may run first. Start the shared automatic budget only
      // on its first allowed request; never restart it for another source or hop.
      deadline ??= now() + maxSeconds * 1000;
      if(!timings.has(source.id))timings.set(source.id,{started:now(),ended:now()});
      checkBudget(source);
      const u = new URL(url), host = u.hostname;
      if (cooled.has(host)) throw new Error('Automatic host cooldown');
      const waitStarted=now();
      let release;
      const prior = locks.get(host) || Promise.resolve(); locks.set(host, new Promise(r => { release = r; }));
      await prior;
      try {
        await pause(1000);
        checkBudget(source);
        if (cooled.has(host)) throw new Error('Automatic host cooldown');
        const addresses = await Promise.race([resolver(host,{all:true,family:4}), new Promise((_,reject) => { const t=setTimeout(()=>reject(new Error('DNS timeout')),5000); t.unref?.(); })]);
        if (!addresses.length || addresses.some(a => !publicAddress(a.address))) throw new Error('Non-public destination');
        checkBudget(source);
        const result = await platformPace(url,()=>{
        checkBudget(source);
        total++; counts.set(source.id,(counts.get(source.id) || 0)+1);
        return new Promise((resolve,reject) => {
          const req = transport(u, { method, servername:host, family:4, autoSelectFamily:false, lookup:(_h,o,cb)=>o?.all?cb(null,[{address:addresses[0].address,family:4}]):cb(null,addresses[0].address,4), headers:{'user-agent':'GlobalNewsflix-careers/1.0','accept':'application/json,text/html','content-type':'application/json'} }, res => {
            let size=0; const chunks=[];
            res.on('data',chunk=>{size+=chunk.length;if(size>2000000)req.destroy(new Error('Response too large'));else chunks.push(chunk);});
            res.on('error',reject); res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks)}));
          });
          const timer=setTimeout(()=>req.destroy(now()>=deadline ? budgetError(source) : new Error('Request timeout')),Math.min(18000,Math.max(1,deadline-now())));
          req.on('close',()=>clearTimeout(timer));req.on('error',reject);
          req.end(method === 'POST' ? options.body : undefined);
        });
        },platformForReader(source.ats),'automatic',now()-waitStarted);
        if ([401,403,429].includes(result.status)) cooled.add(host);
        if ([301,302,303,307,308].includes(result.status)) { url = new URL(result.headers.location,url).href; if (method === 'POST' && [301,302,303].includes(result.status)) method='GET'; continue; }
        return new Response(result.body,{status:result.status,headers:result.headers});
      } finally { release(); }
    }
    throw new Error('Redirect limit');
  };
  const scopedFetch=async(...args)=>{try{return await perform(...args);}finally{ended=now();const timing=timings.get(source.id);if(timing)timing.ended=ended;}};
  scopedFetch.diagnostics=()=>{const timing=timings.get(source.id);return {httpRequests:counts.get(source.id)||0,elapsedMs:timing?Math.max(0,Math.ceil(timing.ended-timing.started)):0,budgetExhausted:budgetStopped.has(source.id),sourceRequestCap:sourceCapped.has(source.id)};};
  return scopedFetch;};
  factory.diagnostics=()=>({httpRequests:total,elapsedMs:deadline===null?0:Math.max(0,Math.ceil((ended??now())-(deadline-maxSeconds*1000))),maxRequests,maxSeconds});
  return factory;
}
export async function loadDiscoveredManifest({ fetchImpl=fetch, cachePath='.jobs-cache/discovered-sources.json', log=console.log }={}) {
  const checked=value=>{
    try{return validateDiscoveredManifest(value);}catch{
      const rejected=(Array.isArray(value?.sources)?value.sources:[]).filter(source=>{try{validateDiscoveredManifest({version:1,sources:[source]});return false;}catch{return true;}});
      const ids=rejected.map(s=>s?.id).filter(id=>typeof id==='string'&&/^auto-[a-f0-9]{24}$/.test(id)).slice(0,20);
      throw Object.assign(new Error(`Discovered manifest validation failed; rejected sources: ${ids.join(', ')||'invalid manifest structure'}. Collector stopped; registry not replaced.`),{code:'DISCOVERED_MANIFEST_INVALID'});
    }
  };
  let previous={version:1,sources:[]},cacheError=null;
  try { previous=checked(JSON.parse(await readFile(cachePath,'utf8'))); } catch(error) {
    if(error.code!=='ENOENT'){cacheError=error.code==='DISCOVERED_MANIFEST_INVALID'?error:Object.assign(new Error('Cached discovered manifest invalid; collector cannot use it'),{code:'DISCOVERED_MANIFEST_INVALID'});log(cacheError.message);}
  }
  try {
    const r=await fetchImpl('https://globalnewsflix.com/api/jobs/sources',{redirect:'error',signal:AbortSignal.timeout(18000)});
    if (!r.ok) throw new Error('Unavailable');
    const reader=r.body.getReader(), chunks=[];let size=0;
    for (;;) {const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>4000000){await reader.cancel();throw new Error('Manifest too large');}chunks.push(value);}
    let decoded;try{decoded=JSON.parse(Buffer.concat(chunks).toString());}catch{throw Object.assign(new Error('Discovered manifest JSON invalid; collector stopped'),{code:'DISCOVERED_MANIFEST_INVALID'});}
    const next=checked(decoded);
    // Existing entries are immutable. Explicit removal on the trusted site is
    // a maintainer's undo; the daily publisher itself remains append-only.
    const known=new Map(next.sources.map(s=>[s.id,JSON.stringify(s)]));
    const changed=previous.sources.filter(s=>known.has(s.id)&&known.get(s.id)!==JSON.stringify(s));
    if (changed.length) throw Object.assign(new Error(`Discovered manifest identity changed; rejected sources: ${changed.slice(0,20).map(s=>s.id).join(', ')}. Collector stopped; registry not replaced.`),{code:'DISCOVERED_MANIFEST_INVALID'});
    await mkdir(dirname(cachePath),{recursive:true});await writeFile(cachePath,JSON.stringify(next));return next;
  } catch(error) {
    if(error.code==='DISCOVERED_MANIFEST_INVALID')throw error;
    if(cacheError)throw cacheError;
    log('Discovered source manifest unavailable; retaining last valid registry');return previous;
  }
}

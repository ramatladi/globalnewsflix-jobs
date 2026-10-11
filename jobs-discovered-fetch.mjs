// Restricted transport for automatically registered employers only.
import { request } from 'node:https';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { allowedDiscoveredRequest, validateDiscoveredManifest } from './jobs-discovered-sources.js';
export function publicAddress(a) {
  if (isIP(a) !== 4) return false;
  const [x,y] = a.split('.').map(Number);
  return !(x === 0 || x === 10 || x === 127 || x >= 224 || x === 100 && y >= 64 && y <= 127 || x === 169 && y === 254 || x === 172 && y >= 16 && y <= 31 || x === 192 && [0,168].includes(y) || x === 198 && [18,19,51].includes(y) || x === 203 && y === 0);
}
export function automaticTransport({ resolver = lookup, transport = request, now = Date.now, pause = ms => new Promise(r => setTimeout(r,ms)), maxRequests = 1000, maxSeconds = 900 } = {}) {
  let total = 0;
  const deadline = now() + maxSeconds * 1000, locks = new Map(), counts = new Map(), cooled = new Set();
  return source => async function scopedFetch(value, options = {}) {
    let url = String(value), method = String(options.method || 'GET').toUpperCase();
    if (options.body && (typeof options.body !== 'string' || Buffer.byteLength(options.body) > 10000)) throw new Error('Invalid request body');
    for (let hop = 0; hop < 4; hop++) {
      if (!allowedDiscoveredRequest(source,url,method) || now() >= deadline || total >= maxRequests || (counts.get(source.id) || 0) >= 100) throw new Error('Automatic request outside scope or budget');
      const u = new URL(url), host = u.hostname;
      if (cooled.has(host)) throw new Error('Automatic host cooldown');
      let release;
      const prior = locks.get(host) || Promise.resolve(); locks.set(host, new Promise(r => { release = r; }));
      await prior;
      try {
        await pause(1000);
        if (now() >= deadline || total >= maxRequests || cooled.has(host)) throw new Error('Automatic request budget or cooldown');
        const addresses = await Promise.race([resolver(host,{all:true,family:4}), new Promise((_,reject) => { const t=setTimeout(()=>reject(new Error('DNS timeout')),5000); t.unref?.(); })]);
        if (!addresses.length || addresses.some(a => !publicAddress(a.address))) throw new Error('Non-public destination');
        total++; counts.set(source.id,(counts.get(source.id) || 0)+1);
        const result = await new Promise((resolve,reject) => {
          const req = transport(u, { method, servername:host, family:4, autoSelectFamily:false, lookup:(_h,o,cb)=>o?.all?cb(null,[{address:addresses[0].address,family:4}]):cb(null,addresses[0].address,4), headers:{'user-agent':'GlobalNewsflix-careers/1.0','accept':'application/json,text/html','content-type':'application/json'} }, res => {
            let size=0; const chunks=[];
            res.on('data',chunk=>{size+=chunk.length;if(size>2000000)req.destroy(new Error('Response too large'));else chunks.push(chunk);});
            res.on('error',reject); res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks)}));
          });
          const timer=setTimeout(()=>req.destroy(new Error('Request timeout')),18000);
          req.on('close',()=>clearTimeout(timer));req.on('error',reject);
          req.end(method === 'POST' ? options.body : undefined);
        });
        if ([401,403,429].includes(result.status)) cooled.add(host);
        if ([301,302,303,307,308].includes(result.status)) { url = new URL(result.headers.location,url).href; if (method === 'POST' && [301,302,303].includes(result.status)) method='GET'; continue; }
        return new Response(result.body,{status:result.status,headers:result.headers});
      } finally { release(); }
    }
    throw new Error('Redirect limit');
  };
}
export async function loadDiscoveredManifest({ fetchImpl=fetch, cachePath='.jobs-cache/discovered-sources.json', log=console.log }={}) {
  let previous={version:1,sources:[]};
  try { previous=validateDiscoveredManifest(JSON.parse(await readFile(cachePath,'utf8'))); } catch { /* Empty safe baseline on absent/invalid cache. */ }
  try {
    const r=await fetchImpl('https://globalnewsflix.com/api/jobs/sources',{redirect:'error',signal:AbortSignal.timeout(18000)});
    if (!r.ok) throw new Error('Unavailable');
    const reader=r.body.getReader(), chunks=[];let size=0;
    for (;;) {const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>4000000){await reader.cancel();throw new Error('Manifest too large');}chunks.push(value);}
    const next=validateDiscoveredManifest(JSON.parse(Buffer.concat(chunks).toString()));
    // The source registry is append-only; never silently accept a rollback.
    const known=new Map(next.sources.map(s=>[s.id,JSON.stringify(s)]));
    if (previous.sources.some(s=>known.get(s.id)!==JSON.stringify(s))) throw new Error('Manifest rollback');
    await mkdir(dirname(cachePath),{recursive:true});await writeFile(cachePath,JSON.stringify(next));return next;
  } catch {log('Discovered source manifest unavailable or invalid; retaining last valid registry');return previous;}
}

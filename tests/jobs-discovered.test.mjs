import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoveredReader, validateDiscoveredManifest, registeredDiscoveredSources, allowedDiscoveredRequest, discoveredJobAllowed } from '../jobs-discovered-sources.js';
import { loadDiscoveredManifest, automaticTransport } from '../jobs-discovered-fetch.mjs';
import { normalizeCollectedJob, collectJobs } from '../jobs.js';
import {evaluateSourceHealth} from '../jobs-source-health.js';
const time='2026-01-01T00:00:00.000Z';
export const source=()=>({id:'auto-'+'a'.repeat(24),name:'Acme Limited',country:'ZA',type:'c',officialDomain:'https://acme.example.com/',careerUrl:'https://acme.wd3.myworkdayjobs.com/External',ats:'wd',args:['acme.wd3.myworkdayjobs.com','acme','External'],identity:{method:'automatic-employer-structured-identity',organization:'Acme Limited',country:'ZA',officialDomain:'https://acme.example.com/',evidenceUrl:'https://acme.example.com/',evidenceSha256:'b'.repeat(64),employerPageSha256:'c'.repeat(64),observedAt:time},discoveredAt:time});
test('Workday is an exact employer tenant; roots, job boards and arbitrary reader arguments fail',()=>{
  const s=source();assert.deepEqual(discoveredReader(s.careerUrl,s.officialDomain),{ats:s.ats,args:s.args});
  for(const url of ['https://myworkdayjobs.com/','https://acme.wd3.myworkdayjobs.com/','https://indeed.com/jobs','https://seek.com.au/Acme-jobs','https://jobs.lever.co/','http://acme.example.com/jobs','https://127.0.0.1/','https://acme.example.com/jobs%2fsecret'])assert.equal(discoveredReader(url,s.officialDomain),null,url);
  const manifest={version:1,sources:[s]};assert.equal(validateDiscoveredManifest(manifest),manifest);
  assert.throws(()=>validateDiscoveredManifest({version:1,sources:[{...s,args:['other','other','External']}]}));
  assert.throws(()=>validateDiscoveredManifest({version:1,sources:[{...s,script:'run me'}]}));
  assert.throws(()=>validateDiscoveredManifest({version:1,sources:[s,s]}));
});
test('a known hiring platform never authorizes another tenant or API operation',()=>{
  const s=source();assert.equal(allowedDiscoveredRequest(s,'https://acme.wd3.myworkdayjobs.com/wday/cxs/acme/External/jobs','POST'),true);
  assert.equal(allowedDiscoveredRequest(s,'https://acme.wd3.myworkdayjobs.com/External/job/Cape-Town/Engineer_123'),true);
  for(const url of ['https://other.wd3.myworkdayjobs.com/External/job/x','https://acme.wd3.myworkdayjobs.com/Other/job/x','https://acme.wd3.myworkdayjobs.com/wday/cxs/acme/Other/jobs','https://acme.wd3.myworkdayjobs.com/External%2f..%2fOther/job/x'])assert.equal(allowedDiscoveredRequest(s,url,'POST'),false);
});
test('automatic jobs must name the correct country, employer and scoped source URL',()=>{
  const s={...source(),automatic:true};const job={id:'1',country:'ZA',employer:s.name,title:'Engineer',url:'https://acme.wd3.myworkdayjobs.com/External/job/Cape-Town/Engineer_1'};
  assert.ok(normalizeCollectedJob(s,job,null));
  for(const change of [{country:'US'},{employer:'Different Company'},{url:'https://indeed.com/job/1'},{salary_url:'https://other.example.com/pay'}])assert.equal(normalizeCollectedJob(s,{...job,...change},null),null);
  assert.equal(discoveredJobAllowed(s,{...job,source_url:'https://other.wd3.myworkdayjobs.com/External/job/1'}),false);
});
test('transport rejects private addresses and cross-tenant destinations before sending',async()=>{
  let calls=0;const f=automaticTransport({platformPace:async(_url,send)=>send(),pause:async()=>{},resolver:async()=>[{address:'127.0.0.1'}],transport:()=>{calls++;throw new Error('must not send');}})(source());
  await assert.rejects(f('https://acme.wd3.myworkdayjobs.com/wday/cxs/acme/External/jobs',{method:'POST',body:'{}'}),/Non-public/);
  await assert.rejects(f('https://evil.example.com/'),/scope/);assert.equal(calls,0);
});
test('collector cannot use an unrestricted fetch for an automatic source',async()=>{
  const s={...source(),automatic:true};let requests=0;
  const result=await collectJobs(async()=>{requests++;return new Response(JSON.stringify({rates:{}}));},()=>{},[s.id],{sources:[s],requestDelayMs:0});
  assert.equal(requests,1);assert.deepEqual(result.rows,[]);assert.deepEqual(result.ok,[]);assert.equal(result.diagnostics[0].status,'failed');
});
test('trusted manifest fetch retains cache on outage but visibly stops on invalid schema',async()=>{
  const cachePath=join(await mkdtemp(join(tmpdir(),'gnf-manifest-')),'manifest.json');const manifest={version:1,sources:[source()]};
  const good=await loadDiscoveredManifest({cachePath,fetchImpl:async(url,options)=>{assert.equal(url,'https://globalnewsflix.com/api/jobs/sources');assert.equal(options.redirect,'error');return Response.json(manifest);},log:()=>{}});assert.deepEqual(good,manifest);
  assert.deepEqual(await loadDiscoveredManifest({cachePath,fetchImpl:async()=>{throw new Error('network');},log:()=>{}}),manifest);
  await assert.rejects(loadDiscoveredManifest({cachePath,fetchImpl:async()=>Response.json({version:1,sources:[{...source(),args:['bad']}]}),log:()=>{}}),error=>error.code==='DISCOVERED_MANIFEST_INVALID'&&error.message.includes(source().id));
  assert.deepEqual(JSON.parse(await readFile(cachePath,'utf8')),manifest);
});
test('automatic Workday retains exact local details without country facets and preserves expiry',async()=>{
  const s={...source(),automatic:true,strictDetailGeography:true,countries:['ZA']};
  const path='/job/Campus/Engineer_JR1';
  const detail={jobReqId:'JR1',jobPostingSiteId:'External',title:'Engineer',externalUrl:s.careerUrl+path,location:'Campus',country:{descriptor:'South Africa'},jobRequisitionLocation:{country:{alpha2Code:'ZA'}},jobDescription:'Engineering role',endDate:'2027-01-01'};
  const run=async(change={})=>collectJobs(async()=>Response.json({rates:{}}),()=>{},[s.id],{sources:[s],requestDelayMs:0,automaticFetch:()=>async url=>Response.json(url.endsWith('/jobs')?{total:1,jobPostings:[{title:'Engineer',externalPath:path,locationsText:'Campus'}],facets:[]}:{jobPostingInfo:{...detail,...change}})});
  const r=await run();assert.equal(r.rows.length,1);assert.equal(r.rows[0].country,'ZA');assert.equal(r.rows[0].closing_ts,Date.parse('2027-01-01'));assert.deepEqual(r.ok,[]);
  for(const change of [{jobReqId:'other'},{externalUrl:'https://other.example.com/job'},{country:{descriptor:'United States'}},{country:{}}])assert.equal((await run(change)).rows.length,0);
});

test('maintainer removal on the trusted site replaces cache while identity mutation fails',async()=>{
 const cachePath=join(await mkdtemp(join(tmpdir(),'gnf-undo-')),'manifest.json');const manifest={version:1,sources:[source()]};
 await loadDiscoveredManifest({cachePath,fetchImpl:async()=>Response.json(manifest),log:()=>{}});
 const empty={version:1,sources:[]};assert.deepEqual(await loadDiscoveredManifest({cachePath,fetchImpl:async()=>Response.json(empty),log:()=>{}}),empty);
});

function fakeHttps(onRequest=()=>{}) {
  return (_url,_options,onResponse)=>{
    onRequest();const req=new EventEmitter();
    req.end=()=>{const res=Readable.from([Buffer.from('{}')]);res.statusCode=200;res.headers={'content-type':'application/json'};res.once('end',()=>req.emit('close'));onResponse(res);};
    req.destroy=error=>{req.emit('error',error);req.emit('close');};return req;
  };
}
test('automatic budget starts after unrelated manual work and stays shared across sources',async()=>{
  let clock=0,dns=0,http=0;
  const scoped=automaticTransport({platformPace:async(_url,send)=>send(),now:()=>clock,pause:async()=>{},resolver:async()=>{dns++;return [{address:'8.8.8.8'}];},transport:fakeHttps(()=>http++)});
  const s=source(),url='https://acme.wd3.myworkdayjobs.com/wday/cxs/acme/External/jobs',options={method:'POST',body:'{}'};
  const first=scoped(s);clock=20*60000; // Production failure: automatic employers reached the queue after20 minutes.
  assert.equal((await first(url,options)).status,200);assert.equal(http,1);
  const start=clock;clock=start+900000-1;
  assert.equal((await scoped({...s,id:'auto-'+'d'.repeat(24)})(url,options)).status,200,'another employer shares the same active budget');
  clock=start+900000;
  await assert.rejects(first(url,options),/budget/);await assert.rejects(scoped({...s,id:'auto-'+'e'.repeat(24)})(url,options),/budget/);
  assert.equal(dns,2);assert.equal(http,2,'no request starts at or beyond the fixed deadline');
});
test('automatic budget cannot expire during pacing or DNS and still send a request',async()=>{
  const url='https://acme.wd3.myworkdayjobs.com/wday/cxs/acme/External/jobs',options={method:'POST',body:'{}'};
  for(const delayed of ['pacing','dns']){
    let clock=0,http=0;
    const f=automaticTransport({platformPace:async(_url,send)=>send(),now:()=>clock,maxSeconds:1,pause:async()=>{if(delayed==='pacing')clock=1000;},resolver:async()=>{clock=1000;return [{address:'8.8.8.8'}];},transport:fakeHttps(()=>http++)})(source());
    await assert.rejects(f(url,options),/budget/);assert.equal(http,0,delayed);
  }
});
test('delayed automatic start preserves the shared hard request limit',async()=>{
  let clock=0,http=0;const scoped=automaticTransport({platformPace:async(_url,send)=>send(),now:()=>clock,maxRequests:2,pause:async()=>{},resolver:async()=>[{address:'8.8.8.8'}],transport:fakeHttps(()=>http++)});
  clock=20*60000;const s=source(),url='https://acme.wd3.myworkdayjobs.com/wday/cxs/acme/External/jobs',options={method:'POST',body:'{}'};
  await scoped(s)(url,options);await scoped({...s,id:'auto-'+'d'.repeat(24)})(url,options);await assert.rejects(scoped(s)(url,options),/budget/);assert.equal(http,2);
});

test('queued concurrent requests cannot exceed the per-employer100 request cap',async()=>{
 let http=0;const f=automaticTransport({platformPace:async(_url,send)=>send(),now:()=>0,pause:async()=>{},resolver:async()=>[{address:'8.8.8.8'}],transport:fakeHttps(()=>http++)})(source());const url='https://acme.wd3.myworkdayjobs.com/wday/cxs/acme/External/jobs',options={method:'POST',body:'{}'};
 for(let i=0;i<99;i++)await f(url,options);
 const results=await Promise.allSettled([f(url,options),f(url,options)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(http,100);assert.equal(f.diagnostics().httpRequests,100);assert.equal(f.diagnostics().sourceRequestCap,true);assert.equal(results.find(r=>r.status==='rejected').reason.code,'AUTOMATIC_SOURCE_REQUEST_CAP');
});
test('budget diagnostics distinguish zero HTTP from attempted collection and still trip health',async()=>{
 const now=Date.now(),s={...source(),discoveredAt:new Date(now-1000).toISOString(),automatic:true};const url='https://acme.wd3.myworkdayjobs.com/wday/cxs/acme/External/jobs',options={method:'POST',body:'{}'};
 for(const attempted of [false,true]){
  let clock=0,http=0;const factory=automaticTransport({platformPace:async(_url,send)=>send(),now:()=>clock,maxSeconds:attempted?1:0,pause:async()=>{},resolver:async()=>[{address:'8.8.8.8'}],transport:fakeHttps(()=>http++)});const scoped=factory(s);
  if(attempted){await scoped(url,options);clock=1000;}
  const result=await collectJobs(async()=>Response.json({rates:{}}),()=>{},[s.id],{sources:[s],requestDelayMs:0,automaticFetch:()=>scoped});
  const d=result.diagnostics[0];assert.equal(d.status,'failed');assert.equal(d.reason,attempted?'budget-exhausted':'not-attempted-budget');assert.equal(http,attempted?1:0);assert.equal(scoped.diagnostics().httpRequests,http);assert.deepEqual(result.rows,[]);assert.deepEqual(result.ok,[]);
  const health=evaluateSourceHealth([s],{},{diagnostics:[{src:s.id,status:d.status,raw_count:d.rawCount,accepted_count:d.acceptedCount,attempted_ts:d.attemptedAt,reason:d.reason}]},Date.now());assert.equal(health.tripped,true);assert.ok(health.reasons.some(r=>r.endsWith('failed-or-empty-over-20-percent')),'budget failure cannot silently bypass the breaker');
 }
});


test('source cap has its own failed diagnostic and still trips health',async()=>{
 const now=Date.now(),s={...source(),discoveredAt:new Date(now-1000).toISOString(),automatic:true};let http=0;
 const scoped=automaticTransport({platformPace:async(_url,send)=>send(),now:()=>0,pause:async()=>{},resolver:async()=>[{address:'8.8.8.8'}],transport:fakeHttps(()=>http++)})(s);
 for(let i=0;i<100;i++)await scoped('https://acme.wd3.myworkdayjobs.com/wday/cxs/acme/External/jobs',{method:'POST',body:'{}'});
 const result=await collectJobs(async()=>Response.json({rates:{}}),()=>{},[s.id],{sources:[s],requestDelayMs:0,automaticFetch:()=>scoped});
 const d=result.diagnostics[0];assert.equal(d.status,'failed');assert.equal(d.reason,'source-request-cap');assert.equal(http,100);assert.equal(scoped.diagnostics().budgetExhausted,false);assert.deepEqual(result.rows,[]);assert.deepEqual(result.ok,[]);
 const health=evaluateSourceHealth([s],{},{diagnostics:[{src:s.id,status:d.status,raw_count:0,accepted_count:0,attempted_ts:d.attemptedAt,reason:d.reason}]},now);assert.equal(health.tripped,true);assert.ok(health.reasons.some(r=>r.endsWith('failed-or-empty-over-20-percent')));
});
test('runtime manifest validation rejects future source and identity timestamps',async()=>{
 const future=new Date(Date.now()+86400000).toISOString();
 for(const change of [{discoveredAt:future},{identity:{...source().identity,observedAt:future}}]){
  const manifest={version:1,sources:[{...source(),...change}]};
  assert.throws(()=>registeredDiscoveredSources(manifest));
  const cachePath=join(await mkdtemp(join(tmpdir(),'gnf-future-manifest-')),'manifest.json');
  await assert.rejects(loadDiscoveredManifest({cachePath,fetchImpl:async()=>Response.json(manifest),log:()=>{}}),error=>error.code==='DISCOVERED_MANIFEST_INVALID'&&error.message.includes(source().id));
 }
});
test('accepted partial rows cannot hide a selected source budget failure',async()=>{
 const s={...source(),ats:'gh',args:['acme'],automatic:true};
 const scoped=async()=>Response.json({jobs:[{id:1,title:'Engineer',absolute_url:'https://boards.greenhouse.io/acme/jobs/1',location:{name:'Johannesburg, South Africa'},content:'Engineering role'}]});
 scoped.diagnostics=()=>({httpRequests:100,elapsedMs:45000,sourceRequestCap:true,budgetExhausted:false});
 const result=await collectJobs(async()=>Response.json({rates:{}}),()=>{},[s.id],{sources:[s],requestDelayMs:0,automaticFetch:()=>scoped});
 assert.equal(result.rows.length,1);assert.equal(result.diagnostics[0].status,'failed');assert.equal(result.diagnostics[0].reason,'source-request-cap');assert.equal(result.diagnostics[0].httpRequests,100);assert.equal(result.diagnostics[0].elapsedMs,45000);assert.deepEqual(result.ok,[]);
});


test('generic complete non-Workday snapshots cannot claim automatic pagination evidence',async()=>{
 const base=source(),s={...base,automatic:true,ats:'gh',args:['acme'],careerUrl:'https://boards.greenhouse.io/acme'};
 const scoped=async()=>Response.json({jobs:[{id:1,title:'Engineer',location:{name:'Cape Town, South Africa'},absolute_url:'https://boards.greenhouse.io/acme/jobs/1'}]});
 scoped.diagnostics=()=>({httpRequests:1,elapsedMs:10,budgetExhausted:false,sourceRequestCap:false});
 const result=await collectJobs(async()=>Response.json({rates:{}}),()=>{},[s.id],{sources:[s],requestDelayMs:0,automaticFetch:()=>scoped});
 assert.equal(result.diagnostics[0].paginationComplete,false);assert.equal(result.diagnostics[0].status,'failed');assert.equal(result.diagnostics[0].reason,'pagination-incomplete');assert.deepEqual(result.ok,[]);
});

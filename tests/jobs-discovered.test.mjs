import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoveredReader, validateDiscoveredManifest, allowedDiscoveredRequest, discoveredJobAllowed } from '../jobs-discovered-sources.js';
import { loadDiscoveredManifest, automaticTransport } from '../jobs-discovered-fetch.mjs';
import { normalizeCollectedJob, collectJobs } from '../jobs.js';
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
  let calls=0;const f=automaticTransport({pause:async()=>{},resolver:async()=>[{address:'127.0.0.1'}],transport:()=>{calls++;throw new Error('must not send');}})(source());
  await assert.rejects(f('https://acme.wd3.myworkdayjobs.com/wday/cxs/acme/External/jobs',{method:'POST',body:'{}'}),/Non-public/);
  await assert.rejects(f('https://evil.example.com/'),/scope/);assert.equal(calls,0);
});
test('collector cannot use an unrestricted fetch for an automatic source',async()=>{
  const s={...source(),automatic:true};let requests=0;
  const result=await collectJobs(async()=>{requests++;return new Response(JSON.stringify({rates:{}}));},()=>{},[s.id],{sources:[s],requestDelayMs:0});
  assert.equal(requests,1);assert.deepEqual(result.rows,[]);assert.deepEqual(result.ok,[]);assert.equal(result.diagnostics[0].status,'failed');
});
test('trusted manifest fetch retains the last valid data on failure or invalid schema',async()=>{
  const cachePath=join(await mkdtemp(join(tmpdir(),'gnf-manifest-')),'manifest.json');const manifest={version:1,sources:[source()]};
  const good=await loadDiscoveredManifest({cachePath,fetchImpl:async(url,options)=>{assert.equal(url,'https://globalnewsflix.com/api/jobs/sources');assert.equal(options.redirect,'error');return Response.json(manifest);},log:()=>{}});assert.deepEqual(good,manifest);
  for(const fetchImpl of [async()=>{throw new Error('network');},async()=>Response.json({version:1,sources:[{...source(),args:['bad']}]})])assert.deepEqual(await loadDiscoveredManifest({cachePath,fetchImpl,log:()=>{}}),manifest);
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

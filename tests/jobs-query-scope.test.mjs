import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {discoveredReader,validateDiscoveredManifest} from '../jobs-discovered-sources.js';
import {loadDiscoveredManifest} from '../jobs-discovered-fetch.mjs';

const official='https://acme.example.com/';
const urls=[
 ['gh','https://boards.greenhouse.io/acme'],
 ['gh','https://job-boards.greenhouse.io/acme'],
 ['lever','https://jobs.lever.co/acme'],
 ['ashby','https://jobs.ashbyhq.com/acme'],
 ['sr','https://careers.smartrecruiters.com/acme'],
 ['jsonld','https://acme.example.com/careers'],
];
const now=Date.parse('2026-10-12T12:00:00.000Z');
function source(careerUrl,reader){
 const discoveredAt='2026-10-11T00:00:00.000Z';
 return {id:'auto-'+'a'.repeat(24),name:'Acme',country:'ZA',type:'c',officialDomain:official,careerUrl,...reader,discoveredAt,
  identity:{method:'automatic-employer-structured-identity',organization:'Acme',country:'ZA',officialDomain:official,evidenceUrl:official,evidenceSha256:'a'.repeat(64),employerPageSha256:'b'.repeat(64),observedAt:discoveredAt}};
}
test('non-Workday readers never widen a query-filtered registration to the whole tenant',()=>{
 for(const [ats,url] of urls){
  const reader=discoveredReader(url,official);assert.equal(reader.ats,ats,url);
  assert.doesNotThrow(()=>validateDiscoveredManifest({version:1,sources:[source(url,reader)]},now));
  for(const query of ['?department=engineering','?location=Singapore','?q=nurse','?locale=en-US','?utm_source=site','?department=one&department=two','?%71=nurse','?unknown=']){
   const filtered=url+query;assert.equal(discoveredReader(filtered,official),null,filtered);
   // A pre-existing tenant-only args array cannot bypass URL scope validation.
   const attempted={...reader,args:ats==='jsonld'?[filtered]:reader.args};
   assert.throws(()=>validateDiscoveredManifest({version:1,sources:[source(filtered,attempted)]},now),/scope disagree/,filtered);
  }
 }
});
test('Workday registration accepts bounded facet syntax only; metadata remains reader-validated',()=>{
 for(const url of ['https://acme.wd3.myworkdayjobs.com/External','https://wd3.myworkdaysite.com/recruiting/acme/External']){
  const facet='a'.repeat(32);
  assert.equal(discoveredReader(url+'?jobFamilyGroup='+facet,official)?.ats,'wd');
  for(const query of ['?q=nurse','?locale=en-US','?jobFamilyGroup=engineering','?jobFamilyGroup='+facet+'&jobFamilyGroup='+facet,'?unknown='+facet])assert.equal(discoveredReader(url+query,official),null,url+query);
 }
});
test('current active registrations retain valid scoped reader contracts',async()=>{
 const manifest=JSON.parse(await readFile(new URL('../data/discovered-sources/manifest.json',import.meta.url),'utf8'));
 assert.doesNotThrow(()=>validateDiscoveredManifest(manifest,now));
});
test('rejected remote query scopes visibly fail with source ID and never become an empty registry',async()=>{
 const url='https://jobs.lever.co/acme',s=source(url+'?location=Singapore',discoveredReader(url,official));
 const rejected={version:1,sources:[s]},cachePath=join(await mkdtemp(join(tmpdir(),'query-registry-')),'sources.json');
 await assert.rejects(loadDiscoveredManifest({cachePath,fetchImpl:async()=>Response.json(rejected),log:()=>{}}),error=>error.code==='DISCOVERED_MANIFEST_INVALID'&&error.message.includes(s.id));
 await writeFile(cachePath,JSON.stringify(rejected));const logs=[];
 await assert.rejects(loadDiscoveredManifest({cachePath,fetchImpl:async()=>{throw Error('offline');},log:m=>logs.push(m)}),error=>error.code==='DISCOVERED_MANIFEST_INVALID'&&error.message.includes(s.id));
 assert.ok(logs.some(m=>m.includes(s.id)));
 const valid={version:1,sources:[source(url,discoveredReader(url,official))]};
 assert.deepEqual(await loadDiscoveredManifest({cachePath,fetchImpl:async()=>Response.json(valid),log:()=>{}}),valid,'a valid authoritative replacement may repair an invalid cache');
 const mutated=structuredClone(valid);mutated.sources[0].identity.employerPageSha256='c'.repeat(64);
 await assert.rejects(loadDiscoveredManifest({cachePath,fetchImpl:async()=>Response.json(mutated),log:()=>{}}),error=>error.code==='DISCOVERED_MANIFEST_INVALID'&&error.message.includes(s.id));
 assert.deepEqual(JSON.parse(await readFile(cachePath,'utf8')),valid,'rejected identity changes leave cached data unchanged');
});

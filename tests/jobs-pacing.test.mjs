import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {Readable} from 'node:stream';
import {createPlatformPacer,jobPlatform,platformForReader} from '../jobs-pacing.js';
import {automaticTransport} from '../jobs-discovered-fetch.mjs';
import {createJobFetch} from '../jobs.js';
const source=name=>({id:'auto-'+name,ats:'wd',args:[`${name}.wd3.myworkdayjobs.com`,name,'External']});
const url=name=>`https://${name}.wd3.myworkdayjobs.com/wday/cxs/${name}/External/jobs`;
const options={method:'POST',body:'{}'};
function transport(onSend){return(u,o,callback)=>{onSend(u);const req=new EventEmitter();req.end=()=>{const res=Readable.from([Buffer.from('{}')]);res.statusCode=200;res.headers={};res.once('end',()=>req.emit('close'));callback(res);};req.destroy=e=>{req.emit('error',e);req.emit('close');};return req;};}
test('shared platform includes distinct Workday tenants and regions, without suffix lookalikes',()=>{
 for(const u of ['https://acme.wd3.myworkdayjobs.com/','https://other.wd1.myworkdayjobs.com/','https://wd5.myworkdaysite.com/'])assert.equal(jobPlatform(u),'workday');
 assert.notEqual(jobPlatform('https://myworkdayjobs.com.example.org/'),'workday');
 assert.equal(jobPlatform('https://boards-api.greenhouse.io/'),jobPlatform('https://job-boards.greenhouse.io/'));
});
test('manual and automatic requests share platform admission and elapsed telemetry includes waiting',async()=>{
 let clock=0;const sent=[];const now=()=>clock,pause=async ms=>{clock+=ms;};const platformPace=createPlatformPacer({now,pause});
 const manual=createJobFetch(async u=>{sent.push({kind:'manual',at:clock});return Response.json({});},0,platformPace);
 await manual(url('manual'));
 const factory=automaticTransport({now,pause:async()=>{},platformPace,resolver:async()=>[{address:'8.8.8.8'}],transport:transport(u=>sent.push({kind:u.hostname,at:clock}))});
 const a=factory(source('acme')),b=factory(source('other'));
 await Promise.all([a(url('acme'),options),b(url('other'),options)]);
 assert.deepEqual(sent.map(x=>x.at),[0,1000,2000]);assert.equal(a.diagnostics().httpRequests,1);assert.equal(b.diagnostics().httpRequests,1);
 assert.ok(a.diagnostics().elapsedMs>=1000);assert.equal(factory.diagnostics().httpRequests,2);assert.equal(factory.diagnostics().elapsedMs,2000);
});
test('platform wait cannot authorize a send after shared deadline; zero HTTP remains measurable',async()=>{
 let clock=0;const now=()=>clock,platformPace=createPlatformPacer({now,pause:async ms=>{clock+=ms;}});await platformPace(url('manual'));
 let sent=0;const f=automaticTransport({now,pause:async()=>{},platformPace,maxSeconds:1,resolver:async()=>[{address:'8.8.8.8'}],transport:transport(()=>sent++)});const scoped=f(source('acme'));
 await assert.rejects(scoped(url('acme'),options),/budget/);assert.equal(sent,0);assert.deepEqual(scoped.diagnostics(),{httpRequests:0,elapsedMs:1000,budgetExhausted:true,sourceRequestCap:false});assert.equal(f.diagnostics().httpRequests,0);
});
test('independent platforms do not consume each others pacing slots',async()=>{
 let clock=0;const pace=createPlatformPacer({now:()=>clock,pause:async ms=>{clock+=ms;}});
 await pace(url('acme'));await pace('https://boards-api.greenhouse.io/v1/boards/a/jobs');assert.equal(clock,0);await pace(url('other'));assert.equal(clock,1000);
});

test('trusted reader mapping paces custom hiring-platform domains together',async()=>{
 let clock=0;const sent=[];const pace=createPlatformPacer({now:()=>clock,pause:async ms=>{clock+=ms;}});
 const f=createJobFetch(async()=>{sent.push(clock);return Response.json({});},0,pace);
 await Promise.all([f('https://careers.unesco.org/',{},platformForReader('sf')),f('https://jobs.itu.int/',{},platformForReader('sf'))]);
 assert.deepEqual(sent,[0,1000]);assert.equal(platformForReader('unknown'),null);
});

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
test('automatic-only platform pacing leaves manual production admission unchanged and measures both',async()=>{
 let clock=0;const sent=[];const now=()=>clock,pause=async ms=>{clock+=ms;};const platformPace=createPlatformPacer({now,pause});
 const manual=createJobFetch(async u=>{sent.push({kind:'manual',at:clock});return Response.json({});},0,platformPace);
 await manual(url('manual'));
 const factory=automaticTransport({now,pause:async()=>{},platformPace,resolver:async()=>[{address:'8.8.8.8'}],transport:transport(u=>sent.push({kind:u.hostname,at:clock}))});
 const a=factory(source('acme')),b=factory(source('other'));
 await Promise.all([a(url('acme'),options),b(url('other'),options)]);
 assert.deepEqual(sent.map(x=>x.at),[0,0,1000]);assert.equal(a.diagnostics().httpRequests,1);assert.equal(b.diagnostics().httpRequests,1);
 assert.ok(a.diagnostics().elapsedMs>=0);assert.equal(factory.diagnostics().httpRequests,2);assert.equal(factory.diagnostics().elapsedMs,1000);
 const metrics=platformPace.diagnostics().find(m=>m.platform==='workday');assert.equal(metrics.manual.requestsStarted,1);assert.equal(metrics.automatic.requestsStarted,2);assert.equal(metrics.automatic.waitMs,1000);assert.equal(metrics.activityElapsedMs,1000);
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

test('trusted reader mapping does not add platform pacing to manual custom domains',async()=>{
 let clock=0;const sent=[];const pace=createPlatformPacer({now:()=>clock,pause:async ms=>{clock+=ms;}});
 const f=createJobFetch(async()=>{sent.push(clock);return Response.json({});},0,pace);
 await Promise.all([f('https://careers.unesco.org/',{},platformForReader('sf')),f('https://jobs.itu.int/',{},platformForReader('sf'))]);
 assert.deepEqual(sent,[0,0]);assert.equal(platformForReader('unknown'),null);
});

test('platform lock protects admission without waiting for a pending HTTP response',async()=>{
 let clock=0,releaseFirst;const sent=[];
 const pace=createPlatformPacer({now:()=>clock,pause:async ms=>{clock+=ms;}});
 const first=pace(url('manual'),()=>{sent.push(clock);return new Promise(resolve=>{releaseFirst=resolve;});});
 const second=pace(url('other'),()=>{sent.push(clock);return 'second admitted';});
 assert.equal(await second,'second admitted');assert.deepEqual(sent,[0,1000]);
 releaseFirst('first complete');assert.equal(await first,'first complete');
});

test('pacing telemetry excludes synchronous pre-dispatch refusal and keeps a bounded platform summary',async()=>{
 let clock=0;const pace=createPlatformPacer({now:()=>clock,pause:async ms=>{clock+=ms;}});
 await pace(url('acme'),()=>Promise.reject(new Error('network failure')),'workday','automatic').catch(()=>{});
 await assert.rejects(pace(url('acme'),()=>{throw new Error('budget before HTTP');},'workday','automatic'),/budget/);
 const m=pace.diagnostics()[0];assert.equal(m.automatic.requestsStarted,1);assert.equal(m.automatic.waitMs,1000);
 for(let i=0;i<300;i++)await pace('https://site'+i+'.example/',()=>{},null,'manual');
 assert.ok(pace.diagnostics().length<=257);assert.equal(pace.diagnostics().find(x=>x.platform==='other-platforms').manual.requestsStarted,45);
});

test('common hostname mutex prevents automatic and manual overlap without serializing other manual hosts',async()=>{
 let releaseAuto;const events=[];
 const pace=createPlatformPacer({now:()=>0,pause:async()=>{throw new Error('unexpected platform sleep');}});
 const automatic=pace(url('acme'),()=>{events.push('auto');return new Promise(resolve=>{releaseAuto=resolve;});},'workday','automatic');
 await new Promise(resolve=>setImmediate(resolve));
 const same=pace(url('acme'),()=>{events.push('same-host-manual');},'workday','manual');
 await pace(url('other'),()=>{events.push('other-host-manual');},'workday','manual');
 assert.deepEqual(events,['auto','other-host-manual']);releaseAuto();await Promise.all([automatic,same]);assert.deepEqual(events,['auto','other-host-manual','same-host-manual']);
});

test('manual production per-host delay and429cooldown remain unchanged by automatic pacing',async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout'],now:10000});
 const calls=[];const pace=createPlatformPacer({now:()=>Date.now(),pause:async()=>{throw new Error('manual platform wait');}});
 const f=createJobFetch(async()=>{calls.push(Date.now());return Response.json({});},1000,pace);
 await f(url('manual'));const second=f(url('manual'));await Promise.resolve();await Promise.resolve();assert.deepEqual(calls,[10000]);
 t.mock.timers.tick(1000);await second;assert.deepEqual(calls,[10000,11000]);
 let network=0;const cooled=createJobFetch(async()=>{network++;return new Response('',{status:429,headers:{'retry-after':'60'}});},1000,pace);
 await cooled(url('cooled'));assert.equal((await cooled(url('cooled'))).status,429);assert.equal(network,1);
});

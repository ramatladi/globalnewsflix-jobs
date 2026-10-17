import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {EventEmitter} from 'node:events';
import {Readable} from 'node:stream';
import {automaticWorkday,collectJobs,workdayDetailRejection} from '../jobs.js';
import {automaticTransport} from '../jobs-discovered-fetch.mjs';
import {automaticRefreshHealth,persistedRefreshHealth} from '../jobs-source-health.js';
import {automaticSourceRequestLimit,AUTOMATIC_SOURCE_HARD_LIMIT,NTU_AUTOMATIC_SOURCE_ID,WORKDAY_DETAIL_REASONS,emptyWorkdayDetailReasons,validWorkdayDetailReasons,workdayDetailSummaries} from '../jobs-request-policy.js';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/jobs-workday-ntu-list-shape.json',import.meta.url)));
const src=fixture.source;
const generic={...src,id:'auto-'+'a'.repeat(24)};
async function run({source=src,count=114,change=()=>({}),response,collect=false,listingChange=row=>row}={}){
 const rows=Array.from({length:count},(_,i)=>({externalPath:`/job/Campus/Engineer_SYN${i}`,title:`Engineer ${i}`,locationsText:'Singapore'}));
 let calls=0,budget=false;const logs=[];
 const f=async(url,opt)=>{
  calls++;
  if(url.endsWith('/jobs')){
   const b=JSON.parse(opt.body),scoped=Object.keys(b.appliedFacets).length>0;
   return Response.json({total:scoped?count:count+1,jobPostings:rows.slice(b.offset,b.offset+20).map((row,i)=>listingChange(row,b.offset+i)),facets:fixture.facets.map(v=>({...v,values:v.values.map(x=>({...x,count}))}))});
  }
  if(response){try{return await response(calls);}catch(e){budget=e.code==='AUTOMATIC_BUDGET_EXHAUSTED';if(budget||e.code==='AUTOMATIC_SOURCE_REQUEST_CAP')calls--;throw e;}}
  const i=Number(url.split('_SYN').at(-1));
  return Response.json({jobPostingInfo:{jobReqId:`SYN${i}`,jobPostingSiteId:'Careers',title:rows[i].title,externalUrl:'https://ntu.wd3.myworkdayjobs.com/Careers'+rows[i].externalPath,location:'Campus',country:{descriptor:'Singapore'},...change(i)}});
 };
 f.diagnostics=()=>({httpRequests:calls,elapsedMs:calls*1000,budgetExhausted:budget,sourceRequestCap:false});
 const result=collect?await collectJobs(async()=>Response.json({rates:{}}),()=>{},[source.id],{sources:[source],automaticFetch:()=>f,requestDelayMs:0}):await automaticWorkday(f,source,line=>logs.push(line));
 return {result,calls,logs};
}
test('NTU exact immutable ID alone receives134 and all other IDs remain100 under hard150 ceiling',()=>{
 assert.equal(automaticSourceRequestLimit(NTU_AUTOMATIC_SOURCE_ID),134);
 assert.equal(AUTOMATIC_SOURCE_HARD_LIMIT,150);
 for(const id of [undefined,null,generic.id,NTU_AUTOMATIC_SOURCE_ID+'x',NTU_AUTOMATIC_SOURCE_ID.toUpperCase(),{id:NTU_AUTOMATIC_SOURCE_ID,maxRequests:999}])assert.equal(automaticSourceRequestLimit(id),100);
 assert.ok(automaticSourceRequestLimit(NTU_AUTOMATIC_SOURCE_ID)<=AUTOMATIC_SOURCE_HARD_LIMIT);
});
test('114-row scoped NTU completes121 requests with all strict detail checks, while identical other source caps100',async()=>{
 const {result,calls}=await run();assert.equal(calls,121);assert.equal(result.detailValidated,114);assert.equal(result.paginationComplete,true);assert.equal(result.sourceRequestCap,false);assert.deepEqual(result.phaseHttp,{listing:7,detail:114});assert.deepEqual(result.detailReasons,emptyWorkdayDetailReasons());
 const old=await run({source:{...generic,maxRequests:999,requestLimit:999}});assert.equal(old.calls,100);assert.equal(old.result.detailValidated,93);assert.equal(old.result.detailReasons['unattempted-cap'],21);assert.equal(old.result.sourceRequestCap,true);
 const capped=await run({count:150});assert.equal(capped.calls,134);assert.equal(capped.result.detailReasons['unattempted-cap'],25);assert.equal(capped.result.detailValidated,125);assert.equal(capped.result.sourceRequestCap,true);
});
test('strict detail rejection reports one fixed count and no article, URL or posting content for each mismatch',async()=>{
 const cases={
  'place-null':{country:{}},'wrong-country':{country:{descriptor:'United States'}},
  'site-mismatch':{jobPostingSiteId:'Elsewhere'},'reqid-mismatch':{jobReqId:'WRONG'},
  'title-mismatch':{title:'Another job'},'external-url-mismatch':{externalUrl:'https://other.example.com/'},
 };
 for(const [reason,delta] of Object.entries(cases)){
  const {result}=await run({count:1,change:()=>delta});assert.equal(result.detailValidated,0,reason);assert.equal(result.rows[0].countryUnresolved,true);assert.deepEqual(result.detailReasons,{...emptyWorkdayDetailReasons(),[reason]:1});
 }
});
test('HTTP, malformed JSON, source cap and global stop use bounded fixed counters',async()=>{
 const http=await run({count:1,response:()=>new Response('',{status:404})});assert.equal(http.result.detailReasons['detail-http-error'],1);
 const bad=await run({count:1,response:()=>new Response('not json')});assert.equal(bad.result.detailReasons['detail-invalid-json'],1);assert.equal(bad.calls,4,'existing one retry is preserved');
 const cap=await run({count:3,response:()=>{throw Object.assign(Error('cap'),{code:'AUTOMATIC_SOURCE_REQUEST_CAP'});}});assert.equal(cap.result.detailReasons['unattempted-cap'],3);assert.equal(cap.result.detailReasons.other,0);assert.equal(cap.result.sourceRequestCap,true);
 const stopped=await run({count:3,response:()=>{throw Object.assign(Error('global'),{code:'AUTOMATIC_BUDGET_EXHAUSTED'});},collect:true});assert.equal(stopped.result.diagnostics[0].detailReasons.other,0);assert.equal(stopped.result.diagnostics[0].detailReasons['unattempted-cap'],3);assert.equal(stopped.result.rows.length,0);assert.equal(stopped.result.diagnostics[0].budgetExhausted,true);
});
test('NTU uses unchanged raw denominator and ninety-percent quality threshold even after full detail collection',async()=>{
 const low=await run({change:i=>i<14?{jobReqId:'WRONG'}:{},collect:true});assert.equal(low.calls,121);assert.equal(low.result.diagnostics[0].rawCount,114);assert.equal(low.result.diagnostics[0].acceptedCount,100);assert.equal(low.result.diagnostics[0].detailReasons['reqid-mismatch'],14);assert.equal(low.result.rows.length,0);assert.equal(low.result.diagnostics[0].status,'failed');
 const good=await run({collect:true});assert.equal(good.result.rows.length,114);assert.equal(good.result.diagnostics[0].reason,'healthy-automatic-refresh');assert.deepEqual(good.result.ok,[]);
 const d=good.result.diagnostics[0];for(const delta of [{src:generic.id},{httpRequests:135},{httpRequests:151},{sourceRequestCap:true},{budgetExhausted:true},{paginationComplete:false},{reportedTotal:113},{acceptedCount:102}])assert.equal(automaticRefreshHealth({...d,...delta}).healthy,false);
 assert.equal(persistedRefreshHealth({src:d.src,status:d.status,reason:d.reason,http_requests:d.httpRequests,raw_count:d.rawCount,accepted_count:d.acceptedCount,pagination_complete:1,budget_exhausted:0,source_request_cap:0,pages_fetched:d.pagesFetched,reported_total:d.reportedTotal,pagination_end:d.paginationEnd}).healthy,true);
});
function fakeHttps(){return (_url,_opt,cb)=>{const req=new EventEmitter();req.end=()=>{const res=Readable.from([Buffer.from('{}')]);res.statusCode=200;res.headers={};res.once('end',()=>req.emit('close'));cb(res);};req.destroy=e=>{req.emit('error',e);req.emit('close');};return req;};}
const url='https://ntu.wd3.myworkdayjobs.com/wday/cxs/ntu/Careers/jobs',options={method:'POST',body:'{}'};
const transportOptions={now:()=>0,pause:async()=>{},resolver:async()=>[{address:'8.8.8.8'}],transport:fakeHttps(),platformPace:async(_u,send)=>send()};
test('transport enforces134 under concurrent NTU calls and ignores manifest budget fields',async()=>{
 const f=automaticTransport(transportOptions)({...src,maxRequests:999,requestLimit:999});
 for(let i=0;i<133;i++)await f(url,options);
 const final=await Promise.allSettled([f(url,options),f(url,options)]);assert.equal(final.filter(x=>x.status==='fulfilled').length,1);assert.equal(f.diagnostics().httpRequests,134);assert.equal(f.diagnostics().sourceRequestCap,true);
});
test('shared transport still stops at2500 requests and exactly3000 seconds regardless of NTU exception',async()=>{
 const factory=automaticTransport(transportOptions);assert.equal(factory.diagnostics().maxRequests,2500);assert.equal(factory.diagnostics().maxSeconds,3000);
 const ntu=factory(src);for(let i=0;i<134;i++)await ntu(url,options);
 for(let n=0;n<23;n++){const f=factory({...generic,id:'auto-'+n.toString(16).padStart(24,'0')});for(let i=0;i<100;i++)await f(url,options);}
 const last=factory({...generic,id:'auto-'+'f'.repeat(24)});for(let i=0;i<66;i++)await last(url,options);await assert.rejects(last(url,options),{code:'AUTOMATIC_BUDGET_EXHAUSTED'});assert.equal(factory.diagnostics().httpRequests,2500);
 let clock=0;const timed=automaticTransport({...transportOptions,now:()=>clock})(src);await timed(url,options);clock=2999999;await timed(url,options);clock=3000000;await assert.rejects(timed(url,options),{code:'AUTOMATIC_BUDGET_EXHAUSTED'});assert.equal(timed.diagnostics().httpRequests,2);
});
test('rejection telemetry accepts only exact fixed integer counts bounded by raw denominator',()=>{
 assert.equal(WORKDAY_DETAIL_REASONS.length,10);assert.equal(validWorkdayDetailReasons(emptyWorkdayDetailReasons(),0,0),true);
 for(const value of [{...emptyWorkdayDetailReasons(),url:'https://secret.example/'},{...emptyWorkdayDetailReasons(),other:-1},{...emptyWorkdayDetailReasons(),other:1.5},{...emptyWorkdayDetailReasons(),other:11},{...emptyWorkdayDetailReasons(),other:6,'place-null':5},{}])assert.equal(validWorkdayDetailReasons(value,10,10),false);
});

test('a failed detail with a capped retry remains attempted, and only untouched rows count as unattempted',async()=>{
 const {result,calls}=await run({count:150,response:n=>n===134?new Response('invalid json'):Response.json({jobPostingInfo:null})});
 assert.equal(calls,134);assert.equal(result.detailReasons['place-null'],124);assert.equal(result.detailReasons['detail-invalid-json'],1);assert.equal(result.detailReasons['unattempted-cap'],25);assert.equal(Object.values(result.detailReasons).reduce((a,b)=>a+b,0),150);
});

test('classification errors fail closed as other and HTTP rejection counts cannot exceed actual detail requests',async()=>{
 const bomb={jobReqId:'R',jobPostingSiteId:'Careers',title:{toString(){throw Error('provider data');}}};
 assert.equal(workdayDetailRejection(bomb,{id:'R',title:'Engineer'},'Careers'),'other');
 assert.equal(validWorkdayDetailReasons({...emptyWorkdayDetailReasons(),other:2},10,1),false);
 assert.equal(validWorkdayDetailReasons({...emptyWorkdayDetailReasons(),'unattempted-cap':9,other:1},10,1),true);
 assert.equal(validWorkdayDetailReasons(emptyWorkdayDetailReasons(),10,undefined),false);
 const {result}=await run({count:1,change:()=>({title:{toString:null}})});assert.equal(result.detailReasons.other,1);assert.equal(result.detailValidated,0);
});
test('human log and daily collection summary expose all fixed counts without posting content',async()=>{
 const {result,logs}=await run({count:1,change:()=>({jobReqId:'PRIVATE PROVIDER CONTENT'})});
 const summary=workdayDetailSummaries([{src:src.id,rawCount:1,phaseHttp:result.phaseHttp,detailReasons:result.detailReasons}]);
 assert.equal(summary.length,1);assert.equal(summary[0].counts['reqid-mismatch'],1);assert.match(summary[0].summary,/reqid-mismatch=1/);assert.ok(logs.some(line=>line.includes('Workday detail rejection counts:')&&line.includes(summary[0].summary)));assert.doesNotMatch(JSON.stringify(summary),/PRIVATE PROVIDER CONTENT/);
 assert.deepEqual(workdayDetailSummaries([{src:'untrusted\nname',rawCount:1,phaseHttp:result.phaseHttp,detailReasons:result.detailReasons}]),[]);
 const runner=readFileSync(new URL('../jobs-runner.mjs',import.meta.url),'utf8');assert.match(runner,/workdayDetailReasons:workdayDetailSummaries\(data.diagnostics\)/);
});

test('malformed JSON country and date objects hold one row without losing the source or partly accepting it',async()=>{
 const malformed=JSON.parse('{"toString":null,"valueOf":null}');
 for(const delta of [{country:{descriptor:malformed}},{startDate:malformed},{endDate:malformed}]){
  const {result,calls}=await run({count:2,change:i=>i===0?delta:{}});
  assert.equal(calls,4);assert.equal(result.rows.length,2);assert.equal(result.detailValidated,1);assert.equal(result.detailReasons.other,1);
  assert.equal(result.rows[0].countryUnresolved,true);assert.equal(result.rows[0].country,null);assert.equal(result.rows[0].payObserved,false);assert.equal(result.rows[1].countryUnresolved,false);
  assert.equal(validWorkdayDetailReasons(result.detailReasons,result.rows.length,result.phaseHttp.detail),true);
 }
 const {result}=await run({count:2,change:i=>i===0?{country:{descriptor:malformed}}:{},collect:true});
 assert.equal(result.diagnostics.length,1);assert.equal(result.diagnostics[0].rawCount,2);assert.equal(result.diagnostics[0].acceptedCount,1);assert.equal(result.diagnostics[0].detailReasons.other,1);assert.equal(result.diagnostics[0].status,'failed');assert.equal(result.rows.length,0,'unchanged90percent threshold still blocks upload');
});

test('hostile plain JSON detail shapes stay row-local across every consumed string field',async()=>{
 const shapes=['{"toString":null}','{"valueOf":null}','{"constructor":{"prototype":{"x":1}}}','{"__proto__":{"x":1}}','[]','["Singapore"]','123','{"nested":{"x":1}}','null'].map(JSON.parse);
 for(const field of ['title','jobReqId','jobPostingSiteId','externalUrl','location','country.descriptor','country'])for(const value of shapes){
  const delta=field==='country.descriptor'?{country:{descriptor:value}}:{[field]:value};
  const {result}=await run({count:2,change:i=>i===0?delta:{}});
  assert.equal(result.rows.length,2,field);assert.equal(result.detailValidated,1,field+JSON.stringify(value));assert.equal(result.rows[0].countryUnresolved,true,field);assert.equal(result.rows[1].countryUnresolved,false,field);assert.notEqual(result.reason,'source-unavailable');assert.equal(Object.values(result.detailReasons).reduce((a,b)=>a+b,0),1,field);
 }
});
test('hostile listing paths/titles are counted and skipped while detail-verified peers continue',async()=>{
 const shapes=['{"toString":null}','{"valueOf":null}','{"constructor":{"prototype":{"x":1}}}','{"__proto__":{"x":1}}','[]','["Singapore"]','123','{"nested":{"x":1}}','null'].map(JSON.parse);
 for(const field of ['externalPath','title'])for(const value of shapes){
  const {result}=await run({count:2,listingChange:(row,i)=>i===0?{...row,[field]:value}:row});
  assert.equal(result.listingRejected,1,field);assert.equal(result.rows.length,1);assert.equal(result.rows[0].id,'SYN1');assert.equal(result.detailValidated,1);assert.equal(result.paginationComplete,false);assert.equal(result.paginationEnd,'invalid-or-duplicate-rows');assert.notEqual(result.reason,'source-unavailable');
 }
 for(const value of shapes){const {result}=await run({count:2,listingChange:(row,i)=>i===0?{...row,locationsText:value}:row});assert.equal(result.detailValidated,2);assert.equal(result.rows[0].location,'Campus','strict detail supplies location; malformed listing label is never used');}
 for(const value of shapes){const {result}=await run({count:2,listingChange:(row,i)=>i===0?value:row});assert.equal(result.listingRejected,1);assert.equal(result.detailValidated,1);}
});
test('cap and global-budget exceptions inside row data processing never become other or disappear',async()=>{
 for(const code of ['AUTOMATIC_SOURCE_REQUEST_CAP','AUTOMATIC_BUDGET_EXHAUSTED']){
  const info={jobReqId:'SYN0',jobPostingSiteId:'Careers',title:'Engineer 0',externalUrl:'https://ntu.wd3.myworkdayjobs.com/Careers/job/Campus/Engineer_SYN0',location:'Campus',country:{descriptor:'Singapore'},startDate:{toString(){throw Object.assign(Error('injected infrastructure error'),{code});}}};
  await assert.rejects(run({count:1,response:()=>({ok:true,status:200,headers:new Headers(),json:async()=>({jobPostingInfo:info})})}),{code});
 }
});

// Synthetic identity pairs model the independently captured NTU '-1' shape;
// they do not contain real posting identifiers or descriptions.
async function variants({source=src,count=1,variantCount=count,missingPlace=false,listingDelta=()=>({}),detailDelta=()=>({}),collect=false}={}){
 const listings=Array.from({length:count},(_,i)=>{
  const req='R'+String(i+1).padStart(8,'0');return {externalPath:`/job/Campus/Engineer-${i}_${req}${i<variantCount?'-1':''}`,title:`Engineer ${i}`,bulletFields:[req],...listingDelta(i,req)};
 });let calls=0;
 const f=async(url,opt)=>{
  calls++;if(url.endsWith('/jobs')){
   const body=JSON.parse(opt.body),scoped=Object.keys(body.appliedFacets).length>0;
   return Response.json({total:scoped?count:count+1,jobPostings:listings.slice(body.offset,body.offset+20),facets:fixture.facets.map(v=>({...v,values:v.values.map(x=>({...x,count}))}))});
  }
  const i=listings.findIndex(row=>url.endsWith(row.externalPath));assert.ok(i>=0);
  const row=listings[i],req='R'+String(i+1).padStart(8,'0');
  return Response.json({jobPostingInfo:{jobReqId:req,jobPostingId:row.externalPath.split('/').at(-1),jobPostingSiteId:'Careers',title:row.title,externalUrl:'https://ntu.wd3.myworkdayjobs.com/Careers'+row.externalPath,location:'Campus',country:{descriptor:'Singapore'},...(missingPlace&&i===count-1?{location:'',country:null}:{}),...detailDelta(i,req)}});
 };
 f.diagnostics=()=>({httpRequests:calls,elapsedMs:calls*1250,budgetExhausted:false,sourceRequestCap:false});
 return collect?collectJobs(async()=>Response.json({rates:{}}),()=>{},[source.id],{sources:[source],automaticFetch:()=>f,requestDelayMs:0}):automaticWorkday(f,source);
}
test('NTU observed duplicate-slug shape requires listing/detail requisition agreement and preserves stored posting identity',async()=>{
 const result=await variants();assert.equal(result.detailValidated,1);assert.equal(result.rows[0].id,'R00000001-1');assert.ok(result.rows[0].url.endsWith('_R00000001-1'));
 const collected=await variants({collect:true});assert.equal(collected.rows.length,1);assert.ok(collected.rows[0].id.endsWith(':R00000001-1'));assert.ok(collected.rows[0].url.endsWith('_R00000001-1'));
 assert.equal(Object.hasOwn(collected.rows[0],'bulletFields'),false,'normalization never sends listing bullets to storage');
 assert.equal(Object.hasOwn(collected.rows[0],'path'),false,'collector-only identity evidence stays out of upload rows');
 assert.equal(JSON.stringify(collected.diagnostics).includes('bulletFields'),false,'reports retain bounded counters only');
});
test('base posting and observed variant keep distinct stored IDs even with one requisition',async()=>{
 const result=await variants({count:2,variantCount:1,collect:true,
  listingDelta:i=>i===1?{externalPath:'/job/Campus/Second_R00000001',bulletFields:['R00000001']}:{},
  detailDelta:i=>i===1?{jobReqId:'R00000001'}:{}});
 assert.equal(result.rows.length,2);assert.equal(new Set(result.rows.map(r=>r.id)).size,2);
 assert.deepEqual(result.rows.map(r=>r.id.split(':').at(-1)),['R00000001-1','R00000001']);
});
test('NTU variant evidence never accepts missing, ambiguous, differently formatted or other-tenant IDs',async()=>{
 const deltas=[{bulletFields:null},{bulletFields:[]},{bulletFields:['WRONG']},{bulletFields:['R00000001','R00000001']},{bulletFields:['R00000001','R00000002']},{bulletFields:[{toString:null}]}];
 for(const delta of deltas){const r=await variants({listingDelta:()=>delta});assert.equal(r.detailValidated,0);assert.equal(r.detailReasons['reqid-mismatch'],1);}
 for(const suffix of ['-2','-01','-999','-1x']){
  const r=await variants({listingDelta:()=>({externalPath:'/job/Campus/Engineer_R00000001'+suffix})});assert.equal(r.detailValidated,0);
 }
 for(const delta of [{jobReqId:'R00000002'},{jobReqId:'r00000001'},{jobPostingId:null},{jobPostingId:'Different_R00000001-1'}])assert.equal((await variants({detailDelta:()=>delta})).detailValidated,0);
 assert.equal((await variants({source:generic})).detailValidated,0,'exception is only reviewed immutable NTU source');
 assert.equal((await variants({source:{...src,args:['other.wd3.myworkdayjobs.com','other','Careers']}})).detailValidated,0);
});
test('NTU reconciled IDs still require exact site, title, external URL and explicit geography',async()=>{
 for(const delta of [{jobPostingSiteId:'Other'},{title:'Different'},{externalUrl:'https://elsewhere.example/job'},{externalUrl:'https://ntu.wd3.myworkdayjobs.com/Careers/job/Other_R00000001-1'},{location:''},{country:null},{country:{descriptor:'United States'}},{jobRequisitionLocation:{country:{alpha2Code:'US'}}}]){
  const r=await variants({detailDelta:()=>delta});assert.equal(r.detailValidated,0,JSON.stringify(delta));
 }
});
test('NTU variant URL must be byte-exact even when URL normalization would match',async()=>{
 const exact='https://ntu.wd3.myworkdayjobs.com/Careers/job/Campus/Engineer-0_R00000001-1';
 for(const value of [' '+exact,exact.replace('/job/','/ignored/../job/'),exact.replace('.com/','.com:443/')]){
  assert.equal(new URL(value).href,new URL(exact).href);
  const result=await variants({detailDelta:()=>({externalUrl:value})});
  assert.equal(result.detailValidated,0);assert.equal(result.detailReasons['reqid-mismatch'],1);
 }
 const unmodified=await variants({variantCount:0,detailDelta:()=>({externalUrl:' https://ntu.wd3.myworkdayjobs.com/Careers/job/Campus/Engineer-0_R00000001'})});
 assert.equal(unmodified.detailValidated,1,'ordinary exact-requisition behavior is unchanged');
});
test('113-row observed-shape replay recovers16 identity mismatches but missing-country row stays held and90percent gate stays intact',async()=>{
 const result=await variants({count:113,variantCount:16,missingPlace:true,collect:true});
 const d=result.diagnostics[0];assert.equal(d.rawCount,113);assert.equal(d.acceptedCount,112);assert.equal(d.detailReasons['reqid-mismatch'],0);assert.equal(d.detailReasons['place-null'],1);assert.equal(d.reason,'healthy-automatic-refresh');assert.equal(d.httpRequests,120);assert.equal(result.rows.length,112);assert.deepEqual(result.ok,[],'automatic snapshot never prunes');
 const low=await variants({count:113,variantCount:16,missingPlace:true,collect:true,detailDelta:i=>i<16?{jobPostingId:'WRONG'}:{}});assert.equal(low.diagnostics[0].acceptedCount,96);assert.equal(low.diagnostics[0].status,'failed');assert.equal(low.rows.length,0);
});

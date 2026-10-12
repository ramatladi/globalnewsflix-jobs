import test from 'node:test';
import assert from 'node:assert/strict';
import { uploadJobs,runCollectedJobs,timedGovernmentJobs } from '../jobs-runner.mjs';
const payload={rows:[{src:'absa'},{src:'nedbank'}],ok:['absa','nedbank'],diagnostics:[],runTs:123,site:'https://globalnewsflix.com',log:()=>{}};
test('partial upload acknowledgement never prunes affected sources',async()=>{
 const posts=[];let tokens=0;
 const result=await uploadJobs({...payload,getToken:async()=>String(++tokens),fetchImpl:async(u,o)=>{posts.push(JSON.parse(o.body));return new Response(JSON.stringify(u.endsWith('/finish')?{ok:true}:{ok:true,n:1}));}});
 assert.equal(result.ok,false);assert.deepEqual(posts[1].sources,[]);assert.equal(tokens,2);
});
test('finish errors fail a run even after all uploads are accepted',async()=>{
 const result=await uploadJobs({...payload,getToken:async()=>'',fetchImpl:async u=>new Response(JSON.stringify(u.endsWith('/finish')?{ok:false}:{ok:true,n:2}))});assert.equal(result.ok,false);
});
test('confirmed empty snapshot can finish without uploads',async()=>{
 let posted;const result=await uploadJobs({...payload,rows:[],ok:['absa'],getToken:async()=>'',fetchImpl:async(u,o)=>{posted=JSON.parse(o.body);return new Response('{"ok":true}');}});assert.equal(result.ok,true);assert.deepEqual(posted.sources,['absa']);
});

test('non-JSON authorization failures report status and cannot authorize cleanup',async()=>{
 const logs=[];const result=await uploadJobs({...payload,log:s=>logs.push(s),getToken:async()=>'',fetchImpl:async()=>new Response('unauthorized',{status:401})});
 assert.equal(result.ok,false);assert.deepEqual(result.completedSources,[]);assert.ok(logs.some(s=>s.includes('upload: 401')));assert.ok(logs.some(s=>s.includes('finish: 401')));
});

test('collection must complete before any upload or finish, including when collection fails',async()=>{
 let release;const ready=new Promise(resolve=>{release=resolve;}),posts=[],reports=[];let clock=0;
 const publish=data=>uploadJobs({...payload,...data,getToken:async()=>'',fetchImpl:async(url,options)=>{posts.push({url,body:JSON.parse(options.body)});clock+=10;return Response.json(url.endsWith('/finish')?{ok:true}:{ok:true,n:2});}});
 const pending=runCollectedJobs({collect:async()=>{await ready;return payload;},writeReport:async(_data,meta)=>reports.push(meta),publish,now:()=>clock,log:()=>{}});
 await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(posts,[]);assert.deepEqual(reports,[]);
 release();const result=await pending;assert.equal(result.result.ok,true);assert.equal(posts.length,2);assert.equal(posts[0].url.endsWith('/api/jobs'),true);assert.equal(posts[1].url.endsWith('/finish'),true);assert.equal(reports[1].uploadElapsedMs,20);
 posts.length=0;reports.length=0;
 await assert.rejects(runCollectedJobs({collect:async()=>{throw new Error('collection interrupted');},writeReport:async()=>reports.push({}),publish}),/collection interrupted/);
 assert.deepEqual(posts,[]);assert.deepEqual(reports,[]);
});
test('report failure and dry-run both prevent publishing',async()=>{
 let uploads=0;const publish=async()=>{uploads++;return {ok:true};};
 await assert.rejects(runCollectedJobs({collect:async()=>payload,writeReport:async()=>{throw new Error('disk failed');},publish}),/disk failed/);
 await runCollectedJobs({collect:async()=>payload,writeReport:async()=>{},publish,dryRun:true});assert.equal(uploads,0);
});

test('government duration is measured separately and preserves returned jobs and diagnostics',async()=>{
 let clock=100;const data={rows:[{src:'za-dpsa'}],diagnostic:{src:'za-dpsa',status:'partial'}};
 const result=await timedGovernmentJobs(async()=>{clock=160100;return data;},()=>clock);
 assert.equal(result.governmentElapsedMs,160000);assert.equal(result.rows,data.rows);assert.equal(result.diagnostic,data.diagnostic);
});

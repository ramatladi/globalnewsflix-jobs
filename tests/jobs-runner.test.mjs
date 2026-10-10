import test from 'node:test';
import assert from 'node:assert/strict';
import { uploadJobs } from '../jobs-runner.mjs';
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

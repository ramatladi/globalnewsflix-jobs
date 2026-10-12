import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {workdayQueryFacets} from '../jobs-workday-query.js';
import {automaticWorkday,registeredWorkdayFacets,collectJobs} from '../jobs.js';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/jobs-workday-ntu-list-shape.json',import.meta.url)));
const posting=i=>({externalPath:`/job/Synthetic-Campus/Synthetic-engineer_SYN${i}`,title:`Synthetic engineer ${i}`,locationsText:'Singapore',postedOn:'Posted Today'});
async function run({total=4,filteredTotal=total,facets,source=fixture.source,detailChange={},pageChange=x=>x,collect=false}={}){
 facets??=fixture.facets.map(f=>({...f,values:f.values.map(v=>({...v,count:filteredTotal}))}));
 const requests=[],posts=Array.from({length:Math.max(total,filteredTotal)},(_,i)=>posting(i));
 const f=async(url,opt)=>{
  requests.push({url,body:opt?.body?JSON.parse(opt.body):null});
  if(url.endsWith('/jobs')){const b=JSON.parse(opt.body),n=Object.keys(b.appliedFacets).length?filteredTotal:total;return Response.json(pageChange({total:n,jobPostings:posts.slice(b.offset,Math.min(n,b.offset+20)),facets},b));}
  const row=posts.find(x=>url.endsWith(x.externalPath));
  return Response.json({jobPostingInfo:{jobReqId:row.externalPath.split('_').at(-1),jobPostingSiteId:'Careers',title:row.title,externalUrl:'https://ntu.wd3.myworkdayjobs.com/Careers'+row.externalPath,location:'Synthetic campus',country:{descriptor:'Singapore'},jobRequisitionLocation:{country:{alpha2Code:'SG'}},...detailChange}});
 };
 f.diagnostics=()=>({httpRequests:requests.length,elapsedMs:requests.length*10,budgetExhausted:false,sourceRequestCap:false});
 const result=collect?await collectJobs(async()=>Response.json({rates:{}}),()=>{},[source.id],{sources:[source],automaticFetch:()=>f,requestDelayMs:0}):await automaticWorkday(f,source);return {result,requests};
}
test('registered jobFamilyGroup is verified and preserved on every scoped page, excluding probe rows',async()=>{
 const {result,requests}=await run({total:742,filteredTotal:24});
 assert.equal(result.scopedTotal,24);assert.equal(result.rows.length,24);assert.equal(result.paginationComplete,true);assert.equal(result.paginationEnd,'reported-total');assert.equal(result.pagesFetched,2);assert.equal(result.reportedTotal,24);assert.equal(result.detailValidated,24);assert.deepEqual(result.phaseHttp,{listing:3,detail:24});
 assert.deepEqual(requests[0].body.appliedFacets,{});
 for(const r of requests.filter(r=>r.body).slice(1))assert.deepEqual(r.body.appliedFacets,{jobFamilyGroup:['09b383db6f9d018b6e6c440e633a4199']});
});
test('missing, duplicate or ambiguous registered filter evidence holds without accepting broad tenant rows',async()=>{
 for(const facets of [[],[...fixture.facets,...fixture.facets],[{...fixture.facets[0],values:[...fixture.facets[0].values,...fixture.facets[0].values]}]]){
  const {result,requests}=await run({facets});assert.equal(requests.length,1);assert.equal(result.rows.length,0);assert.equal(result.paginationComplete,false);assert.equal(result.reason,'registered-workday-filter-unconfirmed');
 }
 assert.equal(registeredWorkdayFacets({facets:fixture.facets},{...fixture.source,careerUrl:fixture.source.careerUrl+'&unknown=value'}),null);
});
test('742-row synthetic tenant stays under100requests and cannot claim a full strict-detail refresh',async()=>{
 const {result,requests}=await run({total:742});
 assert.equal(requests.length,100);assert.equal(result.phaseHttp.listing,39);assert.equal(result.phaseHttp.detail,61);assert.equal(result.rows.length,742);assert.equal(result.paginationComplete,true);assert.equal(result.detailValidated,61);assert.equal(result.sourceRequestCap,true);assert.equal(result.rows.filter(r=>!r.countryUnresolved).length,61);assert.equal(result.reason,'workday-details-incomplete');
});
test('ambiguous or contradictory detail country never inherits Singapore from the employer',async()=>{
 for(const detailChange of [{country:{}},{country:{descriptor:'United States'}},{jobReqId:'WRONG'},{externalUrl:'https://other.example.com/job'}]){
  const {result}=await run({detailChange});assert.equal(result.detailValidated,0);assert.ok(result.rows.every(r=>r.countryUnresolved));
 }
});
test('large, truncated, changing and duplicate pagination cannot produce natural completion',async()=>{
 const large=await run({total:3000});assert.ok(large.requests.length<=100);assert.equal(large.result.paginationComplete,false);
 for(const pageChange of [(p,b)=>b.offset?{...p,jobPostings:[]}:p,(p,b)=>b.offset?{...p,total:p.total+1}:p,(p,b)=>b.offset?{...p,jobPostings:[posting(0),posting(0)]}:p]){
  const {result}=await run({total:30,pageChange});assert.equal(result.paginationComplete,false);
 }
});

test('query selectors reject unknown, free-text, duplicate and oversized values without broadening',()=>{
 const base='https://ntu.wd3.myworkdayjobs.com/Careers',id='a'.repeat(32);
 assert.deepEqual(workdayQueryFacets(base),{});
 for(const query of ['searchText=engineer','locale=en-US','utm_campaign=x','jobFamilyGroup=not-an-id',`jobFamilyGroup=${'A'.repeat(32)}`,`jobFamilyGroup=${id}&jobFamilyGroup=${id}`,Array.from({length:6},(_,i)=>'jobFamilyGroup='+String(i).repeat(32)).join('&')])assert.equal(workdayQueryFacets(base+'?'+query),null,query);
});
test('queryless automatic source remains scoped and posted date stays publisher-derived',async()=>{
 const source={...fixture.source,careerUrl:'https://ntu.wd3.myworkdayjobs.com/Careers'};
 const {result,requests}=await run({source,total:3,detailChange:{startDate:'2026-10-10'}});
 assert.equal(result.rows.length,3);assert.equal(result.phaseHttp.listing,1);assert.equal(result.pagesFetched,1);assert.equal(result.paginationComplete,true);assert.ok(result.rows.every(r=>r.posted===Date.parse('2026-10-10')));
 assert.deepEqual(requests[0].body.appliedFacets,{});
});

test('ninety-five percent accepted cannot conceal pending detail work stopped by the source cap',async()=>{
 const {result,requests}=await run({total:100,source:{...fixture.source,careerUrl:'https://ntu.wd3.myworkdayjobs.com/Careers'}});
 assert.equal(requests.length,100);assert.equal(result.detailValidated,95);assert.equal(result.paginationComplete,true);assert.equal(result.sourceRequestCap,true);
 const complete=await run({total:94});assert.equal(complete.requests.length,100);assert.equal(complete.result.detailValidated,94);assert.equal(complete.result.sourceRequestCap,false,'all work completed exactly at budget');
});

test('collector health rejects local detail-cap truncation while permitting exact-budget natural completion',async()=>{
 const failed=await run({total:100,collect:true,source:{...fixture.source,careerUrl:'https://ntu.wd3.myworkdayjobs.com/Careers'}});
 assert.equal(failed.result.rows.length,95);assert.equal(failed.result.diagnostics[0].status,'failed');assert.equal(failed.result.diagnostics[0].sourceRequestCap,true);
 const healthy=await run({total:94,collect:true});assert.equal(healthy.requests.length,100);assert.equal(healthy.result.rows.length,94);assert.equal(healthy.result.diagnostics[0].status,'partial');assert.equal(healthy.result.diagnostics[0].reason,'healthy-automatic-refresh');assert.deepEqual(healthy.result.ok,[],'automatic refresh never authorizes pruning');
});


test('registered facet counts must be bounded, unambiguous and reflected in scoped totals',async()=>{
 for(const count of [undefined,-1,1.5,'24',743,1000001]){
  const facets=[{...fixture.facets[0],values:[{...fixture.facets[0].values[0],count}]}];
  const {result,requests}=await run({total:742,filteredTotal:24,facets});
  assert.equal(result.reason,'registered-workday-filter-unconfirmed');assert.equal(requests.length,1);assert.equal(result.rows.length,0);
 }
 const facets=[{...fixture.facets[0],values:[{...fixture.facets[0].values[0],count:24}]}];
 const ignored=await run({total:742,filteredTotal:742,facets});
 assert.equal(ignored.result.reason,'registered-workday-filter-unconfirmed');assert.equal(ignored.requests.length,2);assert.equal(ignored.result.rows.length,0);
 const over=await run({total:742,filteredTotal:25,facets});assert.equal(over.result.reason,'registered-workday-filter-unconfirmed');
});
test('Workday selectors reject all fragments including an empty trailing fragment',()=>{
 for(const suffix of ['#','#jobs','#?jobFamilyGroup='+ 'a'.repeat(32)])assert.equal(workdayQueryFacets(fixture.source.careerUrl+suffix),null);
});
test('full paths retain separate postings with a shared requisition suffix for mandatory detail validation',async()=>{
 const paths=['/job/Campus-One/Engineer_SHARED','/job/Campus-Two/Engineer_SHARED'];let detailCalls=0;
 const f=async(url)=>{
  if(url.endsWith('/jobs'))return Response.json({total:2,jobPostings:paths.map(externalPath=>({externalPath,title:'Engineer'}))});
  detailCalls++;return Response.json({jobPostingInfo:{jobReqId:'SHARED',jobPostingSiteId:'Careers',title:'Engineer',externalUrl:'https://ntu.wd3.myworkdayjobs.com/Careers'+paths.find(p=>url.endsWith(p)),location:'Singapore',country:{descriptor:'Singapore'}}});
 };
 const result=await automaticWorkday(f,{...fixture.source,careerUrl:fixture.source.careerUrl.split('?')[0]});
 assert.equal(result.rows.length,2);assert.equal(detailCalls,2);assert.equal(result.detailValidated,2);assert.equal(result.paginationComplete,true);
});

test('recorded NTU continuation total zero retains synthetic first-page total and natural row proof',async()=>{
 const recorded=JSON.parse(readFileSync(new URL('./fixtures/jobs-workday-ntu-page2-recorded.json',import.meta.url)));
 assert.equal(recorded.response.total,0);assert.equal(recorded.response.jobPostings.length,20);assert.deepEqual(recorded.response.facets,[]);
 const first=Array.from({length:20},(_,i)=>posting(i));
 const all=[...first,...recorded.response.jobPostings];
 const f=async(url,opt)=>{
  if(url.endsWith('/jobs'))return Response.json(JSON.parse(opt.body).offset===0?{total:40,jobPostings:first,facets:[]}:recorded.response);
  const row=all.find(x=>url.endsWith(x.externalPath));
  return Response.json({jobPostingInfo:{jobReqId:row.externalPath.split('_').at(-1),jobPostingSiteId:'Careers',title:row.title,externalUrl:'https://ntu.wd3.myworkdayjobs.com/Careers'+row.externalPath,location:'Singapore',country:{descriptor:'Singapore'}}});
 };
 const result=await automaticWorkday(f,{...fixture.source,careerUrl:fixture.source.careerUrl.split('?')[0]});
 assert.equal(result.reportedTotal,40);assert.equal(result.rows.length,40);assert.equal(result.paginationComplete,true);assert.equal(result.detailValidated,40);assert.deepEqual(result.phaseHttp,{listing:2,detail:40});
});
test('later zero totals never excuse short or duplicated continuation rows',async()=>{
 for(const pageChange of [(p,b)=>b.offset?{...p,total:0,jobPostings:[]}:p,(p,b)=>b.offset?{...p,total:0,jobPostings:Array.from({length:10},()=>posting(0))}:p]){
  const {result}=await run({total:30,pageChange});assert.equal(result.paginationComplete,false);
 }
 const good=await run({total:30,pageChange:(p,b)=>b.offset?{...p,total:0}:p});assert.equal(good.result.paginationComplete,true);assert.equal(good.result.reportedTotal,30);
});

test('multiple selected facet values sum within a key while every selected key constrains the result',async()=>{
 const id1=fixture.facets[0].values[0].id,id2='b'.repeat(32),id3='c'.repeat(32);
 const facets=[{facetParameter:'jobFamilyGroup',values:[{id:id1,count:12},{id:id2,count:12}]},{facetParameter:'timeType',values:[{id:id3,count:20}]}];
 const source={...fixture.source,careerUrl:fixture.source.careerUrl+'&jobFamilyGroup='+id2+'&timeType='+id3};
 const held=await run({total:742,filteredTotal:24,facets,source});assert.equal(held.result.reason,'registered-workday-filter-unconfirmed');assert.equal(held.requests.length,2);
 const accepted=await run({total:742,filteredTotal:20,facets,source});assert.equal(accepted.result.paginationComplete,true);assert.equal(accepted.result.detailValidated,20);
 assert.deepEqual(accepted.requests[1].body.appliedFacets,{jobFamilyGroup:[id1,id2],timeType:[id3]});
});

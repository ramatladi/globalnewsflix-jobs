import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {workdayQueryFacets} from '../jobs-workday-query.js';
import {automaticWorkday,registeredWorkdayFacets,collectJobs} from '../jobs.js';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/jobs-workday-ntu-list-shape.json',import.meta.url)));
const posting=i=>({externalPath:`/job/Synthetic-Campus/Synthetic-engineer_SYN${i}`,title:`Synthetic engineer ${i}`,locationsText:'Singapore',postedOn:'Posted Today'});
async function run({total=4,filteredTotal=total,facets=fixture.facets,source=fixture.source,detailChange={},pageChange=x=>x,collect=false}={}){
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
 for(const query of ['searchText=engineer','locale=en-US','utm_campaign=x','jobFamilyGroup=not-an-id',`jobFamilyGroup=${id}&jobFamilyGroup=${id}`,Array.from({length:6},(_,i)=>'jobFamilyGroup='+String(i).repeat(32)).join('&')])assert.equal(workdayQueryFacets(base+'?'+query),null,query);
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

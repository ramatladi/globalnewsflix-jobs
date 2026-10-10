import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseSimplifyList,parseSimplifyDetail} from '../jobs-simplify.js';
import {parseOracleDetail} from '../jobs-oracle-detail.js';
import {collectJobs} from '../jobs.js';
const file=name=>readFileSync(new URL(`./fixtures/${name}`,import.meta.url),'utf8');
const oracle=JSON.parse(file('jobs-oracle-public.json'));
const json=data=>new Response(JSON.stringify(data));
const list=(name)=>parseSimplifyList(file(`jobs-${name}-list.html`),`https://${name}.simplify.hr/`);

test('real Simplify public fragments yield16 AVI and2 Oceana country-backed jobs, always partial',()=>{
 for(const [name,n]of [['avi',16],['oceana',2]]){const result=list(name);assert.equal(result.rows.length,n);assert.equal(result.complete,false);assert.ok(result.rows.every(r=>['ZA',null].includes(r.country)&&r.pay===null));}
 assert.equal(list('avi').rows[0].closing,Date.parse('2026-11-06T22:00:00Z'));
 assert.equal(list('oceana').rows[0].closing,null);
 assert.equal(parseSimplifyList('<h1>Log in</h1>','https://avi.simplify.hr/'),null);
 const changed=file('jobs-oceana-list.html').replaceAll('Cape Town, Western Cape','Remote');assert.ok(parseSimplifyList(changed,'https://oceana.simplify.hr/').rows.every(r=>r.country==null));
});
test('Simplify enrichment binds URL, ID, title, tenant and city, preserving unknown conflicting publication date',()=>{
 const row=list('avi').rows[0],html=file('jobs-avi-detail.html');
 assert.equal(parseSimplifyDetail(html,row).posted,null,'list April and metadata October conflict');
 assert.equal(parseSimplifyDetail(html,row).closing,row.closing);
 for(const changed of [html.replaceAll('181277','181278'),html.replaceAll('avisharedservices.simplify.hr','other.simplify.hr'),html.replace('Payroll Administator','Different role'),html.replace('Johannesburg, Gauteng','Pretoria, Gauteng'),html.replace('2026-11-06','2026-02-30')])assert.equal(parseSimplifyDetail(changed,row),null);
});
test('Oracle actual public detail binds ID/title/country and preserves exact deadline and advertised native annual pay',()=>{
 const raw=oracle.listing.items[0].requisitionList[0];const row={id:raw.Id,title:raw.Title,country:raw.PrimaryLocationCountry,location:raw.PrimaryLocation,url:'https://example.com/job/1600'};
 const got=parseOracleDetail(oracle.detail,row);
 assert.equal(got.closing,Date.parse('2026-10-23T21:00:00Z'));assert.equal(got.posted,Date.parse('2026-10-09T21:00:00Z'));
 assert.deepEqual(got.pay,{cur:'ZAR',min:347517.13,max:451095.57,period:'year'});assert.equal(got.salary_text,'R347 517.13/R 451 095.57 pa');
 for(const patch of [{Id:'other'},{Title:'Different role'},{PrimaryLocationCountry:'US'},{PrimaryLocation:'Pretoria, South Africa'}])assert.equal(parseOracleDetail({items:[{...oracle.detail.items[0],...patch}]},row),null);
 assert.equal(parseOracleDetail({items:[{...oracle.detail.items[0],requisitionFlexFields:[{Prompt:'Remuneration',Value:'R1 2.00/R3 4.00 pa'}]}]},row).pay,null);
 const malformed=parseOracleDetail({items:[{...oracle.detail.items[0],ExternalPostedEndDate:'2026-02-30T22:00:00Z'}]},row);assert.equal(malformed,null);
 assert.equal(parseOracleDetail({items:[{...oracle.detail.items[0],requisitionFlexFields:{}}]},row),null);
 assert.equal(parseOracleDetail(oracle.detail,row,{now:Date.parse('2026-10-08T00:00:00Z')}),null);
});
test('actual fixture replay through all five collectors imports only validated rows and partial sources never prune',async()=>{
 const results={};
 for(const id of ['avi','oceana','ethekwini','uct','shoprite']){
  results[id]=await collectJobs(async url=>{
   if(url.includes('frankfurter'))return json({rates:{ZAR:18}});
   if(id==='avi'||id==='oceana'){
    if(url.includes('/vacancy/vacancies?'))return new Response(file(`jobs-${id}-list.html`));
    if(url.endsWith(id==='avi'?'/181277':'/206675'))return new Response(file(`jobs-${id}-detail.html`));
   }
   if(id==='ethekwini')return json(url.includes('Details?')?oracle.detail:oracle.listing);
   if(id==='uct'){if(url.endsWith('/search/'))return new Response(file('jobs-uct-search.html'));if(url.includes('/1415488433/'))return new Response(file('jobs-uct-detail.html'));}
   if(id==='shoprite'){if(url.endsWith('/browse/'))return new Response(file('jobs-shoprite-browse.html'));if(url.includes('/Categories/Finance/'))return new Response(file('jobs-shoprite-finance.html'));for(const ref of ['SHO261009-8','SHO261005-7'])if(url.endsWith('/'+ref))return new Response(file(`jobs-shoprite-${ref}.html`));}
   return new Response('',{status:404});
  },()=>{},[id],{requestDelayMs:0});
  assert.ok(results[id].rows.length>0,id);assert.deepEqual(results[id].ok,[],id);
 }
 assert.equal(results.avi.rows.length,15);assert.equal(results.oceana.rows.length,2);assert.equal(results.uct.rows.length,1);assert.equal(results.shoprite.rows.length,2);assert.equal(results.ethekwini.rows[0].cur,'ZAR');
});

test('invalid opt-in Oracle details never degrade into unknown-deadline imports or permit source cleanup',async()=>{
 for(const patch of [{Id:'other'},{ExternalPostedEndDate:'2026-02-30T21:00:00Z'},{ExternalPostedStartDate:'2099-10-09T21:00:00Z'},{requisitionFlexFields:{}}]){
  const result=await collectJobs(async url=>url.includes('frankfurter')?json({rates:{ZAR:18}}):url.includes('Details?')?json({items:[{...oracle.detail.items[0],...patch}]}):json({items:[{...oracle.listing.items[0],TotalJobsCount:1}]}),()=>{},['ethekwini'],{requestDelayMs:0});
  assert.equal(result.rows.length,0);assert.deepEqual(result.ok,[]);assert.equal(result.diagnostics[0].status,'partial');
 }
});
test('Simplify uncertain province needs explicit detail country; earlier genuine closing evidence is retained',()=>{
 const html=file('jobs-oceana-detail.html'),row=list('oceana').rows[1];
 assert.equal(parseSimplifyDetail(html,row).closing,row.closing);
 assert.equal(parseSimplifyDetail(html.replace('2026-10-23','2026-10-20'),row).closing,Date.parse('2026-10-20T22:00:00Z'));
 assert.equal(parseSimplifyDetail(html.replace('2026-10-23','2026-10-26'),row).closing,row.closing);
 const ambiguous=parseSimplifyList(file('jobs-oceana-list.html').replaceAll('Cape Town, Western Cape','Klerksdorp, North West'),'https://oceana.simplify.hr/').rows[1];
 assert.equal(ambiguous.country,null);
 assert.equal(parseSimplifyDetail(html.replace('Cape Town, Western Cape','Klerksdorp, North West'),ambiguous).country,'ZA');
 assert.equal(parseSimplifyDetail(html.replace('2026-10-09','2099-10-09'),row),null);
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseGautengJobs,parseGautengDetail,GAUTENG_JOBS_URL} from '../jobs-gauteng.js';
const html=readFileSync(new URL('./fixtures/jobs-gauteng.html',import.meta.url),'utf8');
const detailHtml=readFileSync(new URL('./fixtures/jobs-gauteng-detail.html',import.meta.url),'utf8');
const now=Date.parse('2026-10-10T12:00:00Z');
const one=(salary,close='2026/10/12',href='ViewJob.aspx?u=abcdefgh==')=>`<table id="tblJobs"><thead><tr>${['Position','Department','Location','Package','Closing','Action'].map(t=>`<th>${t}</th>`).join('')}</tr></thead><tbody><tr><td>Clerk</td><td>Department of Health</td><td>Pretoria</td><td>${salary}</td><td>${close}</td><td><a href="${href}">View</a></td></tr></tbody></table>`;
test('actual Gauteng rows preserve authoritative salary, location, application IDs and nullable references',()=>{
 const r=parseGautengJobs(html,{now});assert.equal(r.rows.length,20);assert.equal(r.complete,false);assert.equal(r.diagnostics.rejected,0);
 const j=r.rows[0];assert.equal(j.employer,'Gauteng Department of Health');assert.equal(j.country,'ZA');assert.equal(j.location,'Rahima Moosa Mother and Child Hospital');assert.match(j.url,/ViewJob.aspx\?u=k3JfEvoXPq5R2KVWk5m0Yw==$/);assert.equal(j.salary_url,GAUTENG_JOBS_URL);assert.equal(j.posted,null);assert.equal(j.reference,null);
 assert.deepEqual(j.pay,{cur:'ZAR',min:785568,max:898215,period:'year'});assert.equal(j.closing,Date.parse('2026-10-12T22:00:00Z'));
 assert.equal(r.rows[3].pay.min,413121);assert.equal(r.rows[14].pay,null,'multiple grade packages remain exact text rather than a misleading salary range');assert.match(r.rows[14].salary_text,/PND II/);
});
test('closing dates expire on the advertised local day boundary; invalid calendar dates are rejected',()=>{
 const s=one('R 397 116 per annum');assert.equal(parseGautengJobs(s,{now:Date.parse('2026-10-12T21:59:59Z')}).rows.length,1);assert.equal(parseGautengJobs(s,{now:Date.parse('2026-10-12T22:00:00Z')}).rows.length,0);
 const bad=parseGautengJobs(one('R 100 000 per annum','2026/02/30'),{now});assert.equal(bad.rows.length,0);assert.equal(bad.diagnostics.rejected,1);assert.equal(bad.complete,false);
});
test('native salary accepts explicit annual single/range values and preserves ambiguous packages without invention',()=>{
 for(const [salary,min,max]of [['R 1 554 696,00 - R 1 858 821,00 per annum',1554696,1858821],['R 487,197.00 per annum (plus benefit)',487197,487197],['R397116.00 (per annum plus benefits)',397116,397116]]){const pay=parseGautengJobs(one(salary),{now}).rows[0].pay;assert.equal(pay.min,min);assert.equal(pay.max,max);}
 for(const salary of ['R 100 000','R 1 139 5528 per annum','Grade 1 R 100000 Grade 2 R 200000 per annum','Negotiable'])assert.equal(parseGautengJobs(one(salary),{now}).rows[0].pay,null,salary);
});
test('changed or truncated tables and hostile application URLs fail closed, empty never permits pruning',()=>{
 for(const input of [html.replace('tblJobs','other'),html.replace('</tbody>',''),html.replace('</table>',''),'<html>Login</html>'])assert.equal(parseGautengJobs(input,{now}),null);
 for(const href of ['https://evil.example/Public/ViewJob.aspx?u=abcdefgh==','https://user:secret@jobs.gauteng.gov.za/Public/ViewJob.aspx?u=abcdefgh==','javascript:alert(1)','ViewJob.aspx?u=abcdefgh==&redirect=evil'])assert.equal(parseGautengJobs(one('R 100000 per annum',undefined,href),{now}).rows.length,0);
 const empty=html.replace(/<tbody>[\s\S]*?<\/tbody>/,'<tbody></tbody>');assert.equal(parseGautengJobs(empty,{now}).complete,false);
 const duplicate=html.replace('</tbody>',html.match(/<tr><td>[\s\S]*?<\/tr>/)[0]+'</tbody>');assert.equal(parseGautengJobs(duplicate,{now}).diagnostics.rejected,1);
 assert.doesNotThrow(()=>parseGautengJobs(one('&#x110000;'),{now}));
});

test('collector integration imports bounded normalized rows without granting finish authority',async t=>{
 const {collectJobs}=await import('../jobs.js');
 t.mock.method(Date,'now',()=>now);
 const calls=[];
 const result=await collectJobs(async url=>{calls.push(String(url));if(String(url).includes('frankfurter'))return new Response(JSON.stringify({rates:{ZAR:18}}));if(String(url)===GAUTENG_JOBS_URL)return new Response(html);if(String(url)===parseGautengJobs(html,{now}).rows[0].url)return new Response(detailHtml);return new Response('',{status:404});},()=>{},['za-gauteng']);
 assert.equal(result.rows.length,20);assert.deepEqual(result.ok,[]);assert.equal(result.diagnostics[0].status,'partial');
 for(const row of result.rows){assert.ok(row.id.startsWith('za-gauteng:'));assert.ok(row.id.length<=120);assert.equal(row.etype,'g');assert.equal(row.country,'ZA');assert.equal(row.source_url,GAUTENG_JOBS_URL);}
 assert.equal(result.rows[0].min,785568);assert.ok(result.rows[0].usd_min>0);assert.equal(result.rows[0].posted_ts,null);assert.ok(calls.length<=4);assert.equal(result.rows[0].reference,'REFS/056802');assert.equal(result.rows[1].reference,null);
});

test('actual public details bind exact reference and closing day to matching title, department and location',()=>{
 const row=parseGautengJobs(html,{now}).rows[0];const d=parseGautengDetail(detailHtml,row,{now});assert.equal(d.reference,'REFS/056802');assert.equal(d.posted,null);assert.equal(d.closed,false);assert.equal(d.closing,Date.parse('2026-10-12T22:00:00Z'));
 for(const changed of [{title:'Other role'},{employer:'Other department'},{location:'Other hospital'},{url:'https://evil.example/'}])assert.equal(parseGautengDetail(detailHtml,{...row,...changed},{now}),null);
 assert.equal(parseGautengDetail(detailHtml.replace('refs/056802','refs/'),row,{now}),null);assert.equal(parseGautengDetail(detailHtml.replace('12-10-2026','31-02-2026'),row,{now}),null);assert.equal(parseGautengDetail('<html>Login</html>',row,{now}),null);
 assert.equal(parseGautengDetail(detailHtml,row,{now:Date.parse('2026-10-12T22:00:00Z')}).closed,true);
});

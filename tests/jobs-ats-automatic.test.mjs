import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {EventEmitter} from 'node:events';
import {Readable} from 'node:stream';
import {automaticGreenhouse,automaticLever,automaticAshby,automaticRecruitee,automaticPersonio,automaticTeamtailor,explicitPlaceCountry,collectJobs} from '../jobs.js';
import {registeredDiscoveredSources,discoveredReader,discoveredJobAllowed,atsBoardUrl,dedicatedTenant} from '../jobs-discovered-sources.js';
import {automaticTransport,parseRobots,robotsAllows,maxResponseBytes} from '../jobs-discovered-fetch.mjs';
import {automaticSourceRequestLimit,automaticSourceCost,automaticSourcesFit,automaticRequestBudget,AUTOMATIC_READER_REQUEST_LIMITS,REFRESHABLE_AUTOMATIC_READERS,NTU_AUTOMATIC_SOURCE_ID} from '../jobs-request-policy.js';
import {automaticRefreshHealth} from '../jobs-source-health.js';
import {boardNamesOrganization} from '../jobs-identity-name.js';
// Fixtures were captured from the platforms' public endpoints on 18 Oct 2026 and
// shortened (see each file's note). Employers below are registered only in tests.
const fixture=name=>JSON.parse(readFileSync(new URL(`./fixtures/${name}`,import.meta.url)));
const time='2026-10-18T00:00:00.000Z';
function registered({name,country,officialDomain,careerUrl}){
 const reader=discoveredReader(careerUrl,officialDomain);
 assert.ok(reader,careerUrl);
 const s={id:'auto-'+'f'.repeat(24),name,country,type:'c',officialDomain,careerUrl,...reader,discoveredAt:time,
  identity:{method:'automatic-first-party-name-domain-country',organization:name,country,officialDomain,evidenceUrl:officialDomain,evidenceSha256:'a'.repeat(64),employerPageSha256:'b'.repeat(64),observedAt:time}};
 return registeredDiscoveredSources({version:1,sources:[s]})[0];
}
// A scoped fetch double: answers by URL and reports the transport evidence the collector reads.
function scoped(answer){
 const calls=[];
 const f=async url=>{calls.push(url);const value=await answer(url,calls.length);return value instanceof Response?value:typeof value==='string'?new Response(value,{status:200,headers:{'content-type':'application/xml'}}):Response.json(value);};
 f.calls=calls;f.diagnostics=()=>({httpRequests:calls.length,elapsedMs:calls.length*1000,budgetExhausted:false,sourceRequestCap:false});
 return f;
}
const collect=(source,f)=>collectJobs(async()=>Response.json({rates:{}}),()=>{},[source.id],{sources:[source],requestDelayMs:0,automaticFetch:()=>f});
const jumia=fixture('jobs-ats-greenhouse-jumia.json').response,palantir=fixture('jobs-ats-lever-palantir.json').pages,prosus=fixture('jobs-ats-ashby-prosus.json').response,bunq=fixture('jobs-ats-recruitee-bunq.json').response,personio=fixture('jobs-ats-personio.json').body,anton=fixture('jobs-ats-teamtailor-antonsport.json').pages;
const jumiaNg=()=>registered({name:'Jumia',country:'NG',officialDomain:'https://www.jumia.com.ng/',careerUrl:'https://job-boards.eu.greenhouse.io/jumia'});

test('Greenhouse board: one documented request, reported total and only employer-named countries',async()=>{
 const s=jumiaNg(),f=scoped(()=>jumia);
 const r=await automaticGreenhouse(f,s);
 assert.deepEqual(f.calls,['https://boards-api.greenhouse.io/v1/boards/jumia/jobs?content=true']);
 assert.equal(r.paginationComplete,true);assert.equal(r.paginationEnd,'reported-total');assert.equal(r.reportedTotal,6);assert.equal(r.pagesFetched,1);
 assert.deepEqual(r.rows.map(x=>x.country),['NG','NG','SN','UG','KE','PT']);
 // A pan-African board is not a Nigerian employer's local listing: under 90% local fails health, nothing uploads.
 const mixed=await collect(s,scoped(()=>jumia));
 assert.equal(mixed.diagnostics[0].status,'failed');assert.equal(mixed.diagnostics[0].reason,'insufficient-accepted-coverage');assert.deepEqual(mixed.rows,[]);
});
test('a local Greenhouse board refreshes healthily with board links and the employer name',async()=>{
 const s=jumiaNg(),local=jumia.jobs.filter(j=>j.location.name==='Nigeria');
 const result=await collect(s,scoped(()=>({jobs:local,meta:{total:local.length}})));
 const d=result.diagnostics[0];
 assert.equal(d.status,'partial');assert.equal(d.reason,'healthy-automatic-refresh');assert.equal(d.paginationComplete,true);assert.equal(d.paginationEnd,'reported-total');assert.equal(d.reportedTotal,2);
 assert.equal(result.rows.length,2);assert.ok(result.rows.every(r=>r.country==='NG'&&r.employer==='Jumia'&&r.url.startsWith('https://job-boards.eu.greenhouse.io/jumia/jobs/')));
 assert.deepEqual(result.ok,[],'automatic refreshes never authorize pruning');
});
test('a look-alike board, another organization and a missing total cannot pass as the employer',async()=>{
 const other={...jumiaNg(),name:'Konga',officialDomain:'https://www.konga.com/'};
 const named=await automaticGreenhouse(scoped(()=>jumia),other);
 assert.equal(named.reason,'board-organization-mismatch');assert.deepEqual(named.rows,[]);assert.equal(named.paginationComplete,false);
 const s=jumiaNg(),local=jumia.jobs.filter(j=>j.location.name==='Nigeria');
 const agency=await automaticGreenhouse(scoped(()=>({jobs:[local[0],{...local[1],company_name:'Jumia Recruiting Partners'}],meta:{total:2}})),s);
 assert.equal(agency.rows[1].countryUnresolved,true,'a posting named for another organization is never placed');
 const total=await collect(s,scoped(()=>({jobs:local,meta:{total:25}})));
 assert.equal(total.diagnostics[0].reason,'board-total-mismatch');assert.equal(total.diagnostics[0].paginationComplete,false);assert.deepEqual(total.rows,[]);
 const missing=await automaticGreenhouse(scoped(()=>({jobs:local})),s);
 assert.equal(missing.reason,'board-total-mismatch');
});

test('Lever: structured country, 100-posting pages and natural short or empty final page',async()=>{
 const s=registered({name:'Palantir Technologies',country:'SG',officialDomain:'https://www.palantir.com/',careerUrl:'https://jobs.lever.co/palantir'});
 const rows=palantir.flat(),f=scoped(()=>rows);
 const r=await automaticLever(f,s);
 assert.deepEqual(f.calls,['https://api.lever.co/v0/postings/palantir?mode=json&limit=100&skip=0']);
 assert.equal(r.paginationEnd,'short-page');assert.equal(r.paginationComplete,true);
 assert.deepEqual(r.rows.map(x=>x.country),['SG','GB','US','US']);assert.equal(r.rows[0].url,'https://jobs.lever.co/palantir/6ed76ce8-4156-4b60-b120-403538bd66cd');
 // Pagination proof uses synthetic copies of a captured posting with unique IDs.
 const page=n=>Array.from({length:n},(_,i)=>({...rows[0],id:`${rows[0].id}-${i}`}));
 const two=await automaticLever(scoped(url=>url.endsWith('skip=0')?page(100):page(3).map(x=>({...x,id:x.id+'b'}))),s);
 assert.equal(two.pagesFetched,2);assert.equal(two.paginationEnd,'short-page');assert.equal(two.rows.length,103);
 const exact=await automaticLever(scoped(url=>url.endsWith('skip=0')?page(100):[]),s);
 assert.equal(exact.paginationEnd,'empty-page');assert.equal(exact.rows.length,100);
 const repeated=await automaticLever(scoped(()=>page(100)),s);
 assert.equal(repeated.reason,'board-pagination-unconfirmed');assert.equal(repeated.paginationComplete,false);
 const eu=registered({name:'Palantir Technologies',country:'SG',officialDomain:'https://www.palantir.com/',careerUrl:'https://jobs.eu.lever.co/palantir'}),fe=scoped(()=>rows);
 await automaticLever(fe,eu);assert.equal(fe.calls[0],'https://api.eu.lever.co/v0/postings/palantir?mode=json&limit=100&skip=0');
 const healthy=await collect(s,scoped(()=>rows.filter(x=>x.country==='SG')));
 assert.equal(healthy.diagnostics[0].reason,'healthy-automatic-refresh');assert.equal(healthy.rows.length,1);
});
test('Ashby: one complete board, postal-address countries and listed postings only',async()=>{
 const s=registered({name:'Prosus',country:'NL',officialDomain:'https://www.prosus.com/',careerUrl:'https://jobs.ashbyhq.com/prosus'});
 const f=scoped(()=>prosus),r=await automaticAshby(f,s);
 assert.deepEqual(f.calls,['https://api.ashbyhq.com/posting-api/job-board/prosus?includeCompensation=true']);
 assert.equal(r.paginationEnd,'single-document');assert.equal(r.rows.length,11);
 const london=r.rows.find(x=>x.id==='c0bebb3d-21f4-4c39-b406-81d2db54b906');
 assert.equal(london.country,'NL','a secondary Amsterdam address explicitly places the London posting in the Netherlands');assert.equal(london.location,'Amsterdam');
 const unlisted=await automaticAshby(scoped(()=>({...prosus,jobs:prosus.jobs.map((j,i)=>i?j:{...j,isListed:false})})),s);
 assert.equal(unlisted.rows.length,10);
 const result=await collect(s,scoped(()=>prosus));
 assert.equal(result.diagnostics[0].reason,'healthy-automatic-refresh');assert.equal(result.rows.length,11);
});
test('Recruitee: offers name the organization; custom career-domain links stay on the employer domain',async()=>{
 const s=registered({name:'bunq',country:'NL',officialDomain:'https://www.bunq.com/',careerUrl:'https://bunq.recruitee.com/'});
 const f=scoped(()=>bunq),r=await automaticRecruitee(f,s);
 assert.deepEqual(f.calls,['https://bunq.recruitee.com/api/offers/']);
 assert.equal(r.paginationEnd,'single-document');assert.deepEqual(r.rows.map(x=>x.country),['NL','NL','NL','NL']);assert.equal(r.rows[0].location,'Amsterdam');assert.equal(r.rows[0].posted,Date.parse('2026-10-15T09:31:36Z'));
 const result=await collect(s,scoped(()=>bunq));
 assert.equal(result.diagnostics[0].reason,'healthy-automatic-refresh');assert.equal(result.rows.length,4);assert.ok(result.rows.every(x=>x.url.startsWith('https://careers.bunq.com/o/')));
 assert.equal(discoveredJobAllowed(s,{...result.rows[0],url:'https://jobs.example.org/o/head-of-product-6'}),false,'a link off the board and the employer domain is rejected');
 const other=await automaticRecruitee(scoped(()=>bunq),{...s,name:'Mollie',officialDomain:'https://www.mollie.com/'});
 assert.equal(other.reason,'board-organization-mismatch');assert.deepEqual(other.rows,[]);
});
test('Personio: documented XML feed, offices placed only by explicit country or exact city',async()=>{
 const s=registered({name:'Personio',country:'DE',officialDomain:'https://www.personio.com/',careerUrl:'https://personio.jobs.personio.de/'});
 const f=scoped(()=>personio),r=await automaticPersonio(f,s);
 assert.deepEqual(f.calls,['https://personio.jobs.personio.de/xml']);
 assert.equal(r.paginationEnd,'single-document');assert.equal(r.rows.length,1);
 assert.deepEqual({id:r.rows[0].id,title:r.rows[0].title,country:r.rows[0].country,location:r.rows[0].location,url:r.rows[0].url},{id:'1834171',title:'Staff Software Engineer, Data Platform',country:'DE',location:'Munich; Berlin',url:'https://personio.jobs.personio.de/job/1834171'});
 const remote=await automaticPersonio(scoped(()=>personio.replace(/<office>Munich<\/office>/,'<office>Remote</office>').replace(/<office>Berlin<\/office>/,'<office>Head office</office>')),s);
 assert.equal(remote.rows[0].countryUnresolved,true);
 assert.equal((await automaticPersonio(scoped(()=>'<html>Not found</html>'),s)).reason,'board-response-invalid');
 const result=await collect(s,scoped(()=>personio));
 assert.equal(result.diagnostics[0].reason,'healthy-automatic-refresh');assert.equal(result.rows[0].country,'DE');
});
test('Teamtailor: RSS pages until an empty page, channel names the employer, explicit location countries',async()=>{
 const s=registered({name:'Anton Sport',country:'NO',officialDomain:'https://www.antonsport.no/',careerUrl:'https://antonsport.teamtailor.com/jobs'});
 const empty=anton[0].replace(/<item>[\s\S]*<\/item>/,'');
 const f=scoped(url=>url.endsWith('offset=0')?anton[0]:url.endsWith('offset=100')?anton[1]:empty),r=await automaticTeamtailor(f,s);
 assert.deepEqual(f.calls,[0,100,200].map(n=>`https://antonsport.teamtailor.com/jobs.rss?per_page=100&offset=${n}`));
 assert.equal(r.paginationEnd,'empty-page');assert.equal(r.pagesFetched,3);assert.equal(r.paginationComplete,true);
 assert.deepEqual(r.rows.map(x=>[x.country,x.location]),[['NO','Oslo'],['SE','Stockholm, Sweden'],['SE','Stockholm, Sweden'],['GB','London, United Kingdom']]);
 const mixed=await collect(s,scoped(url=>url.endsWith('offset=0')?anton[0]:url.endsWith('offset=100')?anton[1]:empty));
 assert.equal(mixed.diagnostics[0].reason,'insufficient-accepted-coverage');assert.deepEqual(mixed.rows,[]);
 const other=await automaticTeamtailor(scoped(()=>anton[0]),{...s,name:'Venzo',officialDomain:'https://www.venzo.no/'});
 assert.equal(other.reason,'board-organization-mismatch');
 const repeated=await automaticTeamtailor(scoped(()=>anton[0]),s);
 assert.equal(repeated.reason,'board-pagination-unconfirmed');
});
test('explicit place countries never come from states, regions or exclusions',()=>{
 for(const [place,cc] of [['Nigeria','NG'],['Lagos, Nigeria','NG'],['France - Paris','FR'],['Remote - Kenya','KE'],['Remote (South Africa)','ZA'],['Nairobi','KE'],['Munich','DE']])assert.equal(explicitPlaceCountry(place),cc,place);
 for(const place of ['Remote','Atlanta, Georgia','Georgia','Austin, TX','Cape Town, ZA','Remote - anywhere except Kenya','Lagos, Nigeria, Ghana','Head office'])assert.equal(explicitPlaceCountry(place),null,place);
});
test('board links reduce to the employer board; filtered boards and platform subdomains have no reader',()=>{
 const official='https://www.acme.co.za/';
 for(const [link,url,ats] of [
  ['https://boards.greenhouse.io/embed/job_board?for=acme&b=https://www.acme.co.za/careers','https://job-boards.greenhouse.io/acme','gh'],
  ['https://boards.greenhouse.io/acme/jobs/4980196101?gh_src=site','https://job-boards.greenhouse.io/acme','gh'],
  ['https://jobs.lever.co/acme/6ed76ce8-4156-4b60-b120-403538bd66cd/apply','https://jobs.lever.co/acme','lever'],
  ['https://jobs.ashbyhq.com/acme/embed?version=2','https://jobs.ashbyhq.com/acme','ashby'],
  ['https://acme.recruitee.com/o/engineer','https://acme.recruitee.com/','recruitee'],
  ['https://acme.jobs.personio.com/job/1834171?language=en','https://acme.jobs.personio.com/','personio'],
  ['https://acme.teamtailor.com/jobs/3215780-ios-developer','https://acme.teamtailor.com/jobs','teamtailor'],
 ]){assert.equal(atsBoardUrl(link),url,link);assert.equal(discoveredReader(url,official)?.ats,ats,url);}
 for(const link of ['https://jobs.lever.co/acme?location=Johannesburg','https://acme.teamtailor.com/jobs?department=sales','https://boards.greenhouse.io/embed/job_board?for=acme&for=other','https://www.recruitee.com/','https://careers.teamtailor.com/jobs','https://app.recruitee.com/','https://acme.teamtailor.com/connect'])assert.equal(discoveredReader(atsBoardUrl(link),official),null,link);
 // Shared or agency boards are not the employer's own tenant.
 for(const [ats,args] of [['gh',['talentagency']],['recruitee',['recruitmentpartners']],['personio',['acmegroupholding','de']]])assert.equal(dedicatedTenant({ats,args,name:'Acme Limited',officialDomain:official}),false,args[0]);
 for(const slug of ['acme','acmelimited'])assert.equal(dedicatedTenant({ats:'gh',args:[slug],name:'Acme Limited',officialDomain:official}),true,slug);
 assert.equal(boardNamesOrganization('Jobs at Acme Recruitment',['Acme Limited']),false);assert.equal(boardNamesOrganization('Jobs at Acme',['Acme Limited']),true);
});

// Transport double: answers by URL and records what was sent.
function fakeHttps(routes,sent){
 return (u,_options,onResponse)=>{
  sent.push(u.href);const req=new EventEmitter();
  req.end=()=>{const [status,body,headers={}]=routes(u);const res=Readable.from([Buffer.from(body)]);res.statusCode=status;res.headers=headers;res.once('end',()=>req.emit('close'));onResponse(res);};
  req.destroy=error=>{req.emit('error',error);req.emit('close');};return req;
 };
}
const gh=slug=>({...jumiaNg(),id:'auto-'+slug.padEnd(24,'0').slice(0,24),args:[slug]});
const transportFor=(routes,extra={})=>{const sent=[],pauses=[];return {sent,pauses,factory:automaticTransport({platformPace:async(_u,send)=>send(),now:()=>0,pause:async ms=>{pauses.push(ms);},resolver:async()=>[{address:'8.8.8.8'}],transport:fakeHttps(routes,sent),...extra})};};
test('robots.txt disallowing automatic agents stops a board reader before any listing request',async()=>{
 const {sent,factory}=transportFor(u=>u.pathname==='/robots.txt'?[200,'User-agent: LinkedInBot\nAllow: /v1/\nUser-agent: *\nDisallow: /\n']:[200,'{}']);
 const s=gh('jumia'),f=factory(s);
 await assert.rejects(f('https://boards-api.greenhouse.io/v1/boards/jumia/jobs?content=true'),e=>e.code==='AUTOMATIC_ROBOTS_DISALLOWED');
 assert.deepEqual(sent,['https://boards-api.greenhouse.io/robots.txt']);assert.equal(f.diagnostics().robotsDisallowed,true);assert.equal(f.diagnostics().httpRequests,1,'the robots.txt request counts in the source budget');
 const result=await collectJobs(async()=>Response.json({rates:{}}),()=>{},[s.id],{sources:[s],requestDelayMs:0,automaticFetch:()=>f});
 assert.equal(result.diagnostics[0].status,'failed');assert.equal(result.diagnostics[0].reason,'robots-disallowed');assert.deepEqual(result.rows,[]);
 assert.equal(automaticRefreshHealth({...result.diagnostics[0],ats:'gh'}).healthy,false);
});
test('robots.txt is read once per origin, a 401 or 404 file allows, a server error disallows',async()=>{
 const {sent,factory}=transportFor(u=>u.pathname==='/robots.txt'?[401,'Unauthorized']:[200,JSON.stringify({jobs:[]})]);
 const one=factory(gh('jumia')),two=factory(gh('other'));
 assert.equal((await one('https://boards-api.greenhouse.io/v1/boards/jumia/jobs')).status,200);
 assert.equal((await two('https://boards-api.greenhouse.io/v1/boards/other/jobs')).status,200);
 assert.deepEqual(sent,['https://boards-api.greenhouse.io/robots.txt','https://boards-api.greenhouse.io/v1/boards/jumia/jobs','https://boards-api.greenhouse.io/v1/boards/other/jobs'],'a refused robots.txt does not cool the host');
 const failing=transportFor(u=>u.pathname==='/robots.txt'?[503,'busy']:[200,'{}']);
 await assert.rejects(failing.factory(gh('jumia'))('https://boards-api.greenhouse.io/v1/boards/jumia/jobs'),e=>e.code==='AUTOMATIC_ROBOTS_DISALLOWED');
});
test('a board robots.txt redirect to the employer career domain is followed; crawl-delay is honoured',async()=>{
 const s=registered({name:'bunq',country:'NL',officialDomain:'https://www.bunq.com/',careerUrl:'https://bunq.recruitee.com/'});
 const {sent,pauses,factory}=transportFor(u=>u.hostname==='bunq.recruitee.com'&&u.pathname==='/robots.txt'?[302,'',{location:'https://careers.bunq.com/robots.txt'}]:u.pathname==='/robots.txt'?[200,'User-agent: *\nCrawl-delay: 2\nDisallow: /admin/\n']:[200,'{"offers":[]}']);
 assert.equal((await factory(s)('https://bunq.recruitee.com/api/offers/')).status,200);
 assert.deepEqual(sent,['https://bunq.recruitee.com/robots.txt','https://careers.bunq.com/robots.txt','https://bunq.recruitee.com/api/offers/']);
 assert.equal(pauses.at(-1),2000);
 const offsite=transportFor(u=>u.pathname==='/robots.txt'?[302,'',{location:'https://elsewhere.example.org/robots.txt'}]:[200,'{}']);
 await assert.rejects(offsite.factory(s)('https://bunq.recruitee.com/api/offers/'),e=>e.code==='AUTOMATIC_ROBOTS_DISALLOWED','an off-scope robots redirect fails closed');
});
test('robots rules: own-agent group wins, longest match decides, Workday keeps its reviewed request count',async()=>{
 const rules=parseRobots('User-agent: *\nAllow: /\n\nUser-agent: GlobalNewsflix-careers\nDisallow: /v0/\nAllow: /v0/postings/open\n');
 assert.equal(robotsAllows(rules,'/v0/postings/acme'),false);assert.equal(robotsAllows(rules,'/v0/postings/open'),true);assert.equal(robotsAllows(parseRobots('User-agent: *\nDisallow: /embed/\n'),'/v1/boards/acme/jobs'),true);
 const {sent,factory}=transportFor(()=>[200,'{}']);
 const wd={...jumiaNg(),ats:'wd',args:['acme.wd3.myworkdayjobs.com','acme','External'],careerUrl:'https://acme.wd3.myworkdayjobs.com/External'};
 await factory(wd)('https://acme.wd3.myworkdayjobs.com/wday/cxs/acme/External/jobs',{method:'POST',body:'{}'});
 assert.deepEqual(sent,['https://acme.wd3.myworkdayjobs.com/wday/cxs/acme/External/jobs']);
});
test('a whole board may be up to 8 MB while Workday pages keep their 2 MB bound',async()=>{
 assert.equal(maxResponseBytes(gh('jumia')),8000000);assert.equal(maxResponseBytes({ats:'wd'}),2000000);
 const big=JSON.stringify({jobs:[],meta:{total:0},pad:'x'.repeat(3000000)});
 const {factory}=transportFor(u=>u.pathname==='/robots.txt'?[404,'']:[200,big]);
 assert.equal((await factory(gh('jumia'))('https://boards-api.greenhouse.io/v1/boards/jumia/jobs?content=true')).status,200);
 const wd={...jumiaNg(),ats:'wd',args:['acme.wd3.myworkdayjobs.com','acme','External'],careerUrl:'https://acme.wd3.myworkdayjobs.com/External'};
 await assert.rejects(factory(wd)('https://acme.wd3.myworkdayjobs.com/wday/cxs/acme/External/jobs',{method:'POST',body:'{}'}),/too large/);
});
test('per-reader request limits fit the 2,500-request run; the cheaper boards raise the ceiling',()=>{
 assert.deepEqual(AUTOMATIC_READER_REQUEST_LIMITS,{wd:100,gh:4,ashby:4,recruitee:4,personio:4,lever:15,teamtailor:15});
 assert.deepEqual([...REFRESHABLE_AUTOMATIC_READERS].sort(),['ashby','gh','lever','personio','recruitee','teamtailor','wd']);
 assert.equal(automaticSourceRequestLimit(NTU_AUTOMATIC_SOURCE_ID),134);assert.equal(automaticSourceRequestLimit(NTU_AUTOMATIC_SOURCE_ID,'gh'),4,'the NTU exception is Workday-only');
 assert.equal(automaticSourceRequestLimit('auto-x','sr'),100,'readers without refresh evidence keep the default bound');
 assert.equal(automaticSourceCost('auto-x','gh'),8,'a shared API host costs two seconds per request');assert.equal(automaticSourceCost('auto-x','recruitee'),4);
 const id=n=>'auto-'+String(n).padStart(24,'0'),of=(ats,n,from=0)=>Array.from({length:n},(_,i)=>({id:id(from+i),ats}));
 const workday=[{id:NTU_AUTOMATIC_SOURCE_ID,ats:'wd'},...of('wd',23)];
 assert.equal(automaticSourcesFit(workday),true);
 assert.equal(automaticSourcesFit([...workday,...of('gh',8,100)]),true,'eight Greenhouse boards still fit beside a full Workday ceiling');
 assert.equal(automaticSourcesFit([...workday,...of('gh',9,100)]),false);
 assert.equal(automaticSourcesFit([{id:NTU_AUTOMATIC_SOURCE_ID,ats:'wd'},...of('recruitee',591)]),true);
 assert.equal(automaticSourcesFit([{id:NTU_AUTOMATIC_SOURCE_ID,ats:'wd'},...of('recruitee',592)]),false);
 assert.equal(automaticSourcesFit(of('gh',312)),true);assert.equal(automaticSourcesFit(of('gh',313)),false,'shared-host time binds before requests');
 assert.ok(automaticRequestBudget()<=2500);
});

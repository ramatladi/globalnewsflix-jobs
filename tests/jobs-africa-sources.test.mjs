import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { collectJobs, parseJobGeography, strictWorkdayPlace, SOURCES } from '../jobs.js';
const fixture = name => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const detail = fixture('jobs-dangote-ibese-detail.html');
const row = { title: 'Technician, Mechanical L3&4', url: 'https://careers.dangote.com/job/Ibese-Plant-Technician%2C-Mechanical-L3&4-Ibes/820146402/', location: 'Ibese Plant, Ibese Plant' };
const json = value => new Response(JSON.stringify(value));
// Test the reusable opt-in parser with an ephemeral fixture source. Dangote
// itself is intentionally not registered: its live metadata conflicts.
async function collectFixture(fetchImpl) {
  const source = {id:'fixture-dangote',name:'Fixture only',type:'c',ats:'sf',args:['careers.dangote.com'],detailGeography:true};
  SOURCES.push(source);
  try { return await collectJobs(fetchImpl,()=>{},[source.id],{requestDelayMs:0}); }
  finally { SOURCES.splice(SOURCES.indexOf(source),1); }
}
test('active Africa batch excludes held Dangote and contains only validated Kenya sources',()=>{
  assert.ok(!SOURCES.some(s=>s.id==='dangote'));
  for(const id of ['safaricom','diageo','cbk']) assert.ok(SOURCES.some(s=>s.id===id));
});

test('captured Dangote detail binds canonical/title and explicit microdata country without plant inference', () => {
  const got = parseJobGeography(detail, row);
  assert.equal(got.country, 'NG'); assert.equal(got.location, 'Ibese Plant');
  for (const changed of [
    detail.replace('820146402/', '999999/'),
    detail.replace('Technician, Mechanical L3&amp;4', 'Different job'),
    detail.replace('content="NG"', 'content=""'),
    detail.replace('content="NG"', 'content="Ibese"'),
    detail.replace('<meta itemprop="addressCountry" content="NG">', '<meta itemprop="addressCountry" content="NG"><meta itemprop="addressCountry" content="TZ">'),
    detail + '<div itemscope itemtype="http://schema.org/JobPosting"></div>',
    detail.replace('itemtype="http://schema.org/PostalAddress"', 'itemtype="http://schema.org/Thing"'),
    detail.replace('itemprop="jobLocation"', 'itemprop="hiringOrganization"'),
    detail.replace('itemtype="http://schema.org/JobPosting"', 'data-itemtype="http://schema.org/JobPosting"'),
    detail.replace('itemscope="itemscope"', ''),
    detail.replace('itemtype="http://schema.org/Place"', 'itemtype="http://schema.org/Organization"'),
    detail.replace('itemprop="address"', 'itemprop="relatedAddress"'),
    detail.replace('itemprop="jobLocation" itemscope', 'itemprop="jobLocation"'),
    detail.replace('itemprop="address" itemscope', 'itemprop="address"'),

  ]) assert.equal(parseJobGeography(changed, row), null);
  assert.equal(parseJobGeography('<h1>Sign in</h1>', row), null);
});

test('JSON-LD geography requires explicit matching URL/title and rejects unrelated or multi-country jobs', () => {
  const posting = { '@type': 'JobPosting', title: row.title, url: row.url, jobLocation: { address: { addressCountry: 'Nigeria', addressLocality: 'Ibese Plant' } } };
  const html = value => `<script type="application/ld+json">${JSON.stringify(value)}</script>`;
  assert.equal(parseJobGeography(html(posting), row).country, 'NG');
  for (const value of [{ ...posting, url: undefined }, { ...posting, url: row.url.replace('820146402', '999') }, { ...posting, title: 'Other job' }, { ...posting, jobLocation: [posting.jobLocation, { address: { addressCountry: 'Tanzania' } }] }, [posting, { ...posting, title: 'Other job', jobLocation: null }]]) assert.equal(parseJobGeography(html(value), row), null);
});

test('Dangote fixture collector fetches decoded observed URLs and places only country-validated details, always partial', async () => {
  let detailRequests = 0;
  const result = await collectFixture(async url => {
    if (url.includes('frankfurter')) return json({ rates: {} });
    if (url.includes('/search/')) return new Response(fixture('jobs-dangote-public.html'));
    assert.ok(!url.includes('&amp;'));
    detailRequests++;
    return url === row.url ? new Response(detail) : new Response('', { status: 404 });
  });
  assert.equal(result.rows.length, 1); assert.equal(result.rows[0].country, 'NG');
  assert.equal(result.rows[0].location, 'Ibese Plant'); assert.equal(result.rows[0].url, row.url);
  assert.equal(result.rows[0].posted_ts, Date.parse('2026-10-10T02:00:00Z'));
  assert.equal(result.rows[0].closing_ts, null);
  assert.ok(detailRequests > 0 && detailRequests <= 250);
  assert.deepEqual(result.ok, []); assert.equal(result.diagnostics[0].status, 'partial');
});

test('Dangote does not invent a cutoff for date-only deadlines or recover geography from a failed detail', async () => {
  for (const [body, status, count] of [[detail.replace('<meta itemprop="datePosted"', '<meta itemprop="validThrough" content="2026-10-31"><meta itemprop="datePosted"'), 200, 1], [detail.replace('820146402/', '999/'), 200, 0], ['', 403, 0]]) {
    const result = await collectFixture(async url => url.includes('frankfurter') ? json({ rates: {} }) : url.includes('/search/') ? new Response(fixture('jobs-dangote-public.html')) : url === row.url ? new Response(body, { status }) : new Response('', { status: 404 }));
    assert.equal(result.rows.length, count); if (count) assert.equal(result.rows[0].closing_ts, null);
    assert.deepEqual(result.ok, []);
  }
});

test('captured Safaricom public Oracle response yields its two explicit Kenya jobs', async () => {
  const captured = JSON.parse(fixture('jobs-safaricom-public.json'));
  const result = await collectJobs(async url => url.includes('frankfurter') ? json({ rates: {} }) : json(captured), () => {}, ['safaricom'], { requestDelayMs: 0 });
  assert.equal(result.rows.length, 2); assert.deepEqual(result.rows.map(r => r.id).sort(), ['safaricom:1561', 'safaricom:1569']);
  assert.ok(result.rows.every(r => r.country === 'KE'));
});

test('Dangote detail enrichment attempts exactly250 of251 postings and never authorizes pruning', async () => {
  const tile = (id) => `<li class="job-tile x"><a href="/job/Role/${id}/">Role ${id}</a><div id="job-${id}-desktop-section-location-value">Ibese Plant</div></li>`;
  const listing = `<ul>${Array.from({length:251},(_,i)=>tile(i+1)).join('')}</ul>`;
  let attempts = 0;
  const result = await collectFixture(async url => {
    if (url.includes('frankfurter')) return json({rates:{}});
    if (url.includes('/search/')) return new Response(url.includes('startrow=0') ? listing : '<ul></ul>');
    attempts++; const id = url.match(/\/(\d+)\/$/)[1];
    return new Response(`<link rel="canonical" href="${url}"><div itemscope itemtype="http://schema.org/JobPosting"><h1 itemprop="title">Role ${id}</h1><span itemprop="jobLocation" itemscope itemtype="http://schema.org/Place"><span itemprop="address" itemscope itemtype="http://schema.org/PostalAddress"><meta itemprop="addressCountry" content="NG"><meta itemprop="addressLocality" content="Ibese Plant"></span></span></div>`);
  });
  assert.equal(attempts,250); assert.equal(result.rows.length,250);
  assert.ok(!result.rows.some(r=>r.id==='fixture-dangote:251'));
  assert.equal(result.diagnostics[0].rawCount,251); assert.equal(result.diagnostics[0].status,'partial'); assert.deepEqual(result.ok,[]);
});

const diageoDetails = JSON.parse(fixture('jobs-diageo-geography.json'));
const detailRow = (info, country) => ({id:info.jobReqId,title:info.title,url:info.externalUrl,country});
test('captured Diageo details retain valid India additional locations and reject GB facet for Ireland-only job',()=>{
  for(const {jobPostingInfo:info} of diageoDetails){
    const country=info.jobReqId==='JR1125269'?'GB':'IN';
    const place=strictWorkdayPlace(info,detailRow(info,country),'Diageo_Careers');
    if(country==='GB')assert.equal(place,null);else{assert.equal(place.country,'IN');assert.match(place.location,/,\s*India$/i);}
  }
});
test('strict Workday details bind ID/site/title/URL and reject ambiguous or malformed geography',()=>{
  const info=diageoDetails.find(x=>x.jobPostingInfo.jobReqId==='JR1130878').jobPostingInfo,row=detailRow(info,'IN');
  for(const patch of [{jobReqId:'other'},{jobPostingSiteId:'other'},{title:'other'},{externalUrl:info.externalUrl+'-other'},{country:{descriptor:'Unknown'}},{additionalLocations:{}},{additionalLocations:['Atlanta, Georgia']},{additionalLocations:['Bangalore Karle Town SEZ']},{jobRequisitionLocation:{country:{descriptor:'Ireland'}}}])assert.equal(strictWorkdayPlace({...info,...patch},row,'Diageo_Careers'),null);
  assert.equal(strictWorkdayPlace(info,{...row,country:null},'Diageo_Careers'),null);
  for(const label of ['Atlanta, Georgia','Atlanta, Georgia.','Atlanta, Georgia 30303']) assert.equal(strictWorkdayPlace({...info,additionalLocations:[label]},{...row,country:'GE'},'Diageo_Careers'),null);
});
test('Diageo failed or contradictory details remain omitted and partial with no fallback',async()=>{
  const info=diageoDetails.find(x=>x.jobPostingInfo.jobReqId==='JR1125269').jobPostingInfo;
  const path=new URL(info.externalUrl).pathname.replace('/Diageo_Careers','');
  for(const fail of [false,true]){
    const result=await collectJobs(async(url,options)=>{
      if(url.includes('frankfurter'))return json({rates:{}});
      if(url.endsWith('/jobs'))return json({total:1,jobPostings:[{title:info.title,externalPath:path,locationsText:'Limerick, Republic of Ireland'}],facets:[{facetParameter:'locationCountry',values:[{id:'gb',descriptor:'United Kingdom',count:1}]}]});
      return fail?new Response('',{status:404}):json({jobPostingInfo:info});
    },()=>{},['diageo'],{requestDelayMs:0});
    assert.equal(result.rows.length,0);assert.equal(result.diagnostics[0].status,'partial');assert.deepEqual(result.ok,[]);
  }
});
test('Diageo targets Kenya within250 detail budget, omits unvalidated remainder and never claims full source',async()=>{
  const names={IN:'India',US:'United States',GB:'United Kingdom',FR:'France',KE:'Kenya'};
  const boards=Object.fromEntries(Object.keys(names).map(cc=>[cc,Array.from({length:cc==='KE'?2:64},(_,i)=>({title:`Role ${cc}${i}`,externalPath:`/job/${cc}/Role_${cc}${i}`,locationsText:`Office, ${names[cc]}`}))]));
  const attempts=[];
  const result=await collectJobs(async(url,options)=>{
    if(url.includes('frankfurter'))return json({rates:{}});
    if(url.endsWith('/jobs')){
      const body=JSON.parse(options.body),cc=body.appliedFacets.locationCountry?.[0];
      if(!cc)return json({total:258,jobPostings:[],facets:[{facetParameter:'locationCountry',values:Object.keys(names).map(cc=>({id:cc,descriptor:names[cc],count:boards[cc].length}))}]});
      const all=boards[cc];return json({total:all.length,jobPostings:all.slice(body.offset,body.offset+20)});
    }
    const id=url.split('_').at(-1),cc=id.slice(0,2);attempts.push(id);
    return json({jobPostingInfo:{jobReqId:id,title:`Role ${id}`,jobPostingSiteId:'Diageo_Careers',externalUrl:`https://diageo.wd3.myworkdayjobs.com/Diageo_Careers/job/${cc}/Role_${id}`,country:{descriptor:names[cc]},location:`Office, ${names[cc]}`}});
  },()=>{},['diageo'],{requestDelayMs:0});
  assert.equal(attempts.length,250);assert.deepEqual(attempts.slice(0,2),['KE0','KE1']);
  assert.equal(result.rows.length,250);assert.equal(result.rows.filter(r=>r.country==='KE').length,2);
  assert.equal(result.diagnostics[0].rawCount,258);assert.equal(result.diagnostics[0].status,'partial');assert.deepEqual(result.ok,[]);
  assert.ok(!result.rows.some(r=>r.id==='diageo:FR63'));
});

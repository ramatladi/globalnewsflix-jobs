import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseJobDates } from '../jobs-dates.js';
import { collectJobs, createJobFetch, countryOf } from '../jobs.js';
const fixtures = JSON.parse(readFileSync(new URL('./fixtures/jobs-detail-dates.json', import.meta.url)));
const page = (date, title = 'Engineer') => `<h1>${title}</h1><script type="application/ld+json">${JSON.stringify({'@type':'JobPosting',title,datePosted:'2026-10-01',validThrough:date})}</script>`;

test('twenty real employer detail excerpts preserve exact deadlines and the explicit Sasol location', () => {
  const rows = fixtures.samples;
  assert.equal(rows.length, 20);
  for (const row of rows) assert.deepEqual(parseJobDates(row.html, row), row.expected, row.id);
  const discovery = rows.find(r => r.id === 'discovery:1382759533');
  assert.equal(parseJobDates(discovery.html, discovery).closing, Date.parse('2026-11-30T22:00:00Z'));
  const sasol = rows.find(r => r.id === 'sasol:1445056333');
  assert.equal(parseJobDates(sasol.html, sasol).location, 'Durban');
});

test('invalid calendar dates, missing time zones and unknown date-only closing times remain unknown', () => {
  for (const date of ['2026-02-30T22:00:00Z','2026-13-01T22:00:00Z','2026-02-29T22:00:00Z','Fri Feb 30 22:00:00 UTC 2026','2026-10-16T24:00:00Z','2026-10-16T22:00:00','2026-10-16']) assert.equal(parseJobDates(page(date), {title:'Engineer',country:'ZA'}).closing, null, date);
  assert.equal(parseJobDates(page('2028-02-29T22:00:00Z'), {title:'Engineer'}).closing, Date.parse('2028-02-29T22:00:00Z'));
});

test('detail redirects, login pages and unrelated recommendations cannot attach dates', () => {
  for (const html of [page('2026-10-16T22:00:00Z','Different job'), '<h1>Log in</h1>', page('2026-10-16T22:00:00Z','Different job')+'<h1>Engineer</h1>']) assert.equal(parseJobDates(html, {title:'Engineer'}).closing, null);
  assert.equal(parseJobDates(page('2026-10-16T22:00:00Z','Engineer &amp; Analyst'), {title:'  ENGINEER & Analyst '}).closing, Date.parse('2026-10-16T22:00:00Z'));
});

test('detail 401/404 or changed title retains safe listing without a fabricated deadline', async () => {
  for (const failure of [401,404,'changed']) {
    const result = await collectJobs(async url => {
      if (url.includes('frankfurter')) return new Response(JSON.stringify({rates:{ZAR:18}}));
      if (url.includes('/v1/companies/')) return new Response(JSON.stringify({totalFound:1,content:[{id:'real1',name:'Engineer',location:{country:'za',fullLocation:'Johannesburg'}}]}));
      return failure === 'changed' ? new Response(page('2026-10-16T22:00:00Z','Different job')) : new Response('', {status:failure});
    }, () => {}, ['standardbank']);
    assert.equal(result.rows.length,1); assert.equal(result.rows[0].closing_ts,null);
  }
});

test('host requests serialize, respect cooldowns and keep fixture fetches fast', async () => {
  let active=0,max=0,calls=0;
  const f=createJobFetch(async()=>{calls++;active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,2));active--;return new Response('{}');});
  await Promise.all([f('https://example.com/1'),f('https://example.com/2')]);
  assert.equal(max,1);assert.equal(calls,2);
  calls=0;const blocked=createJobFetch(async()=>{calls++;return new Response('',{status:429,headers:{'retry-after':'120'}});});
  await blocked('https://example.com/1'); await blocked('https://example.com/2');
  assert.equal(calls,1);await blocked('https://another.example/1');assert.equal(calls,2);
});

test('observed ZAF location suffix outranks ambiguous provincial abbreviation and service pagination stays partial', async () => {
  assert.equal(countryOf('Upington, NC, ZAF,'),'ZA');assert.equal(countryOf('Paarl, Wc, ZAF,'),'ZA');
  let services=0;
  const result=await collectJobs(async url=>{
    if(url.includes('frankfurter'))return new Response(JSON.stringify({rates:{ZAR:18}}));
    if(url.includes('/search/'))return new Response('<script>CSRFToken="fixture-token";</script>');
    if(url.includes('/services/'))return ++services===1 ? new Response(JSON.stringify({jobSearchResult:[{response:{id:'28306',unifiedStandardTitle:'Financial Adviser',jobLocationShort:['Upington, NC, ZAF,'],urlTitle:'Financial-Adviser',supportedLocales:['en_GB'],unifiedStandardStart:'09/01/2026'}}]})) : new Response('',{status:403});
    return new Response('',{status:404});
  },()=>{},['sanlam']);
  assert.equal(result.rows.length,1);assert.equal(result.rows[0].country,'ZA');assert.deepEqual(result.ok,[]);assert.equal(result.diagnostics[0].status,'partial');
});

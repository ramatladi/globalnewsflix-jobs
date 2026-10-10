import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { collectJobs, parseJobGeography } from '../jobs.js';
const fixture = name => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const detail = fixture('jobs-dangote-ibese-detail.html');
const row = { title: 'Technician, Mechanical L3&4', url: 'https://careers.dangote.com/job/Ibese-Plant-Technician%2C-Mechanical-L3&4-Ibes/820146402/', location: 'Ibese Plant, Ibese Plant' };
const json = value => new Response(JSON.stringify(value));

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
  const result = await collectJobs(async url => {
    if (url.includes('frankfurter')) return json({ rates: {} });
    if (url.includes('/search/')) return new Response(fixture('jobs-dangote-public.html'));
    assert.ok(!url.includes('&amp;'));
    detailRequests++;
    return url === row.url ? new Response(detail) : new Response('', { status: 404 });
  }, () => {}, ['dangote'], { requestDelayMs: 0 });
  assert.equal(result.rows.length, 1); assert.equal(result.rows[0].country, 'NG');
  assert.equal(result.rows[0].location, 'Ibese Plant'); assert.equal(result.rows[0].url, row.url);
  assert.equal(result.rows[0].posted_ts, Date.parse('2026-10-10T02:00:00Z'));
  assert.equal(result.rows[0].closing_ts, null);
  assert.ok(detailRequests > 0 && detailRequests <= 250);
  assert.deepEqual(result.ok, []); assert.equal(result.diagnostics[0].status, 'partial');
});

test('Dangote does not invent a cutoff for date-only deadlines or recover geography from a failed detail', async () => {
  for (const [body, status, count] of [[detail.replace('<meta itemprop="datePosted"', '<meta itemprop="validThrough" content="2026-10-31"><meta itemprop="datePosted"'), 200, 1], [detail.replace('820146402/', '999/'), 200, 0], ['', 403, 0]]) {
    const result = await collectJobs(async url => url.includes('frankfurter') ? json({ rates: {} }) : url.includes('/search/') ? new Response(fixture('jobs-dangote-public.html')) : url === row.url ? new Response(body, { status }) : new Response('', { status: 404 }), () => {}, ['dangote'], { requestDelayMs: 0 });
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
  const result = await collectJobs(async url => {
    if (url.includes('frankfurter')) return json({rates:{}});
    if (url.includes('/search/')) return new Response(url.includes('startrow=0') ? listing : '<ul></ul>');
    attempts++; const id = url.match(/\/(\d+)\/$/)[1];
    return new Response(`<link rel="canonical" href="${url}"><div itemscope itemtype="http://schema.org/JobPosting"><h1 itemprop="title">Role ${id}</h1><span itemprop="jobLocation" itemscope itemtype="http://schema.org/Place"><span itemprop="address" itemscope itemtype="http://schema.org/PostalAddress"><meta itemprop="addressCountry" content="NG"><meta itemprop="addressLocality" content="Ibese Plant"></span></span></div>`);
  },()=>{},['dangote'],{requestDelayMs:0});
  assert.equal(attempts,250); assert.equal(result.rows.length,250);
  assert.ok(!result.rows.some(r=>r.id==='dangote:251'));
  assert.equal(result.diagnostics[0].rawCount,251); assert.equal(result.diagnostics[0].status,'partial'); assert.deepEqual(result.ok,[]);
});

import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { collectJobs, normalizeCollectedJob, SOURCES } from '../jobs.js';
import { detectJobSystem, parseJobPostings } from '../jobs-adapters.js';
const response = data => new Response(JSON.stringify(data));
const fx = { rates: { ZAR: 18, GBP: .8 } };
const gh = id => ({ id, title: 'Engineer', location: { name: 'Johannesburg' }, absolute_url: `https://careers.airbnb.com/${id}` });
const run = (answer, ids = ['airbnb']) => collectJobs(async (url, opts) => url.includes('frankfurter') ? response(fx) : answer(url, opts), () => {}, ids);

test('authoritative zero is complete, malformed and failed boards never authorize removal', async () => {
  const zero = await run(() => response({ jobs: [] }));
  assert.deepEqual(zero.ok, ['airbnb']); assert.equal(zero.diagnostics[0].status, 'complete');
  for (const value of [{}, { jobs: null }]) {
    const invalid = await run(() => response(value));
    assert.deepEqual(invalid.ok, []); assert.equal(invalid.diagnostics[0].status, 'failed');
  }
  const failed = await run(() => new Response('', { status: 403 }));
  assert.deepEqual(failed.ok, []);
});

test('rejected and duplicate rows cannot authorize replacing a full board', async () => {
  for (const jobs of [[gh(1), { ...gh(2), location: { name: 'Unknown Place' } }], [gh(1), gh(1)]]) {
    const result = await run(() => response({ jobs }));
    assert.equal(result.rows.length, 1); assert.deepEqual(result.ok, []);
    assert.equal(result.diagnostics[0].status, 'partial');
  }
});

const wdRow = id => ({ externalPath: `/job/Johannesburg/Engineer_${id}`, title: 'Engineer', locationsText: 'Johannesburg' });
test('Workday later-page failure retains earlier rows without full-source cleanup', async () => {
  const result = await run((url, options) => {
    if (!url.endsWith('/jobs')) return response({});
    const query = JSON.parse(options.body);
    if (!Object.keys(query.appliedFacets).length) return response({ total: 40, jobPostings: [], facets: [{ facetParameter: 'country', values: [{ id: 'za', descriptor: 'South Africa', count: 40 }] }] });
    return query.offset ? new Response('', { status: 403 }) : response({ jobPostings: Array.from({ length: 20 }, (_, i) => wdRow(i)) });
  }, ['absa']);
  assert.equal(result.rows.length, 20); assert.deepEqual(result.ok, []);
  assert.equal(result.diagnostics[0].status, 'partial');
});

test('Workday full known total including zero is complete, with no per-country cap (owner, 22 Oct 2026)', async () => {
  for (const total of [0, 1, 81]) {
    const result = await run((url, options) => {
      if (!url.endsWith('/jobs')) return response({});
      const query = JSON.parse(options.body);
      if (!Object.keys(query.appliedFacets).length) return response({ total, jobPostings: [], facets: total ? [{ facetParameter: 'country', values: [{ id: 'za', descriptor: 'South Africa', count: total }] }] : [] });
      return response({ jobPostings: Array.from({ length: Math.min(20, total - query.offset) }, (_, i) => wdRow(i + query.offset)) });
    }, ['absa']);
    assert.deepEqual(result.ok, ['absa']);
    assert.equal(result.rows.length, total);
  }
});

test('Amazon partial country or a full first page cannot authorize global cleanup', async () => {
  for (const mode of ['failed', 'capped']) {
    const result = await run(url => {
      if (url.includes('country=USA')) return mode === 'failed' ? new Response('', { status: 403 }) : response({ jobs: Array.from({ length: 100 }, (_, id) => ({ id, title: 'Engineer', location: 'Seattle', job_path: `/jobs/${id}` })) });
      return response({ jobs: [] });
    }, ['amazon']);
    assert.deepEqual(result.ok, []); assert.equal(result.diagnostics[0].status, 'partial');
  }
});

test('FX outage preserves collection and native employer pay, unknown dates stay unknown', async () => {
  const result = await collectJobs(async url => url.includes('frankfurter') ? new Response('', { status: 403 }) : response({ jobs: [{ ...gh(1), content: 'Salary: ZAR 500000 - 600000 per year' }] }), () => {}, ['airbnb']);
  assert.equal(result.rows.length, 1); assert.equal(result.rows[0].cur, 'ZAR');
  assert.equal(result.rows[0].usd_min, null); assert.equal(result.rows[0].posted_ts, null);
  const rejected = normalizeCollectedJob(SOURCES.find(s => s.id === 'airbnb'), { id: 1, title: 'Remote', location: 'Remote', url: 'https://example.com/job', pay: { cur: 'USD', min: 1, max: 2, period: 'hour' } }, fx.rates);
  assert.equal(rejected, null, 'salary currency does not establish country eligibility');
});

test('ATS host detection is bounded and does not confuse lookalike domains', () => {
  for (const [url, type] of [['https://careers.example.icims.com/jobs', 'icims'], ['https://apply.workable.com/employer/', 'workable'], ['https://example.taleo.net/careersection', 'taleo'], ['https://boards.greenhouse.io/employer', 'gh']]) assert.equal(detectJobSystem(url), type);
  assert.equal(detectJobSystem('https://greenhouse.io.attacker.example/'), null);
});

test('JSON-LD handles graphs, explicit dates and salary; rejects ambiguous multi-country eligibility', () => {
  const posting = { '@type': 'JobPosting', identifier: { value: 'ABC-1' }, title: 'Engineer', url: '/careers/ABC-1', hiringOrganization: { name: 'Employer' }, jobLocation: { address: { addressLocality: 'Nairobi', addressCountry: 'KE' } }, datePosted: '2026-10-01', validThrough: '2026-10-20T17:00:00+03:00', baseSalary: { currency: 'KES', value: { minValue: 50000, maxValue: 70000, unitText: 'MONTH' } } };
  const html = data => `<script type="application/ld+json">${JSON.stringify(data)}</script>`;
  const rows = parseJobPostings(html({ '@graph': [posting] }), 'https://employer.example/careers');
  assert.equal(rows.length, 1); assert.equal(rows[0].id, 'ABC-1'); assert.equal(rows[0].pay.period, 'month');
  assert.equal(rows[0].closing, Date.parse(posting.validThrough));
  assert.equal(rows[0].source_url, 'https://employer.example/careers');
  assert.equal(parseJobPostings(html({ ...posting, validThrough: '2026-10-20' }), 'https://employer.example')[0].closing, null);
  assert.equal(parseJobPostings(html({ ...posting, jobLocation: [posting.jobLocation, { address: { addressCountry: 'US' } }] }), 'https://employer.example').length, 0);
  assert.equal(parseJobPostings(html({ ...posting, jobLocation: [{ address: { addressLocality: 'London' } }, posting.jobLocation] }), 'https://employer.example').length, 0);
});


test('missing identities and malformed or contradictory totals fail closed', async () => {
  for (const id of [undefined, null, '']) {
    const result = await run(() => response({ jobs: [{ ...gh(1), id }] }));
    assert.equal(result.rows.length, 0); assert.deepEqual(result.ok, []);
  }
  for (const total of [null, '', '100', 0, -1]) {
    const oracle = await run(() => response({ items: [{ TotalJobsCount: total, requisitionList: [{ Id: 1, Title: 'Engineer', PrimaryLocationCountry: 'KE' }] }] }), ['kcb']);
    assert.equal(oracle.rows.length, 1); assert.deepEqual(oracle.ok, []);
    const smart = await run(() => response({ totalFound: total, content: [{ id: 1, name: 'Engineer', location: { country: 'gb' } }] }), ['oecd']);
    assert.equal(smart.rows.length, 1); assert.deepEqual(smart.ok, []);
  }
});


test('Amazon supplied malformed or contradictory country totals are partial', async () => {
  for (const hits of [null, '', '100', -1, 1]) {
    const result = await run(() => response({ hits, jobs: [] }), ['amazon']);
    assert.deepEqual(result.ok, []); assert.equal(result.diagnostics[0].status, 'partial');
  }
  const zero = await run(() => response({ hits: 0, jobs: [] }), ['amazon']);
  assert.deepEqual(zero.ok, ['amazon']);
});


test('real Greenhouse structured locations expand per country and verified Block URLs work', async () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/jobs-greenhouse-public.json', import.meta.url)));
  for (const { source, postings } of fixture.fixtures) {
    const result = await run(() => response({ jobs: postings }), [source]);
    assert.deepEqual(result.ok, [source]);
    assert.equal(result.rows.length, new Set(result.rows.map(r => r.id)).size);
    assert.equal(result.diagnostics[0].rawCount, result.diagnostics[0].acceptedCount);
    if (source === 'cloudflare') {
      assert.ok(result.rows.every(r => !/^(Hybrid|Distributed|In-Office)$/.test(r.location)));
      const ohio = result.rows.find(r => r.location === 'Ohio');
      assert.equal(ohio.country, 'US');
      const multi = postings.find(p => new Set((p.metadata[0]?.value || []).map(v => v.split(',').pop().trim())).size > 1);
      const copies = result.rows.filter(r => r.id.startsWith(`cloudflare:${multi.id}:`));
      assert.ok(copies.length > 1); assert.equal(copies.length, new Set(copies.map(r => r.country)).size);
      assert.ok(copies.every(r => r.url === multi.absolute_url));
    } else {
      assert.equal(result.rows[0].url, 'https://block.xyz/careers/jobs/5317296008?gh_jid=5317296008');
      assert.equal(result.rows[0].country, 'AU');
    }
  }
  const blocked = await run(() => response({ jobs: [{ ...gh(1), absolute_url: 'http://other.example/careers/jobs/1' }] }), ['block']);
  assert.equal(blocked.rows.length, 0); assert.deepEqual(blocked.ok, []);
});

test('verified new ZA readers preserve real first-page jobs even if later pages cannot be fetched', async () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/jobs-za-public.json', import.meta.url)));
  for (const [id, data] of Object.entries(fixture.sources)) {
    let count = 0;
    const result = await run(() => ++count === 1 ? (typeof data === 'string' ? new Response(data) : response(data)) : new Response('', { status: 403 }), [id]);
    assert.ok(result.rows.length > 0, id);
    assert.ok(result.rows.some(r => r.country === 'ZA'), id);
    assert.deepEqual(result.ok, [], 'partial fixture pages cannot authorize pruning');
    assert.ok(result.rows.every(r => r.id.startsWith(id + ':') && r.url.startsWith('https://')));
    if (id === 'firstrand') assert.equal(result.rows[0].location, data.jobPostings[0].bulletFields[0]);
    if (id === 'sasol') assert.ok(result.rows.some(r => r.title === 'Snr Security Officer'));
  }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseUctSearch, parseUctDetail } from '../jobs-uct.js';
const search = readFileSync(new URL('./fixtures/jobs-uct-search.html', import.meta.url), 'utf8');
const detail = readFileSync(new URL('./fixtures/jobs-uct-detail.html', import.meta.url), 'utf8');
const now = Date.parse('2026-10-10T12:00:00Z');
const listed = parseUctSearch(search).rows.find(r => r.id === '1415488433');

test('actual UCT public list yields eight unique jobs without inventing city or dates', () => {
  const parsed = parseUctSearch(search);
  assert.equal(parsed.rows.length, 8);
  assert.equal(new Set(parsed.rows.map(r => r.id)).size, 8);
  assert.equal(parsed.complete, false);
  assert.ok(parsed.rows.every(r => r.url.startsWith('https://jobs.uct.ac.za/job/') && r.location === '' && r.posted == null && r.closing == null));
  assert.equal(listed.title, 'Management Accountant: Executive Education');
  assert.equal(parsed.rows.find(r => r.id === '1422829933').title, 'Lecturer (nGAP) French Language & Literature');
});

test('actual detail binds the semantic title despite other H1s and preserves native salary provenance', () => {
  const row = parseUctDetail(detail, listed, { now });
  assert.equal(row.location, 'Cape Town'); assert.equal(row.country, 'ZA');
  assert.equal(row.employer, 'University of Cape Town');
  assert.equal(row.posted, Date.parse('2026-10-05T02:00:00Z'));
  assert.equal(row.closing, Date.parse('2026-10-19T22:00:00Z'));
  assert.equal(row.closed, false);
  assert.deepEqual(row.pay, { cur: 'ZAR', min: 661967, max: 778773, period: 'year' });
  assert.equal(row.salary_text, 'The annual remuneration package, including benefits, is between R661 967 and R778 773.');
  assert.equal(row.source_url, listed.url); assert.equal(row.salary_url, listed.url);
  assert.equal(parseUctDetail(detail, listed, { now: row.closing }).closed, true);
});

test('wrong title, URL, employer or location cannot enrich another job', () => {
  for (const changed of [
    detail.replace('itemprop="title"', 'itemprop="other"').replace('data-careersite-propertyid="title"', 'data-careersite-propertyid="other"'),
    detail.replace(/Management Accountant: Executive Education/g, 'Different vacancy'),
    detail.replace('rel="canonical" href="https://jobs.uct.ac.za/job/', 'rel="canonical" href="https://other.example/job/'),
    detail.replace('content="University of Cape Town"', 'content="Another employer"'),
    detail.replace('content="Cape Town, ZA"', 'content="London, GB"'),
    detail.replace('data-careersite-propertyid="city"', 'data-careersite-propertyid="other"'),
  ]) assert.equal(parseUctDetail(changed, listed, { now }), null);
  assert.equal(parseUctDetail(detail, { ...listed, url: listed.url.replace('1415488433', '9999') }, { now }), null);
});

test('invalid, future and conflicting dates fail closed while source-absent dates stay null', () => {
  for (const changed of [
    detail.replace('Mon Oct 19 22:00:00 UTC 2026', 'Mon Oct 32 22:00:00 UTC 2026'),
    detail.replace('Mon Oct 05 02:00:00 UTC 2026', 'Mon Oct 15 02:00:00 UTC 2026'),
    detail.replace('19th October 2026', '20th October 2026'),
    detail + '<meta itemprop="validThrough" content="Mon Oct 20 22:00:00 UTC 2026">',
  ]) assert.equal(parseUctDetail(changed, listed, { now }), null);
  const absent = detail.replace(/<meta itemprop="(?:datePosted|validThrough)"[^>]*>/g, '');
  const row = parseUctDetail(absent, listed, { now });
  assert.equal(row.posted, null); assert.equal(row.closing, null);
});

test('ambiguous salary remains verbatim without guessed numeric package', () => {
  const changed = detail.replace('The annual remuneration package, including benefits, is between R661 967 and R778 773.', 'Salary varies by grade, between R661 967 and R778 773.');
  const row = parseUctDetail(changed, listed, { now });
  assert.equal(row.pay, null); assert.equal(row.salary_text, 'Salary varies by grade, between R661 967 and R778 773.');
});

test('changed list structure and unsafe application links remain partial with no accepted rows', () => {
  assert.equal(parseUctSearch(search.replace('id="searchresults"', 'id="other"')).rows.length, 0);
  const changed = search.replaceAll('href="/job/', 'href="https://user:secret@jobs.uct.ac.za/job/');
  assert.equal(parseUctSearch(changed).rows.length, 0);
  assert.equal(parseUctSearch('x'.repeat(2000001)).rows.length, 0);
  assert.equal(parseUctDetail('x'.repeat(2000001), listed, { now }), null);
  assert.doesNotThrow(() => parseUctSearch(search.replaceAll('Lecturer', '&#x110000;Lecturer')));
});


test('actual Lecturer grade paragraphs preserve advertised pay text without a fabricated range', () => {
  const html = readFileSync(new URL('./fixtures/jobs-uct-lecturer-detail.html', import.meta.url), 'utf8');
  const listing = parseUctSearch(search).rows.find(r => r.id === '1445959933');
  const row = parseUctDetail(html, listing, { now });
  assert.equal(row.closing, Date.parse('2026-11-02T22:00:00Z'));
  assert.equal(row.salary_text, 'The annual remuneration package for 2026, including benefits are: Senior Lecturer level: R 1 207 358 Lecturer level: R 974 126');
  assert.equal(row.pay, null, 'different grades are not a pay range');
  assert.equal(row.salary_url, listing.url);
});


test('adjacent full grade salary sentences are preserved once each', () => {
  const first = 'The annual cost of employment for 2026, including benefits, at the Lecturer level is R974 126';
  const second = 'The annual cost of employment for 2026, including benefits, at the Senior Lecturer level is R1 207 358';
  // These consecutive sentences are from the fetched Computer Science detail.
  const html = detail.replace('The annual remuneration package, including benefits, is between R661 967 and R778 773.', first + '</p><p>' + second);
  const row = parseUctDetail(html, listed, { now });
  assert.equal(row.salary_text, first + ' ' + second);
  assert.equal(row.pay, null);
});

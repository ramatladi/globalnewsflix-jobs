import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectJobs, countryOf, SOURCES } from '../jobs.js';
import { iso3To2 } from '../iso-codes.js';

const json = value => new Response(JSON.stringify(value));
async function collectWith(source, pages) {
  SOURCES.push(source);
  const asked = [];
  try {
    const result = await collectJobs(async url => {
      if (url.includes('frankfurter')) return json({ rates: {} });
      asked.push(url);
      const start = Number(new URL(url).searchParams.get('startrow') || 0);
      return new Response(pages[start] ?? '<html></html>');
    }, () => {}, [source.id], { requestDelayMs: 0 });
    return { result, asked };
  } finally { SOURCES.splice(SOURCES.indexOf(source), 1); }
}
const row = (n, loc) => `<tr class="data-row"><td><a href="/job/Lima-Analyst-${n}/${1000 + n}/" class="jobTitle-link">Analyst ${n}</a></td><td><span class="jobLocation"> ${loc}</span></td><td><span class="jobDate"> Oct 20, 2026</span></td></tr>`;
const label = (a, b, total) => `<span class="paginationLabel">Results <b>${a} – ${b}</b> of <b>${total}</b></span>`;

test('large and well-known private companies are configured as companies without a ticker, and none use SmartRecruiters', () => {
  const ids = ['ey', 'pwc', 'kpmgindia', 'kpmgindiakdn', 'kpmggulf', 'mars', 'zf', 'foundever', 'scjohnson', 'trafigura', 'ofi', 'tataelectronics', 'stripe', 'moniepoint', 'mkopa', 'yassir', 'bosta', 'tamara', 'careem', 'trendyol', 'insiderone', 'quintoandar', 'ebanx', 'wildlifestudios', 'kavak', 'rappi', 'addi', 'lalamove', 'ninjavan', 'xendit', 'razorpay'];
  for (const id of ids) {
    const s = SOURCES.find(x => x.id === id);
    assert.ok(s, id); assert.equal(s.type, 'c', id); assert.equal(s.ticker, null, id); assert.notEqual(s.ats, 'sr', id);
    assert.equal(s.sector, 'private', id);
  }
  assert.equal(SOURCES.find(x => x.id === 'meesho').ticker, 'MEESHO');
});

test('reviewed private employers on SmartRecruiters are configured by company identifier (owner decision, 21 Oct 2026)', () => {
  for (const [id, company] of [['bosch', 'BoschGroup'], ['louisdreyfus', 'LouisDreyfusCompany'], ['deloitteafrica', 'Deloitte6'], ['phonepe', 'PHONEPELIMITED'], ['canva', 'Canva'], ['vitol', 'Vitol']]) {
    const s = SOURCES.find(x => x.id === id);
    assert.equal(s.ats, 'sr', id); assert.deepEqual(s.args, [company], id); assert.equal(s.type, 'c', id); assert.equal(s.ticker, null, id);
    assert.equal(s.collectionUrl, `https://api.smartrecruiters.com/v1/companies/${company}/postings`);
  }
  assert.ok(!SOURCES.some(s => s.automatic && s.ats === 'sr'), 'automatic discovery never reads SmartRecruiters');
});

test('a town, region code and country code is read by its last code, ISO-2 or ISO-3', () => {
  for (const [loc, cc] of [['Mumbai, MH, IND,', 'IN'], ['Pune, MH, IN', 'IN'], ['Hosur, TN, IN', 'IN'], ['Jagiroad, AS, IN', 'IN'], ['Tegucigalpa, FM, HND,', 'HN'],
    ['Shanghai, SH, CN, 201814', 'CN'], ['Wroclaw, DS, PL, 53-238', 'PL'], ['Durban, KZN, ZAF', 'ZA'], ['Austin, TX, US', 'US'], ['Toronto, ON, CA', 'CA'], ['San Francisco, CA', 'US'], ['Atlanta, GA', 'US']])
    assert.equal(countryOf(loc), cc, loc);
  assert.equal(iso3To2('IND'), 'IN'); assert.equal(iso3To2('ind'), 'IN'); assert.equal(iso3To2('KZN'), null);
});

test('a career site with ten jobs a page is read to the end, without a request past its total', async () => {
  const all = Array.from({ length: 23 }, (_, i) => row(i + 1, 'Lima, LIM, PE'));
  const pages = { 0: label(1, 10, 23) + all.slice(0, 10).join(''), 10: label(11, 20, 23) + all.slice(10, 20).join(''), 20: label(21, 23, 23) + all.slice(20).join('') };
  const { result, asked } = await collectWith({ id: 'fixture-sf-ten', name: 'Fixture', type: 'c', ats: 'sf', args: ['careers.example.com'] }, pages);
  assert.equal(result.rows.length, 23);
  assert.ok(result.rows.every(r => r.country === 'PE'));
  assert.deepEqual(asked.map(u => new URL(u).searchParams.get('startrow')), ['0', '10', '20']);
});

test('the default 25-a-page reading is unchanged and a short board makes one request', async () => {
  const all = Array.from({ length: 30 }, (_, i) => row(i + 1, 'Karachi, PK'));
  const { result, asked } = await collectWith({ id: 'fixture-sf-25', name: 'Fixture', type: 'c', ats: 'sf', args: ['careers.example.com'] }, { 0: label(1, 25, 30) + all.slice(0, 25).join(''), 25: label(26, 30, 30) + all.slice(25).join('') });
  assert.equal(result.rows.length, 30); assert.equal(asked.length, 2);
  const short = await collectWith({ id: 'fixture-sf-short', name: 'Fixture', type: 'c', ats: 'sf', args: ['careers.example.com'] }, { 0: label(1, 10, 10) + all.slice(0, 10).join('') });
  assert.equal(short.result.rows.length, 10); assert.equal(short.asked.length, 1);
});

test('job tiles take their country from the location ("Jagiroad, AS, IN" is India)', async () => {
  const tile = (n, loc) => `<li class="job-tile job-id-${n}"><a href="/job/Jagiroad-QMS-Engineer-AS/${54279144 + n}/" class="jobTitle-link">QMS Engineer ${n}</a><div id="job-tile-${n}-desktop-section-location-value">${loc}</div><div id="job-tile-${n}-desktop-section-date-value">Oct 14, 2026</div></li>`;
  const { result } = await collectWith({ id: 'fixture-sf-tiles', name: 'Fixture', type: 'c', ats: 'sf', args: ['careers.example.com'] }, { 0: '<span>Showing 1 to 2 of 2 Jobs</span>' + tile(1, 'Jagiroad, AS, IN') + tile(2, 'Hosur, TN, IN') });
  assert.deepEqual(result.rows.map(r => r.country), ['IN', 'IN']);
});

test('Bosch and EY are read past the usual 1,500 jobs an employer; others keep it', async () => {
  assert.equal(SOURCES.find(s => s.id === 'bosch').maxJobs, 6000);
  assert.equal(SOURCES.find(s => s.id === 'ey').maxJobs, 10000);
  assert.equal(SOURCES.find(s => s.id === 'stripe').maxJobs, undefined);
  const postings = Array.from({ length: 1700 }, (_, i) => ({ id: String(i + 1), name: 'Engineer ' + (i + 1), location: { fullLocation: 'Hanoi, Vietnam', country: 'vn' }, releasedDate: '2026-10-20T00:00:00Z' }));
  const answer = url => {
    if (url.includes('frankfurter')) return json({ rates: {} });
    const off = Number(new URL(url).searchParams.get('offset'));
    return json({ totalFound: postings.length, content: postings.slice(off, off + 100) });
  };
  const read = async extra => {
    const source = { id: 'fixture-sr', name: 'Fixture', type: 'c', ats: 'sr', args: ['Fixture'], ...extra };
    SOURCES.push(source);
    try { return await collectJobs(async url => answer(url), () => {}, [source.id], { requestDelayMs: 0 }); }
    finally { SOURCES.splice(SOURCES.indexOf(source), 1); }
  };
  assert.equal((await read({})).rows.length, 1500);
  const big = await read({ maxJobs: 6000 });
  assert.equal(big.rows.length, 1700); assert.deepEqual(big.ok, ['fixture-sr']);
});

test('a career-site page that does not answer is skipped when the site states its total', async () => {
  const all = Array.from({ length: 100 }, (_, i) => row(i + 1, 'Lima, LIM, PE'));
  const pages = {};
  for (let s = 0; s < 100; s += 25) pages[s] = label(s + 1, Math.min(s + 25, 100), 100) + all.slice(s, s + 25).join('');
  delete pages[50];
  const { result, asked } = await collectWith({ id: 'fixture-sf-gap', name: 'Fixture', type: 'c', ats: 'sf', args: ['careers.example.com'] }, pages);
  assert.equal(result.rows.length, 75);
  assert.deepEqual(asked.map(u => new URL(u).searchParams.get('startrow')), ['0', '25', '50', '75']);
});

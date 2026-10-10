import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SOURCES } from '../jobs.js';
import { sourceCareerUrls, employerMetadata, employerRegistry, registryCoverage } from '../jobs-employers.js';

test('every supported configured source has deterministic HTTPS career provenance', () => {
  for (const source of SOURCES.filter(source => source.ats !== 'dpsa')) {
    const row = employerMetadata(source);
    assert.match(row.careersUrl, /^https:\/\//, source.id);
    assert.match(row.collectionUrl, /^https:\/\//, source.id);
    assert.equal(row.verifiedAt != null, ['cloudflare', 'block', 'standardbank', 'firstrand', 'sasol', 'angloamerican', 'discovery', 'za-gauteng', 'capitec', 'goldfields', 'adcorp', 'sanlam', 'avi', 'oceana', 'shoprite', 'uct', 'ethekwini', 'safaricom', 'diageo', 'cbk'].includes(source.id));
    assert.equal(row.verification, ['cloudflare', 'block', 'standardbank', 'firstrand', 'sasol', 'angloamerican', 'discovery', 'za-gauteng', 'capitec', 'goldfields', 'adcorp', 'sanlam', 'avi', 'oceana', 'shoprite', 'uct', 'ethekwini', 'safaricom', 'diageo', 'cbk'].includes(source.id) ? 'observed' : 'configured-unverified');
  }
  const source = SOURCES.find(source => source.id === 'absa');
  assert.equal(sourceCareerUrls(source).careersUrl, 'https://absa.wd3.myworkdayjobs.com/ABSAcareersite');
  assert.equal(employerMetadata(source).sector, 'private');
  assert.equal(employerMetadata(source).ownership, 'listed-company');
  assert.deepEqual(employerMetadata(source).countries, [], 'company domicile is not proof of career-board hiring scope');
});

test('country metadata distinguishes existing explicit reader scopes from dated observations', () => {
  const nhs = employerMetadata(SOURCES.find(source => source.id === 'nhs'));
  assert.equal(nhs.sector, 'public'); assert.deepEqual(nhs.countries, ['GB']);
  assert.equal(nhs.countryEvidence[0].kind, 'configured-reader-scope');
  const source = SOURCES.find(source => source.id === 'kcb');
  const observation = { countries: ['KE', 'KE'], provenanceUrl: 'https://example.com/observed-career-list', verifiedAt: 100 };
  const seen = employerMetadata(source, observation, 200);
  assert.deepEqual(seen.countries, ['KE']); assert.equal(seen.verifiedAt, 100);
  assert.deepEqual(employerMetadata(source, { ...observation, verifiedAt: 300 }, 200).countries, []);
  assert.deepEqual(employerMetadata(source, { ...observation, provenanceUrl: 'http://example.com' }, 200).countries, []);
});

test('coverage reports source deficits, never fabricates a thousand employers or country coverage', () => {
  const registry = employerRegistry(SOURCES);
  const coverage = registryCoverage(registry);
  assert.equal(coverage.totalSources, SOURCES.length);
  assert.equal(coverage.countries.length, 6);
  assert.ok(coverage.countryUnknownSources > 70);
  for (const row of coverage.countries) {
    assert.equal(row.observedSources, ['US', 'GB'].includes(row.country) ? 2 : row.country === 'IN' ? 1 : row.country === 'ZA' ? 15 : row.country === 'KE' ? 2 : 0);
    assert.equal(row.sourceShortfall, 1000 - row.configuredSources);
  }
  assert.match(coverage.note, /not employer or live vacancy counts/);
});

test('only fixture-verified ZA adapters are connected and catalogue records are distinct parent employers', async () => {
  const { readFileSync } = await import('node:fs');
  const { ZA_EXTRA_SOURCES } = await import('../jobs-za-sources.js');
  const catalogue = JSON.parse(readFileSync(new URL('../za-private-employers.json', import.meta.url)));
  assert.equal(catalogue.employers.length, new Set(catalogue.employers.map(e => e.id)).size);
  for (const source of ZA_EXTRA_SOURCES) {
    const entry = catalogue.employers.find(e => e.id === source.id);
    assert.equal(entry.status, 'verified-reader');
    assert.equal(SOURCES.filter(s => s.id === source.id).length, 1);
    assert.ok(source.verifiedAt > 0); assert.deepEqual(source.countries, ['ZA']);
  }
  for (const entry of catalogue.employers.filter(e => e.status !== 'verified-reader')) assert.ok(!ZA_EXTRA_SOURCES.some(s => s.id === entry.id));
});

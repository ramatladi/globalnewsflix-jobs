import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {greenhouseJobs, normalizeCollectedJob, SOURCES, countryOf} from '../jobs.js';
const source = SOURCES.find(s => s.id === 'affirm');
const posting = location => ({id:123,title:'Engineer',location:{name:location},absolute_url:'https://job-boards.greenhouse.io/affirm/jobs/123'});

test('observed Affirm remote country names and multi-country eligibility retain explicit employer geography', () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/jobs-greenhouse-remote.json',import.meta.url)));
  const result = greenhouseJobs(fixture.postings,'affirm');
  assert.equal(result.complete,true);
  const rows = result.rows.map(r => normalizeCollectedJob(source,r,{}));
  assert.ok(rows.every(Boolean));
  assert.deepEqual([...new Set(rows.map(r=>r.country))].sort(),['AU','CA','ES','GB','PL','US']);
  const multi = fixture.postings.find(p=>p.location.name.includes(';'));
  assert.ok(multi);
  const expanded = rows.filter(r=>r.id.startsWith(`affirm:${multi.id}:`));
  assert.deepEqual(expanded.map(r=>r.country).sort(),['ES','GB','PL']);
  assert.ok(expanded.every(r=>r.url===multi.absolute_url));
  assert.equal(new Set(rows.map(r=>r.id)).size,rows.length);
});

test('ambiguous remote abbreviations and regional eligibility never become guessed countries', () => {
  for (const label of ['Remote CA','Remote IN','Remote GA','Remote EMEA','Remote Europe','Remote','Remote UK or Canada','Remote Spain except Madrid','Remote worldwide except London','Remote USA, Canada']) {
    const result=greenhouseJobs([posting(label)],'affirm');
    assert.equal(result.complete,false,label);
    assert.equal(result.rows.filter(r=>normalizeCollectedJob(source,r,{})).length,0,label);
  }
});

test('known and unresolved multi-location scope remains partial and preserves known country rows', () => {
  const result=greenhouseJobs([posting('Remote UK; Remote EMEA')],'affirm');
  assert.equal(result.complete,false);
  assert.deepEqual(result.rows.map(r=>r.country),['GB']);
  assert.equal(result.reason,'location-scope-unresolved');
});

test('structured posting location remains authoritative over office names and display country', () => {
  const result=greenhouseJobs([{...posting('Remote Canada'),metadata:[{name:'Job Posting Location',value:['Remote Spain','Remote Poland']}],offices:[{name:'Remote US',location:'United States'}]}],'affirm');
  assert.equal(result.complete,true);
  assert.deepEqual(result.rows.map(r=>r.country),['ES','PL']);
});

test('observed qualified remote labels preserve explicit countries without city substring inference', () => {
  for (const [label,cc] of [['Remote - US: Select locations','US'],['Remote - US: All locations','US'],['Remote - Canberra, Australia','AU'],['Remote (USA - Boston, MA)','US'],['Remote - Toronto','CA']]) {
    const result=greenhouseJobs([posting(label)],'affirm');
    assert.equal(result.complete,true,label);
    assert.equal(result.rows[0].country,cc,label);
  }
});

test('Georgia needs explicit country evidence and Georgia USA remains a US state', () => {
  const ambiguous=greenhouseJobs([posting('Remote - Georgia')],'affirm');
  assert.equal(ambiguous.complete,false);
  assert.equal(ambiguous.rows.filter(r=>normalizeCollectedJob(source,r,{})).length,0);
  const explicit=greenhouseJobs([posting('Remote - Georgia, USA')],'affirm');
  assert.equal(explicit.complete,true);
  assert.equal(explicit.rows[0].country,'US');
});

test('expanded partial listings preserve the legacy country ID and add stable country IDs', () => {
  const result=greenhouseJobs([posting('Remote - Ireland; Remote - United Kingdom; Remote EMEA')],'affirm');
  assert.equal(result.complete,false);
  assert.deepEqual(result.rows.map(r=>[r.id,r.country]),[['123:IE','IE'],[123,'GB']]);
  const existingMulti=greenhouseJobs([{...posting('Remote'),metadata:[{name:'Job Posting Location',value:['United States','Canada']}]}],'affirm');
  assert.deepEqual(existingMulti.rows.map(r=>r.id),['123:US','123:CA']);
});

test('five observed Okta US office postings correct Georgia while retaining existing IDs', () => {
  const {postings}=JSON.parse(readFileSync(new URL('./fixtures/jobs-okta-us-georgia.json',import.meta.url)));
  const result=greenhouseJobs(postings,'okta');
  assert.equal(result.complete,true);
  assert.equal(result.rows.length,5);
  assert.ok(result.rows.every(r=>r.country==='US'));
  assert.deepEqual(result.rows.map(r=>r.id),postings.map(p=>p.id));
  for(const offices of [[],[{id:21498,name:'US Remote East Coast'}],[{id:21497,name:'Canadian Office'}]]) {
    const unknown=greenhouseJobs([{...postings[0],offices}],'okta');
    assert.equal(unknown.complete,false);
  }
  const conflicting=greenhouseJobs([{...postings[0],metadata:[{name:'Job Posting Location',value:'United Kingdom'}]}],'okta');
  assert.deepEqual(conflicting.rows.map(r=>r.country),['GB']);
  const otherEmployer=greenhouseJobs(postings,'affirm');
  assert.equal(otherEmployer.complete,false);
});

test('observed non-geographic qualifiers do not create false missing countries', () => {
  for(const [label,country] of [['New York, NY, USA; Hybrid','US'],['Remote - Ontario, Canada (DNU)','CA'],['Remote - Alberta, Canada (DNU)','CA'],['Porto; Portugal','PT']]) {
    const result=greenhouseJobs([posting(label)],'affirm');
    assert.equal(result.complete,true,label);assert.equal(result.rows.length,1,label);assert.equal(result.rows[0].country,country,label);
  }
  const unresolved=greenhouseJobs([posting('New York; Remote')],'affirm');
  assert.equal(unresolved.complete,false,'remote eligibility without a country stays unproven');
});

test('Porto corroboration is confined to the explicit Portugal list and never other city prefixes', () => {
  for(const label of ['Porto','Porto Alegre','Porto-Novo']) {
    assert.notEqual(countryOf(label),'PT');
    const result=greenhouseJobs([posting(label)],'affirm');
    assert.equal(result.complete,false,label);
    assert.ok(result.rows.every(r=>r.country!=='PT'),label);
  }
});

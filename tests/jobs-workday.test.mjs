import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { collectJobs, normalizeCollectedJob, SOURCES } from '../jobs.js';

const response = data => Response.json(data);
const posting = (id, location = 'Undisclosed workplace') => ({
  externalPath: `/job/Workplace/Engineer_${id}`, title: 'Engineer', locationsText: location,
});
async function collect(postings, detail = () => ({ jobPostingInfo: { country: { descriptor: 'South Africa' }, location: 'Johannesburg' } }), source = 'absa') {
  const requests = [];
  const result = await collectJobs(async (url, options) => {
    if (url.includes('frankfurter')) return response({ rates: { ZAR: 18 } });
    if (url.endsWith('/jobs')) {
      const { offset } = JSON.parse(options.body);
      return response({ total: postings.length, jobPostings: postings.slice(offset, offset + 20), facets: [] });
    }
    const id = url.split('_').at(-1);
    requests.push(id);
    const value = detail(id);
    return value instanceof Response ? value : response(value);
  }, () => {}, [source], { requestDelayMs: 0 });
  return { ...result, requests };
}

test('late unresolved Workday rows get their country pages first; pay-only pages stay within 250', async () => {
  const located = Array.from({ length: 260 }, (_, i) => posting(`known-${i}`, 'Johannesburg'));
  const unresolved = Array.from({ length: 3 }, (_, i) => posting(`unknown-${i}`));
  const result = await collect([...located, ...unresolved]);
  assert.equal(result.requests.length, 253);
  assert.deepEqual(result.requests.slice(0, 3), ['unknown-0', 'unknown-1', 'unknown-2']);
  assert.deepEqual(result.requests.slice(3), Array.from({ length: 250 }, (_, i) => `known-${i}`));
  assert.equal(result.rows.length, 263);
  assert.deepEqual(result.rows.slice(-3).map(row => row.id), ['absa:unknown-0', 'absa:unknown-1', 'absa:unknown-2'], 'priority never changes source output order');
  assert.ok(result.rows.every(row => row.country === 'ZA'));
  assert.deepEqual(result.ok, ['absa'], 'an optional pay-detail cap does not make a fully located list incomplete');
});

test('known-country pay enrichment continues after country resolution when detail budget remains', async () => {
  const result = await collect([posting('known', 'Johannesburg'), posting('unknown')], id => ({ jobPostingInfo: {
    country: { descriptor: 'South Africa' }, location: 'Johannesburg',
    jobDescription: id === 'known' ? 'Salary: ZAR 500000 - 600000 per year' : '',
  } }));
  assert.deepEqual(result.requests, ['unknown', 'known']);
  assert.equal(result.rows.find(row => row.id === 'absa:known').min, 500000);
  assert.equal(result.rows.find(row => row.id === 'absa:known').cur, 'ZAR');
  assert.deepEqual(result.ok, ['absa']);
});

test('unresolved detail failures or absent country evidence never fabricate geography or authorize pruning', async () => {
  const result = await collect([posting('known', 'Johannesburg'), posting('denied'), posting('missing')], id => {
    if (id === 'denied') return new Response('', { status: 403 });
    if (id === 'missing') return { jobPostingInfo: { location: 'Undisclosed workplace', jobDescription: 'Salary: USD 100000 per year' } };
    return {};
  });
  assert.deepEqual(result.requests, ['denied', 'missing', 'known']);
  assert.deepEqual(result.rows.map(row => row.id), ['absa:known']);
  assert.deepEqual(result.ok, []);
  assert.equal(result.diagnostics[0].status, 'partial');
  assert.equal(result.diagnostics[0].rawCount, 3);
  assert.equal(result.diagnostics[0].acceptedCount, 1);
});

test('every unresolved row gets its country page, however many there are (owner, 22 Oct 2026)', async () => {
  const result = await collect(Array.from({ length: 251 }, (_, i) => posting(`unknown-${i}`)));
  assert.equal(result.requests.length, 251);
  assert.equal(result.rows.length, 251);
  assert.ok(result.rows.some(row => row.id === 'absa:unknown-250'));
  assert.deepEqual(result.ok, ['absa']);
});

test('Workday distinguishes unobserved pay from an observed description with no pay', async () => {
  const result = await collect(['paid', 'empty', 'missing', 'malformed', 'failed'].map(id => posting(id, 'Johannesburg')), id => {
    if (id === 'failed') return new Response('', { status: 403 });
    if (id === 'missing') return { jobPostingInfo: {} };
    return { jobPostingInfo: { jobDescription: id === 'paid' ? 'Salary: ZAR 500000 - 600000 per year' : id === 'empty' ? '' : { text: 'not a source string' } } };
  });
  const byId = new Map(result.rows.map(row => [row.id.split(':')[1], row]));
  assert.equal(byId.get('paid').pay_observed, true); assert.equal(byId.get('paid').min, 500000);
  assert.equal(byId.get('empty').pay_observed, true); assert.equal(byId.get('empty').min, null);
  for (const id of ['missing', 'malformed', 'failed']) assert.equal(byId.get(id).pay_observed, false, id);
  const capped = await collect(Array.from({ length: 251 }, (_, i) => posting(String(i), 'Johannesburg')), () => ({ jobPostingInfo: { jobDescription: '' } }));
  assert.equal(capped.requests.length, 250); assert.equal(capped.rows[249].pay_observed, true); assert.equal(capped.rows[250].pay_observed, false);
});

test('pay observation is optional for other readers and malformed supplied flags are rejected', () => {
  const source = SOURCES.find(row => row.id === 'absa');
  const job = { id:'observation', title:'Engineer', location:'Johannesburg', url:'https://absa.wd3.myworkdayjobs.com/job/observation' };
  assert.equal(Object.hasOwn(normalizeCollectedJob(source,job,null),'pay_observed'),false);
  for (const flag of [true,false]) assert.equal(normalizeCollectedJob(source,{...job,payObserved:flag},null).pay_observed,flag);
  for (const flag of [null,undefined,0,'false',{}]) assert.equal(normalizeCollectedJob(source,{...job,payObserved:flag},null),null);
});

test('observed Workday Atlanta office labels infer US while Tbilisi and explicit bullet countries retain their identity', async () => {
  // Actual Mastercard labels/IDs captured in the collection report. The public
  // R-290891 detail independently states United States of America.
  const rows = [posting('R-290891','Atlanta, Georgia'), posting('R-292581','Atlanta, Georgia (675 Ponce De Leon Ave NE)'), posting('R-274958-1','Tbilisi, Georgia'),
    {...posting('explicit-ge','Atlanta, Georgia'),bulletFields:['Georgia']}, {...posting('explicit-gb','Atlanta, Georgia (675 Ponce De Leon Ave NE)'),bulletFields:['United Kingdom']}];
  const result=await collect(rows,()=>({}),'mastercard');
  assert.deepEqual(result.rows.map(row=>[row.id,row.country]),[
    ['mastercard:R-290891','US'],['mastercard:R-292581','US'],['mastercard:R-274958-1','GE'],['mastercard:explicit-ge','GE'],['mastercard:explicit-gb','GB'],
  ]);
  assert.deepEqual(result.ok,['mastercard']);
  assert.equal(result.rows[1].location,'Atlanta, Georgia (675 Ponce De Leon Ave NE)');
});

test('Workday country facets take priority over the narrow Atlanta inference', async () => {
  const item=posting('facet-gb','Atlanta, Georgia');
  const result=await collectJobs(async (url,options)=>{
    if(url.includes('frankfurter'))return response({rates:{}});
    if(!url.endsWith('/jobs'))return response({});
    const {appliedFacets}=JSON.parse(options.body);
    return Object.keys(appliedFacets).length ? response({jobPostings:[item]}) : response({total:1,jobPostings:[item],facets:[{facetParameter:'country',values:[{id:'gb',descriptor:'United Kingdom',count:1}]}]});
  },()=>{},['mastercard'],{requestDelayMs:0});
  assert.deepEqual(result.rows.map(row=>[row.id,row.country]),[['mastercard:facet-gb','GB']]);
});


test('all seven observed Atlanta details and genuine Tbilisi control retain the original list IDs', async () => {
  const {records}=JSON.parse(readFileSync(new URL('./fixtures/jobs-workday-mastercard-geography.json',import.meta.url)));
  const result=await collect(records.map(r=>posting(r.listId,r.location)),()=>({}),'mastercard');
  assert.equal(result.rows.length,8);
  assert.equal(result.rows.filter(r=>r.country==='US').length,7);
  assert.equal(result.rows.filter(r=>r.country==='GE').length,1);
  for(const evidence of records){
    const row=result.rows.find(r=>r.id==='mastercard:'+evidence.listId);
    assert.ok(row,evidence.listId);
    assert.equal(row.country,evidence.countryDescriptor==='United States of America'?'US':'GE');
  }
  assert.ok(result.rows.some(r=>r.id==='mastercard:R-274958-1'&&r.country==='GE'),'detail reference never replaces the existing list ID');
});

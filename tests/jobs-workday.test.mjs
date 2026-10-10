import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectJobs, normalizeCollectedJob, SOURCES } from '../jobs.js';

const response = data => Response.json(data);
const posting = (id, location = 'Undisclosed workplace') => ({
  externalPath: `/job/Workplace/Engineer_${id}`, title: 'Engineer', locationsText: location,
});
async function collect(postings, detail = () => ({ jobPostingInfo: { country: { descriptor: 'South Africa' }, location: 'Johannesburg' } })) {
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
  }, () => {}, ['absa'], { requestDelayMs: 0 });
  return { ...result, requests };
}

test('late unresolved Workday rows get detail requests before located pay enrichment within the same 250 cap', async () => {
  const located = Array.from({ length: 260 }, (_, i) => posting(`known-${i}`, 'Johannesburg'));
  const unresolved = Array.from({ length: 3 }, (_, i) => posting(`unknown-${i}`));
  const result = await collect([...located, ...unresolved]);
  assert.equal(result.requests.length, 250);
  assert.deepEqual(result.requests.slice(0, 3), ['unknown-0', 'unknown-1', 'unknown-2']);
  assert.deepEqual(result.requests.slice(3), Array.from({ length: 247 }, (_, i) => `known-${i}`));
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

test('more than 250 unresolved rows remain bounded and unlocated remainder keeps the snapshot partial', async () => {
  const result = await collect(Array.from({ length: 251 }, (_, i) => posting(`unknown-${i}`)));
  assert.equal(result.requests.length, 250);
  assert.equal(result.rows.length, 250);
  assert.ok(!result.rows.some(row => row.id === 'absa:unknown-250'));
  assert.deepEqual(result.ok, []);
  assert.equal(result.diagnostics[0].status, 'partial');
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

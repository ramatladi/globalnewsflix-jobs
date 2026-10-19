import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeSiteFetch } from '../site-fetch.mjs';

test('site calls retry through a deploy (5xx / dropped connection) with a fresh token, then succeed', async () => {
  const seen = []; let n = 0, tokens = 0;
  const replies = [() => { throw new Error('socket hang up'); }, () => new Response('', { status: 502 }), () => new Response('ok', { status: 200 })];
  const f = makeSiteFetch({ auth: async () => ({ authorization: 'Bearer t' + (++tokens) }), userAgent: 'UA', delays: [1, 1, 1], wait: async () => {}, log: () => {},
    fetchImpl: async (url, init) => { seen.push(init.headers.authorization); return replies[n++](); } });
  const r = await f('https://example.test/api', { method: 'POST' }, 'upload');
  assert.equal(r.status, 200);
  assert.deepEqual(seen, ['Bearer t1', 'Bearer t2', 'Bearer t3']);
});

test('client errors are returned at once; lasting failures are annotated and thrown', async () => {
  const logs = [];
  const once = makeSiteFetch({ auth: async () => ({}), userAgent: 'UA', delays: [1], wait: async () => {}, log: m => logs.push(m), fetchImpl: async () => new Response('', { status: 401 }) });
  assert.equal((await once('u', {}, 'x')).status, 401);
  const paused = makeSiteFetch({ auth: async () => ({}), userAgent: 'UA', delays: [1], wait: async () => {}, log: m => logs.push(m), fetchImpl: async () => new Response('', { status: 503 }) });
  assert.equal((await paused('u', {}, 'x')).status, 503, 'a deliberate pause (503) is returned at once');
  const down = makeSiteFetch({ auth: async () => ({}), userAgent: 'UA', delays: [1, 1], wait: async () => {}, log: m => logs.push(m), fetchImpl: async () => new Response('', { status: 502 }) });
  await assert.rejects(down('u', {}, 'ingest batch 1'), /ingest batch 1: HTTP 502/);
  assert.ok(logs.some(m => m.startsWith('::error title=Collect news') && m.includes('after 3 attempts')));
});

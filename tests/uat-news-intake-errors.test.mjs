import test from 'node:test';
import assert from 'node:assert/strict';
import { collectTarget } from '../news-collect.js';

test('collection errors identify the failing desk or search host without logging request details', async t => {
  t.mock.method(globalThis, 'fetch', async url => {
    if (new URL(url).hostname === 'grapevine.is') throw new Error('private diagnostic value');
    return new Response('', { status: 503 });
  });
  const observed = [];
  const { errors } = await collectTarget('IS', 1, { onFeedError: error => observed.push(error) });
  assert.equal(observed.length, errors.length);
  assert.ok(observed.some(x => x.host === 'grapevine.is' && x.reason === 'collection failure'));
  assert.ok(observed.some(x => x.host === 'www.icelandreview.com' && x.reason === 'HTTP 503'));
  assert.ok(observed.some(x => x.host.endsWith('bing.com') && x.reason === 'HTTP 503'));
  for (const x of observed) {
    assert.deepEqual(Object.keys(x).sort(), ['host', 'reason', 'section']);
    assert.doesNotMatch(JSON.stringify(x), /private diagnostic value|https?:|[?&=]/);
  }
});

test('a throwing diagnostic callback never stops collection or changes its errors', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 503 }));
  const plain = await collectTarget('IS', 1);
  let calls = 0;
  const observed = await collectTarget('IS', 1, { onFeedError: () => { calls++; throw new Error('logger failed'); } });
  assert.ok(calls > 0, 'the callback was still called for each failure');
  assert.equal(calls, observed.errors.length);
  // The two Coming Up searches run side by side, so compare the errors without their order.
  assert.deepEqual([...observed.errors].sort(), [...plain.errors].sort());
  assert.deepEqual(observed.rows, plain.rows);
});

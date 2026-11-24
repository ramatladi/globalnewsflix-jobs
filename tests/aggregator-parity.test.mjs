import test from 'node:test';
import assert from 'node:assert/strict';
import { userContentReason, sponsoredContentReason } from '../sponsored-content.js';

test('link aggregators cannot count as independently sourced news', () => {
  for (const url of ['https://digg.com/science/example', 'https://www.digg.com/news/example', 'https://news.digg.com/story']) {
    assert.equal(userContentReason(url), 'aggregator');
    assert.equal(sponsoredContentReason({url}), 'aggregator');
  }
  assert.equal(userContentReason('https://diggers-news.example/story'), null);
});

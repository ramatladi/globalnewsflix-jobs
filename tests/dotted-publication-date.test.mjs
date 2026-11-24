// visir.is states its precise publication time only as "DD.MM.YYYY HH:MM:SS +00:00" in article:published_time, beside a
// date-only JSON-LD datePublished. The dotted time counts only when it falls inside a day the page states elsewhere.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publisherDateEvidence, dottedPublicationInstant } from '../news-freshness.js';

const NOW = Date.UTC(2026, 10, 24, 3, 0, 0);
const URL = 'https://www.visir.is/g/20262967223d/radu-neytid-kaupi-sjalft-a-fengi-a-netinu';
const page = ({ meta = '23.11.2026 18:05:33 +00:00', ld = '2026-11-23', modified = '23.11.2026 18:05:33 +00:00' } = {}) => `<html><head>
<link rel="canonical" href="${URL}">
${meta === null ? '' : `<meta property="article:published_time" content="${meta}">`}
<meta property="article:modified_time" content="${modified}">
${ld === null ? '' : `<script type="application/ld+json">{"@context":"https://schema.org","@type":"NewsArticle","headline":"x","datePublished":"${ld}","dateModified":"${ld}"}</script>`}
</head><body><time class="article-single__time">23. nóvember 2026 18:05</time></body></html>`;

test('a dotted time that agrees with the stated publication day gives the precise time', () => {
  const r = publisherDateEvidence(page(), NOW, URL);
  assert.equal(r.publication_date_invalid, false);
  assert.equal(r.published_ts, Date.UTC(2026, 10, 23, 18, 5, 33));
});

test('a dotted time with no other publication marker is still invalid', () => {
  const r = publisherDateEvidence(page({ ld: null }), NOW, URL);
  assert.equal(r.published_ts, null);
  assert.equal(r.publication_date_invalid, true);
});

test('a dotted time on a different day from the stated one is invalid', () => {
  const r = publisherDateEvidence(page({ meta: '24.11.2026 01:05:33 +00:00' }), NOW, URL);
  assert.equal(r.published_ts, null);
  assert.equal(r.publication_date_invalid, true);
});

test('a dotted time outside a precise stated time is invalid, so it can never make a report newer', () => {
  const r = publisherDateEvidence(page({ ld: '2026-11-23T10:00:00Z' }), NOW, URL);
  assert.equal(r.published_ts, null);
  assert.equal(r.publication_date_invalid, true);
});

test('pages without dotted values are unchanged', () => {
  const r = publisherDateEvidence(page({ meta: null }), NOW, URL);
  assert.equal(r.publication_date_invalid, false);
  assert.equal(r.published_ts, Date.UTC(2026, 10, 23) - 14 * 3600000);
});

test('the dotted form needs an explicit zone and a real, past date', () => {
  assert.equal(dottedPublicationInstant('23.11.2026 18:05:33 +00:00', NOW), Date.UTC(2026, 10, 23, 18, 5, 33));
  assert.equal(dottedPublicationInstant('23.11.2026 18:05 +01:00', NOW), Date.UTC(2026, 10, 23, 17, 5));
  assert.equal(dottedPublicationInstant('23.11.2026 18:05:33', NOW), null);
  assert.equal(dottedPublicationInstant('31.02.2026 18:05:33 +00:00', NOW), null);
  assert.equal(dottedPublicationInstant('23.11.2026 24:05:33 +00:00', NOW), null);
  assert.equal(dottedPublicationInstant('23.11.2026 18:05:33 +15:00', NOW), null);
  assert.equal(dottedPublicationInstant('25.11.2026 18:05:33 +00:00', NOW), null);
  assert.equal(dottedPublicationInstant('11/23/2026 18:05 +00:00', NOW), null);
});

test('a page whose dotted value agrees with no stated range keeps its original invalid result', () => {
  const html = page({ meta: '23.11.2026 18:05:33 +00:00', ld: '2026-11-21' });
  assert.equal(publisherDateEvidence(html, NOW, URL).published_ts, null);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseShopriteCategories, parseShopriteList, parseShopriteDetail } from '../jobs-erecruit.js';
const fixture = name => readFileSync(new URL(`./fixtures/jobs-shoprite-${name}.html`, import.meta.url), 'utf8');
const categories = parseShopriteCategories(fixture('browse'));
const finance = fixture('finance'), sourceUrl = categories.find(x => x.name === 'Finance').url;
const rows = parseShopriteList(finance, { sourceUrl }).rows;
const now = Date.parse('2026-10-10T12:00:00Z');

test('observed public browse links yield eleven positive categories without treating counts as complete', () => {
  assert.equal(categories.length, 11); assert.equal(categories.reduce((sum, x) => sum + x.count, 0), 42);
  assert.ok(categories.every(x => x.url.startsWith('https://shoprite.erecruit.co/candidateapp/Jobs/Categories/')));
  assert.equal(parseShopriteCategories(fixture('browse').replaceAll('href="/candidateapp/', 'href="https://other.example/candidateapp/')).length, 0);
});
test('actual categories expose19unique vacancy navigation literals without guessing country or dates', () => {
  const meat = parseShopriteList(fixture('meat-markets'), { sourceUrl: categories.find(x => x.name === 'Meat Markets').url });
  assert.equal(rows.length, 3); assert.equal(meat.rows.length, 16); assert.equal(meat.complete, false);
  assert.ok([...rows, ...meat.rows].every(r => r.country == null && r.posted == null && r.closing == null));
  assert.equal(rows[0].id, 'SHO261009-8'); assert.equal(rows[0].title, 'Money Market Assistant (Temp)');
  assert.equal(rows[0].location, 'Brackenfell'); assert.equal(rows[0].closing_text, '2026/10/18');
  assert.equal(meat.rows[0].title, 'Meat Processing & Supply Chain Graduate Programme');
});
test('two actual details bind reference,title,city and explicit ZA before accepting calendar-day expiry', () => {
  for (const listed of rows.slice(0, 2)) {
    const row = parseShopriteDetail(fixture(listed.id), listed, { now });
    assert.equal(row.country, 'ZA'); assert.equal(row.posted, null); assert.equal(row.pay, null);
    assert.equal(row.reference, listed.id); assert.equal(row.source_url, listed.url); assert.equal(row.closed, false);
    const expected = listed.id === 'SHO261009-8' ? '2026-10-18T22:00:00Z' : '2026-10-14T22:00:00Z';
    assert.equal(row.closing, Date.parse(expected));
    assert.equal(parseShopriteDetail(fixture(listed.id), listed, { now: row.closing }).closed, true);
  }
});
test('detail mismatch, changed country, date conflict and login shells never qualify', () => {
  const listed = rows[0], detail = fixture(listed.id);
  for (const modified of [detail.replaceAll(listed.id, 'SHO261005-7'), detail.replaceAll('Money Market Assistant (Temp)', 'Different title'), detail.replaceAll('Brackenfell', 'Durban'), detail.replace('South Africa', 'Namibia'), detail.replace('2026/10/18', '2026/10/19'), detail.replace('2026/10/18', '2026/02/30'), '<html>Log in</html>']) assert.equal(parseShopriteDetail(modified, listed, { now }), null);
  assert.equal(parseShopriteDetail(detail, { ...listed, url: 'https://evil.example/candidateapp/Jobs/View/SHO261009-8' }, { now }), null);
});
test('changed tables, unsafe script literals and invalid dates stay partial without executing scripts', () => {
  for (const html of [finance.replace('Town or City', 'Unknown'), finance.replaceAll('javascript:window.location=', 'javascript:alert(1);window.location='), finance.replaceAll('/candidateapp/Jobs/View/', 'https://evil.example/candidateapp/Jobs/View/'), finance.replaceAll(/2026\/10\/\d+/g, '2026/02/30')]) {
    const result = parseShopriteList(html, { sourceUrl }); assert.equal(result.complete, false); assert.equal(result.rows.length, 0);
  }
  assert.equal(parseShopriteList(finance, { sourceUrl: 'https://other.example/' }).rows.length, 0);
  assert.equal(parseShopriteCategories('x'.repeat(2000001)).length, 0);
  assert.doesNotThrow(() => parseShopriteList(finance.replaceAll('Brackenfell', '&#x110000;'), { sourceUrl }));
});

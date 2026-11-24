// change-search.js and event-search.js build each language's patterns on first use rather than at module load, so
// the pipeline Worker's startup stays inside Cloudflare's CPU limit (deploy error 10021). These checks pin the behaviour.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHANGE_SEARCH_LANGS, CHANGE_TYPES, namesChange } from '../change-search.js';
import { EVENT_SEARCH_LANGS, EVENT_GROUPS, eventTerms, namesEvent } from '../event-search.js';

test('every event term is recognised in its own language, before and after the patterns are first built', () => {
  for (const lang of EVENT_SEARCH_LANGS) for (const group of EVENT_GROUPS) for (const term of eventTerms(lang, group)) {
    assert.equal(namesEvent(lang, `Notice: ${term} next week`), true, `${lang} ${group} ${term}`);
    assert.equal(namesEvent(lang, `Notice: ${term} next week`), true, `${lang} ${group} ${term} (cached)`);
  }
});

test('change and event matching keeps word boundaries and language scoping', () => {
  assert.equal(namesChange('fr', 'Hausse des tarifs'), true);
  assert.equal(namesChange('ja', '電気料金の値上げ'), true);
  assert.equal(namesEvent('fr', 'grèves prévues lundi'), true);
  assert.equal(namesEvent('en', 'general elections next month'), true);
  assert.equal(namesEvent('en', 'selectionsxyz'), false);
  assert.ok(CHANGE_SEARCH_LANGS.length > 0 && CHANGE_TYPES.length > 0);
});

test('unknown or prototype-named languages match nothing and never throw', () => {
  for (const lang of ['xx', '', '__proto__', 'constructor', 'hasOwnProperty', undefined]) {
    assert.equal(namesChange(lang, 'increase hike elections'), false);
    assert.equal(namesEvent(lang, 'increase hike elections'), false);
  }
});

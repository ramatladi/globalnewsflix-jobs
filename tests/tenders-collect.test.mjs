// Tenders collector (public repository): UNGM notices read the way any visitor's browser reads them (the search
// page's anti-forgery token, then the search results), turned into rows with countries, kinds and closing times.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseUngmRows, ungmRow, ungmTime, collectUngm, collectTenders, UA } from '../tenders-collect.js';
import { countryCode, TENDER_KINDS, UNGM_KIND } from '../tenders-kinds.js';
import { uploadTenders } from '../tenders-runner.mjs';

const FIXTURE = readFileSync(new URL('./fixtures/ungm-search.html', import.meta.url), 'utf8');
const NOW = Date.parse('2026-10-22T12:00:00Z');

test('UNGM closing times keep the issuer\'s time zone; publication days are noon UTC', () => {
  assert.equal(new Date(ungmTime('22-Oct-2026 14:59 (GMT -4.00)')).toISOString(), '2026-10-22T18:59:00.000Z');
  assert.equal(new Date(ungmTime('12-Nov-2026 13:00 (GMT 5.50)')).toISOString(), '2026-11-12T07:30:00.000Z', 'decimal half hours');
  assert.equal(new Date(ungmTime('05-Nov-2026 23:59 (GMT 1.00)')).toISOString(), '2026-11-05T22:59:00.000Z');
  assert.equal(new Date(ungmTime('06-Oct-2026')).toISOString(), '2026-10-06T12:00:00.000Z');
  assert.equal(ungmTime('31-Feb-2026'), null);
  assert.equal(ungmTime('soon'), null);
});

test('country names as UN notices write them', () => {
  assert.equal(countryCode('Congo, The Democratic Republic of the'), 'CD');
  assert.equal(countryCode('Congo'), 'CG');
  assert.equal(countryCode('Tanzania, United Republic of'), 'TZ');
  assert.equal(countryCode('Palestine, State of'), 'PS');
  assert.equal(countryCode("Côte d'Ivoire"), 'CI');
  assert.equal(countryCode('Viet Nam'), 'VN');
  assert.equal(countryCode('United States of America'), 'US');
  assert.equal(countryCode('Multiple destinations'), '');
  for (const k of Object.values(UNGM_KIND)) assert.ok(TENDER_KINDS.includes(k), k);
});

test('a page of UNGM results becomes open notices with kinds, references, countries and official links', () => {
  const notices = parseUngmRows(FIXTURE);
  assert.equal(notices.length, 4);
  assert.deepEqual(notices[1], { id: '316701', title: 'INCL-Consultoría de diagnóstico en desarrollo empresarial', deadline: '08-Nov-2026 23:59 (GMT -5.00)', published: '21-Oct-2026', agency: 'FAO', type: 'Invitation to bid', ref: '2026/FLCOL/FLCOL/138537', country: 'Colombia' });
  const rows = notices.map(n => ungmRow(n, NOW));
  assert.deepEqual(rows.map(r => [r.id, r.kind, r.countries.join(',')]), [['ungm:317128', 'grant', 'SL'], ['ungm:316701', 'itb', 'CO'], ['ungm:317300', 'rfp', ''], ['ungm:317301', 'other', 'CD']]);
  assert.equal(rows[2].title, 'LTA for printing services & delivery');
  assert.equal(rows[2].url, 'https://www.ungm.org/Public/Notice/317300');
  assert.equal(rows[3].ref, null);
  assert.ok(rows.every(r => r.issuer_type === 'io' && r.src === 'ungm'));
  assert.equal(ungmRow(notices[0], Date.parse('2026-10-23T00:00:00Z')), null, 'a notice whose deadline has passed is not listed');
});

test('the collector reads the search page once, then the results with its token and cookie, one page at a time', async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, method: init.method || 'GET', headers: init.headers || {}, body: init.body });
    if (url.endsWith('/Public/Notice')) return new Response('<form><input name="__RequestVerificationToken" type="hidden" value="tok123" /></form>', { headers: { 'set-cookie': '.AspNetCore.Antiforgery.x=abc; path=/; samesite=strict; httponly' } });
    return new Response(FIXTURE, { headers: { 'content-type': 'text/html' } });
  };
  const { rows, diagnostics } = await collectUngm(fetchImpl, { now: NOW, delayMs: 0 });
  assert.equal(rows.length, 4);
  assert.equal(diagnostics[0].status, 'complete', 'fewer than a page of results: the last page');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].headers['user-agent'], UA, 'the crawler names itself');
  assert.equal(calls[1].method, 'POST');
  assert.equal(calls[1].headers.RequestVerificationToken, 'tok123');
  assert.equal(calls[1].headers.cookie, '.AspNetCore.Antiforgery.x=abc');
  assert.equal(JSON.parse(calls[1].body).IsActive, true);
  const refused = await collectUngm(async () => new Response('busy', { status: 503 }), { now: NOW, delayMs: 0 });
  assert.deepEqual([refused.rows.length, refused.diagnostics[0].status, refused.diagnostics[0].reason], [0, 'failed', 'page-http-503']);
  const all = await collectTenders(fetchImpl, { now: NOW, delayMs: 0 });
  assert.deepEqual(all.complete, ['ungm']);
});

test('upload: a failed request keeps the source from being pruned', async () => {
  const sent = [];
  const post = async (path, body) => { sent.push([path, body]); return path === '/api/tenders' ? { ok: false, why: 'busy' } : { ok: true, removed: 0 }; };
  const rows = parseUngmRows(FIXTURE).map(n => ungmRow(n, NOW));
  const r = await uploadTenders({ rows, diagnostics: [{ src: 'ungm', status: 'complete', reason: '', rawCount: 4, acceptedCount: 4, httpRequests: 2 }], complete: ['ungm'], runTs: NOW, post, log: () => {} });
  assert.equal(r.ok, false);
  const finish = sent.find(([p]) => p === '/api/tenders/finish')[1];
  assert.deepEqual(finish.sources, [], 'nothing pruned after a failed upload');
  assert.equal(finish.diagnostics[0].reason, 'upload-failed');
});

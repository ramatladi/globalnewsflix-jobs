// Tenders collector (public repository): UNGM notices read the way any visitor's browser reads them (the search
// page's anti-forgery token, then the search results), turned into rows with countries, kinds and closing times.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseUngmRows, ungmRow, ungmTime, collectUngm, collectTenders, UA, tedIssuer, tedTime, tedRow, tedQuery, collectTed, TED_API, isoTime, wbgRow, collectWbg, WBG_LIST,
  parseAfdb, afdbRow, collectAfdb, AFDB_LIST } from '../tenders-collect.js';
import { countryCode, countryFromIso3, TENDER_KINDS, UNGM_KIND } from '../tenders-kinds.js';
import { uploadTenders } from '../tenders-runner.mjs';

const FIXTURE = readFileSync(new URL('./fixtures/ungm-search.html', import.meta.url), 'utf8');
const TED_FIXTURE = JSON.parse(readFileSync(new URL('./fixtures/ted-search.json', import.meta.url), 'utf8'));
const WBG_FIXTURE = readFileSync(new URL('./fixtures/wbg-advertisements.json', import.meta.url), 'utf8');
const AFDB_FIXTURE = readFileSync(new URL('./fixtures/afdb-solicitations.html', import.meta.url), 'utf8');
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
  const every = async (url, init) => url === TED_API ? new Response(JSON.stringify(TED_FIXTURE)) : url === WBG_LIST ? new Response(WBG_FIXTURE)
    : url.startsWith(AFDB_LIST) ? new Response(AFDB_FIXTURE) : fetchImpl(url, init);
  const all = await collectTenders(every, { now: NOW, delayMs: 0, afdbDelayMs: 0 });
  assert.deepEqual(all.complete, ['ungm', 'ted', 'wbg', 'afdb']);
  assert.equal(all.rows.length, 4 + 4 + 4 + 3);
  assert.equal(new Set(all.rows.map(r => r.id)).size, all.rows.length);
});

test('TED: only EU institutions\' and international organisations\' notices, checked by the buyer\'s name', () => {
  for (const name of ['European Commission, DG DIGIT - Digital Services', 'European Union Agency for Asylum', 'Clean Hydrogen Joint Undertaking', 'Cour de justice de l’Union européenne',
    'Secrétariat général du Conseil de l\'Union européenne', 'Europäische Kommission, Gemeinsame Forschungsstelle (JRC)', 'United Nations Office for Project Services (UNOPS)',
    'European Patent Organisation', 'Banque de Développement Conseil Europe', 'CEFTA Secretariat', 'Health and Digital Executive Agency (HaDEA)']) assert.ok(tedIssuer(name), name);
  // TED labels these EU or international bodies too; they are national, local or private.
  for (const name of ['MINISTRSTVO ZA OBRAMBO', 'Fédération AGIRC-ARRCO', 'VšĮ Europos socialinio fondo agentūra', 'POLITECHNIKA RZESZOWSKA', 'Politie', 'EIT Food ivzw',
    'EESC Escp Europe', 'Johanniter Unfall Hilfe e.V.', 'INSTITUT CURIE', 'E.ON Észak-dunántúli Áramhálózati Zrt.']) assert.equal(tedIssuer(name), false, name);
  assert.equal(tedIssuer('Cour des comptes', 'LUX'), true, 'the European Court of Auditors');
  assert.equal(tedIssuer('Cour des comptes', 'FRA'), false, 'the French one');
  assert.match(tedQuery(NOW), /buyer-legal-type IN \(eu-ins-bod-ag int-org\)/);
  assert.match(tedQuery(NOW), />= 20261022\b/);
});

test('TED deadlines keep the buyer\'s time zone, in the wording the pages read', () => {
  assert.deepEqual(tedTime('2026-11-09+01:00', '17:00:59+01:00'), { ts: Date.parse('2026-11-09T16:00:59Z'), text: '09-Nov-2026 17:00 (GMT 1.00)' });
  assert.deepEqual(tedTime('2026-10-27-04:00', '19:00:00-04:00'), { ts: Date.parse('2026-10-27T23:00:00Z'), text: '27-Oct-2026 19:00 (GMT -4.00)' });
  assert.equal(tedTime('2026-11-09+05:30', '10:00:00+05:30').text, '09-Nov-2026 10:00 (GMT 5.50)');
  assert.deepEqual(tedTime('2026-11-12+01:00'), { ts: Date.parse('2026-11-12T22:59:59Z'), text: '12-Nov-2026' }, 'a day without a time closes at its end');
  assert.equal(tedTime('2026-02-31+01:00'), null);
  assert.equal(tedTime('soon'), null);
  assert.equal(countryFromIso3('BRB'), 'BB');
  assert.equal(countryFromIso3('lux'), 'LU');
  assert.equal(countryFromIso3('XXX'), '');
});

test('TED notices become rows: the official notice, issuer, kind, reference, places and closing time; the latest notice of a procedure', async () => {
  const [ministry, dps, unops, curia, eurohpc, digit] = TED_FIXTURE.notices;
  assert.equal(tedRow(ministry, NOW), null, 'a national ministry, whatever TED labels it');
  assert.equal(tedRow(dps, NOW), null, 'a standing call closing more than 400 days ahead');
  assert.deepEqual(tedRow(unops, NOW), { id: 'ted:692396-2026', src: 'ted', issuer: 'United Nations Office for Project Services (UNOPS)', issuer_type: 'io',
    title: 'Construction of the new waste treatment facility for the Queen Elizabeth Hospital in Barbados', ref: 'ITB/2026/63895', kind: 'itb', countries: ['BB'],
    published_ts: Date.parse('2026-10-07T12:00:00Z'), closes_ts: Date.parse('2026-10-27T23:00:00Z'), closes_text: '27-Oct-2026 19:00 (GMT -4.00)', url: 'https://ted.europa.eu/en/notice/-/detail/692396-2026' });
  assert.equal(tedRow(curia, NOW).title, 'Fourniture d’objets promotionnels et de communication', 'the title as the buyer wrote it');
  assert.equal(tedRow(curia, NOW).issuer, 'Cour de justice de l’Union européenne');
  assert.equal(tedRow(eurohpc, NOW).countries.length, 13);
  assert.deepEqual(tedRow(digit, NOW).countries, [], 'no place of performance given');
  assert.equal(tedRow(curia, Date.parse('2026-10-24T00:00:00Z')), null, 'closed');
  assert.equal(tedRow({ ...unops, 'deadline-receipt-tender-date-lot': undefined, 'deadline-receipt-request-date-lot': ['2026-11-02+01:00'] }, NOW).kind, 'prequal', 'requests to take part');
  assert.equal(tedRow({ ...unops, 'notice-type': 'pin-cfc-standard' }, NOW).kind, 'eoi');
  assert.equal(tedRow({ ...unops, 'publication-number': '../x' }, NOW), null);

  const calls = [];
  const { rows, diagnostics } = await collectTed(async (url, init) => { calls.push({ url, init }); return new Response(JSON.stringify(TED_FIXTURE)); }, { now: NOW, delayMs: 0 });
  assert.deepEqual(rows.map(r => r.id).sort(), ['ted:476935-2026', 'ted:529135-2026', 'ted:632753-2026', 'ted:692396-2026'], 'the earlier notice of the UNOPS procedure is dropped');
  assert.deepEqual([diagnostics[0].status, diagnostics[0].rawCount, diagnostics[0].acceptedCount, diagnostics[0].httpRequests], ['complete', 7, 4, 1]);
  assert.equal(calls[0].init.headers['user-agent'], UA, 'the crawler names itself');
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.onlyLatestVersions, true);
  assert.equal(body.query, tedQuery(NOW));
  const refused = await collectTed(async () => new Response('busy', { status: 429 }), { now: NOW, delayMs: 0 });
  assert.deepEqual([refused.rows.length, refused.diagnostics[0].status, refused.diagnostics[0].reason], [0, 'failed', 'search-http-429']);
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

test('World Bank Group: its open requests for expressions of interest, with the full title and countries, and nothing about its staff', async () => {
  const ads = JSON.parse(WBG_FIXTURE).advertisementList;
  assert.deepEqual(wbgRow(ads[0], NOW), { id: 'wbg:7445', src: 'wbg', issuer: 'World Bank Group', issuer_type: 'io', title: 'Refugee Mental Health Study in Jordan', ref: '0002024139', kind: 'eoi',
    countries: ['JO'], published_ts: Date.parse('2026-10-22T12:00:00Z'), closes_ts: Date.parse('2026-10-30T03:59:00Z'), closes_text: '30-Oct-2026 03:59 (GMT 0.00)',
    url: 'https://wbgeprocure-rfxnow.worldbank.org/rfxnow/public/advertisement/7445/view.html' });
  assert.deepEqual(wbgRow(ads[1], NOW).countries, ['CI'], "Cote d'Ivoire");
  assert.deepEqual(wbgRow(ads[3], NOW).countries, ['GM'], 'Gambia, The');
  assert.equal(wbgRow(ads[2], NOW).title, 'Technical Consultant Lviv Hospital Public-Private Partnership Project', 'no stated title: the list\'s');
  assert.deepEqual(wbgRow(ads[2], NOW).countries, []);
  assert.equal(wbgRow({ ...ads[0], draft: true }, NOW), null);
  assert.equal(wbgRow(ads[3], Date.parse('2026-10-23T04:00:00Z')), null, 'closed');
  const staff = { ...ads[0], createdBy: { userProfile: { email: 'someone@worldbank.org', fullName: 'Some One' } } };
  assert.doesNotMatch(JSON.stringify(wbgRow(staff, NOW)), /someone|Some One/);
  const calls = [];
  const out = await collectWbg(async (url, init) => { calls.push({ url, init }); return new Response(WBG_FIXTURE); }, { now: NOW });
  assert.deepEqual([out.rows.length, out.diagnostics[0].status, calls.length, calls[0].init.headers['user-agent']], [4, 'complete', 1, UA]);
  const refused = await collectWbg(async () => new Response('no', { status: 403 }), { now: NOW });
  assert.deepEqual([refused.rows.length, refused.diagnostics[0].status, refused.diagnostics[0].reason], [0, 'failed', 'list-http-403']);
  assert.deepEqual(isoTime('2026-10-30T03:59:00.000+0000'), { ts: Date.parse('2026-10-30T03:59:00Z'), text: '30-Oct-2026 03:59 (GMT 0.00)' });
});

test('African Development Bank Group: current solicitations still open, newest first, ten seconds apart as its robots.txt asks', async () => {
  const notices = parseAfdb(AFDB_FIXTURE);
  assert.equal(notices.length, 5);
  assert.deepEqual(afdbRow(notices[0], NOW), { id: 'afdb:97754', src: 'afdb', issuer: 'African Development Bank Group', issuer_type: 'io',
    title: 'Acquisition of leased office premises for the African Development Bank’s Country Office in Cairo (Egypt)', ref: 'TCGS.1/RFP/FAD/BDE/2026/10/01', kind: 'rfp', countries: [],
    published_ts: Date.parse('2026-10-22T12:00:00Z'), closes_ts: Date.parse('2026-11-12T15:00:00Z'), closes_text: '12-Nov-2026 15:00 (GMT 0.00)',
    url: 'https://www.afdb.org/en/corporate-procurement/acquisition-leased-office-premises-african-97754' });
  assert.equal(afdbRow(notices[3], NOW), null, 'closed on 15 October');
  assert.equal(afdbRow({ ...notices[4], deadline: '2026-11-30T12:00:00+00:00' }, NOW).kind, 'itb', 'ADB/ITB/...');
  assert.equal(afdbRow({ ...notices[0], ref: '', title: "Avis à manifestation d'intérêt pour un audit" }, NOW).kind, 'eoi');
  const calls = [];
  const pages = [AFDB_FIXTURE, AFDB_FIXTURE.replace(/2026-1[01]-\d\dT/g, '2026-07-01T')];
  const out = await collectAfdb(async (url, init) => { calls.push({ url, init }); return new Response(pages[calls.length - 1] ?? ''); }, { now: NOW, afdbDelayMs: 0 });
  assert.deepEqual([out.rows.length, out.diagnostics[0].status, calls.length], [3, 'complete', 2], 'a page with nothing open ends the run');
  assert.equal(calls[1].url, AFDB_LIST + '?page=1');
  assert.equal(calls[0].init.headers['user-agent'], UA);
  const challenged = await collectAfdb(async () => new Response('<html><title>Just a moment...</title><script src="/cdn-cgi/challenge-platform/x.js"></script></html>', { status: 200 }), { now: NOW, afdbDelayMs: 0 });
  assert.deepEqual([challenged.rows.length, challenged.diagnostics[0].status, challenged.diagnostics[0].reason], [0, 'failed', 'challenge-page'], 'a bot check is not got around');
});

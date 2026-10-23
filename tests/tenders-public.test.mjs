// Tenders from the public sector (owner, 23 Oct 2026), read from official systems only: TED's other buyers (the EU and
// EEA countries' public sector, once a day, with TED's iteration mode) and South Africa's eTenders Publication Portal;
// and every notice's language, so each edition lists its own (the global edition English ones). Fixtures are the
// systems' answers as served: TED's (its links object left out) and eTenders' (four of the tenders it listed, some of
// their documents, and contact people's names, e-mail addresses and telephone numbers replaced).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { tedRow, tednRow, tedTexts, collectTed, tedAllQuery, tedQuery, TED_API, UA, etzaRow, etzaNature, zaTime, collectEtza, ETZA_LIST, collectTenders, shorten } from '../tenders-collect.js';
import { guessLang } from '../lang-guess.js';
import { TENDER_SOURCES } from '../tenders-kinds.js';
import { postWithRetry, fullRun, TENDER_ROWS_PER_UPLOAD } from '../tenders-runner.mjs';

const TED = JSON.parse(readFileSync(new URL('./fixtures/ted-public.json', import.meta.url), 'utf8'));
const ETZA = JSON.parse(readFileSync(new URL('./fixtures/etenders-za-opportunities.json', import.meta.url), 'utf8'));
const NOW = Date.parse('2026-10-22T12:00:00Z');

test('TED public buyers: each notice in every language TED gives it, its buyer\'s name in each, goods/works/services and the town', () => {
  const [belgium, bavaria, ireland, helios, kkh] = TED.notices;
  const be = tednRow(belgium, NOW);
  assert.deepEqual({ ...be, summary: be.summary.slice(0, 40), texts: { fr: [be.texts.fr[0].slice(0, 30), be.texts.fr[1].slice(0, 30), be.texts.fr[2]] } }, {
    id: 'tedn:700501-2026', src: 'tedn', issuer: 'FOD Justitie', issuer_type: 'public', kind: 'itb', countries: ['BE'],
    title: 'Openbare procedure voor de uitvoering van een dagelijkse pendeldienst met het oog op het busvervoer van het personeel van de FOD Justitie VOOR REKENING VAN DE FOD JUSTITIE, directoraat-generaal Penitentiaire Inrichtingen, gevangenis te Haren',
    summary: 'De raamovereenkomst heeft betrekking op ', lang: 'nl', langs: ['nl', 'fr'], texts: { fr: ['Procédure ouverte pour l’exécu', "Le présent accord cadre porte ", 'SPF Justice'] },
    ref: 'BESTEK PROCUR/2026-2030/Pendeldienst/Haren/DGEPI', published_ts: Date.parse('2026-10-12T12:00:00Z'), closes_ts: Date.parse('2026-11-12T13:00:00Z'), closes_text: '12-Nov-2026 14:00 (GMT 1.00)',
    url: 'https://ted.europa.eu/en/notice/-/detail/700501-2026', nature: 'services', value_amount: null, value_cur: null, place: 'Bruxelles' }, 'Belgium\'s edition is in Dutch: the Dutch version first');
  const by = tednRow(bavaria, NOW);
  assert.deepEqual([by.issuer_type, by.lang, by.kind, by.nature, by.place, by.countries], ['public', 'de', 'prequal', 'works', 'München', ['DE']], 'requests to take part');
  assert.ok(by.summary.length <= 400 && by.summary.endsWith('…'), 'summaries are cut at a word');
  assert.equal(tednRow(ireland, NOW), null, 'a standing call closing more than 400 days ahead');
  const ie = tednRow(ireland, Date.parse('2028-01-10T12:00:00Z'));
  assert.deepEqual([ie.lang, ie.issuer, ie.value_amount, ie.value_cur, ie.nature, ie.place], ['en', 'Atlantic Technological University', 7500000, 'EUR', 'services', 'Letterkenny']);
  assert.deepEqual(tednRow(ireland, Date.parse('2028-01-10T12:00:00Z')).countries, ['IE'], 'no place of performance: the buyer\'s country');
  assert.deepEqual([tednRow(helios, NOW).issuer_type, tednRow(helios, NOW).nature], ['private', 'goods'], 'a body awarding subsidised contracts is a company');
  // TED files this notice's German text under English as well: it is German, once.
  const k = tednRow(kkh, NOW);
  assert.deepEqual([k.lang, k.langs, k.texts], ['de', ['de'], null]);
  assert.equal(tedTexts({ 'title-proc': { eng: 'Supply of laptops for schools', fra: 'Fourniture d’ordinateurs portables pour les écoles' }, 'buyer-country': ['FRA'] }).lang, 'en', 'English first where given');
  assert.equal(tednRow({ ...belgium, 'buyer-legal-type': ['int-org'], 'buyer-name': { eng: ['United Nations Office for Project Services'] } }, NOW), null, 'international organisations stay under ted');
  assert.equal(tedRow(belgium, NOW), null);
  assert.equal(tednRow({ ...ireland, 'estimated-value-proc': '1' }, Date.parse('2028-01-10T12:00:00Z')).value_amount, null, 'a token value is not shown');
  assert.equal(shorten('a '.repeat(300)).length <= 400, true);
});

test('the daily full TED run reads every open call with TED\'s iteration mode and files each buyer\'s notices under its source', async () => {
  const calls = [];
  const pages = [{ notices: TED.notices.slice(0, 2), totalNoticeCount: 5, iterationNextToken: 'AAA', timedOut: false }, { notices: TED.notices.slice(2), totalNoticeCount: 5, iterationNextToken: null, timedOut: false }];
  const full = await collectTed(async (url, init) => { calls.push({ url, body: JSON.parse(init.body), ua: init.headers['user-agent'] }); return new Response(JSON.stringify(pages[calls.length - 1])); }, { now: NOW, delayMs: 0, full: true });
  assert.equal(calls[0].url, TED_API);
  assert.deepEqual([calls[0].body.paginationMode, calls[0].body.iterationNextToken, calls[1].body.iterationNextToken], ['ITERATION', undefined, 'AAA']);
  assert.equal(calls[0].body.query, tedAllQuery(NOW));
  assert.doesNotMatch(tedAllQuery(NOW), /buyer-legal-type/);
  assert.equal(calls[0].ua, UA);
  assert.deepEqual(full.rows.map(r => r.id).sort(), ['tedn:574337-2023', 'tedn:700501-2026', 'tedn:711296-2026', 'tedn:711350-2026']);
  assert.deepEqual(full.diagnostics.map(d => [d.src, d.status, d.rawCount, d.httpRequests]), [['ted', 'complete', 5, 2], ['tedn', 'complete', 5, 2]]);
  // The regular runs read international organisations' notices only, by page number.
  const regular = [];
  const out = await collectTed(async (url, init) => { regular.push(JSON.parse(init.body)); return new Response(JSON.stringify({ notices: [], totalNoticeCount: 0 })); }, { now: NOW, delayMs: 0 });
  assert.deepEqual([regular[0].paginationMode, regular[0].query, out.diagnostics.map(d => d.src)], ['PAGE_NUMBER', tedQuery(NOW), ['ted']]);
  // A search TED could not finish is not a complete reading: nothing is pruned.
  const timed = await collectTed(async () => new Response(JSON.stringify({ notices: TED.notices, totalNoticeCount: 9, timedOut: true })), { now: NOW, delayMs: 0, full: true });
  assert.deepEqual(timed.diagnostics.map(d => [d.status, d.reason]), [['failed', 'search-timed-out'], ['failed', 'search-timed-out']]);
  const refused = await collectTed(async () => new Response('busy', { status: 503 }), { now: NOW, delayMs: 0, full: true, retryMs: 0 });
  assert.deepEqual(refused.diagnostics.map(d => d.reason), ['search-http-503', 'search-http-503']);
  // A refusal for too many requests is waited out (as long as TED asks) and the same page asked again.
  const answers = [new Response('slow down', { status: 429, headers: { 'retry-after': '0' } }), new Response(JSON.stringify({ notices: TED.notices, totalNoticeCount: 5, iterationNextToken: null }))];
  const patient = await collectTed(async () => answers.shift(), { now: NOW, delayMs: 0, full: true, retryMs: 0 });
  assert.deepEqual(patient.diagnostics.map(d => [d.status, d.httpRequests]), [['complete', 2], ['complete', 2]]);
});

test('South Africa\'s eTenders portal: every advertised tender with its province, category, briefing session and documents, and nobody\'s contact details', async () => {
  const [health, aidc, eskom, agriculture] = ETZA.data;
  const r = etzaRow(health, NOW);
  assert.deepEqual(r, {
    id: 'etza:174831', src: 'etza', issuer: 'Gauteng - Health', issuer_type: 'public', lang: 'en', langs: ['en'], ref: 'GT/GDH/037/2026', kind: 'itb', countries: ['ZA'],
    title: 'THE SUPPLY, DELIVERY, INSTALLATION, COMMISSIONING AND MAINTENANCE OF NUCLEAR MEDICINE EQUIPMENT AT VARIOUS GAUTENG HEALTH INSTITUTIONS FOR A PERIOD OF THREE YEARS',
    published_ts: Date.parse('2026-10-23T12:00:00Z'), closes_ts: Date.parse('2026-11-13T09:00:00Z'), closes_text: '13-Nov-2026 11:00 (GMT 2.00)',
    url: 'https://www.etenders.gov.za/home/Download?blobName=fa166915-16b8-49f2-9d81-659ef202df3c.pdf&downloadedFileName=GT%20GDH%20037%202026%20-%20Section%201%20(002)%20(002).pdf',
    category: 'Supplies: Medical', nature: 'goods', region: 'Gauteng', place: 'Johannesburg',
    info: { brief: { ts: Date.parse('2026-10-30T10:00:00Z'), text: '30-Oct-2026 12:00 (GMT 2.00)', compulsory: true, venue: '45 Commissioner street; Life Centre Building;Auditorium (Training Centre)' },
      docs: [
        { n: 'GT GDH 037 2026 - Section 1 (002) (002).pdf', u: 'https://www.etenders.gov.za/home/Download?blobName=fa166915-16b8-49f2-9d81-659ef202df3c.pdf&downloadedFileName=GT%20GDH%20037%202026%20-%20Section%201%20(002)%20(002).pdf' },
        { n: 'ANNEXURE-B NUCLEAR MEDICINE PRICE SCHEDULE 31072026 GT GDH 037 2026.xls', u: 'https://www.etenders.gov.za/home/Download?blobName=01e93c3b-a814-4172-bbe6-b87e1b391972.xls&downloadedFileName=ANNEXURE-B%20NUCLEAR%20MEDICINE%20PRICE%20SCHEDULE%2031072026%20GT%20GDH%20037%202026.xls' },
        { n: 'GT GDH 037 2026 - Section 2 (002) (002).pdf', u: 'https://www.etenders.gov.za/home/Download?blobName=e4f4c785-698d-4ea3-b585-be74be61e7cd.pdf&downloadedFileName=GT%20GDH%20037%202026%20-%20Section%202%20(002)%20(002).pdf' },
        { n: 'ANNEXURE-A TECHNICAL SPECIFICATIONS FOR NUCLEAR MEDICINE EQUIPMENT GT GDH 037 2026.xlsx', u: 'https://www.etenders.gov.za/home/Download?blobName=18a1b8aa-793f-4c35-9515-da59aa40b008.xlsx&downloadedFileName=ANNEXURE-A%20TECHNICAL%20SPECIFICATIONS%20FOR%20NUCLEAR%20MEDICINE%20EQUIPMENT%20GT%20GDH%20037%202026.xlsx' },
      ] },
  });
  assert.doesNotMatch(JSON.stringify(ETZA.data.map(x => etzaRow(x, NOW))), /Contact Person|example\.gov\.za|000-000-0000/, 'contact people are not kept');
  assert.deepEqual([etzaRow(aidc, NOW).kind, etzaRow(aidc, NOW).info?.brief, etzaRow(aidc, NOW).nature, etzaRow(aidc, NOW).place], ['rfq', undefined, 'services', 'Pretoria']);
  const e = etzaRow(eskom, NOW);
  assert.deepEqual([e.issuer, e.region, e.info.brief.compulsory, e.info.brief.venue, e.place], ['ESKOM', 'National', false, 'MS TEAM', 'Sandton'], 'a state-owned company is the public sector; a briefing session that is not compulsory');
  assert.deepEqual([etzaRow(agriculture, NOW).kind, etzaRow(agriculture, NOW).place, etzaRow(agriculture, NOW).ref], ['rfp', 'Pretoria', '5/2/2/1 (010) 2026-2027']);
  assert.equal(etzaRow(health, Date.parse('2026-11-14T00:00:00Z')), null, 'closed');
  assert.equal(etzaRow({ ...health, status: 'Cancelled' }, NOW), null);
  assert.equal(etzaRow({ ...health, supportDocument: [] }, NOW).url, 'https://www.etenders.gov.za/Home/opportunities?id=1', 'no documents: the portal\'s list');
  assert.equal(etzaRow({ ...health, eSubmission: true }, NOW).info.esub, true);
  assert.deepEqual([etzaNature('Construction'), etzaNature('Services: Civil'), etzaNature('Disposals: General'), etzaNature('Manufacture of furniture'), etzaNature('Information and communication')], ['works', 'works', null, 'goods', 'services']);
  assert.deepEqual(zaTime('2026-12-08T10:00:00'), { ts: Date.parse('2026-12-08T08:00:00Z'), text: '08-Dec-2026 10:00 (GMT 2.00)' });
  assert.equal(zaTime('2026-13-08T10:00:00'), null);
  // Collected 500 at a time, two seconds apart, naming itself.
  const calls = [];
  const out = await collectEtza(async (url, init) => { calls.push({ url, init }); return new Response(JSON.stringify({ ...ETZA, recordsTotal: 4 })); }, { now: NOW, delayMs: 0 });
  assert.deepEqual([out.rows.length, out.diagnostics[0].status, calls.length], [4, 'complete', 1]);
  assert.equal(calls[0].url, `${ETZA_LIST}?draw=1&start=0&length=500&status=1`);
  assert.equal(calls[0].init.headers['user-agent'], UA);
  const refused = await collectEtza(async () => new Response('no', { status: 403 }), { now: NOW, delayMs: 0 });
  assert.deepEqual([refused.rows.length, refused.diagnostics[0].status, refused.diagnostics[0].reason], [0, 'failed', 'list-http-403']);
  assert.deepEqual(TENDER_SOURCES.etza.hosts, ['www.etenders.gov.za']);
});

test('every run reads every source; the daily one adds TED\'s public buyers and Brazil\'s PNCP', async () => {
  const seen = [];
  const fetchImpl = async (url, init) => { seen.push(String(url)); return new Response('{}', { status: 404 }); };
  const out = await collectTenders(fetchImpl, { now: NOW, delayMs: 0, afdbDelayMs: 0 });
  assert.deepEqual(out.diagnostics.map(d => d.src), ['ungm', 'ted', 'wbg', 'afdb', 'etza', 'ppke', 'gets', 'aust', 'secop', 'cabuy', 'cfgb']);
  const fullOut = await collectTenders(fetchImpl, { now: NOW, delayMs: 0, afdbDelayMs: 0, full: true });
  assert.deepEqual(fullOut.diagnostics.map(d => d.src), ['ungm', 'ted', 'tedn', 'wbg', 'afdb', 'etza', 'ppke', 'gets', 'aust', 'secop', 'cabuy', 'cfgb', 'pncp']);
  assert.equal(fullRun(Date.parse('2026-10-23T02:23:00Z'), {}), true, 'the first run of the day');
  assert.equal(fullRun(Date.parse('2026-10-23T10:23:00Z'), {}), false);
  assert.equal(fullRun(Date.parse('2026-10-23T10:23:00Z'), { TENDERS_FULL: '1' }), true, 'a manual run');
  assert.equal(TENDER_ROWS_PER_UPLOAD, 250);
});

test('uploads are tried again after a refusal for too many requests or a server error, as long as asked', async () => {
  const waits = [], answers = [new Response('', { status: 429, headers: { 'retry-after': '20' } }), new Response('', { status: 502 }), new Response('{"ok":true}', { status: 200 })];
  const r = await postWithRetry(async () => answers.shift(), { wait: async ms => { waits.push(ms); } });
  assert.equal(r.status, 200);
  assert.deepEqual(waits, [20000, 30000]);
  const refused = await postWithRetry(async () => new Response('', { status: 400 }), { wait: async () => assert.fail('no retry') });
  assert.equal(refused.status, 400, 'a refused upload is not repeated');
});

test('languages: from the script, the letters and the common words; unknown when a title does not show it', () => {
  const cases = [
    ['Supply of laptops for schools', 'en'], ['Fourniture de matériel informatique pour le ministère', 'fr'], ['Lieferung von Büromaterial für die Stadtverwaltung', 'de'],
    ['Suministro de equipos informáticos para la Universidad', 'es'], ['Aquisição de serviços de manutenção', 'pt'], ['Fornitura di servizi di pulizia', 'it'],
    ['Levering van kantoorartikelen voor de gemeente', 'nl'], ['Dostawa sprzętu komputerowego dla szkoły', 'pl'], ['Upphandling av städtjänster', 'sv'],
    ['Furnizare echipamente medicale pentru spitalul județean', 'ro'], ['Поставка медицинского оборудования', 'ru'], ['Προμήθεια ιατρικού εξοπλισμού', 'el'],
    ['Werkstudent Software Engineering (m/w/d)', 'de'], ['Stage - Assistant Marketing (H/F)', 'fr'], ['Graduate Programme 2026', 'en'], ['Internship - Finance', 'en'],
    ['E3711CXMWP', ''], ['SAP Consultant', ''], ['数据分析实习生', 'zh'], ['データ分析インターン', 'ja'], ['데이터 분석 인턴', 'ko'], ['متدرب تحليل البيانات', 'ar'],
  ];
  for (const [text, want] of cases) assert.equal(guessLang(text), want, text);
  assert.equal(guessLang('Dodávka materiálu', { hint: 'sk' }), 'sk', 'a tie goes to the expected language');
  assert.equal(guessLang('Поставка оборудования', { hint: 'bg' }), 'bg');
});

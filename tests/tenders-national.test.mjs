// National public procurement portals (owner, 23 Oct 2026: each country's public sector, from official systems only):
// Kenya's PPIP, New Zealand's GETS, Australia's AusTender, Colombia's SECOP II, Brazil's PNCP, CanadaBuys and the UK's
// Find a Tender and Contracts Finder. Fixtures are the portals' answers as served, cut to a few notices (Kenya's: the
// officer who posted each tender, the bidders and the subscribers removed; PNCP's: empty fields left out; CanadaBuys':
// long fields cut at 300 characters and contact people replaced; Contracts Finder's: one long description shortened;
// Find a Tender's: the fields the reader uses, descriptions cut near 420 characters, a few places and lots).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ppkeRow, collectPpke, PPKE, parseGets, getsRow, getsTime, collectGets, GETS_FEED, parseAusTender, ausTenderRow, ausTime, collectAusTender, AUSTENDER_LIST,
  secopRow, secopQuery, collectSecop, SECOP_DATA, pncpRow, collectPncp, PNCP_SEARCH, BR_STATES, zonedTime, isoLocal, kindOfTitle, parseCsv, canadaBuysRow, caSlug, collectCanadaBuys, CANADABUYS_CSV, contractsFinderRow, collectContractsFinder, CF_SEARCH, findTenderRow, collectFindATender, FTS_RELEASES, retrying } from '../tenders-national.js';
import { TENDER_SOURCES } from '../tenders-kinds.js';

const fx = name => readFileSync(new URL('./fixtures/' + name, import.meta.url), 'utf8');
const NOW = Date.parse('2026-10-23T08:00:00Z');
const UA = /GlobalNewsflixTenders\/1\.0/;

test('local times in each portal\'s time zone, with the offset of that day', () => {
  assert.deepEqual(zonedTime(2026, 10, 26, 10, 0, 'Australia/Sydney'), { ts: Date.parse('2026-10-25T23:00:00Z'), text: '26-Oct-2026 10:00 (GMT 11.00)' }, 'Canberra in summer time');
  assert.deepEqual(zonedTime(2026, 6, 26, 10, 0, 'Australia/Sydney'), { ts: Date.parse('2026-06-26T00:00:00Z'), text: '26-Jun-2026 10:00 (GMT 10.00)' });
  assert.deepEqual(isoLocal('2026-10-24 11:00:00', 'Africa/Nairobi'), { ts: Date.parse('2026-10-24T08:00:00Z'), text: '24-Oct-2026 11:00 (GMT 3.00)' });
  assert.deepEqual(isoLocal('2026-11-03', 'America/Bogota'), { ts: Date.parse('2026-11-04T04:59:00Z'), text: '03-Nov-2026' }, 'a day without a time closes at its end');
  assert.deepEqual(isoLocal('2026-11-06T09:00', 'America/Sao_Paulo'), { ts: Date.parse('2026-11-06T12:00:00Z'), text: '06-Nov-2026 09:00 (GMT -3.00)' });
  assert.equal(isoLocal('2026-02-30', 'Africa/Nairobi'), null);
  assert.deepEqual(getsTime('Wednesday, 30 June 2027 11:30 PM +12:00'), { ts: Date.parse('2027-06-30T11:30:00Z'), text: '30-Jun-2027 23:30 (GMT 12.00)' });
  assert.deepEqual(ausTime('26-Oct-2026 2:00 pm (ACT Local Time)'), { ts: Date.parse('2026-10-26T03:00:00Z'), text: '26-Oct-2026 14:00 (GMT 11.00)' });
  assert.deepEqual(['RFQ for laptops', 'Registration of Interest – roads', 'Request for Tender: bridge', 'Primary Sector Growth Fund', 'Panel'].map(t => kindOfTitle(t)), ['rfq', 'eoi', 'itb', 'grant', 'other']);
  for (const id of ['ppke', 'gets', 'aust', 'secop', 'pncp', 'cabuy']) assert.deepEqual(TENDER_SOURCES[id].issuerTypes, ['public'], id);
  assert.deepEqual(TENDER_SOURCES.cfgb.issuerTypes, ['public', 'private'], 'Contracts Finder also carries companies\' sub-contracts');
  assert.deepEqual(TENDER_SOURCES.ftsgb.issuerTypes, ['public', 'private'], 'Find a Tender also carries private utilities\' tenders');
});

test('Kenya: the active tenders on PPIP, with their documents and nothing about the officers who posted them', async () => {
  const data = JSON.parse(fx('ke-ppip-active.json'));
  const [roads, school, water, county] = data.data;
  assert.deepEqual(ppkeRow(roads, NOW), { id: 'ppke:308417', src: 'ppke', issuer: 'Kenya Rural Roads Authority', issuer_type: 'public',
    title: 'UPGRADING TO BITUMEN STANDARD OF TACHASIS CHEPLASKEI KONYALIL USWO & CHEPLASKEI KARANDILI CHEBIEMIT', lang: 'en', langs: ['en'], ref: 'RWC 930', kind: 'itb', countries: ['KE'],
    published_ts: Date.parse('2026-01-13T12:00:00Z'), closes_ts: Date.parse('2026-10-24T08:00:00Z'), closes_text: '24-Oct-2026 11:00 (GMT 3.00)', url: 'https://tenders.go.ke/tenders/308417',
    category: 'Works', nature: 'works', place: null, summary: null,
    info: { docs: [{ n: 'Tender Document', u: 'https://tenders.go.ke/storage/Documents/1791876106977-blank-tender-document.pdf' }, { n: 'Tender Notice', u: 'https://tenders.go.ke/storage/Documents/1791876107014-long-tender-notice.pdf' },
      { n: 'Additional Documents', u: 'https://tenders.go.ke/storage/Documents/1791876107037-mygov-gazettenotice.pdf' }] } });
  assert.deepEqual([ppkeRow(school, NOW).nature, ppkeRow(school, NOW).place, ppkeRow(water, NOW).kind, ppkeRow(water, NOW).nature, ppkeRow(county, NOW).issuer], ['goods', 'Nairobi', 'rfp', 'services', 'Kirinyaga County Government']);
  assert.equal(ppkeRow({ ...roads, terminated: 1 }, NOW), null, 'terminated');
  assert.equal(ppkeRow(roads, Date.parse('2026-10-25T00:00:00Z')), null, 'closed');
  assert.doesNotMatch(JSON.stringify(data.data.map(t => ppkeRow({ ...t, created_by: { name: 'An Officer', email: 'officer@example.go.ke', id_number: '12345678' } }, NOW))), /Officer|officer@|12345678/);
  const calls = [];
  const out = await collectPpke(async (url, init) => { calls.push({ url, init }); return new Response(JSON.stringify({ ...data, next_page_url: null, last_page: 1 })); }, { now: NOW, delayMs: 0 });
  assert.deepEqual([out.rows.length, out.diagnostics[0].status, calls.length, calls[0].url], [4, 'complete', 1, `${PPKE}/api/active-tenders?perpage=50&page=1`]);
  assert.match(calls[0].init.headers['user-agent'], UA);
  const pages = [];
  const two = await collectPpke(async url => { pages.push(url); return new Response(JSON.stringify(pages.length === 1 ? data : { ...data, data: [], next_page_url: null })); }, { now: NOW, delayMs: 0 });
  assert.deepEqual([pages.length, two.diagnostics[0].status], [2, 'complete'], 'page by page until the last');
  const refused = await collectPpke(async () => new Response('no', { status: 503 }), { now: NOW, delayMs: 0 });
  assert.deepEqual([refused.diagnostics[0].status, refused.diagnostics[0].reason], ['failed', 'list-http-503']);
});

test('New Zealand: GETS\' feed of open tenders, with region, category and overview; no contact details kept', async () => {
  const xml = fx('nz-gets-rss.xml'), items = parseGets(xml);
  assert.equal(items.length, 4);
  assert.deepEqual(items[3].regions, ['Canterbury']);
  const ccc = getsRow(items[3], NOW);
  assert.deepEqual({ ...ccc, summary: ccc.summary.slice(0, 40) }, { id: 'gets:33761824', src: 'gets', issuer: 'Christchurch City Council', issuer_type: 'public',
    title: 'Burwood Landfill Site C : Provision of Plant hire, maintenance and operation of Burwood Landfill', lang: 'en', langs: ['en'], ref: '33761824', kind: 'rfp', countries: ['NZ'],
    published_ts: Date.parse('2026-10-05T20:30:00Z'), closes_ts: Date.parse('2027-06-30T00:00:00Z'), closes_text: '30-Jun-2027 12:00 (GMT 12.00)', url: 'https://www.gets.govt.nz/CCC/ExternalTenderDetails.htm?id=33761824',
    category: 'Building and Construction Machinery and Accessories', nature: 'goods', region: 'Canterbury', summary: 'The purpose of this RFP is to invite Pro' });
  assert.equal(getsRow(items[0], NOW), null, 'a standing panel closing more than 400 days ahead');
  const msd = getsRow(items[0], Date.parse('2029-06-01T00:00:00Z'));
  assert.doesNotMatch(msd.summary, /@|procurement@msd/, 'no e-mail addresses');
  assert.equal(getsRow(items[1], Date.parse('2027-12-01T00:00:00Z')).region, null, 'several regions: none');
  assert.equal(getsRow(items[2], NOW).kind, 'grant');
  const calls = [];
  const out = await collectGets(async (url, init) => { calls.push({ url, init }); return new Response(xml); }, { now: NOW });
  assert.deepEqual([out.rows.length, out.diagnostics[0].status, out.diagnostics[0].rawCount, calls[0].url], [2, 'complete', 4, GETS_FEED]);
  assert.match(calls[0].init.headers['user-agent'], UA);
  const bad = await collectGets(async () => new Response('<html>maintenance</html>'), { now: NOW });
  assert.deepEqual([bad.diagnostics[0].status, bad.diagnostics[0].reason], ['failed', 'bad-response']);
});

test('Australia: AusTender\'s current approaches to market, in Canberra time, page by page', async () => {
  const html = fx('au-austender-atm.html'), list = parseAusTender(html);
  assert.equal(list.length, 4);
  assert.deepEqual(ausTenderRow(list[1], NOW), { id: 'aust:284574a4-fb3c-459c-a7af-b9a0e9b6722a', src: 'aust', issuer: 'Department of Defence - DSRG', issuer_type: 'public', title: 'Lavarack Barracks Building works, QLD',
    lang: 'en', langs: ['en'], ref: 'S-EST11265', kind: 'itb', countries: ['AU'], published_ts: null, closes_ts: Date.parse('2026-10-26T01:00:00Z'), closes_text: '26-Oct-2026 12:00 (GMT 11.00)',
    url: 'https://www.tenders.gov.au/Atm/Show/284574a4-fb3c-459c-a7af-b9a0e9b6722a', category: 'Building construction and support and maintenance and repair services', nature: 'works', summary: null });
  assert.equal(ausTenderRow(list[3], NOW).kind, 'eoi');
  assert.match(ausTenderRow(list[0], NOW).summary, /^Reissue of 5950-2025-26 with amended closing date/);
  const calls = [];
  const out = await collectAusTender(async (url, init) => { calls.push({ url, init }); return new Response(calls.length === 1 ? html : html.replace(/href="\?page=\d+"/g, '')); }, { now: NOW, delayMs: 0 });
  assert.deepEqual([calls.length, calls[0].url, calls[1].url, out.diagnostics[0].status, out.rows.length], [2, `${AUSTENDER_LIST}?page=1`, `${AUSTENDER_LIST}?page=2`, 'complete', 4]);
  assert.match(calls[0].init.headers['user-agent'], UA);
});

test('Colombia: SECOP II processes still receiving offers, from the national open data portal', async () => {
  const rows = JSON.parse(fx('co-secop-procesos.json'));
  const [santaRosa, car, fondo] = rows;
  const r = secopRow(santaRosa, NOW);
  assert.deepEqual(r, { id: 'secop:CO1.NTC.11089174', src: 'secop', issuer: 'MUNICIPIO DE SANTA ROSA DEL SUR', issuer_type: 'public',
    title: 'ADQUISICIÓN DE AYUDAS TÉCNICAS Y ELEMENTOS DE DOTACIÓN HOSPITALARIA PARA DISTINTOS GRUPOS POBLACIONALES DEL MUNICIPIO DE SANTA ROSA DEL SUR, BOLÍVAR', lang: 'es', langs: ['es'], ref: 'SASI-015-2026',
    kind: 'itb', countries: ['CO'], published_ts: Date.parse('2026-10-20T12:00:00Z'), closes_ts: Date.parse('2026-11-04T04:59:00Z'), closes_text: '03-Nov-2026',
    url: 'https://community.secop.gov.co/Public/Tendering/OpportunityDetail/Index?noticeUID=CO1.NTC.11089174', category: 'Selección abreviada subasta inversa', nature: 'goods', region: 'Bolívar', place: 'Santa Rosa Del Sur',
    value_amount: 138354230, value_cur: 'COP', summary: null }, 'a generic name gives way to the description');
  assert.deepEqual([secopRow(car, NOW).kind, secopRow(car, NOW).nature, secopRow(car, NOW).place], ['rfp', 'services', null]);
  assert.deepEqual([secopRow(fondo, NOW).kind, secopRow(fondo, NOW).value_amount], ['rfi', null]);
  assert.equal(secopRow({ ...car, urlproceso: { url: 'https://community.secop.gov.co/STS/Users/Login/Index' } }, NOW), null, 'a login page is not a notice');
  assert.match(decodeURIComponent(secopQuery(NOW)), /estado_del_procedimiento = 'Publicado' AND fecha_de_recepcion_de >= '2026-10-23T00:00:00'/);
  const calls = [];
  const out = await collectSecop(async (url, init) => { calls.push({ url, init }); return new Response(JSON.stringify(rows)); }, { now: NOW, delayMs: 0 });
  assert.deepEqual([out.rows.length, out.diagnostics[0].status, calls.length], [3, 'complete', 1]);
  assert.ok(calls[0].url.startsWith(SECOP_DATA + '?'));
  assert.match(calls[0].init.headers['user-agent'], UA);
});

test('Brazil: PNCP notices receiving proposals, read state by state (its search stops at 10,000 results)', async () => {
  const data = JSON.parse(fx('br-pncp-search.json'));
  const [saude, ufu, marinha] = data.items;
  assert.deepEqual(pncpRow(saude, NOW), { id: 'pncp:00394544000185-2026-2162', src: 'pncp', issuer: 'MINISTERIO DA SAUDE', issuer_type: 'public',
    title: 'Trata-se da instrução processual para aquisição de 02 (dois) veículos tipo caminhão, destinados ao apoio logístico das equipes de saúde do DSEI Litoral Sul,', lang: 'pt', langs: ['pt'], ref: 'Edital nº 149/2026',
    kind: 'itb', countries: ['BR'], published_ts: Date.parse('2026-10-02T12:00:00Z'), closes_ts: Date.parse('2026-11-06T12:00:00Z'), closes_text: '06-Nov-2026 09:00 (GMT -3.00)',
    url: 'https://pncp.gov.br/app/editais/00394544000185/2026/2162', category: 'Pregão - Eletrônico', region: 'Paraná', place: 'Curitiba', value_amount: 854500, value_cur: 'BRL', summary: null });
  assert.match(pncpRow(ufu, NOW).summary, /licitacoes\.ufu\.br/);
  assert.deepEqual([pncpRow(marinha, NOW).kind, pncpRow(marinha, NOW).region], ['rfq', 'Distrito Federal']);
  assert.equal(pncpRow({ ...saude, cancelado: true }, NOW), null);
  assert.equal(Object.keys(BR_STATES).length, 27);
  const calls = [];
  const out = await collectPncp(async (url, init) => { calls.push({ url, init }); return new Response(JSON.stringify(calls.length === 1 ? data : { items: [], total: 0 })); }, { now: NOW, delayMs: 0 });
  assert.equal(calls.length, 27, 'one search per state');
  assert.ok(calls[0].url.startsWith(PNCP_SEARCH + '?') && calls[0].url.includes('ufs=AC') && calls[0].url.includes('status=recebendo_proposta'));
  assert.deepEqual([out.rows.length, out.diagnostics[0].status], [3, 'complete']);
  assert.match(calls[0].init.headers['user-agent'], UA);
  const refused = await collectPncp(async () => new Response('busy', { status: 429 }), { now: NOW, delayMs: 0, retryMs: 0 });
  assert.deepEqual([refused.diagnostics[0].status, refused.diagnostics[0].reason, refused.diagnostics[0].httpRequests], ['failed', 'search-http-429', 5], 'asked again after a wait, then the run ends');
});

test('Canada: CanadaBuys\' daily file of open tender notices, in English with the French version, each on its CanadaBuys page', async () => {
  const csv = fx('ca-canadabuys-open.csv'), table = parseCsv(csv), head = table[0];
  assert.equal(table.length, 6); assert.ok(table.slice(1).every(r => r.length === head.length), 'quoted line breaks stay inside their fields');
  const row = i => canadaBuysRow(Object.fromEntries(head.map((k, j) => [k, table[i][j]])), NOW);
  const nas = row(1);
  assert.deepEqual({ ...nas, summary: nas.summary.slice(0, 37), texts: { fr: nas.texts.fr.map(x => x.slice(0, 40)) } }, { id: 'cabuy:ssc-26-00034485t', src: 'cabuy', issuer: 'Shared Services Canada', issuer_type: 'public',
    title: 'QNAP TVS-H1688X - NAS server for RCMP', lang: 'en', langs: ['en', 'fr'], texts: { fr: ['QNAP TVS-H1688X - NAS server pour la GRC', 'QNAP TVS-H1688X - NAS server pour la GRC', 'Services partagés Canada'] },
    ref: 'BPM026355/34485', kind: 'rfp', countries: ['CA'], published_ts: null, closes_ts: Date.parse('2026-11-04T19:00:00Z'), closes_text: '04-Nov-2026 14:00 (GMT -5.00)',
    url: 'https://canadabuys.canada.ca/en/tender-opportunities/tender-notice/ssc-26-00034485t', category: 'Automatic Data Processing Equipment, System Configuration', nature: 'goods', region: 'Manitoba', place: 'Ottawa',
    summary: 'QNAP TVS-H1688X - NAS server for RCMP', info: null }, 'Eastern Standard Time after the clocks change');
  assert.equal(row(2), null, 'a notice still marked open after its closing date');
  assert.equal(row(3), null, 'a standing arrangement closing more than 400 days ahead');
  assert.equal(row(4).kind, 'other', 'an advance contract award notice');
  const apn = row(5);
  assert.deepEqual([apn.kind, apn.nature, apn.closes_text, apn.url], ['other', 'works', '27-Oct-2026 14:00 (GMT -4.00)', 'https://canadabuys.canada.ca/en/tender-opportunities/tender-notice/mx-444165208654']);
  assert.match(apn.texts.fr[1], /^Préavis d’approvisionnement AMÉLIORATIONS/, 'character references read as letters');
  assert.doesNotMatch(JSON.stringify(table.slice(1).map((_, i) => row(i + 1))), /Contact Person|contact@example|000-000-0000/);
  assert.deepEqual(['PW-_NCS-030-11940', 'SSC-26-00034485:T', 'MX-443841357513'].map(caSlug), ['pw-ncs-030-11940', 'ssc-26-00034485t', 'mx-443841357513']);
  const calls = [];
  const out = await collectCanadaBuys(async (url, init) => { calls.push({ url, init }); return new Response(csv); }, { now: NOW });
  assert.deepEqual([out.rows.length, out.diagnostics[0].status, out.diagnostics[0].rawCount, calls[0].url], [3, 'complete', 5, CANADABUYS_CSV]);
  assert.match(calls[0].init.headers['user-agent'], UA);
  const bad = await collectCanadaBuys(async () => new Response('<html>busy</html>'), { now: NOW });
  assert.deepEqual([bad.diagnostics[0].status, bad.diagnostics[0].reason], ['failed', 'bad-response']);
});

test('United Kingdom: Contracts Finder\'s open notices, public bodies\' and the sub-contracts companies advertise, in UK time', async () => {
  const data = JSON.parse(fx('gb-contracts-finder.json'));
  const [leeds, school, dstl, amey] = data.noticeList;
  assert.deepEqual(contractsFinderRow(leeds, NOW), { id: 'cfgb:382dcd02-e90d-46d3-a0d4-d58205dc7ca2', src: 'cfgb', issuer: 'University of Leeds', issuer_type: 'public', title: '202526 5920 Six Miele Glasswashers',
    lang: 'en', langs: ['en'], ref: 'BIP1077224731', kind: 'itb', countries: ['GB'], published_ts: Date.parse('2026-10-23T12:00:00Z'), closes_ts: Date.parse('2026-11-13T17:00:00Z'), closes_text: '13-Nov-2026 17:00 (GMT 0.00)',
    url: 'https://www.contractsfinder.service.gov.uk/Notice/382dcd02-e90d-46d3-a0d4-d58205dc7ca2', category: 'Washer/dryers', nature: 'goods', region: 'Yorkshire and The Humber', value_amount: 100000, value_cur: 'GBP',
    summary: 'The Supply, Installation & Commissioning of Six (6) Miele PLW 8683 [LD DC10] Glasswashers and associated accessories.' });
  const s = contractsFinderRow(school, NOW);
  assert.deepEqual([s.region, s.nature, s.value_amount], [null, 'services', 309000], '"Any region" names none');
  assert.doesNotMatch(s.summary, /020 3920 8054/, 'no telephone numbers');
  const d = contractsFinderRow(dstl, NOW);
  assert.deepEqual([d.kind, d.ref, d.closes_text], ['rfi', null, '31-Oct-2026 23:59 (GMT 0.00)']);
  assert.doesNotMatch(d.summary, /@/);
  assert.equal(contractsFinderRow(amey, NOW), null, 'a pipeline notice takes no bids yet');
  assert.equal(contractsFinderRow({ item: { ...leeds.item, noticeType: 'Contract', organisationName: 'AMEY DEFENCE SERVICES LIMITED' } }, NOW).issuer_type, 'private');
  const calls = [];
  const out = await collectContractsFinder(async (url, init) => { calls.push({ url, init }); return new Response(JSON.stringify({ ...data, hitCount: 4 })); }, { now: NOW });
  assert.deepEqual([out.rows.length, out.diagnostics[0].status, calls[0].url, JSON.parse(calls[0].init.body)], [3, 'complete', CF_SEARCH, { searchCriteria: { statuses: ['Open'] }, size: 1000 }]);
  assert.match(calls[0].init.headers['user-agent'], UA);
  const more = await collectContractsFinder(async () => new Response(JSON.stringify(data)), { now: NOW });
  assert.deepEqual([more.diagnostics[0].status, more.diagnostics[0].reason], ['partial', 'over-limit'], 'more open notices than one search returns: nothing pruned');
});

test('United Kingdom: Find a Tender\'s procurements whose latest notice invites tenders or requests to participate', async () => {
  const data = JSON.parse(fx('gb-find-a-tender.json')), by = {};
  for (const r of data.releases) (by[r.ocid] ||= []).push(r);
  const row = ocid => findTenderRow(by[`ocds-h6vhtk-${ocid}`], NOW, { since: NOW - 60 * 86400000 });
  assert.deepEqual(row('078e5d'), { id: 'ftsgb:h6vhtk-078e5d', src: 'ftsgb', issuer: 'Medway Council', issuer_type: 'public', title: 'ESPLANADE GARDENS, ROCHESTER LANDSCAPE IMPROVEMENTS - OCT 2026',
    lang: 'en', langs: ['en'], ref: null, kind: 'itb', countries: ['GB'], published_ts: Date.parse('2026-10-22T12:00:00Z'), closes_ts: Date.parse('2026-11-10T12:00:00Z'), closes_text: '10-Nov-2026 12:00 (GMT 0.00)',
    url: 'https://www.find-tender.service.gov.uk/Notice/100204-2026', category: 'Landscaping work for parks', nature: 'works', region: 'South East', value_amount: 400000, value_cur: 'GBP',
    summary: row('078e5d').summary, info: null });
  assert.match(row('078e5d').summary, /^Revised specification from July\/Aug opportunity .+…$/);
  // Changed after it was published: the change is what is listed, linking to it, published when the tender was.
  const guys = row('078d51');
  assert.deepEqual([guys.url, guys.published_ts, guys.ref, guys.region, guys.value_amount], ['https://www.find-tender.service.gov.uk/Notice/099705-2026', Date.parse('2026-10-21T12:00:00Z'), '6297-26', 'London', 2600000]);
  assert.match(guys.summary, /^Refurbishment of the Apheresis Suite/);
  // A private utility's; requests to participate first (a pre-qualification), until the deadline for expressions of interest.
  const yw = row('06d1fa');
  assert.deepEqual([yw.issuer_type, yw.kind, yw.closes_text, yw.region, yw.category], ['private', 'prequal', '13-Nov-2026 23:59 (GMT 0.00)', null, 'Marketing services'], 'the whole UK names no region');
  assert.deepEqual([row('078e63').issuer_type, row('078e63').kind], ['private', 'itb']);
  assert.doesNotMatch(row('078e63').summary, /\*\*/);
  const har = row('078d60');
  assert.deepEqual([har.kind, har.closes_ts, har.closes_text, har.info, har.region, har.nature], ['prequal', Date.parse('2026-11-20T23:59:00Z'), '20-Nov-2026', { esub: true }, 'London', 'services'], 'a restricted procedure, closing at the end of the day');
  assert.equal(row('078df0').region, null, 'delivered across several regions');
  assert.equal(row('069b78').region, null, 'delivered abroad (an embassy): no UK region');
  assert.equal(row('077919'), null, 'a change that awards the contract: no closing date, nothing to bid for');
  assert.equal(row('078c55'), null, 'awarded');
  assert.equal(findTenderRow([...by['ocds-h6vhtk-078e5d'], { ocid: 'ocds-h6vhtk-078e5d', id: '100300-2026', date: '2026-10-23T09:00:00+01:00', tag: ['tenderCancellation'] }], NOW), null, 'cancelled');
  assert.equal(findTenderRow(by['ocds-h6vhtk-078e5d'], Date.parse('2026-11-11T00:00:00Z')), null, 'closed');
  const upd = findTenderRow([by['ocds-h6vhtk-078d51'][0]], NOW, { since: Date.parse('2026-08-24T08:00:00Z') });
  assert.equal(upd.published_ts, Date.parse('2026-08-24T12:00:00Z'), 'its tender notice is older than those read: no later than that');
  assert.equal(findTenderRow([{ ...by['ocds-h6vhtk-078e5d'][0], tender: { ...by['ocds-h6vhtk-078e5d'][0].tender, title: 'GB-Chatham: Esplanade Gardens' } }], NOW).title, 'Esplanade Gardens');
  // Sixty days of notices, page after page, each from the same service only, two seconds apart, naming itself.
  const calls = [], pages = [{ releases: data.releases.slice(0, 5), links: { next: `${FTS_RELEASES}?limit=100&cursor=abc` } }, { releases: data.releases.slice(5), links: {} }];
  const out = await collectFindATender(async (url, init) => { calls.push({ url, init }); return new Response(JSON.stringify(pages[calls.length - 1])); }, { now: NOW, delayMs: 0 });
  assert.deepEqual([out.rows.length, out.diagnostics[0].status, out.diagnostics[0].rawCount, calls.length], [7, 'complete', 10, 2]);
  assert.equal(calls[0].url, `${FTS_RELEASES}?limit=100&updatedFrom=2026-08-24T08:00:00`);
  assert.equal(calls[1].url, `${FTS_RELEASES}?limit=100&cursor=abc`);
  assert.match(calls[0].init.headers['user-agent'], UA);
  assert.equal(out.rows.find(r => r.id === 'ftsgb:h6vhtk-078d51').url, 'https://www.find-tender.service.gov.uk/Notice/099705-2026', 'the change and its tender, read on one page or two');
  const away = await collectFindATender(async () => new Response(JSON.stringify({ releases: [], links: { next: 'https://example.com/api?x' } })), { now: NOW, delayMs: 0 });
  assert.deepEqual([away.diagnostics[0].status, away.diagnostics[0].reason], ['failed', 'bad-response'], 'a next page elsewhere is never followed');
  const busy = await collectFindATender(async () => new Response('', { status: 429 }), { now: NOW, delayMs: 0, retryMs: 0 });
  assert.deepEqual([busy.diagnostics[0].reason, busy.diagnostics[0].httpRequests], ['list-http-429', 5], 'asked to slow down: tried again, then left for the next run');
});

test('a portal that asks the crawler to slow down is waited for, as long as it asks, then asked again', async () => {
  const answers = [new Response('', { status: 429, headers: { 'retry-after': '0' } }), new Response('', { status: 503 }), new Response('ok')];
  let n = 0;
  const r = await retrying(async () => answers.shift(), 'https://example.gov/x', () => ({}), { retryMs: 0, count: () => n++ });
  assert.deepEqual([r.status, n], [200, 3]);
  const no = await retrying(async () => new Response('', { status: 404 }), 'https://example.gov/x', () => ({}), { retryMs: 0, count: () => n++ });
  assert.deepEqual([no.status, n], [404, 4], 'a refusal is not asked again');
});

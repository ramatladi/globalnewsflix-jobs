// News collection that runs on GitHub's network (the Actions collector, ingest-runner.mjs): Google News and Bing
// feeds per edition, and publisher pages read for facts. Pure: no database, AI or site bindings, so the same code
// runs in the scheduled public collector (exported to ramatladi/globalnewsflix-jobs by
// scripts/export-jobs-collector.mjs) and in the private repository's manual fallback. ingest.js re-exports it.
//
// Crawler rules: every request names this crawler in its user agent; publishers are read at most about once a second
// per host by the Coming Up searches (politeWait/hostTurn); a 401/403, paywall, consent or bot challenge is recorded
// and never retried, disguised or bypassed.
import { COUNTRY, TOPICS, CELEBRITIES, searchEditionFor, slugify, newsLang } from './data.js';
import { sourceTimestamp, isFreshNews, publisherDateEvidence } from './news-freshness.js';
import { nonNewsReason } from './non-news.js';
import { sponsoredContentReason } from './sponsored-content.js';
import { resolveGoogleNewsUrl } from './google-news-url.js';
import { changeQuery, changeRotation, isOfficialHost, namesChange, OFFICIAL_SOURCE_BONUS } from './change-search.js';
import { eventQuery, eventRotation, namesEvent } from './event-search.js';
import { extractArticleImages } from './article-images.js';
import { SECTION_TOPIC, sectionQuery, sectionForVisit, namesSection } from './section-search.js';

const UA = 'Mozilla/5.0 (compatible; GlobalNewsFlixBot/1.0; +https://globalnewsflix.com/about)';

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
export function decodeEntities(s) {
  return String(s || '').replace(/&(#x?[0-9a-f]+|[a-z0-9]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENT[e.toLowerCase()] ?? m;
  });
}
const stripTags = s => decodeEntities(String(s || '').replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const tag = (xml, t) => { const m = xml.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)<\\/${t}>`, 'i')); return m ? m[1].replace(/^<!\[CDATA\[|\]\]>$/g, '') : ''; };

export function parseFeed(xml) {
  const items = [];
  const re = /<item>([\s\S]*?)<\/item>/g;
  let m, rank = 0;
  while ((m = re.exec(xml))) {
    const it = m[1];
    const source = decodeEntities(tag(it, 'source') || tag(it, 'News:Source'));
    const srcHome = (it.match(/<source url="([^"]+)"/) || [])[1] || '';
    let title = decodeEntities(tag(it, 'title'));
    if (source && title.endsWith(' - ' + source)) title = title.slice(0, -(source.length + 3));
    const desc = decodeEntities(tag(it, 'description'));
    const cluster = [];
    const li = /<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>(?:&nbsp;|\s| )*<font[^>]*>([\s\S]*?)<\/font>/g;
    let c;
    while ((c = li.exec(desc))) cluster.push({ t: stripTags(c[2]), s: stripTags(c[3]), u: c[1] });
    let link = decodeEntities(tag(it, 'link')).trim();
    if (/bing\.com\/news\/apiclick/.test(link)) { try { link = new URL(link).searchParams.get('url') || link; } catch {} }
    const image = decodeEntities(tag(it, 'News:Image')).trim();
    if (!cluster.length && desc && !/<a /.test(desc)) cluster.push({ t: title, s: source, d: stripTags(desc).slice(0, 400), u: link });
    items.push({
      rank: rank++, title, source, srcHome, image,
      link,
      guid: decodeEntities(tag(it, 'guid')).trim(),
      pub: sourceTimestamp(tag(it, 'pubDate')),
      cluster: cluster.length ? cluster : [{ t: title, s: source }],
    });
  }
  return items;
}

function feedUrl({ edition, q, topic }) {
  const [hl, gl, ceid] = edition.split(';');
  const params = `hl=${encodeURIComponent(hl)}&gl=${gl}&ceid=${encodeURIComponent(ceid)}`;
  if (q) return `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&${params}`;
  if (topic) return `https://news.google.com/rss/headlines/section/topic/${topic}?${params}`;
  return `https://news.google.com/rss?${params}`;
}

function bingUrl(q, lang = 'en', cc = '') {
  return `https://www.bing.com/news/search?q=${encodeURIComponent(q)}&format=rss&qft=${encodeURIComponent('interval="7"')}&setlang=${encodeURIComponent(lang)}${cc ? `&cc=${encodeURIComponent(cc)}` : ''}`;
}

// Google News editions by language, for searches in an edition's own news language.
const LANG_SEARCH_EDITION = {
  fr: 'fr;FR;FR:fr', es: 'es-419;MX;MX:es-419', pt: 'pt-PT;PT;PT:pt-150', de: 'de;DE;DE:de', it: 'it;IT;IT:it',
  nl: 'nl;NL;NL:nl', ru: 'ru;RU;RU:ru', ro: 'ro;RO;RO:ro', ar: 'ar;EG;EG:ar', el: 'el;GR;GR:el', sr: 'sr;RS;RS:sr',
  ko: 'ko;KR;KR:ko', uk: 'uk;UA;UA:uk', tr: 'tr;TR;TR:tr', bg: 'bg;BG;BG:bg', cs: 'cs;CZ;CZ:cs', sk: 'sk;SK;SK:sk',
  sl: 'sl;SI;SI:sl', hu: 'hu;HU;HU:hu', pl: 'pl;PL;PL:pl', sv: 'sv;SE;SE:sv', no: 'no;NO;NO:no', lv: 'lv;LV;LV:lv',
  lt: 'lt;LT;LT:lt', he: 'he;IL;IL:he', id: 'id;ID;ID:id', vi: 'vi;VN;VN:vi', th: 'th;TH;TH:th', ja: 'ja;JP;JP:ja',
  bn: 'bn;BD;BD:bn', zh: 'zh-HK;HK;HK:zh-Hant',
};
export function countryNameIn(code, lang) {
  try { return new Intl.DisplayNames([lang], { type: 'region' }).of(code) || ''; } catch { return ''; }
}
// Bing news markets that exist for a language. Other languages keep the edition's own country code with their setlang.
const BING_MARKET = { fr: 'FR', es: 'MX', pt: 'BR', de: 'DE', it: 'IT', nl: 'NL', ru: 'RU', ja: 'JP', ko: 'KR', tr: 'TR', pl: 'PL', sv: 'SE', no: 'NO', da: 'DK', fi: 'FI', zh: 'HK' };
// The language a feed returns: Google's hl, or Bing's setlang ('' when the feed does not fix one).
export function feedLanguage(url) {
  try { const u = new URL(url); return (u.searchParams.get('hl') || u.searchParams.get('setlang') || '').toLowerCase().split('-')[0]; } catch { return ''; }
}
// Only reports in an edition's news language can ground its stories, so a non-English edition is searched in that
// language: Google News in the language's edition when one exists, and Bing in that language (its links point straight
// at the publisher, so they need no Google lookup). rot alternates the newest day with the last two.
export function editionLanguageFeeds(c, lang, rot = 0) {
  if (!c || !lang || lang === 'en') return [];
  let name = countryNameIn(c.code, lang);
  if (!name || name === c.code) name = c.name;
  const names = [...new Set([name, c.name, c.q].filter(Boolean))];
  const out = [], edition = LANG_SEARCH_EDITION[lang];
  if (edition) out.push({ country: c.code, section: 'top', search: true, names, url: feedUrl({ edition, q: `"${name}" when:${rot % 2 ? 2 : 1}d` }) });
  out.push({ country: c.code, section: 'top', bing: true, search: true, names, url: bingUrl(`"${name}"`, lang, BING_MARKET[lang] || c.code) });
  return out;
}
// A title that names the edition's country (any spelling the edition is searched by), case- and accent-insensitive.
const foldName = s => String(s || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
export function namesCountry(title, names) {
  const t = foldName(title);
  return (names || []).some(n => { const k = foldName(n); return k.length >= 3 && new RegExp(`(?<![\\p{L}\\p{N}])${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'u').test(t); });
}
// Searches return any page that mentions the country; a report that names it in its title is more likely about it.
export const NAMED_COUNTRY_BONUS = 20;

// For one-source feeds (Bing), estimate trend by how many items tell the same story.
export function clusterBySimilarity(items) {
  const norms = items.map(it => normTitle(it.title));
  const out = [];
  const used = new Set();
  items.forEach((it, i) => {
    if (used.has(i)) return;
    const group = [it];
    for (let j = i + 1; j < items.length; j++) if (!used.has(j) && similar(norms[i], norms[j]) >= 0.5) { group.push(items[j]); used.add(j); }
    it.cluster = group.map(g => ({ t: g.title, s: g.source, d: g.cluster?.[0]?.d, u: g.link }));
    out.push(it);
  });
  return out;
}

// When each feed host was last asked (this process). Coming Up searches wait for at least a second after it.
const HOST_LAST = new Map();
const urlHost = url => { try { return new URL(url).hostname; } catch { return ''; } };
export async function politeWait(url, gapMs = 1000, now = Date.now) {
  const wait = (HOST_LAST.get(urlHost(url)) || 0) + gapMs - now();
  if (wait > 0) await new Promise(r => setTimeout(r, Math.min(wait, gapMs)));
}
async function fetchText(url, opts = {}, ms = 8000) {
  HOST_LAST.set(urlHost(url), Date.now());
  const r = await fetch(url, { ...opts, headers: { 'user-agent': UA, 'accept-language': 'en,*;q=0.5', ...(opts.headers || {}) }, signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url.slice(0, 80)}`);
  return r.text();
}

export async function sha(s) {
  const b = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].slice(0, 8).map(x => x.toString(16).padStart(2, '0')).join('');
}

function scoreItem(it) {
  const ageH = (Date.now() - it.pub) / 3600000;
  const fresh = ageH < 3 ? 15 : ageH < 8 ? 10 : ageH < 24 ? 5 : 0;
  return it.cluster.length * 10 + Math.max(0, 30 - it.rank) + fresh;
}

// Extra searches for the world desk's newer sections (the writer still decides each story's section).
const DESK_QUERIES = [
  ['ai', '("artificial intelligence" OR cyberattack OR "data breach" OR ransomware OR hackers) when:1d'],
  ['space', '(NASA OR SpaceX OR ESA OR ISRO OR astronomers OR "space mission" OR "rocket launch") when:1d'],
  ['odd', '(bizarre OR weird OR strange OR quirky OR unusual) when:1d'],
  // Random News (owner, 22 Oct 2026): whatever is trending on social media (a video, meme, challenge, hashtag, post,
  // product, place, event or person), and what made it trend.
  ['odd', '("went viral" OR "goes viral" OR "viral video" OR "trending on" OR "internet sensation") (TikTok OR Instagram OR X OR YouTube OR Facebook OR Snapchat OR Threads OR Reddit) when:1d'],
  ['odd', '("viral trend" OR "TikTok trend" OR "viral challenge" OR meme OR hashtag OR "social media trend" OR "trending sound") when:1d'],
  ['living', '("cost of living" OR "fuel price" OR "petrol price" OR "food prices" OR inflation OR "electricity tariff" OR rent) when:1d'],
  ['jobs', '(jobs OR hiring OR layoffs OR unemployment OR "job cuts" OR recruitment) when:1d'],
  ['goodnews', '("good news" OR breakthrough OR rescued OR celebrates OR "first-ever" OR reunited) when:1d'],
  ['upcoming', '("next week" OR "this week") (vote OR summit OR verdict OR "rate decision" OR launch OR election) when:1d'],
];

// The world desk's always-visible sections. Their searches return single-source
// stories that never outrank the big multi-source stories, so a section with
// too few current stories gets one boosted candidate every ten minutes until
// it fills. The writer still decides the final section.
export const DESK_SECTIONS = Object.freeze([...new Set(DESK_QUERIES.map(([section]) => section))].filter(section => section !== 'jobs'));
export const DESK_SECTION_MIN = 3;
export function deskSectionsShort(liveCounts) {
  return new Set(DESK_SECTIONS.filter(section => (Number(liveCounts?.[section]) || 0) < DESK_SECTION_MIN));
}
export function deskBoost(c, short) {
  return c?.country === 'WW' && short?.has(c.section) ? 2000 : 0;
}

// Build the list of feeds to pull for one ingest target.
export function feedsFor(target, rot) {
  if (target === 'CELEB') {
    const name = CELEBRITIES[rot % CELEBRITIES.length];
    return [{ country: 'WW', section: 'celebrity', celeb: slugify(name), bing: true, url: bingUrl(`"${name}"`) }];
  }
  if (target === 'SOCIAL') {
    // Whatever is trending on social media, and what made it trend, for Random News (owner, 22 Oct 2026); celebrities'
    // own social media posts for Celebrity. In turn, beside the entertainment page.
    const qs = [
      ['odd', '("went viral" OR "goes viral" OR "viral video") (TikTok OR Instagram OR X OR YouTube OR Facebook)'],
      ['odd', '("trending on" OR "internet sensation" OR "breaks the internet" OR "viral moment") ("social media" OR TikTok OR Instagram OR X)'],
      ['odd', '("viral trend" OR "TikTok trend" OR "viral challenge" OR meme OR hashtag OR "trending sound")'],
      ['celebrity', '(Instagram OR TikTok OR "posted on X" OR YouTube) (celebrity OR singer OR rapper OR actress OR actor)'],
    ];
    const [section, q] = qs[rot % qs.length];
    return [{ country: 'WW', section, bing: true, url: bingUrl(q) },
            { country: 'WW', section: 'celebrity', url: feedUrl({ edition: 'en-US;US;US:en', topic: 'ENTERTAINMENT' }) }];
  }
  if (target === 'WORLD') {
    const eds = ['en-US;US;US:en', 'en-GB;GB;GB:en', 'en-IN;IN;IN:en', 'en-AU;AU;AU:en', 'en-ZA;ZA;ZA:en', 'en-NG;NG;NG:en', 'en-SG;SG;SG:en'];
    const topics = ['WORLD', 'BUSINESS', 'TECHNOLOGY', 'SCIENCE', 'HEALTH', 'SPORTS'];
    const ed = eds[rot % eds.length], tp = topics[Math.floor(rot / eds.length) % topics.length];
    const extra = DESK_QUERIES[rot % DESK_QUERIES.length];
    return [{ country: 'WW', section: tp.toLowerCase(), url: feedUrl({ edition: ed, topic: tp }) },
      { country: 'WW', section: 'world', url: feedUrl({ edition: eds[(rot + 3) % eds.length], topic: 'WORLD' }) },
      { country: 'WW', section: extra[0], url: feedUrl({ edition: 'en-US;US;US:en', q: extra[1] }) }];
  }
  const c = COUNTRY[target];
  if (!c) return [];
  const lang = newsLang(c.code);
  if (c.edition) {
    // The edition's own Google News pages, plus (for non-English editions) a Bing search in the edition language whose
    // links need no Google lookup.
    return [
      { country: c.code, section: 'top', url: feedUrl({ edition: c.edition }) },
      { country: c.code, section: TOPICS[rot % TOPICS.length].toLowerCase(), url: feedUrl({ edition: c.edition, topic: TOPICS[rot % TOPICS.length] }) },
      ...editionLanguageFeeds(c, lang, rot).filter(f => f.bing),
    ];
  }
  // No Google News edition: searches for the country bring several publishers' reports of the same events. A country
  // keyword pair ("Mali Bamako") is searched unquoted, so both words must appear but not as one phrase.
  const q = c.q && c.q !== c.name ? c.q : '';
  if (lang === 'en') {
    // An English edition can only use English reports: a term in another script ("Македонија") is not searched.
    const q = /^[\p{Script=Latin}\s'’.-]+$/u.test(c.q || '') && c.q !== c.name ? c.q : '';
    const names = [...new Set([c.name, c.q].filter(Boolean))];
    const feeds = [{ country: c.code, section: 'top', search: true, names, url: feedUrl({ edition: 'en-US;US;US:en', q: `"${c.name}" when:2d` }) }, { country: c.code, section: 'top', bing: true, search: true, names, url: bingUrl(`"${c.name}"`) }];
    if (q) feeds.push({ country: c.code, section: 'top', search: true, names, url: feedUrl({ edition: searchEditionFor(c), q: `${q} when:2d` }) });
    if (q) feeds.push({ country: c.code, section: 'top', bing: true, search: true, names, url: bingUrl(q).replace('&setlang=en', '') });
    return feeds;
  }
  // A non-English edition can only use reports in its own language, so it is searched in that language only: English
  // searches for it supplied reports that no story could ever be written from.
  const feeds = editionLanguageFeeds(c, lang, rot);
  const qEdition = q ? searchEditionFor(c) : '';
  // The country's own search term, when its search edition is in the edition language (an Arabic-script term in the
  // Arabic edition for an Arabic edition, never for a French one).
  if (q && q !== feeds[0]?.names?.[0]) {
    if (feedLanguage(feedUrl({ edition: qEdition })) === lang)
      feeds.push({ country: c.code, section: 'top', search: true, names: feeds[0]?.names, url: feedUrl({ edition: qEdition, q: `${q} when:2d` }) });
    // Otherwise the term goes to Bing in the edition language, when it is written in that language's script.
    else if (/^[\p{Script=Latin}\s'’.-]+$/u.test(q) === LATIN_LANGS.has(lang))
      feeds.push({ country: c.code, section: 'top', bing: true, search: true, names: feeds[0]?.names, url: bingUrl(q, lang, BING_MARKET[lang] || c.code) });
  }
  return feeds;
}
const LATIN_LANGS = new Set('fr es pt de it nl hr bs ro sl sk cs pl hu sv no da fi et lv lt tr id vi ms sq'.split(' '));
// Coming Up: one search for announced changes (fees, tariffs, employment rules, education requirements, taxes or
// public services, in turn) on every other visit to a target, in the edition's own language, next to the country's
// name: Google News in the edition's (or its language's) Google edition, alternating with Bing in that language.
// Languages without search terms are not searched (see changes.js).
export function changeFeedsFor(target, rot) {
  const turn = changeRotation(rot);
  if (!turn) return [];
  if (target === 'WORLD') return [{ country: 'WW', section: 'upcoming', change: turn.type, lang: 'en', ...(turn.google
    ? { url: feedUrl({ edition: 'en-US;US;US:en', q: `${changeQuery('en', turn.type)} when:1d` }) } : { bing: true, url: bingUrl(changeQuery('en', turn.type, '', { short: true })) }) }];
  const c = COUNTRY[target];
  if (!c) return [];
  const lang = newsLang(c.code);
  let name = lang === 'en' ? c.name : countryNameIn(c.code, lang);
  if (!name || name === c.code) name = c.name;
  const q = changeQuery(lang, turn.type, name);
  if (!q) return [];
  const base = { country: c.code, section: 'upcoming', change: turn.type, lang, search: true, names: [...new Set([name, c.name, c.q].filter(Boolean))] };
  const edition = c.edition && feedLanguage(feedUrl({ edition: c.edition })) === lang ? c.edition : lang === 'en' ? 'en-US;US;US:en' : LANG_SEARCH_EDITION[lang];
  if (edition && turn.google) return [{ ...base, url: feedUrl({ edition, q: `${q} when:2d` }) }];
  const short = changeQuery(lang, turn.type, name, { short: true });
  return [{ ...base, bing: true, url: lang === 'en' ? bingUrl(short) : bingUrl(short, lang, BING_MARKET[lang] || c.code) }];
}
export const COMING_UP_RESULTS = 12;
// A section search keeps its first twenty results (each row is a write).
export const SECTION_RESULTS = 20;
// Section searches (owner, 22 Oct 2026; section-search.js): on each visit, one of the edition's sections with too few
// stories of its own, in turn. An edition with its own Google News edition reads that section's topic page there
// (Business, Technology, Science, Health, Sports, Entertainment) or searches its words there; any other country is
// searched by name next to the section's words, in the edition language. The rows carry the section, so the writer's
// queue can give the edition's short sections their turn; the writer still decides each story's section.
export function sectionFeedsFor(target, rot, sections) {
  const section = sectionForVisit(sections, rot);
  const c = COUNTRY[target];
  if (!section || !c) return [];
  const lang = newsLang(c.code);
  const own = c.edition && feedLanguage(feedUrl({ edition: c.edition })) === lang ? c.edition : '';
  const base = { country: c.code, section, sectionSearch: true, lang };
  if (own && SECTION_TOPIC[section]) return [{ ...base, url: feedUrl({ edition: own, topic: SECTION_TOPIC[section] }) }];
  const q = sectionQuery(lang, section);
  if (!q) return [];
  if (own) return [{ ...base, url: feedUrl({ edition: own, q: `${q} when:2d` }) }];
  let name = lang === 'en' ? c.name : countryNameIn(c.code, lang);
  if (!name || name === c.code) name = c.name;
  const named = { ...base, search: true, names: [...new Set([name, c.name, c.q].filter(Boolean))] };
  const edition = lang === 'en' ? 'en-US;US;US:en' : LANG_SEARCH_EDITION[lang];
  if (edition) return [{ ...named, url: feedUrl({ edition, q: `"${name}" ${q} when:2d` }) }];
  return [{ ...named, bing: true, url: lang === 'en' ? bingUrl(`"${name}" ${q}`) : bingUrl(`"${name}" ${q}`, lang, BING_MARKET[lang] || c.code) }];
}
// Coming Up: one search for scheduled events (elections, votes, court rulings, strikes, festivals, summits, matches,
// exams; three groups in turn, event-search.js) on every visit, in the edition's own language next to the country's
// name, on the other engine from the visit's change search.
export function eventFeedsFor(target, rot) {
  const turn = eventRotation(rot, changeRotation(rot).google);
  if (target === 'WORLD') return [{ country: 'WW', section: 'upcoming', event: turn.group, lang: 'en', ...(turn.google
    ? { url: feedUrl({ edition: 'en-US;US;US:en', q: `${eventQuery('en', turn.group)} when:1d` }) } : { bing: true, url: bingUrl(eventQuery('en', turn.group, '', { short: true })) }) }];
  const c = COUNTRY[target];
  if (!c) return [];
  const lang = newsLang(c.code);
  let name = lang === 'en' ? c.name : countryNameIn(c.code, lang);
  if (!name || name === c.code) name = c.name;
  const q = eventQuery(lang, turn.group, name);
  if (!q) return [];
  const base = { country: c.code, section: 'upcoming', event: turn.group, lang, search: true, names: [...new Set([name, c.name, c.q].filter(Boolean))] };
  const edition = c.edition && feedLanguage(feedUrl({ edition: c.edition })) === lang ? c.edition : lang === 'en' ? 'en-US;US;US:en' : LANG_SEARCH_EDITION[lang];
  if (edition && turn.google) return [{ ...base, url: feedUrl({ edition, q: `${q} when:2d` }) }];
  const short = eventQuery(lang, turn.group, name, { short: true });
  return [{ ...base, bing: true, url: lang === 'en' ? bingUrl(short) : bingUrl(short, lang, BING_MARKET[lang] || c.code) }];
}
// Fetch and parse every feed for one target. Pure (no DB) so GitHub Actions can run it too.
// One request at a time to each host from the Coming Up searches, which otherwise run side by side (politeWait then
// keeps each host's requests a second apart).
const HOST_TURN = new Map();
export function hostTurn(url, fn) {
  const h = urlHost(url), run = (HOST_TURN.get(h) || Promise.resolve()).then(fn, fn);
  HOST_TURN.set(h, run.then(() => {}, () => {}));
  return run;
}
export async function collectTarget(target, rot, { sections } = {}) {
  const rows = [], errors = [];
  const read = async f => {
    try {
      let xml;
      // The extra Coming Up searches ask a host at most once a second after the previous request to it.
      if (f.change || f.event) await politeWait(f.url);
      try { xml = await fetchText(f.url); }
      catch (e) {
        // A refused Coming Up or section search is not replaced by a general one.
        if (f.bing || f.change || f.event || f.sectionSearch || !COUNTRY[f.country]) throw e;
        // Google refused: fall back to Bing for this country, in the same language.
        const c = COUNTRY[f.country], l = feedLanguage(f.url) || 'en', name = l === 'en' ? c.name : (countryNameIn(c.code, l) || c.name);
        xml = await fetchText(l === 'en' ? bingUrl(`"${name}"`) : bingUrl(`"${name}"`, l, BING_MARKET[l] || c.code)); f.bing = true;
      }
      // A Coming Up search keeps its first twelve results (its relevance falls off after that; each row is a write).
      let items = parseFeed(xml).filter(it => isFreshNews(it.pub) && !nonNewsReason(it.title) &&
        !sponsoredContentReason({ url: it.link, title: it.title, source: it.source })).slice(0, f.change || f.event ? COMING_UP_RESULTS : f.sectionSearch ? SECTION_RESULTS : 30);
      if (f.bing) items = clusterBySimilarity(items);
      // A Bing section search keeps the reports whose title or summary holds one of the section's words.
      if (f.sectionSearch && f.bing) items = items.filter(it => namesSection(f.lang, f.section, it.cluster.map(x => `${x.t || ''} ${x.d || ''}`).join(' ') || it.title));
      // Bing answers a change search with loosely related reports too: keep those whose title or summary names a change,
      // and in English (read worldwide) also the edition's country.
      if ((f.change || f.event) && f.bing) items = items.filter(it => { const text = it.cluster.map(x => `${x.t || ''} ${x.d || ''}`).join(' ') || it.title;
        return (f.change ? namesChange(f.lang, text) : namesEvent(f.lang, text)) && (f.lang !== 'en' || f.country === 'WW' || namesCountry(text, f.names)); });
      // fl: the language the feed returns, so the collector and the writer's queue favour reports an edition can use.
      const fl = feedLanguage(f.url);
      for (const it of items) {
        rows.push({
          id: await sha(f.country + '|' + (it.guid || it.link)), country: f.country, section: f.section, title: it.title,
          source: it.source, source_home: it.srcHome, gn_link: it.link, pub_ts: it.pub, date_verified: 1, fl,
          cluster: JSON.stringify({ c: it.cluster.slice(0, 8), img: it.image || '', ...(fl ? { fl } : {}), ...(f.change ? { ch: f.change } : {}), ...(f.event ? { ev: f.event } : {}) }),
          score: scoreItem(it) + (f.search && namesCountry(it.title, f.names) ? NAMED_COUNTRY_BONUS : 0) +
            ((f.change || f.event) && isOfficialHost(it.srcHome || it.link) ? OFFICIAL_SOURCE_BONUS : 0), celeb: f.celeb || null, facts: null,
        });
      }
    } catch (e) { errors.push(`${target}: ${e.message}`); }
  };
  for (const f of [...feedsFor(target, rot), ...sectionFeedsFor(target, rot, sections)]) await read(f);
  // The visit's two Coming Up searches normally go to different engines: they run side by side, never two at once to one
  // host. (One after the other they added minutes to every collector run.)
  await Promise.all([...changeFeedsFor(target, rot), ...eventFeedsFor(target, rot)].map(f => hostTurn(f.url, () => read(f))));
  return { rows, errors };
}

const meta = (html, prop) => {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*>`, 'i');
  const m = html.match(re); if (!m) return '';
  const c = m[0].match(/content=["']([^"']*)["']/i);
  return c ? decodeEntities(c[1]).trim() : '';
};

function declaredCharset(value) {
  const params=String(value||'').split(';').filter(part=>/^\s*charset\b/i.test(part));
  if(!params.length)return null;
  if(params.length!==1)return '';
  const match=params[0].match(/^\s*charset\s*=\s*(?:"([^"]+)"|'([^']+)'|([a-z0-9._-]+))\s*$/i);
  return match?(match[1]??match[2]??match[3]):'';
}

function publisherCharset(bytes,contentType) {
  // HTML BOMs take precedence over HTTP and meta declarations.
  // Check UTF-32LE before UTF-16LE; a UTF-16LE page starting with NUL is conservatively held.
  if(bytes.length>=4&&((bytes[0]===0xff&&bytes[1]===0xfe&&bytes[2]===0&&bytes[3]===0)||
    (bytes[0]===0&&bytes[1]===0&&bytes[2]===0xfe&&bytes[3]===0xff)))return null; // unsupported UTF-32 BOM
  if(bytes.length>=3&&bytes[0]===0xef&&bytes[1]===0xbb&&bytes[2]===0xbf)return 'utf-8';
  if(bytes.length>=2&&bytes[0]===0xff&&bytes[1]===0xfe)return 'utf-16le';
  if(bytes.length>=2&&bytes[0]===0xfe&&bytes[1]===0xff)return 'utf-16be';
  const prefix=Array.from(bytes.subarray(0,4096),b=>String.fromCharCode(b)).join('');
  const header=declaredCharset(contentType);
  const metaLabels=[];
  for(const match of prefix.matchAll(/<meta\b[^>]*>/gi)) {
    const attributes=new Map();
    const tag=match[0],body=tag.slice(5,tag.endsWith('/>')?-2:-1);
    for(const attr of body.matchAll(/(?:^|\s)([a-z0-9:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/gi))
      attributes.set(attr[1].toLowerCase(),(attr[2]??attr[3]??attr[4]??'').trim());
    let label=null;
    if(attributes.has('charset'))label=attributes.get('charset');
    else if(attributes.get('http-equiv')?.toLowerCase()==='content-type'&&attributes.has('content'))
      label=declaredCharset(attributes.get('content'));
    if(label!==null)metaLabels.push(label);
  }
  if(header===''||metaLabels.includes(''))return null;
  try {
    const headerEncoding=header?new TextDecoder(header,{fatal:true}).encoding:null;
    const metaEncodings=metaLabels.map(label=>new TextDecoder(label,{fatal:true}).encoding);
    if(metaEncodings.some(encoding=>encoding!==(headerEncoding||metaEncodings[0])))return null;
    return headerEncoding||metaEncodings[0]||'utf-8';
  } catch { return null; }
}

export async function boundedPublisherText(response,maxBytes=3000000,{truncate=false}={}) {
  // truncate: keep the first maxBytes of a larger page instead of refusing it. Publication markers sit in the head
  // and the article opening; a cut multi-byte UTF-8 character at the end is dropped, never replaced.
  const announced=Number(response.headers.get('content-length'));
  if(!truncate&&Number.isFinite(announced)&&announced>maxBytes){await response.body?.cancel();return null;}
  const reader=response.body?.getReader();if(!reader)return null;
  const chunks=[];let size=0,cut=false;
  try {
    for(;;){const {done,value}=await reader.read();if(done)break;
      if(size+value.byteLength>maxBytes){if(!truncate){await reader.cancel();return null;}chunks.push(value.subarray(0,maxBytes-size));size=maxBytes;cut=true;await reader.cancel().catch(()=>{});break;}
      size+=value.byteLength;chunks.push(value);}
  } finally {reader.releaseLock();}
  let bytes=new Uint8Array(size);let offset=0;
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  const charset=publisherCharset(bytes,response.headers.get('content-type'));
  if(!charset)return null;
  if(cut&&charset==='utf-8')bytes=bytes.subarray(0,utf8CompleteLength(bytes));
  try {return new TextDecoder(charset,{fatal:true}).decode(bytes);} catch {return null;}
}
// Length of the prefix that ends on a complete UTF-8 character.
export function utf8CompleteLength(bytes) {
  let i=bytes.length;const stop=Math.max(0,bytes.length-4);
  while(i>stop&&(bytes[i-1]&0xc0)===0x80)i--;
  if(i===0||i<=stop&&(bytes[i]&0xc0)===0x80)return bytes.length;
  const lead=bytes[i-1],need=lead>=0xf0?4:lead>=0xe0?3:lead>=0xc0?2:1;
  return bytes.length-(i-1)>=need?bytes.length:i-1;
}

export function publisherSourceLanguage(html) {
  const root=String(html).match(/<html\b[^>]*>/i)?.[0] || '';
  const value=root.match(/\slang\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
  const lang=(value?.[1] || value?.[2] || value?.[3] || '').trim();
  return /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(lang) ? lang.toLowerCase().split('-')[0] : null;
}

// Source text the writer may draw on. Full articles need the body of each report,
// not just its opening; the writer's review sources are capped at 7,000 characters each.
export const SOURCE_EXCERPT_MAX = 6000, MORE_EXCERPT_MAX = 4500, MORE_EXCERPT_EXTRA_MAX = 2000;
// Publisher page requests. The crawler always identifies itself (UA); only standard Accept / Accept-Language headers are
// added. Paywalls, bot challenges and refusals are respected: a 401/403 is recorded and never retried or disguised.
export const PUBLISHER_FETCH_MAX_BYTES = 4000000;
const ACCEPT_HTML = 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5';
const TRANSIENT_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
export function acceptLanguage(lang) {
  const l = String(lang || '').toLowerCase().split(/[-_]/)[0];
  return /^[a-z]{2,3}$/.test(l) && l !== 'en' ? `${l},en;q=0.6,*;q=0.3` : 'en,*;q=0.5';
}
export function publisherHost(url) {
  try { return new URL(url).hostname.toLowerCase().replace(/^(?:www\d*|m|amp|mobile)\./, ''); } catch { return ''; }
}
// One request with an optional single retry after a transient failure (timeout, network error, 408/429/5xx).
async function fetchPublisherPage(url, { timeoutMs = 7000, retries = 0, lang = '', fetchImpl = globalThis.fetch } = {}) {
  let reason = 'fetch failed';
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt) await new Promise(r => setTimeout(r, 1500));
    try {
      const r = await fetchImpl(url, { headers: { 'user-agent': UA, accept: ACCEPT_HTML, 'accept-language': acceptLanguage(lang) }, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
      if (r.ok) return { response: r };
      await r.body?.cancel().catch(() => {});
      reason = `HTTP ${r.status}`;
      if (!TRANSIENT_STATUS.has(r.status)) break;
    } catch (e) { reason = e?.name === 'TimeoutError' || e?.name === 'AbortError' ? 'timeout' : 'fetch failed'; }
  }
  return { response: null, reason };
}
// A same-publisher alternative of the page (rel=canonical, else rel=amphtml) that may carry the publication markers
// the fetched variant lacks. Only http(s) on the same site (ignoring www./m./amp.) and never the same URL.
export function samePublisherAlternate(html, pageUrl) {
  const host = publisherHost(pageUrl);
  if (!host) return null;
  const links = [...String(html).slice(0, 400000).matchAll(/<link\b[^>]*>/gi)].map(m => m[0]);
  for (const rel of ['canonical', 'amphtml']) {
    for (const tag of links) {
      if (!new RegExp(`\\srel\\s*=\\s*["']?${rel}["'\\s>]`, 'i').test(tag)) continue;
      const href = tag.match(/\shref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
      if (!href) continue;
      try {
        const u = new URL(decodeEntities(href[1] ?? href[2] ?? href[3]), pageUrl);
        if (!/^https?:$/.test(u.protocol) || publisherHost(u.href) !== host) continue;
        u.hash = '';
        if (u.href.replace(/\/$/, '') === String(pageUrl).replace(/#.*$/, '').replace(/\/$/, '')) continue;
        return u.href;
      } catch { /* malformed link */ }
    }
  }
  return null;
}
// Options: resolve(link) -> publisher URL or null (the collector passes its budgeted, cached resolver so enrichment never
// makes unbudgeted Google requests); timeoutMs; retries; lang (edition language for Accept-Language); skipHost(host).
export async function enrich(cand, opts = {}) {
  const { resolve = null, timeoutMs = 7000, retries = 0, lang = '', skipHost = null, fetch: fetchImpl = globalThis.fetch } = opts;
  const out = { url: null, image: '', images: [], description: '', excerpt: '', published_ts: null, fetched_ts: null, publication_date_invalid: false, sponsored_reason: null };
  if (!/news\.google\.com/.test(cand.gn_link)) out.url = cand.gn_link;
  else if (resolve) {
    out.url = await resolve(cand.gn_link).catch(() => null) || null;
    if (!out.url) out.url_reason = 'Google News link unresolved: not resolved within the collection budget';
  } else {
    const resolved = await resolveGoogleNewsUrl(cand.gn_link).catch(e => ({ url: null, reason: `decode error: ${e?.message || e}` }));
    out.url = resolved.url;
    if (!out.url) out.url_reason = `Google News link unresolved: ${resolved.reason}`;
  }
  out.sponsored_reason = sponsoredContentReason({url:out.url,title:cand.title,source:cand.source});
  if (out.sponsored_reason) return out;
  if (!out.url) return out;
  if (skipHost?.(publisherHost(out.url))) { out.fetch_reason = 'publisher skipped: repeated fetch failures'; return out; }
  try {
    const page = await readPublisherPage(out.url, { timeoutMs, retries, lang, fetchImpl });
    if (!page.html) { out.fetch_reason = page.reason; if (page.url) out.url = page.url; if (page.sponsored_reason) out.sponsored_reason = page.sponsored_reason; return out; }
    let { html, url } = page;
    out.url = url;
    let dates = publisherDateEvidence(html, Date.now(), url);
    // No usable publication markers on this variant: try the publisher's own canonical / AMP version once.
    if (!sourceTimestamp(dates.published_ts) && !dates.publication_date_invalid) {
      const alt = samePublisherAlternate(html, url);
      if (alt) {
        const second = await readPublisherPage(alt, { timeoutMs, retries: 0, lang, fetchImpl });
        if (second.html && publisherHost(second.url) === publisherHost(url)) {
          const altDates = publisherDateEvidence(second.html, Date.now(), second.url);
          if (sourceTimestamp(altDates.published_ts) || altDates.publication_date_invalid) { html = second.html; url = second.url; dates = altDates; out.url = url; out.alternate_of = page.url; }
        }
      }
    }
    out.sponsored_reason = sponsoredContentReason({html,url:out.url});
    if (out.sponsored_reason) return out;
    out.source_lang=publisherSourceLanguage(html);
    out.fetched_ts=Date.now();
    Object.assign(out, dates);
    const imageData = extractArticleImages(html, url);
    out.imageEvidence = imageData.images;
    out.image = imageData.images[0]?.url || '';
    out.images = imageData.images.slice(1).map(x => x.url);
    out.image_size = out.image ? declaredImageSize(html) : null;
    out.description = meta(html, 'og:description') || meta(html, 'description');
    const body = (html.match(/<article[\s\S]*?<\/article>/i) || [html])[0];
    const paras = [];
    const pre = /<p[^>]*>([\s\S]*?)<\/p>/gi; let p, len = 0;
    while ((p = pre.exec(body)) && len < SOURCE_EXCERPT_MAX) {
      const t = stripTags(p[1]);
      if (t.length > 60 && !/cookie|subscribe|sign up|newsletter|all rights reserved/i.test(t)) { paras.push(t); len += t.length; }
    }
    out.excerpt = paras.join('\n').slice(0, SOURCE_EXCERPT_MAX);
  } catch { out.fetch_reason = out.fetch_reason || 'page could not be read'; }
  return out;
}
// The lead photo's size as the publisher declares it (og:image:width / og:image:height). A ranking hint only: every
// photo is still downloaded and checked before a story can use it.
export function declaredImageSize(html) {
  const w = Number(meta(html, 'og:image:width')), h = Number(meta(html, 'og:image:height'));
  return Number.isInteger(w) && Number.isInteger(h) && w > 0 && h > 0 && w <= 20000 && h <= 20000 ? { w, h } : null;
}
// Photo checks accept only publisher photos of at least 1200x600 (and a sane shape); most stories written without such
// a photo never get one. A report that declares one is likelier to publish.
export const LARGE_PHOTO_BONUS = 60;
export function declaresLargePhoto(facts) {
  let f = facts; if (typeof f === 'string') { try { f = JSON.parse(f); } catch { return false; } }
  if (!f || typeof f !== 'object') return false;
  return [f, ...(Array.isArray(f.more) ? f.more : [])].some(r => r && r.image && r.image_size && r.image_size.w >= 1200 && r.image_size.h >= 600 &&
    r.image_size.w / r.image_size.h >= 0.5 && r.image_size.w / r.image_size.h <= 2.5);
}
// Fetch and decode one publisher page. Returns {html,url} or {html:null,reason}.
async function readPublisherPage(url, { timeoutMs, retries, lang, fetchImpl }) {
  const { response: r, reason } = await fetchPublisherPage(url, { timeoutMs, retries, lang, fetchImpl });
  if (!r) return { html: null, reason };
  const finalUrl = r.url || url;
  const sponsored = sponsoredContentReason({url:finalUrl});
  if (sponsored) { await r.body?.cancel().catch(() => {}); return { html: null, url: finalUrl, reason: 'sponsored', sponsored_reason: sponsored }; }
  const type = (r.headers.get('content-type') || '').toLowerCase();
  if (type && !type.includes('html')) { await r.body?.cancel().catch(() => {}); return { html: null, url: finalUrl, reason: `not HTML (${type.split(';')[0].slice(0, 40)})` }; }
  if (publisherHost(finalUrl) !== publisherHost(url) && /(^|\.)(consent|guce|privacy|cmp)\.|\/consent/i.test(finalUrl)) { await r.body?.cancel().catch(() => {}); return { html: null, url, reason: 'consent page' }; }
  let html = await boundedPublisherText(r, PUBLISHER_FETCH_MAX_BYTES, { truncate: true });
  if (html === null) return { html: null, url: finalUrl, reason: 'undecodable text' };
  if (html.length > 600000) html = html.slice(0, 600000);
  return { html, url: finalUrl };
}

export async function enrichMulti(cand, extra = 4, opts = {}) {
  const lead = await enrich(cand, opts);
  if (lead.sponsored_reason) return lead;
  lead.imageSource = lead.image ? cand.source : '';
  let others = readCluster(cand.cluster).c.filter(x => x.u && x.s !== cand.source && x.u !== cand.gn_link);
  // Other reports from publishers known to refuse or to serve undated shells are not requested.
  if (opts.skipHost) others = others.filter(x => /news\.google\.com/.test(x.u) || !opts.skipHost(publisherHost(x.u)));
  others = others.slice(0, extra);
  const more = await Promise.all(others.map(async x => {
    try { const f = await enrich({ gn_link: x.u, title: x.t, source: x.s }, opts); if (f.sponsored_reason) return null; return { excerpt: f.excerpt || f.description || '', image: f.image, images: f.images, imageEvidence: f.imageEvidence, image_size: f.image_size, url: f.url, source_lang: f.source_lang, published_ts: f.published_ts, fetched_ts: f.fetched_ts, publication_date_invalid: f.publication_date_invalid, source: x.s }; } catch { return null; }
  }));
  lead.more = more.filter(m => m && (m.excerpt || m.image)).map((m, i) => ({ excerpt: m.excerpt.slice(0, i < 2 ? MORE_EXCERPT_MAX : MORE_EXCERPT_EXTRA_MAX), image: m.image, images: m.images, imageEvidence: m.imageEvidence, image_size: m.image_size, url: m.url, source_lang: m.source_lang, published_ts: m.published_ts, fetched_ts: m.fetched_ts, publication_date_invalid: m.publication_date_invalid, timing_role: isFreshNews(m.published_ts) ? 'current-report' : sourceTimestamp(m.published_ts) ? 'historical-context' : 'unverified', source: m.source }));
  if (!lead.image) { const withImg = lead.more.find(m => m.image); if (withImg) { lead.image = withImg.image; lead.imageSource = withImg.source; } }
  return lead;
}

export function readCluster(str) {
  const v = JSON.parse(str || '[]');
  const data = Array.isArray(v) ? { c: v, img: '' } : { c: v.c || [], img: v.img || '' };
  return { ...data, c: Array.isArray(data.c) ? data.c.filter(x => x && !sponsoredContentReason({url:x.u,title:x.t,source:x.s})) : [] };
}

const STOP = new Set('the a an of to in on for and or is are was were be by with at from as after over into its his her their this that new says say said de la el le les des du en y und der die das il di da do na no o e'.split(' '));
export function normTitle(t) {
  return [...new Set(String(t).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').split(/[^\p{L}\p{N}]+/u).filter(w => w.length > 2 && !STOP.has(w)))].sort().join(' ');
}
export function similar(a, b) {
  const A = new Set(a.split(' ')), B = new Set(b.split(' '));
  if (!A.size || !B.size) return 0;
  let i = 0; for (const w of A) if (B.has(w)) i++;
  return i < 2 ? 0 : i / Math.min(A.size, B.size);
}

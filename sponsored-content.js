// Only explicit publisher labels count. A story *about* sponsors or partnerships is news.
const label = value => String(value || '').normalize('NFKC').toLowerCase().replace(/&(?:nbsp|#160);/gi, ' ')
  .replace(/[\s\u00a0_-]+/g, ' ').trim();

const PAID_LABELS = new Set([
  'advertorial', 'branded content', 'paid content', 'paid partnership',
  'partner content', 'promoted content', 'sponsored', 'sponsored article',
  'sponsored content',
  'contenido patrocinado', 'contenido de pago', 'contenido publicitario', 'publirreportaje',
  'contenu sponsorisé', 'contenu commandité', 'contenu publicitaire', 'publi-reportage',
  'conteúdo patrocinado', 'conteúdo pago', 'conteúdo publicitário', 'publieditorial',
  'contenuto sponsorizzato', 'pubbliredazionale',
  'gesponsorde inhoud', 'gesponsord artikel', 'gesponserter inhalt', 'bezahlter inhalt',
  'konten bersponsor', 'sponsorlu içerik',
  'प्रायोजित सामग्री', '赞助内容', '广告内容', 'スポンサー記事', '広告記事', '광고 콘텐츠',
  'محتوى برعاية', 'محتوى مدفوع', 'محتوى إعلاني', 'محتوى ممول',
  'anzeige', 'werbung', 'publicidad', 'patrocinado', 'publireportage',
  'reklam', 'iklan', 'реклама', '广告', '広告', '광고', 'إعلان',
].map(label));
const PAID_PATHS = new Set([
  'advertorial', 'advertorials', 'branded-content', 'brandstudio',
  'brand-studio', 'brandvoice', 'paid-content', 'paid-post', 'paidpost',
  'partner-content', 'promoted-content', 'sponsored', 'sponsored-content',
  'sponsor-content',
]);
const PAID_SUBDOMAINS = new Set(['paidpost', 'brandstudio', 'sponsored', 'partners']);
const COUNTRY_SECOND_LEVEL = new Set(['ac', 'co', 'com', 'edu', 'gov', 'net', 'org']);

function japaneseContext(url, title, html) {
  if (/[\u3040-\u30ff]/u.test(String(title || ''))) return true;
  try { if (new URL(url).hostname.toLowerCase().endsWith('.jp')) return true; } catch {}
  const root = String(html || '').match(/<html\b[^>]*>/i)?.[0] || '';
  return /^ja(?:-|$)/i.test(attr(root, 'lang'));
}

const paidLabel = (value, context) => {
  const normalized = label(value);
  return normalized === 'pr'
    ? japaneseContext(context.url, context.title, context.html)
    : PAID_LABELS.has(normalized);
};

function paidUrl(url) {
  try {
    const parsed = new URL(url), parts = parsed.hostname.toLowerCase().split('.');
    const name = parts[0] === 'www' ? parts[1] : parts[0];
    const domainParts = parts.length - (parts[0] === 'www' ? 1 : 0);
    const countrySecondLevel = parts.at(-1)?.length === 2 && COUNTRY_SECOND_LEVEL.has(parts.at(-2));
    if (PAID_SUBDOMAINS.has(name) && domainParts >= (countrySecondLevel ? 4 : 3)) return true;
    return parsed.pathname.split('/').some(segment => {
      try { return PAID_PATHS.has(decodeURIComponent(segment).toLowerCase()); }
      catch { return false; }
    });
  } catch { return false; }
}

function attr(tag, name) {
  const match = tag.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? '';
}

function pageKey(url) {
  try { const parsed = new URL(url); return parsed.hostname.toLowerCase() + parsed.pathname.replace(/\/+$/, ''); }
  catch { return null; }
}

function schemaNodes(value) {
  if (Array.isArray(value)) return value.flatMap(schemaNodes);
  if (!value || typeof value !== 'object') return [];
  return [value, ...schemaNodes(value['@graph'])];
}

function schemaType(node) {
  const types = Array.isArray(node['@type']) ? node['@type'] : [node['@type']];
  return types.filter(x => typeof x === 'string').map(x => x.split(/[\/#]/).pop());
}

function schemaUrls(node) {
  const page = node.mainEntityOfPage;
  return [node.url, node['@id'], typeof page === 'string' ? page : page?.url, page?.['@id']]
    .filter(x => typeof x === 'string' && pageKey(x));
}

function paidSchema(html, url) {
  const current = pageKey(url);
  const nodes = [];
  for (const match of String(html || '').matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (!/^application\/ld\+json(?:\s*;|$)/i.test(attr(match[1], 'type'))) continue;
    let data;
    try { data = JSON.parse(match[2]); } catch { continue; }
    nodes.push(...schemaNodes(data));
  }
  const articles = nodes.filter(n => schemaType(n).some(t => /Article$/.test(t) || t === 'BlogPosting'));
  for (const node of articles) {
    if (!schemaType(node).includes('AdvertiserContentArticle')) continue;
    const urls = schemaUrls(node);
    if (current && urls.some(candidate => pageKey(candidate) === current)) return true;
    if (!urls.length && articles.length === 1) return true;
    if (!current && articles.length === 1) return true;
  }
  return false;
}

function paidMetadata(html, url, title) {
  const head = String(html || '').match(/<head\b[^>]*>([\s\S]*?)<\/head>/i)?.[1] || String(html || '').slice(0, 20000);
  for (const tag of head.match(/<meta\b[^>]*>/gi) || []) {
    const name = (attr(tag, 'name') || attr(tag, 'property')).toLowerCase();
    if (['article:section', 'article:category', 'section', 'category', 'content-type', 'content_type'].includes(name)
        && paidLabel(attr(tag, 'content'), {url, title, html})) return 'publisher-paid-label';
  }
  const article = String(html || '').match(/<article\b[^>]*>/i)?.[0];
  if (article) {
    for (const key of ['data-label', 'data-category', 'data-content-type']) {
      if (paidLabel(attr(article, key), {url, title, html})) return 'publisher-paid-label';
    }
    if (attr(article, 'class').split(/\s+/).some(c => PAID_PATHS.has(c.toLowerCase()))) return 'publisher-paid-label';
  }
  if (paidSchema(html, url)) return 'publisher-paid-schema';
  return null;
}

export function sponsoredContentReason({ url, title, source, html } = {}) {
  if (paidUrl(url)) return 'publisher-paid-section';
  const context = {url, title, html};
  if (paidLabel(source, context)) return 'feed-paid-label';
  const headline = String(title || '').trim();
  const markedTitle = headline.match(/^(?:\[([^\]]+)\]|([^:|–—]+)\s*[:|–—])\s*\S/i);
  if (markedTitle && paidLabel(markedTitle[1] || markedTitle[2], context)) return 'headline-paid-label';
  const trailing = headline.match(/\s+[[(]([^\])]+)[\])]$/)?.[1] || headline.match(/^.+\s+[-–—|]\s+(.+)$/)?.[1];
  if (trailing && paidLabel(trailing, context)) return 'headline-paid-label';
  const dashParts = headline.split(/\s+[-–—]\s+/);
  if (dashParts.length >= 3 && paidLabel(dashParts.at(-2), context)) return 'headline-paid-label';
  if (html) return paidMetadata(html, url, title);
  return null;
}

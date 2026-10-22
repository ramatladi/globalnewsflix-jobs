// Article images: the lead photos a publisher's own report declares (its Article.image and social lead image),
// and the image addresses never accepted (pixel-reviewed generic or unrelated resources). Pure, so the news collector
// (news-collect.js) runs it on GitHub's network; media.js re-exports it with the photo checks.
const BAD_IMG = /logo|placeholder|default|favicon|sprite|blank|spacer|avatar|icon|1x1|pixel|share[-_]?image|og[-_]?default|fallback|no[-_]?image|brand/i;

// These resources were pixel-reviewed against their attached articles. Identity
// is host + case-sensitive path, so harmless query/fragment/size variants do
// not restore a known-bad image. Do not block all /img proxy URLs.
function imageResourceKey(value) {
  try {
    let url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return '';
    if (url.hostname === 'www.devdiscourse.com' && url.pathname === '/img') {
      const nested = url.searchParams.get('imageUrl');
      if (!nested) return '';
      url = new URL(nested);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return '';
    }
    return url.host.toLowerCase() + url.pathname;
  } catch { return ''; }
}
const BLOCKED_RESOURCES = new Set([
  imageResourceKey('https://x0.ifengimg.com/ucms/2026_39/473C7B18D86CFF43F8DBC3DD5B607885D444A689_size126_w1080_h598.jpg'),
  imageResourceKey('https://x0.ifengimg.com/res/2026/62AA2A7D68751143D55238313125539C3DF89C08_size99_w1080_h810.jpg'),
  imageResourceKey('https://devdiscourse.blob.core.windows.net/imagegallery/11_03_2020_13_37_19_6120453.jpg'),
  // Pixel-verified pale camera placeholder on gray, not a story photograph.
  imageResourceKey('https://img02.rl0.ru/6507ab389ab485e3f0bf1b7b4d2330ea/c1280x720o-x0i/news.rambler.ru/special/no_img.jpg'),
  // Pixel-reviewed generic assets previously attached to unrelated reports.
  imageResourceKey('https://www.vanguardngr.com/wp-content/plugins/dx-vanguard-newsletters/assets/dist/public/images/macbook-air.png'),
  imageResourceKey('https://images.ctfassets.net/765y2hpj99ul/3ZqBYRwc8pOG8vzlZWsSfC/384a291f0455bb576d61edc5ad3ac1e9/DPG_Media_Building_Antwerp.PNG?w=1920&q=75&fm=webp'),
  imageResourceKey('https://www.sports.fr/wp-content/themes/sport/assets/images/lv_rugby_bg.jpg'),
  imageResourceKey('https://cloudfront-us-east-1.images.arcpublishing.com/elfinanciero/WSH7N5NMGBHQDLHG6UG23TIE7M.png'),
  imageResourceKey('https://cloudfront-us-east-1.images.arcpublishing.com/gray/UVEOZX7ER5E6BF5JWX72VR3PVA.png'),
]);
const BLOCKED_ARTICLE_RESOURCES = new Map([
  ['08c99dcb487afafe', imageResourceKey('https://cloudfront-eu-central-1.images.arcpublishing.com/irishtimes/YKK2TD4XKMH5N4SGY22VZXJ2QM.JPG')],
  ['0b448602435477d0', imageResourceKey('https://ichef.bbci.co.uk/ace/standard/1024/cpsprodpb/5e08/live/008791f0-4235-11f0-835b-310c7b938e84.jpg')],
]);
export const blockedImageUrl = value => BLOCKED_RESOURCES.has(imageResourceKey(value));
export const blockedImageCandidate = blockedImageUrl;
// Read projection only: retain every article's text/date/state while hiding a
// globally bad resource or one proven unrelated article/image pairing.
export const publicArticleImage = article => article && (blockedImageUrl(article.image) || BLOCKED_ARTICLE_RESOURCES.get(article.id) === imageResourceKey(article.image))
  ? { ...article, image: null, image_credit: null } : article;

export const AI_IMAGE_PATH = /(?:^|[\/_.-])(?:ai[-_]generated|chatgpt[-_ ]image|gemini[-_]generated|dall[-_]e[-_\d]|midjourney|stable[-_]diffusion)(?=$|[\/_.\-\d])/i;
export function usablePublisherImage(url) {
  if (blockedImageCandidate(url)) return false;
  if (!url || !/^https:\/\//.test(url)) return false;
  if (BAD_IMG.test(url.split('?')[0])) return false;
  // A filename marker, never a substring of a real subject or publisher name.
  let filename;
  try { filename = new URL(url).pathname.split('/').at(-1); } catch { return false; }
  if (/^no[-_]?img\.(?:jpe?g|png|webp|gif)$/i.test(filename)) return false;
  // Pictures their own address marks as AI-generated (owner rule: real photographs only).
  if (AI_IMAGE_PATH.test(decodeURIComponent(url.split('?')[0]))) return false;
  // Width hints in the URL (e.g. w=120, /150x150/) below a sensible size mean a thumbnail.
  const w = url.match(/[?&/_-]w(?:idth)?[=_-]?(\d{2,4})\b/i) || url.match(/\/(\d{2,4})x\d{2,4}\//);
  if (w && Number(w[1]) < 500) return false;
  return true;
}

const strip = s => String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
const decode = s => String(s || '').replace(/&(?:amp|quot|apos|lt|gt);/g, x => ({'&amp;':'&','&quot;':'"','&apos;':"'",'&lt;':'<','&gt;':'>'}[x])).replace(/&#(x[0-9a-f]+|\d+);/gi, (_, n) => { const v = n[0].toLowerCase() === 'x' ? parseInt(n.slice(1), 16) : Number(n); return v > 0 && v <= 0x10ffff ? String.fromCodePoint(v) : ''; });
function attrs(tag) { return Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map(m => [m[1].toLowerCase(), decode(m[2] ?? m[3])])); }
export function canonicalSourceUrl(value) {
  try { const u = new URL(value); if (u.protocol !== 'https:') return ''; u.hash = ''; for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$)/i.test(k)) u.searchParams.delete(k); u.searchParams.sort(); return u.toString().replace(/\/$/, ''); } catch { return ''; }
}
export function imageIdentity(value) {
  try { const u = new URL(value); if (u.protocol !== 'https:') return ''; u.hash = ''; for (const k of [...u.searchParams.keys()]) if (/^(w|width|h|height|quality|resize|imwidth|utm_.*)$/i.test(k)) u.searchParams.delete(k); u.searchParams.sort(); return u.toString(); } catch { return ''; }
}
// Only the page's own Article.image and social lead image are candidates. Never scrape arbitrary
// JSON URLs, recommendations, Organization.logo or the remainder of the document after <article>.
export function extractArticleImages(html, pageUrl) {
  const page = canonicalSourceUrl(pageUrl); if (!page) return { title: '', images: [] };
  const metas = new Map(); for (const m of String(html).matchAll(/<meta\b[^>]*>/gi)) { const a = attrs(m[0]); if (a.content) metas.set((a.property || a.name || '').toLowerCase(), a.content); }
  let canonical = page;
  for (const m of String(html).matchAll(/<link\b[^>]*>/gi)) { const a = attrs(m[0]); if (a.rel?.toLowerCase() === 'canonical') { try { const u = canonicalSourceUrl(new URL(a.href, page).href); if (new URL(u).hostname === new URL(page).hostname) canonical = u; } catch {} } }
  const nodes = [];
  for (const m of String(html).matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi)) {
    try { const walk = v => { if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') { nodes.push(v); if (v['@graph']) walk(v['@graph']); } }; walk(JSON.parse(m[1])); } catch {}
  }
  const articles = nodes.filter(n => [n['@type']].flat().some(t => /^(NewsArticle|Article|ReportageNewsArticle|AnalysisNewsArticle)$/.test(t)));
  const own = articles.filter(n => { const raw = n.url || n.mainEntityOfPage?.['@id'] || (typeof n.mainEntityOfPage === 'string' ? n.mainEntityOfPage : '') || n['@id']; if (!raw) return articles.length === 1; try { const u = canonicalSourceUrl(new URL(raw, page).href); return u === page || u === canonical; } catch { return false; } });
  const title = strip(own[0]?.headline || metas.get('og:title') || decode(String(html).match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || ''));
  const multiReport = nodes.some(n => [n['@type']].flat().some(t => /^(LiveBlogPosting|CollectionPage|ItemList)$/.test(t))) || /(?:live[- /]?updates?|liveblog|round[- ]?up|news briefing|daily briefing|latest headlines)/i.test(title + ' ' + new URL(page).pathname);
  const singleReport = own.length === 1 && !multiReport;
  const images = [], seen = new Set();
  const add = (value, caption = '') => {
    if (Array.isArray(value)) return value.forEach(v => add(v, caption));
    if (value && typeof value === 'object') { const ref = value['@id'] && nodes.find(n => n['@id'] === value['@id']); return add(value.contentUrl || value.url || ref?.contentUrl || ref?.url, value.caption || caption); }
    if (typeof value !== 'string') return;
    try { const url = new URL(value, page).href; if (!usablePublisherImage(url) || seen.has(url)) return; seen.add(url); images.push({url, source_url: page, source_title: title, caption: strip(caption).slice(0, 600), single_report:singleReport}); } catch {}
  };
  // An explicit non-article page must not supply a generic share card as story evidence.
  const articlePage = own.length || /^(article|news)$/i.test(metas.get('og:type') || '');
  if (articlePage && title) {
    own.forEach(n => add(n.image));
    for (const k of ['og:image:secure_url', 'og:image', 'twitter:image', 'twitter:image:src']) add(metas.get(k));
  }
  return { title, images: images.slice(0, 6) };
}

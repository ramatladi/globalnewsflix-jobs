// One freshness policy for all country editions and Global. Processing time is never evidence of recency.
export const NEWS_MAX_AGE_MS = 48 * 3600000;
export const JUST_IN_MAX_AGE_MS = 6 * 3600000;
// Explicit timestamp evidence only. JS Date.parse alone silently normalizes invalid dates.
export function parsePublicationDate(value, now = Date.now()) {
  if (typeof value !== 'string' || value.length > 100) return null;
  const text=value.trim();
  let weekday=null;
  let m=text.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:?\d{2})$/i), y,month,day,hour,minute,second;
  if(m){[,y,month,day,hour,minute,second]=m;const z=m[7];if(z.toUpperCase()!=='Z'){const n=z.slice(1).replace(':','');if(+n.slice(0,2)>14||+n.slice(2)>59||(+n.slice(0,2)===14&&+n.slice(2)!==0))return null;}}
  else {
    m=text.match(/^(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s+)?(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?\s+(GMT|UTC|[+-]\d{4})$/i);
    if(!m)return null;weekday=text.match(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s/i)?.[1]?.toLowerCase()||null;day=m[1];month='jan feb mar apr may jun jul aug sep oct nov dec'.split(' ').indexOf(m[2].toLowerCase())+1;y=m[3];hour=m[4];minute=m[5];second=m[6]||0;
    if(/^[+-]/.test(m[7])&&(+m[7].slice(1,3)>14||+m[7].slice(3)>59||(+m[7].slice(1,3)===14&&+m[7].slice(3)!==0)))return null;
  }
  [y,month,day,hour,minute,second]=[y,month,day,hour,minute,second].map(Number);
  if(y<1970||month<1||month>12||day<1||day>new Date(Date.UTC(y,month,0)).getUTCDate()||hour>23||minute>59||second>59)return null;
  if(weekday&&['sun','mon','tue','wed','thu','fri','sat'][new Date(Date.UTC(y,month-1,day)).getUTCDay()]!==weekday)return null;
  const ts=Date.parse(text);return Number.isSafeInteger(ts)&&ts>0&&ts<=now?ts:null;
}
export function sourceTimestamp(value, now = Date.now()) {
  if(typeof value==='number')return Number.isSafeInteger(value)&&value>0&&value<=now?value:null;
  return parsePublicationDate(value,now);
}
export function isFreshNews(value, now = Date.now(), maxAge = NEWS_MAX_AGE_MS) {
  const ts = sourceTimestamp(value, now);
  return ts !== null && ts > now - maxAge;
}
export function freshNewsSql(now = Date.now(), maxAge = NEWS_MAX_AGE_MS, prefix = '') {
  if (!Number.isFinite(now) || !Number.isFinite(maxAge) || !/^(?:[a-z]+\.)?$/.test(prefix)) throw new Error('invalid freshness policy');
  return `typeof(${prefix}source_pub_ts) = 'integer' AND ${prefix}source_pub_ts > ${Math.floor(now - maxAge)} AND ${prefix}source_pub_ts <= ${Math.floor(now)} AND ${prefix}source_date_review_required = 0`;
}
// Publication evidence, strongest tier first. Every uncertain value resolves to its EARLIEST possible instant so
// that uncertainty can only make a report look older, never newer. Crawl dates, footer dates and any stated
// modified date never establish publication time.
const HOUR=3600000, EARLIEST_OFFSET=14*HOUR, LATEST_OFFSET=12*HOUR;
// Returns {lo,hi,precise} or null. Precise values carry an explicit zone (lo===hi). Zone-less values are read at
// UTC+14 (lo) through UTC-12 (hi); date-only values cover that whole calendar day across every zone.
export function publicationInstantRange(value, now = Date.now()) {
  if (typeof value !== 'string' || value.length > 100) return null;
  const text=value.trim();
  if(/^(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s+)?\d{1,2}\s+[a-z]{3}\s+\d{4}\s/i.test(text)){const ts=parsePublicationDate(text,now);return ts===null?null:{lo:ts,hi:ts,precise:true};}
  const m=text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,9}))?)?\s*(Z|UTC|GMT|[+-]\d{2}(?::?\d{2})?)?)?$/i);
  if(!m)return null;
  const [y,mo,d]=[m[1],m[2],m[3]].map(Number),h=m[4]===undefined?null:+m[4],mi=+(m[5]||0),s=+(m[6]||0),ms=m[7]?+m[7].slice(0,3).padEnd(3,'0'):0;
  if(y<1970||mo<1||mo>12||d<1||d>new Date(Date.UTC(y,mo,0)).getUTCDate()||h>23||mi>59||s>59)return null;
  if(h===null){const day=Date.UTC(y,mo-1,d),lo=day-EARLIEST_OFFSET;return lo>0&&lo<=now?{lo,hi:Date.UTC(y,mo-1,d+1)+LATEST_OFFSET-1,precise:false}:null;}
  const local=Date.UTC(y,mo-1,d,h,mi,s,ms),z=m[8];
  if(!z){const lo=local-EARLIEST_OFFSET;return lo>0&&lo<=now?{lo,hi:local+LATEST_OFFSET,precise:false}:null;}
  let offset=0;
  if(/^[+-]/.test(z)){const n=z.slice(1).replace(':',''),oh=+n.slice(0,2),om=+(n.slice(2)||0);if(oh>14||om>59||(oh===14&&om))return null;offset=(z[0]==='-'?-1:1)*(oh*HOUR+om*60000);}
  const ts=local-offset;return ts>0&&ts<=now?{lo:ts,hi:ts,precise:true}:null;
}
// A dated URL path (/2026/10/16/, /2026-10-16/, /20261016/) is day-level evidence only.
export function urlPathDateRange(pageUrl, now = Date.now()) {
  let path;try{path=new URL(pageUrl).pathname;}catch{return null;}
  const out=[];
  for(const re of [/(?:^|\/)(\d{4})\/(\d{2})\/(\d{2})(?=[/._-]|$)/g,/(?:^|\/)(\d{4})-(\d{2})-(\d{2})(?=[/._-]|$)/g,/(?:^|\/)(\d{4})(\d{2})(\d{2})(?=[/._-]|$)/g])
    for(const x of path.matchAll(re)){if(+x[1]<1995)continue;const r=publicationInstantRange(`${x[1]}-${x[2]}-${x[3]}`,now);if(r)out.push(r);}
  return out.length?out.reduce((a,b)=>a.lo<=b.lo?a:b):null;
}
// Comparison key for "is this JSON-LD node about this page": scheme, www./m./amp. host prefixes, AMP path suffixes,
// tracking parameters, trailing slashes and percent-encoding case do not make a different article.
const URL_TRACKING=/^(?:utm_.*|fbclid|gclid|amp|outputtype|output|ref|cmpid|ocid)$/i;
export function articleUrlKey(value, base) {
  try{
    const u=new URL(value,base||undefined);if(!/^https?:$/.test(u.protocol))return '';
    const host=u.hostname.toLowerCase().replace(/^(?:www\d*|m|amp|mobile)\./,'');
    let path=u.pathname;try{path=decodeURI(path);}catch{/* keep the encoded form */}
    path=path.replace(/(?:\/amp|\.amp)(?=\/?$)/i,'').replace(/\/+$/,'');
    for(const k of [...u.searchParams.keys()])if(URL_TRACKING.test(k))u.searchParams.delete(k);
    u.searchParams.sort();const q=u.searchParams.toString();
    return host+path+(q?'?'+q:'');
  }catch{return '';}
}
const attrsOf=tag=>Object.fromEntries([...tag.matchAll(/([\w:.-]+)\s*=\s*(["'])(.*?)\2/g)].map(x=>[x[1].toLowerCase(),x[3]]));
const LEGACY_META=['article:published_time','datepublished'];
const STRONG_META=['pubdate','publishdate','publish-date','publication_date','dc.date.issued','dcterms.issued','parsely-pub-date','sailthru.date','article.published','og:published_time','originalpublicationdate'];
const GENERIC_META=['date','dc.date','dcterms.created','datecreated'];
const MODIFIED_META=['article:modified_time','og:updated_time','modified','last-modified','datemodified','dc.date.modified','dcterms.modified','parsely-updated','article.updated'];
const LEGACY_TYPES=/^(?:NewsArticle|Article|ReportageNewsArticle|AnalysisNewsArticle)$/, PRIMARY_TYPES=/^(?:NewsArticle|Article|ReportageNewsArticle|AnalysisNewsArticle|BlogPosting|LiveBlogPosting)$/, SECONDARY_TYPES=/^(?:WebPage|VideoObject)$/;
const typesOf=node=>[].concat(node['@type']||[]).map(t=>String(t).replace(/^(?:https?:\/\/schema\.org\/|schema:)/i,''));
export function publisherDateEvidence(html, now = Date.now(), pageUrl = '') {
  html=String(html);
  // Tiers: 0 original markers (unchanged semantics), 1 other explicit publication meta, 2 microdata and page-scoped
  // WebPage/VideoObject JSON-LD, 3 generic date meta. The first tier with evidence decides; lower tiers are ignored
  // so related-story lists or generic markers cannot contradict or refresh a stronger statement.
  const tiers=[0,1,2,3].map(()=>({ranges:[],invalid:false})), modified=[];
  const add=(tier,value,legacy=false)=>{
    if(value===undefined||value===null)return;
    const r=publicationInstantRange(value,now);
    if(r)tiers[tier].ranges.push(r);else{tiers[tier].invalid=true;if(legacy)tiers[tier].legacyInvalid=true;}
  };
  const addModified=value=>{const r=publicationInstantRange(value,now);if(r)modified.push(r);};
  for(const match of html.matchAll(/<meta\b[^>]*>/gi)){
    const a=attrsOf(match[0]),key=(a.property||a.name||'').toLowerCase(),prop=(a.itemprop||'').toLowerCase().split(/\s+/);
    if(LEGACY_META.includes(key))add(0,a.content,true);
    else if(STRONG_META.includes(key))add(1,a.content);
    else if(GENERIC_META.includes(key))add(3,a.content);
    else if(MODIFIED_META.includes(key))addModified(a.content);
    if(!key&&prop.includes('datepublished'))add(2,a.content);
    if(prop.includes('datemodified'))addModified(a.content);
  }
  for(const match of html.matchAll(/<time\b[^>]*>/gi)){
    const a=attrsOf(match[0]),prop=(a.itemprop||'').toLowerCase().split(/\s+/);
    if(prop.includes('datepublished')||/\spubdate(?=[\s>=/])/i.test(match[0]))add(2,a.datetime);
    else if(prop.includes('datemodified'))addModified(a.datetime);
  }
  const nodes=[];
  const visit=node=>{
    if(!node||typeof node!=='object')return;
    if(Array.isArray(node))return node.forEach(visit);
    nodes.push(node);
    if(node['@graph'])visit(node['@graph']);
    if(node.mainEntity&&typeof node.mainEntity==='object')visit(node.mainEntity);
  };
  for(const match of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)){
    try{visit(JSON.parse(match[1]));}catch{/* malformed evidence is not a date */}
  }
  const page=articleUrlKey(pageUrl),accepted=new Set(page?[page]:[]);
  if(page)for(const match of html.matchAll(/<link\b[^>]*>/gi)){
    const a=attrsOf(match[0]);
    if(a.rel?.toLowerCase()==='canonical'){const link=articleUrlKey(a.href,pageUrl);if(link&&link.split('/')[0]===page.split('/')[0])accepted.add(link);}
  }
  const canonical=value=>articleUrlKey(value,pageUrl);
  const rawUrl=node=>node.url||node.mainEntityOfPage?.['@id']||(typeof node.mainEntityOfPage==='string'?node.mainEntityOfPage:'')||node['@id'];
  const scoped=(list,soleFallback)=>list.filter(node=>{const raw=rawUrl(node);return raw&&page?accepted.has(canonical(raw)):soleFallback&&list.length===1;});
  const articles=nodes.filter(n=>typesOf(n).some(t=>PRIMARY_TYPES.test(t)));
  const own=scoped(articles,true);
  own.forEach(node=>{add(0,node.datePublished,true);addModified(node.dateModified);});
  nodes.filter(n=>!own.includes(n)).forEach(n=>{if(typeof n.dateModified==='string')addModified(n.dateModified);});
  if(!own.length){const secondary=nodes.filter(n=>!typesOf(n).some(t=>PRIMARY_TYPES.test(t))&&typesOf(n).some(t=>SECONDARY_TYPES.test(t)));scoped(secondary,!articles.length).forEach(node=>add(2,node.datePublished));}
  // Ambiguous article graphs without any page-scoped publication evidence cannot establish a date.
  const legacyArticles=articles.filter(n=>typesOf(n).some(t=>LEGACY_TYPES.test(t)));
  if(page&&legacyArticles.length&&!own.length&&!tiers[0].ranges.length){tiers[0].invalid=true;tiers[0].legacyInvalid=true;tiers[0].ambiguous=true;}
  // A generic date marker that matches a stated modified date may be the update time, so it is not publication evidence.
  tiers[3].ranges=tiers[3].ranges.filter(r=>!modified.some(x=>x.lo<=r.hi&&r.lo<=x.hi));
  const used=tiers.findIndex(t=>t.ranges.length);
  const invalidAbove=tiers.slice(0,used<0?4:used+1).find(t=>used<0?t.legacyInvalid:t.invalid);
  if(invalidAbove)return {published_ts:null,publication_date_invalid:true,publication_date_reason:invalidAbove.ambiguous?'ambiguous-article-graph':'invalid-publication-date'};
  const urlRange=urlPathDateRange(pageUrl,now);
  if(used<0){
    if(tiers.some(t=>t.invalid))return {published_ts:null,publication_date_invalid:false,publication_date_reason:'unparseable-publication-date'};
    return {published_ts:urlRange?urlRange.lo:null,publication_date_invalid:false};
  }
  const {ranges}=tiers[used],precise=[...new Set(ranges.filter(r=>r.precise).map(r=>r.lo))];
  // Several distinct page-scoped publication times (for example a first-publication meta and a later JSON-LD value):
  // the EARLIEST is used, so the disagreement can only make the report older, never newer.
  // A precise timestamp wins over consistent day-level evidence; any imprecise evidence that lies wholly earlier, or a
  // dated URL wholly earlier, pulls the report back to that earliest instant.
  const base=precise.length?Math.min(...precise):Math.min(...ranges.map(r=>r.lo));
  const earlier=[...ranges,urlRange].filter(r=>r&&r.hi<base);
  return {published_ts:earlier.length?Math.min(...earlier.map(r=>r.lo)):base,publication_date_invalid:false,...(precise.length>1?{publication_date_reason:'conflicting-publication-times-earliest'}:{})};
}
export function publisherDate(html, now = Date.now(), pageUrl = '') { return publisherDateEvidence(html, now, pageUrl).published_ts; }
export function reportTimestamp(candidate, facts, now = Date.now()) {
  if (!facts || typeof facts !== 'object' || facts.more != null && !Array.isArray(facts.more)) return null;
  if ([facts, ...(facts?.more || [])].some(f => f?.publication_date_invalid || f?.published_ts != null && sourceTimestamp(f.published_ts, now) === null)) return null;
  const feed = sourceTimestamp(candidate?.pub_ts, now);
  if (feed === null) return null;
  const fetched = sourceTimestamp(facts?.fetched_ts, now);
  const publisher = sourceTimestamp(facts?.published_ts, fetched ?? now);
  // A feed timestamp alone can be a refresh. The lead report must provide its own publication evidence.
  return publisher;
}

export function sourceDateEvidence(candidate,facts,now=Date.now()) {
  if(sourceTimestamp(facts?.fetched_ts,now)===null)return null;
  const ts=reportTimestamp(candidate,facts,now);
  if(ts===null)return null;
  let url;try{url=new URL(facts.url);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)return null;}catch{return null;}
  // A publisher time more than two hours after the feed saw the story is treated as a re-date: the story is
  // dated by the earlier feed time instead, so it ages out of Latest sooner. No manual review is needed.
  const feed=sourceTimestamp(candidate.pub_ts,now),redated=ts-feed>2*3600000;
  return {version:1,feedPublishedTs:feed,publisherPublishedTs:sourceTimestamp(facts.published_ts,now),sourcePublishedTs:redated?feed:ts,earliestEvidenceTs:Math.min(feed,ts),publisherUrl:url.href,checkedAt:facts.fetched_ts,reviewReasons:[],...(redated?{redatedToFeed:true}:{})};
}

export function isCurrentReport(article,now=Date.now(),maxAge=NEWS_MAX_AGE_MS){return article?.source_date_review_required===0&&isFreshNews(article.source_pub_ts,now,maxAge);}
// Conservative deterministic review clues, not semantic or factual verification.
export function publicationReview(title,lead,publishedTs){
 const ts=sourceTimestamp(publishedTs);if(ts===null)return {required:true,reasons:['date-unverified']};
 const norm=v=>String(v||'').normalize('NFKC').replace(/[٠-٩۰-۹]/g,c=>String(c.charCodeAt(0)-(c>='۰'?1776:1632))).toLowerCase();
 const head=norm(String(title||'').slice(0,600)),text=head+' '+norm(String(lead||'').slice(0,1800));
 const year=new Date(ts).getUTCFullYear(),reasons=[];
 // Only a PAST year in the headline suggests an old event; future years (plans, model years) and years
 // cited as background in the lead (laws, resolutions, records) are normal in current reporting.
 if([...head.matchAll(/(?:^|[^0-9])((?:19|20)\d{2})(?![0-9])/g)].some(m=>Number(m[1])<year))reasons.push('different-year');
 if(/(?<![\p{L}\p{N}_])(?:anniversary|archiv(?:e|ed|es)|retrospective|on this day|throwback|anniversaire|anniversario|anivers[aá]rio|aniversario|jahrestag|rückblick|yıldönümü|годовщин[\p{L}]*|архив[\p{L}]*)(?![\p{L}\p{N}_])|周年|回顾|回顧|ذكرى|الذكرى|أرشيف|ارشيف|회고|기념/u.test(text))reasons.push('historical-language');
 return {required:reasons.length>0,reasons};
}
// A repair is operational metadata, never a new report/publication date.
export const PHOTO_HOLD_MAX_MS = 7 * 86400000;
export const PHOTO_ATTEMPT_LIMIT = 6;
export function photoRetryDelayMs(attempts) { return [0,1200000,3600000,21600000,86400000,86400000,86400000][Math.max(0,Math.min(6,Math.floor(Number(attempts)||0)))]; }
export function photoRepairState(a, now = Date.now()) {
  if (a?.photo_archive_repair !== 1 || a.pub_state === 'live') return null;
  // A successful photo replacement waits for the publication gate. The
  // original hold deadline governs photo attempts, not release of a verified
  // replacement that already completed within that deadline.
  if (a.pub_state === 'draft' && a.photo_ok === 1 && a.img_audit === 2 &&
      Number.isFinite(a.photo_ts) && Number.isFinite(a.photo_hold_started_ts) &&
      a.photo_hold_started_ts > 0 && a.photo_ts >= a.photo_hold_started_ts &&
      a.photo_ts <= a.photo_hold_started_ts + PHOTO_HOLD_MAX_MS) return 'awaiting_release';
  const start = a.photo_hold_started_ts;
  if (a.pub_state !== 'pending_photo' || Number(a.photo_tries || 0) >= 4 || !Number.isFinite(start) || start <= 0 || start > now || now - start >= PHOTO_HOLD_MAX_MS) return 'withdrawn';
  return 'pending';
}
export function photoRepairRetryAfter(a, now = Date.now()) {
  if (!Number.isFinite(now)) return 0;
  const state=photoRepairState(a,now);
  if (state==='awaiting_release') return 3600;
  if (state!=='pending') return 0;
  // .github/workflows/photos.yml UTC slots, after the existing 20-minute/try cooldown.
  const minutes = [4,9,14,24,29,34,44,49,54];
  const attempted=Number.isFinite(a.photo_ts) && a.photo_ts>0 && a.photo_ts<=now ? a.photo_ts : now;
  const tries=Number.isFinite(a.photo_tries) ? Math.max(1,Math.min(3,a.photo_tries)) : 1;
  const nextAttempt=Number.isFinite(a.photo_next_attempt_ts) && a.photo_next_attempt_ts>0 ? a.photo_next_attempt_ts : attempted+(a.photo_attempts ? photoRetryDelayMs(a.photo_attempts) : tries*1200000);
  const eligible = Math.max(now,nextAttempt);
  const hour = Math.floor(eligible / 3600000) * 3600000;
  const next = minutes.map(m => hour + m * 60000).find(ts => ts > eligible) || hour + 3600000 + minutes[0] * 60000;
  const remaining=Math.max(1,Math.ceil((a.photo_hold_started_ts+PHOTO_HOLD_MAX_MS-now)/1000));
  return Math.min(remaining,Math.max(3600, Math.min(86400, Math.ceil((next - now) / 1000))));
}

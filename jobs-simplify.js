// Public Simplify.hr vacancy fragments. The endpoint and markup were observed
// in the employer pages' own company bundle; there is no inferred API fallback.
const plain = value => String(value || '').replace(/<[^>]*>/g, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
const MONTHS = ['january','february','march','april','may','june','july','august','september','october','november','december'];
function calendar(value) {
  const m = plain(value).match(/^(\d{1,2}) ([a-z]+) (\d{4})$/i);
  if (!m) return null;
  const month = MONTHS.indexOf(m[2].toLowerCase());
  if (month < 0) return null;
  const time = Date.UTC(+m[3], month, +m[1]);
  const d = new Date(time);
  return d.getUTCFullYear() === +m[3] && d.getUTCMonth() === month && d.getUTCDate() === +m[1] ? time : null;
}
function publicUrl(value, base) {
  try {
    const u = new URL(value, base);
    return u.protocol === 'https:' && !u.username && !u.password && /^[a-z0-9-]+\.simplify\.hr$/i.test(u.hostname) && /^\/Vacancy\/\d+\/?$/i.test(u.pathname) ? u.href : null;
  } catch { return null; }
}
function country(location) {
  // An explicit unique South African province is geographic evidence; employer
  // domicile, currency, and a generic "remote" location are not country evidence.
  return /(?:^|,\s*)(?:Gauteng|KwaZulu-Natal|Western Cape|Eastern Cape|Northern Cape|Mpumalanga|Limpopo|Free State|South Africa)\s*$/i.test(location) ? 'ZA' : null;
}
export function parseSimplifyList(html, sourceUrl) {
  if (typeof html !== 'string' || html.length > 2000000 || !/class="job-section"/.test(html)) return null;
  const markers = [...html.matchAll(/<div class="row job-title">\s*<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)];
  const rows = [], seen = new Set();
  for (let i = 0; i < markers.length && i < 250; i++) {
    const m = markers[i], body = html.slice(m.index, markers[i+1]?.index ?? html.length);
    const url = publicUrl(m[1], sourceUrl), title = plain(m[2]);
    const location = plain(body.match(/<span class="job-location[^>]*>([\s\S]*?)<\/label>/i)?.[1]);
    const cc = country(location);
    if (!url || !title || !location || seen.has(url)) continue;
    seen.add(url);
    const employer = [...html.slice(0,m.index).matchAll(/<span class="job-section-title">([\s\S]*?)<\/span>/gi)].at(-1)?.[1];
    const posted = calendar(body.match(/Published\s+(\d{1,2}\s+[A-Za-z]+\s+\d{4})/i)?.[1]);
    const closingDay = calendar(body.match(/Closing Date:\s*<b>([^<]+)<\/b>/i)?.[1]);
    rows.push({id: new URL(url).hostname + ':' + new URL(url).pathname.match(/\d+/)[0], title, employer:plain(employer), url,source_url:sourceUrl,location,country:cc,
      posted: posted == null ? null : posted - 2 * 3600000,
      // A labelled closing date is inclusive of that ZA calendar day.
      closing: closingDay == null ? null : closingDay + 86400000 - 2 * 3600000,
      pay:null});
  }
  return {rows,complete:false,reason:markers.length > 250 ? 'detail-limit' : 'public-list-total-unverified',observedCount:markers.length};
}

export function parseSimplifyDetail(html, listed, { now = Date.now() } = {}) {
  if (typeof html !== 'string' || html.length > 2000000 || !publicUrl(listed?.url, listed?.url)) return null;
  const nodes=[];
  for (const m of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { const node=JSON.parse(m[1]); if(node['@type']==='JobPosting')nodes.push(node); } catch {}
  }
  if(nodes.length!==1)return null;
  const x=nodes[0], id=new URL(listed.url).pathname.match(/\d+/)[0];
  const canonical=html.match(/<meta\b[^>]*property=["']og:url["'][^>]*content=["']([^"']+)["'][^>]*>/i)?.[1];
  if(publicUrl(canonical,listed.url)!==publicUrl(listed.url,listed.url))return null;
  try { if(new URL(x.hiringOrganization?.sameAs).origin!==new URL(listed.url).origin)return null; } catch { return null; }
  const heroAddress=plain(html.match(/class="hero_text hero-vacancy-address[^"]*"[^>]*>([\s\S]*?)<div class="hero_text/i)?.[1]);
  if(heroAddress.toLowerCase()!==plain(listed.location).toLowerCase())return null;
  if(String(x.identifier?.value)!==id || plain(x.title).toLowerCase()!==plain(listed.title).toLowerCase())return null;
  const address=x.jobLocation?.address;
  if(!address || !/^(South Africa|ZA)$/i.test(address.addressCountry||''))return null;
  const isoDay=value=>{const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(value||'');return m?calendar(`${+m[3]} ${MONTHS[+m[2]-1]||''} ${m[1]}`):null;};
  const postedDay=isoDay(x.datePosted), closeDay=isoDay(x.validThrough);
  if((x.validThrough && closeDay==null)||(x.datePosted && (postedDay==null || postedDay-2*3600000>now)))return null;
  const posted=postedDay==null?null:postedDay-2*3600000;
  const closing=closeDay==null?listed.closing:closeDay+86400000-2*3600000;
  // Some employer lists publish an older date than their detail metadata; do
  // not relabel the newer metadata date as the original publication date.
  return {...listed,country:'ZA',posted:listed.posted && posted && listed.posted!==posted?null:posted??listed.posted,
    closing:listed.closing && closing?Math.min(listed.closing,closing):closing,
    text:typeof x.description==='string'?x.description:'',pay:listed.pay};
}

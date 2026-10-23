// Scratch probe (never merged): can a GitHub runner reach candidate official tender portals with the collector's
// named user agent? One request each; reports status, a few headers and the error cause as annotations.
const UA = 'Mozilla/5.0 (compatible; GlobalNewsflixTenders/1.0; +https://globalnewsflix.com/contact)';
const targets = [
  ['pncp', 'https://pncp.gov.br/api/search/?tipos_documento=edital&status=recebendo_proposta&ordenacao=-data&ufs=AC&pagina=1&tam_pagina=10', {}],
  ['pncp-home', 'https://pncp.gov.br/app/', {}],
  ['ungm', 'https://www.ungm.org/Public/Notice', { accept: 'text/html' }],
  ['afdb', 'https://www.afdb.org/en/about-us/corporate-procurement/procurement-notices/current-solicitations', { accept: 'text/html' }],
  ['sam', 'https://sam.gov/api/prod/sgs/v1/search/?index=opp&page=0&mode=search&sort=-modifiedDate&size=1&mfe=true&is_active=true&notice_type=o', { accept: 'application/hal+json' }],
  ['etimad', 'https://tenders.etimad.sa/Tender/AllSupplierTendersForVisitorAsync?PageSize=24&PublishDateId=5&pageNumber=1', { accept: 'application/json', 'x-requested-with': 'XMLHttpRequest' }],
  ['fts', 'https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages?limit=1', { accept: 'application/json' }],
  ['cppp', 'https://eprocure.gov.in/cppp/latestactivetendersnew', { accept: 'text/html' }],
  ['undp', 'https://procurement-notices.undp.org/', { accept: 'text/html' }],
];
for (const [name, url, headers] of targets) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { headers: { 'user-agent': UA, ...headers }, signal: AbortSignal.timeout(45000) });
    const body = await r.text();
    const h = ['server', 'content-type', 'cf-ray', 'x-akamai-transformed', 'set-cookie'].map(k => `${k}=${(r.headers.get(k) || '').slice(0, 40)}`).join(' ');
    let extra = '';
    try { const d = JSON.parse(body); extra = `total=${d.totalCount ?? d.total ?? d.page?.totalElements ?? (Array.isArray(d.releases) ? d.releases.length : '?')}`; } catch { extra = `title=${(/<title[^>]*>([^<]{0,60})/i.exec(body) || [])[1] || ''}`; }
    console.log(`::notice title=probe ${name}::${r.status} ${Date.now() - t0}ms len=${body.length} ${extra} ${h}`);
  } catch (e) {
    console.log(`::notice title=probe ${name}::ERROR ${e.name} ${e.message} cause=${e.cause?.code || ''} ${String(e.cause?.message || '').slice(0, 120)} ${Date.now() - t0}ms`);
  }
}

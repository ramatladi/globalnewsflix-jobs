import { jobDateInstant } from './jobs-dates.js';
const plain=value=>String(value||'').replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim();
export function parseOracleDetail(payload, listed, { now = Date.now() } = {}) {
  if(!Array.isArray(payload?.items)||payload.items.length!==1)return null;
  const d=payload.items[0];
  if(String(d.Id)!==String(listed.id)||plain(d.Title).toLowerCase()!==plain(listed.title).toLowerCase()||d.PrimaryLocationCountry!==listed.country || plain(d.PrimaryLocation).toLowerCase()!==plain(listed.location).toLowerCase())return null;
  const posted=jobDateInstant(d.ExternalPostedStartDate),closing=jobDateInstant(d.ExternalPostedEndDate);
  if((d.ExternalPostedStartDate && (posted==null || posted>now)) || (d.ExternalPostedEndDate && closing==null) || (d.requisitionFlexFields!=null && !Array.isArray(d.requisitionFlexFields)))return null;
  const salary=(d.requisitionFlexFields||[]).filter(x=>x.Prompt==='Remuneration').map(x=>plain(x.Value));
  const salary_text=salary.length===1?salary[0]:null;
  // Preserve ambiguous or multi-grade salary strings; only this observed annual
  // numeric range syntax is converted to comparable native pay.
  const m=salary_text?.match(/^R\s*((?:\d+|\d{1,3}(?: \d{3})+)\.\d{2})\s*\/\s*R\s*((?:\d+|\d{1,3}(?: \d{3})+)\.\d{2})\s*pa$/i);
  const min=m?Number(m[1].replace(/ /g,'')):null,max=m?Number(m[2].replace(/ /g,'')):null;
  const pay=min>0&&max>=min?{cur:'ZAR',min,max,period:'year'}:null;
  return {...listed,posted:posted??listed.posted,
    closing,salary_text,salary_url:salary_text?listed.url:null,pay,
    text:plain(d.ExternalDescriptionStr),hint:d.Category||listed.hint};
}

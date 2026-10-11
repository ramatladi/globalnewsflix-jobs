// Independent checks over accepted collector output. Never grants upload access.
import { discoveredJobAllowed, excludedDiscoveryUrl } from './jobs-discovered-sources.js';
export function auditAutomaticOutput(source, rows, rawCount, now=Date.now()) {
  const invalid=rows.filter(r=>!discoveredJobAllowed(source,r)||r.closing_ts!=null&&(!Number.isSafeInteger(r.closing_ts)||r.closing_ts<=now)).length;
  const reasons=[];
  if(excludedDiscoveryUrl(source.officialDomain)||excludedDiscoveryUrl(source.careerUrl))reasons.push('excluded-domain');
  if(rawCount>1000)reasons.push('unusual-volume');
  if(rows.length&&invalid/rows.length>0.05)reasons.push('invalid-output');
  return {ok:reasons.length===0,reasons,invalid};
}
export function evaluateSourceHealth(sources, report, status, now=Date.now()) {
  const recent=sources.filter(s=>now-Date.parse(s.discoveredAt)<7*86400000);
  const reasons=[],pending=[],groups=new Map();
  for(const s of recent){
    const day=s.discoveredAt.slice(0,10),group=groups.get(day)||{total:0,failed:0};group.total++;groups.set(day,group);
    if(excludedDiscoveryUrl(s.officialDomain)||excludedDiscoveryUrl(s.careerUrl))reasons.push(s.id+':excluded-domain');
    const d=status.diagnostics?.find(d=>d.src===s.id);
    if(d&&(!['complete','partial','failed'].includes(d.status)||![d.accepted_count,d.raw_count,d.attempted_ts].every(Number.isSafeInteger)||d.accepted_count<0||d.raw_count<d.accepted_count||d.attempted_ts>now+60000)){
      reasons.push(s.id+':invalid-production-diagnostics');continue;
    }
    if(!d||d.attempted_ts<Date.parse(s.discoveredAt)){
      if(now-Date.parse(s.discoveredAt)>12*3600000){group.failed++;reasons.push(s.id+':first-collection-missing');}else pending.push(s.id);
      continue;
    }
    if(now-d.attempted_ts>12*3600000){group.failed++;reasons.push(s.id+':collection-stale');continue;}
    if(d.status==='failed'||d.accepted_count===0)group.failed++;
    if(d.reason==='automatic-quality-breaker')reasons.push(s.id+':output-quality');
    const initial=report.results?.find(r=>r.source?.id===s.id)?.acceptedJobs;
    if(d.raw_count>1000||initial&&d.accepted_count>Math.max(100,initial*3))reasons.push(s.id+':unusual-volume');
  }
  for(const [day,g]of groups)if(g.failed/g.total>0.2)reasons.push(day+':failed-or-empty-over-20-percent');
  return {tripped:reasons.length>0,reasons,pending,checked:recent.length-pending.length,checkedAt:new Date(now).toISOString()};
}

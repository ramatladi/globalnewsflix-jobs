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
// A successful automatic refresh is distinct from pruning authority. Require
// positive transport evidence, natural pagination and >=90% accepted rows.
export function automaticRefreshHealth(d){
 if(d?.status==='failed'||['source-request-cap','budget-exhausted','not-attempted-budget','automatic-quality-breaker','upload-failed','source-unavailable'].includes(d?.reason))return {healthy:false,reason:d.reason||'automatic-refresh-failed'};
 if(d?.sourceRequestCap===true)return {healthy:false,reason:'source-request-cap'};
 if(d?.budgetExhausted===true)return {healthy:false,reason:d.httpRequests===0?'not-attempted-budget':'budget-exhausted'};
 if(!Number.isSafeInteger(d?.httpRequests)||d.httpRequests<=0||d.httpRequests>100||d.budgetExhausted!==false||d.sourceRequestCap!==false)return {healthy:false,reason:'refresh-transport-unverified'};
 if(d.paginationComplete!==true||!Number.isSafeInteger(d.pagesFetched)||d.pagesFetched<1||d.pagesFetched>d.httpRequests||!['reported-total','short-page','empty-page'].includes(d.paginationEnd))return {healthy:false,reason:'pagination-incomplete'};
 if(d.paginationEnd==='reported-total'&&(!Number.isSafeInteger(d.reportedTotal)||d.reportedTotal!==d.rawCount)||d.reportedTotal!=null&&(!Number.isSafeInteger(d.reportedTotal)||d.reportedTotal<0||d.reportedTotal!==d.rawCount))return {healthy:false,reason:'pagination-total-mismatch'};
 if(!Number.isSafeInteger(d.rawCount)||d.rawCount<=0||d.rawCount>1000)return {healthy:false,reason:'empty-automatic-refresh'};
 if(!Number.isSafeInteger(d.acceptedCount)||d.acceptedCount<0||d.acceptedCount>d.rawCount||d.acceptedCount*10<d.rawCount*9)return {healthy:false,reason:'insufficient-accepted-coverage'};
 return {healthy:true,reason:'healthy-automatic-refresh'};
}
export function persistedRefreshHealth(d){
 return automaticRefreshHealth({status:d.status,reason:d.reason,httpRequests:d.http_requests,rawCount:d.raw_count,acceptedCount:d.accepted_count,paginationComplete:d.pagination_complete===1,budgetExhausted:d.budget_exhausted===0?false:d.budget_exhausted===1?true:undefined,sourceRequestCap:d.source_request_cap===0?false:d.source_request_cap===1?true:undefined,pagesFetched:d.pages_fetched,reportedTotal:d.reported_total,paginationEnd:d.pagination_end});
}
export function evaluateSourceHealth(sources, report, status, now=Date.now()) {
  const reasons=[],pending=[],groups=new Map(),backlog=[];
  if(status.legacyGrace?.overflow===true){
    const snapshotAt=status.legacyGrace.snapshotAt;
    if(!Number.isSafeInteger(snapshotAt)||snapshotAt<=0||snapshotAt>now)reasons.push('legacy-grace-snapshot-invalid');
    else if(now<snapshotAt+72*3600000)reasons.push('legacy-grace-snapshot-overflow');
  }
  let checked=0,attempted=0,failed=0,empty=0;
  for(const s of sources){
    const discovered=Date.parse(s.discoveredAt),day=s.discoveredAt.slice(0,10);
    if(!Number.isFinite(discovered)||discovered>now){reasons.push(s.id+':invalid-registration-time');continue;}
    if(excludedDiscoveryUrl(s.officialDomain)||excludedDiscoveryUrl(s.careerUrl))reasons.push(s.id+':excluded-domain');
    const d=status.diagnostics?.find(d=>d.src===s.id);
    if(d&&(!['complete','partial','failed'].includes(d.status)||![d.accepted_count,d.raw_count,d.attempted_ts].every(Number.isSafeInteger)||d.accepted_count<0||d.raw_count<d.accepted_count||d.attempted_ts>now+60000)){
      reasons.push(s.id+':invalid-production-diagnostics');checked++;continue;
    }
    const genuine=d&&d.attempted_ts>=discovered;
    const age=Math.max(0,now-(genuine?d.attempted_ts:discovered));
    if(!genuine||age>12*3600000){
      const reason=genuine?'collection-stale':'first-collection-missing';
      backlog.push({src:s.id,reason,ageMs:age,lastAttemptedTs:genuine?d.attempted_ts:null,overdue:age>12*3600000});
      if(age>12*3600000){reasons.push(s.id+':'+reason);checked++;}else pending.push(s.id);
      continue;
    }
    checked++;attempted++;
    const group=groups.get(day)||{attempted:0,failed:0};group.attempted++;groups.set(day,group);
    if(!persistedRefreshHealth(d).healthy){group.failed++;failed++;}
    if(d.accepted_count===0)empty++;
    if(d.reason==='automatic-quality-breaker')reasons.push(s.id+':output-quality');
    const initial=report.verificationBaselines?.entries.find(b=>b.sourceId===s.id&&b.discoveredAt===s.discoveredAt)?.acceptedJobs ?? report.results?.find(r=>r.source?.id===s.id)?.acceptedJobs;
    if(d.raw_count>1000||initial&&d.accepted_count>Math.max(100,initial*3))reasons.push(s.id+':unusual-volume');
  }
  // Only real recent attempts form the failure denominator. A waiting source
  // cannot dilute selected failures; starvation has its own independent alarm.
  for(const [day,g]of groups)if(g.failed/g.attempted>0.2)reasons.push(day+':failed-or-empty-over-20-percent');
  return {tripped:reasons.length>0,reasons,pending,checked,active:sources.length,legacyGrace:status.legacyGrace??null,
    selected:{attempted,failed,empty,windowHours:12},
    backlog:{count:backlog.length,overdue:backlog.filter(s=>s.overdue).length,oldestAgeMs:Math.max(0,...backlog.map(s=>s.ageMs)),sources:backlog},
    checkedAt:new Date(now).toISOString()};
}

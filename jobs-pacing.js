// Automatic-only platform pacing and a shared hostname mutex; authorization remains in each transport.
export function jobPlatform(value) {
  const host = new URL(value).hostname.toLowerCase();
  const groups = {workday:['myworkdayjobs.com','myworkdaysite.com'],greenhouse:['greenhouse.io'],lever:['lever.co'],ashby:['ashbyhq.com'],smartrecruiters:['smartrecruiters.com'],oracle:['oraclecloud.com'],successfactors:['successfactors.com','successfactors.eu'],workable:['workable.com'],icims:['icims.com'],taleo:['taleo.net']};
  for (const [name,domains] of Object.entries(groups)) if (domains.some(d=>host===d||host.endsWith('.'+d))) return name;
  return 'host:'+host;
}
export const platformForReader = ats => ({wd:'workday',gh:'greenhouse',lever:'lever',ashby:'ashby',sr:'smartrecruiters',orc:'oracle',sf:'successfactors'})[ats] || null;
export function createPlatformPacer({now=()=>performance.now(),pause=ms=>new Promise(r=>setTimeout(r,ms))}={}) {
  const states=new Map(),hosts=new Map(),metrics=new Map();
  const pace=async (value,send=()=>{},platform=null,kind='other',priorWaitMs=0)=>{
    const key=platform||jobPlatform(value),host=new URL(value).hostname;
    const metricKey=metrics.has(key)||metrics.size<256?key:'other-platforms';
    const queuedAt=now(),metric=metrics.get(metricKey)||{started:queuedAt,ended:queuedAt,manual:{requestsStarted:0,waitMs:0},automatic:{requestsStarted:0,waitMs:0},other:{requestsStarted:0,waitMs:0}};
    metrics.set(metricKey,metric);const group=metric[['manual','automatic'].includes(kind)?kind:'other'];
    let releaseHost;const previousHost=hosts.get(host)||Promise.resolve();hosts.set(host,new Promise(r=>{releaseHost=r;}));
    await previousHost;
    const dispatch=()=>{
      group.waitMs+=Math.max(0,now()-queuedAt)+(Number.isFinite(priorWaitMs)?Math.max(0,priorWaitMs):0);metric.ended=now();
      const response=send();group.requestsStarted++;
      return Promise.resolve(response).finally(()=>{metric.ended=now();});
    };
    try {
      // Manual readers preserve production per-host pacing; no platform-wide wait.
      if(kind==='manual')return await dispatch();
      const state=states.get(key)||{tail:Promise.resolve(),next:0};
      let release;const previous=state.tail;state.tail=new Promise(r=>{release=r;});states.set(key,state);
      await previous;
      // Platform lock protects admission only, while the hostname lock lasts
      // through the response. Do not await dispatch while holding platform lock.
      const admit=async()=>{
        try {while(now()<state.next)await pause(state.next-now());state.next=now()+1000;return dispatch();}
        finally {release();}
      };
      return await admit();
    } finally {
      releaseHost();
    }
  };
  // waitMs includes prior host scheduling and automatic DNS resolution.
  // activityElapsedMs spans this platform's automatic and manual activity, including the gap.
  pace.diagnostics=()=>[...metrics].map(([platform,m])=>({platform,activityElapsedMs:Math.max(0,Math.ceil(m.ended-m.started)),...Object.fromEntries(['manual','automatic','other'].map(k=>[k,{requestsStarted:m[k].requestsStarted,waitMs:Math.ceil(m[k].waitMs)}]))}));
  return pace;
}

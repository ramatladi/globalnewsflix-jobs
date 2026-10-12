// Shared in-process admission pacing; authorization remains in each transport.
export function jobPlatform(value) {
  const host = new URL(value).hostname.toLowerCase();
  const groups = {workday:['myworkdayjobs.com','myworkdaysite.com'],greenhouse:['greenhouse.io'],lever:['lever.co'],ashby:['ashbyhq.com'],smartrecruiters:['smartrecruiters.com'],oracle:['oraclecloud.com'],successfactors:['successfactors.com','successfactors.eu'],workable:['workable.com'],icims:['icims.com'],taleo:['taleo.net']};
  for (const [name,domains] of Object.entries(groups)) if (domains.some(d=>host===d||host.endsWith('.'+d))) return name;
  return 'host:'+host;
}
export const platformForReader = ats => ({wd:'workday',gh:'greenhouse',lever:'lever',ashby:'ashby',sr:'smartrecruiters',orc:'oracle',sf:'successfactors'})[ats] || null;
export function createPlatformPacer({now=()=>performance.now(),pause=ms=>new Promise(r=>setTimeout(r,ms))}={}) {
  const states=new Map();
  return async (value,send=()=>{},platform=null)=>{
    const key=platform||jobPlatform(value),state=states.get(key)||{tail:Promise.resolve(),next:0};
    let release;const previous=state.tail;state.tail=new Promise(r=>{release=r;});states.set(key,state);
    await previous;
    try {while(now()<state.next)await pause(state.next-now());state.next=now()+1000;return send();}
    finally {release();}
  };
}

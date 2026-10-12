// Query selectors supported by this reader. Unknown selectors, free text and
// unverified locale/tracking parameters cannot silently broaden a source.
const KEYS=new Set(['jobFamilyGroup','jobFamily','locations','locationCountry','timeType','workerSubType']);
export function workdayQueryFacets(value){
 let query;try{query=new URL(value).searchParams;}catch{return null;}
 const facets={};
 for(const key of new Set(query.keys())){
  if(!KEYS.has(key))return null;
  const values=query.getAll(key);
  if(!values.length||values.length>5||new Set(values).size!==values.length||values.some(v=>!(/^[a-f0-9]{32}$/i.test(v))))return null;
  facets[key]=values;
 }
 return facets;
}

// Organization-name comparison shared by daily discovery and the collector.
// Pure functions over strings; no page text is treated as instructions.
// HTML character references. Pages routinely write names as Universidad de
// Ays&eacute;n or &#x41C;..., which must read as the same letters a browser shows.
const LATIN1='nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn sup2 sup3 acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml'.split(' ');
const NAMED={...Object.fromEntries(LATIN1.map((n,i)=>[n,String.fromCodePoint(160+i)])),amp:'&',quot:'"',apos:"'",lt:'<',gt:'>',ndash:'–',mdash:'—',lsquo:'‘',rsquo:'’',sbquo:'‚',ldquo:'“',rdquo:'”',bdquo:'„',bull:'•',hellip:'…',trade:'™',euro:'€',OElig:'Œ',oelig:'œ',Scaron:'Š',scaron:'š',Yuml:'Ÿ',thinsp:' ',ensp:' ',emsp:' ',zwnj:'',zwj:'',lrm:'',rlm:''};
export const decode=s=>String(s||'').replace(/&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([A-Za-z][A-Za-z0-9]{1,8}));/g,(m,dec,hex,name)=>{
  if(dec||hex){const n=parseInt(dec||hex,dec?10:16);return n>0&&n<=0x10ffff?String.fromCodePoint(n):' ';}
  return Object.hasOwn(NAMED,name)?NAMED[name]:m;
});
// Tags are removed before references are decoded, so an escaped "&lt;b&gt;"
// stays text instead of becoming markup that is then silently dropped.
export const text=s=>decode(String(s||'').replace(/<script\b[^>]*>[\s\S]*?<\/script>|<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<[^>]*>/g,' ')).replace(/\s+/g,' ').trim();
// Letters and digits only, case- and accent-insensitive, any script.
export function plainName(s){return text(s).normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();}
// Legal-form words do not distinguish one organization from another on its own
// site: "Acme Ltd", "Acme Limited" and "ACME S.A." are the same name as "Acme".
// Each form is a whole trailing (or, where noted, leading) word sequence.
const LEGAL_SUFFIXES=['persero','persero tbk','limited','ltd','plc','p l c','incorporated','inc','corporation','corp','pty','proprietary','sa','s a','sas','s a s','sarl','s a r l','sl','s l','srl','s r l','spa','s p a','sab','s a b','de c v','sab de cv','s a b de c v','sa de cv','s a de c v','ltda','gmbh','mbh','ag','kg','gmbh co kg','se','nv','n v','bv','b v','ab','publ','ab publ','asa','as','a s','aps','oy','oyj','kk','k k','llc','l l c','llp','l l p','lp','pte','pte ltd','pvt','pvt ltd','private limited','sdn bhd','bhd','berhad','tbk','jsc','pjsc','ojsc','cjsc','sae','s a e','saog','saoc','psc','p s c','qsc','q s c','bsc','b s c','wll','w l l','fze','fzco','co','company'].map(s=>s.split(' '));
const LEGAL_PREFIXES=['the','pt','pjsc','jsc','ojsc','cjsc','ooo','oao','zao','pao'].map(s=>[s]);
export function identityName(s){
  let tokens=plainName(s).split(' ').filter(Boolean);
  const long=t=>t.join('').length>=3;
  for(let changed=true;changed;){
    changed=false;
    for(const form of LEGAL_SUFFIXES){const rest=tokens.slice(0,-form.length);if(tokens.length>form.length&&long(rest)&&form.every((t,i)=>tokens[rest.length+i]===t)){tokens=rest;changed=true;break;}}
    for(const form of LEGAL_PREFIXES){const rest=tokens.slice(form.length);if(tokens.length>form.length&&long(rest)&&form.every((t,i)=>tokens[i]===t)){tokens=rest;changed=true;break;}}
  }
  return tokens.join(' ');
}
// Applicant-tracking boards label themselves "Jobs at Acme", "Acme Jobs",
// "Careers at Acme - Current Openings" or "Acme logo". Only that fixed board
// wording is removed; any other word still makes it a different name.
const BOARD_LEAD=/^(?:(?:current|all|open)\s+)?(?:jobs|careers|career opportunities|job openings|openings|vacancies|open positions|positions)\s+(?:at|with|@)\s+/i;
const BOARD_TAIL=/\s+(?:jobs|careers|career site|careers? page|job board|job openings|current openings|vacancies|logo)$/i;
export function boardLabelNames(label){
  const whole=text(label);if(!whole||whole.length>300)return [];
  const parts=[whole,...whole.split(/\s+[|｜–—·-]\s+|\s*[|｜]\s*/)].map(p=>p.trim()).filter(Boolean);
  const out=new Set();
  for(let p of parts){for(let i=0;i<3;i++){const next=p.replace(BOARD_LEAD,'').replace(BOARD_TAIL,'').trim();if(next===p)break;p=next;}const n=identityName(p);if(n.length>=3)out.add(n);}
  return [...out];
}
// True when one of the board's own labels is exactly one of the employer's names
// (legal-form words aside). Never a substring, prefix or similar-name match.
export function boardNamesOrganization(labels,names){
  const wanted=new Set((Array.isArray(names)?names:[names]).filter(n=>typeof n==='string').map(identityName).filter(n=>n.length>=3));
  return wanted.size>0&&(Array.isArray(labels)?labels:[labels]).some(l=>typeof l==='string'&&boardLabelNames(l).some(n=>wanted.has(n)));
}

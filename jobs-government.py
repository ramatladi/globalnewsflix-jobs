"""Read official South African vacancy circulars; no application data collected.
Only dated, individually identified vacancies with an unambiguous closing date
are exported. A weekly circular is not an employer-wide replacement snapshot.
"""
import argparse, hashlib, io, json, re, sys, time
from datetime import datetime, timezone, timedelta
from html import unescape
from urllib.parse import urljoin, urlparse
from urllib.request import Request, urlopen
from pypdf import PdfReader

LANDING = 'https://www.gov.za/government-jobs-week'
SAST = timezone(timedelta(hours=2))
MONTHS = {m.lower(): i for i, m in enumerate(['January','February','March','April','May','June','July','August','September','October','November','December'], 1)}
DATE = r'(\d{1,2})\s+(' + '|'.join(MONTHS) + r')\s+(20\d{2})'
LABEL = r'(?:SALARY|STIPEND|CENTRE|CENTRES|REQUIREMENTS|DUTIES|ENQUIRIES|APPLICATIONS|CLOSING DATE|NOTE|NOTES)'

def flat(s):
    return re.sub(r'\s+', ' ', re.sub(r'@@PAGE:\d+@@', '', s)).strip()

def date_value(s, closing=False):
    matches = list(re.finditer(DATE, s, re.I))
    days = {(int(m[3]), MONTHS[m[2].lower()], int(m[1])) for m in matches}
    if len(days) != 1:
        return None
    y,m,d = next(iter(days))
    # A source time is interpreted in the advertised country's timezone.
    tail = s[matches[0].end():]
    clocks = list(re.finditer(r'\b(\d{1,2})\s*[:h]\s*(\d{2})(?:\s*(AM|PM)\b)?', tail, re.I))
    times=[]
    for clock in clocks:
        h,minute=int(clock[1]),int(clock[2]); meridiem=(clock[3] or '').upper()
        if meridiem == 'AM' and h == 12: h=0
        if meridiem == 'PM' and h < 12: h+=12
        if h>23 or minute>59: return None
        times.append((h,minute))
    # Different application channels can close at different times on the same
    # date. Use the earliest published cutoff, never leave an expired channel open.
    h,minute = min(times) if times else ((23,59) if closing else (0,0))
    try: return int(datetime(y,m,d,h,minute,59 if closing and not times else 0,tzinfo=SAST).timestamp()*1000)
    except ValueError: return None

def field(block, label):
    m = re.search(r'^\s*'+label+r'\s*:\s*(.*?)(?=^\s*'+LABEL+r'\s*:|\Z)', block, re.M|re.S)
    return flat(m[1]) if m else ''

def salary(text):
    # Explicit advertised Rand amounts only. Multiple pay grades remain verbatim.
    amounts = re.findall(r'\bR\s*(\d[\d\s,]*(?:\.\d{2})?)', text)
    vals=[]
    for v in amounts:
        try: vals.append(float(re.sub(r'[\s,]','',v)))
        except ValueError: pass
    period = 'month' if re.search(r'per month|monthly',text,re.I) else 'year' if re.search(r'per annum|per year|annually',text,re.I) else None
    if not period or not vals or len(vals)>2 or any(v<=0 for v in vals): return None
    if len(vals)==2 and not re.search(r'\s[-–—]\s|\bto\b',text,re.I): return None
    return {'cur':'ZAR','min':min(vals),'max':max(vals),'period':period}

def parse_pages(pages, source_url, now=None):
    now = int(time.time()*1000) if now is None else now
    issued = re.search(r'DATE ISSUED\s*:?\s*('+DATE+r')',pages[0],re.I)
    posted = date_value(issued[1]) if issued else None
    if not posted or posted>now or now-posted>60*86400000:
        raise ValueError('missing, future or stale official circular issue date')
    year = datetime.fromtimestamp(posted/1000,SAST).year
    # Remove only each page's own final folio. Keep page markers for links, but
    # flat() removes them from exported fields even when a field spans pages.
    cleaned=[]
    for i,page in enumerate(pages):
        lines=page.splitlines()
        while lines and not lines[-1].strip(): lines.pop()
        if lines and lines[-1].strip()==str(i+1): lines.pop()
        cleaned.append('\n'.join(lines))
    text='\n'.join(f'\n@@PAGE:{i+1}@@\n'+p for i,p in enumerate(cleaned))
    annexures=list(re.finditer(r'(?m)^[ \t]*ANNEXURE[ \t]+[A-Z]+[ \t]*$',text))
    sections=[]
    for i,annexure in enumerate(annexures):
        end=annexures[i+1].start() if i+1<len(annexures) else len(text)
        body=text[annexure.end():end]
        first_post=re.search(r'(?m)^\s*POST\s+(\d+/\d+)\s*:',body)
        if not first_post: continue
        lines=[flat(x) for x in body[:first_post.start()].splitlines() if flat(x)]
        parent=lines[0] if lines else ''
        if parent.startswith('PROVINCIAL ADMINISTRATION:'):
            # Provincial annexures contain several distinct employers. A new
            # department/office heading ends the preceding job and resets dates.
            headings=list(re.finditer(r'(?m)^[ \t]*(?:DEPARTMENT (?:OF|FOR) [A-Z][A-Z &(),/\-]*|OFFICE OF THE [A-Z][A-Z &(),/\-]*)[ \t]*$',body))
            for j,heading in enumerate(headings):
                stop=headings[j+1].start() if j+1<len(headings) else len(body)
                employer=f'{flat(heading[0])} — {parent.split(":",1)[1].strip()}'
                sections.append((body[heading.end():stop],annexure.end()+heading.end(),employer))
        else:
            sections.append((body,annexure.end(),parent))
    out=[]; skipped={}; employers=set()
    for sec,section_start,employer in sections:
        first_post=re.search(r'(?m)^\s*POST\s+(\d+/\d+)\s*:',sec)
        if not first_post: continue
        header=sec[:first_post.start()]
        if not employer or len(employer)>150: continue
        employers.add(employer)
        closing_default=date_value(field(header,'CLOSING DATE'),True)
        starts=list(re.finditer(r'(?m)^\s*POST\s+(\d+/\d+)\s*:',sec))
        for i,st in enumerate(starts):
            block=sec[st.end():starts[i+1].start() if i+1<len(starts) else len(sec)]
            # Annexure headers can announce different department dates; don't guess.
            closing_text=field(block,'CLOSING DATE')
            closing=date_value(closing_text,True) if closing_text else closing_default
            if closing is None: skipped['ambiguous_or_missing_closing']=skipped.get('ambiguous_or_missing_closing',0)+1;continue
            if closing < now: skipped['expired']=skipped.get('expired',0)+1;continue
            head=re.split(r'(?m)^\s*'+LABEL+r'\s*:',block,maxsplit=1)[0]
            head=re.sub(r'@@PAGE:\d+@@','',head)
            ref=re.search(r'\bREF(?:ERENCE)?\s*(?:NO\.?|NUMBER)?\s*:\s*([^\n]+)',head,re.I)
            title=flat(head[:ref.start()] if ref else head)
            if ref:
                # A bold uppercase role/discipline can continue after an inline
                # reference. Exclude code-like wrapped references and prose.
                continuation=[flat(line) for line in head[ref.end():].splitlines()]
                continuation=[line for line in continuation if line and line==line.upper() and '/' not in line and ':' not in line and len(re.findall(r'[A-Z]{2,}',line))>=2]
                if continuation: title=flat(title+' '+' '.join(continuation))
            # A subtitle is useful context but must not consume paragraphs.
            if not title or len(title)>220: skipped['unclear_title']=skipped.get('unclear_title',0)+1;continue
            reference=flat(ref[1]) if ref else f'Post {st[1]}'
            location=field(block,'CENTRES?')
            if not location or len(location)>300: skipped['unclear_location']=skipped.get('unclear_location',0)+1;continue
            prefix=text[:section_start+st.start()]
            marks=re.findall(r'@@PAGE:(\d+)@@',prefix)
            page=int(marks[-1]) if marks else 1
            url=source_url.split('#')[0]+f'#page={page}'
            paytext=field(block,'(?:SALARY|STIPEND)')
            out.append({'id':f'{year}-{st[1]}','title':title,'employer':employer.title(),'country':'ZA','location':location,'url':url,'source_url':url,'posted':posted,'closing':closing,'closing_text':closing_text or field(header,'CLOSING DATE'),'pay':salary(paytext),'salary_text':paytext[:600],'salary_url':url if paytext else None,'reference':reference,'source_page':page})
    return {'rows':out,'complete':False,'reason':'dated_circular_not_employer_snapshot','diagnostics':{'parsed':len(out),'employers':len({row['employer'] for row in out}),'employer_sections':len(employers),'skipped':skipped,'issued':posted,'source':source_url}}

def public_get(url):
    p=urlparse(url)
    if p.scheme!='https' or p.hostname!='www.gov.za': raise ValueError('non-official source URL')
    req=Request(url,headers={'User-Agent':'GlobalNewsflixJobs/1.0 (+https://globalnewsflix.com/about/)','Accept':'text/html,application/pdf'})
    with urlopen(req,timeout=30) as r:
        if urlparse(r.url).hostname!='www.gov.za': raise ValueError('unexpected redirect host')
        data=r.read(25*1024*1024+1)
        if len(data)>25*1024*1024: raise ValueError('source exceeds byte limit')
        return data

def collect():
    html=public_get(LANDING).decode('utf-8','replace')
    links=re.findall(r'<a\b[^>]*href=["\']([^"\']+)["\'][^>]*>(.*?)</a>',html,re.I|re.S)
    candidates=[urljoin(LANDING,unescape(u)) for u,label in links if re.search(r'Public Service Vacancy Circular',flat(re.sub('<[^>]+>',' ',label)),re.I) and '.pdf' in u.lower()]
    if len(candidates)!=1: raise ValueError('official current circular link ambiguous')
    time.sleep(1)
    pdf=public_get(candidates[0])
    if not pdf.startswith(b'%PDF'): raise ValueError('source did not return PDF')
    r=PdfReader(io.BytesIO(pdf))
    if len(r.pages)>1000: raise ValueError('too many pages')
    return parse_pages([p.extract_text(extraction_mode='layout') for p in r.pages],candidates[0])

if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('--pages');ap.add_argument('--source-url');ap.add_argument('--output',required=True);args=ap.parse_args()
    result=parse_pages(json.load(open(args.pages)),args.source_url) if args.pages else collect()
    with open(args.output,'w') as f: json.dump(result,f,ensure_ascii=False)
    print(json.dumps(result['diagnostics']),file=sys.stderr)

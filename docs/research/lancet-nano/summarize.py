"""Retain measurements without model weights or large intermediate tensors."""
import hashlib
import json
import math
import sys
from pathlib import Path

s = Path(sys.argv[1])
out = Path(__file__).parent
data = json.loads((s/'js-results.json').read_text(encoding='utf8'))
parity = json.loads((s/'parity.json').read_text(encoding='utf8'))
rows = data['results']
def pct(values, p):
    values = sorted(values)
    return values[max(0, math.ceil(len(values)*p)-1)]
def matrix(group):
    group = [r for r in rows if r['group']==group]
    return {shell:{label:sum(r['shell']==shell and r['classification']==label for r in group)
                   for label in ['risky','review','not_flagged']} for shell in ['bash','powershell','cmd']}
def distribution(group):
    values = [r['score'] for r in rows if r['group']==group]
    return dict(min=min(values),p10=pct(values,.1),p50=pct(values,.5),p90=pct(values,.9),max=max(values))
thresholds = []
for t in [.991200665739696,.9,.5,.2956467684116474,.2,.1,.05,0]:
    thresholds.append(dict(threshold=t,dangerousAsked=sum(r['group']=='dangerous' and r['score']>=t for r in rows),
                           ordinaryAsked=sum(r['group']=='ordinary' and r['score']>=t for r in rows)))
changes = []
for r in rows:
    if 'baseId' in r:
        base = next(x for x in rows if x['id']==r['baseId'])
        changes.append(dict(id=r['id'],baseId=base['id'],baseLabel=base['classification'],label=r['classification'],
                            baseScore=base['score'],score=r['score'],delta=r['score']-base['score']))
summary = dict(count=len(rows),matrix={g:matrix(g) for g in ['ordinary','dangerous','shim-injection','prompt-injection']},
               distribution={g:distribution(g) for g in ['ordinary','dangerous','shim-injection','prompt-injection']},
               thresholds=thresholds,injection=changes,
               latency=dict(loadMs=data['loadMs'],firstInferenceMs=rows[0]['ms'],warmCount=len(data['warm']),
                            warmP50=pct(data['warm'],.5),warmP95=pct(data['warm'],.95),
                            fixtureP50=pct([r['ms'] for r in rows[1:]],.5),fixtureP95=pct([r['ms'] for r in rows[1:]],.95)),
               initialMemory=data['initialMemory'],finalMemory=data['finalMemory'],resourceUsage=data['resourceUsage'],
               nodeVersions=data['versions'],parity=parity)
(out/'summary.json').write_text(json.dumps(summary,indent=2)+'\n',encoding='utf8')
clean = [{k:v for k,v in r.items() if k not in ['pooled','ids']} for r in rows]
(out/'results.json').write_text(json.dumps(clean,indent=2,ensure_ascii=False)+'\n',encoding='utf8')
hf = json.loads((s/'hf.json').read_text(encoding='utf-8-sig'))
artifacts=[]
for p in sorted((s/'bundle').rglob('*')):
    if not p.is_file() or '__pycache__' in p.parts:
        continue
    rel=p.relative_to(s).as_posix()
    artifacts.append(dict(path=rel,bytes=p.stat().st_size,sha256=hashlib.sha256(p.read_bytes()).hexdigest(),
                          url=f'https://huggingface.co/fingerthief/lancet-nano/resolve/{hf["sha"]}/{rel}'))
(out/'artifacts.json').write_text(json.dumps(dict(revision=hf['sha'],artifacts=artifacts),indent=2)+'\n',encoding='utf8')
print(json.dumps(summary['latency']))

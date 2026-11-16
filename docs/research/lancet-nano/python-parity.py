"""Compare the JS run with the downloaded upstream runtime. No command execution."""
import importlib.util
import json
import sys
from pathlib import Path

scratch = Path(sys.argv[1])
spec = importlib.util.spec_from_file_location('upstream', scratch/'bundle/model/classify.py')
upstream = importlib.util.module_from_spec(spec)
spec.loader.exec_module(upstream)
predictor = upstream.LancetNano(scratch/'bundle/model', threads=1)
js = json.loads((scratch/'js-results.json').read_text(encoding='utf8'))
# Spread across all groups plus every long/Unicode edge.
selected = list({r['id']: r for r in js['results'][::12] + [r for r in js['results'] if r['group']=='parity-edge']}.values())
comparisons = []
head_math_differences = []
import numpy as np
for row in js['results']:
    if 'pooled' in row:
        z = predictor.projection @ np.asarray(row['pooled'],dtype=np.float64)
        z = (z-z.mean()) / np.sqrt(z.var()+predictor.norm_eps)*predictor.norm_weight+predictor.norm_bias
        risk = float((predictor.head_weight @ z + predictor.head_bias)[0])
        head_math_differences.append(dict(id=row['id'],logitDifference=abs(risk-row['riskLogit'])))
for row in selected:
    result = predictor.score(row['command'], row['shell'])
    ids = predictor.tokenizer.encode(row['command']).ids
    comparisons.append(dict(id=row['id'], reference=result, tokenIdsMatch=ids==row['ids'],
                            scoreDifference=abs(result['score']-row['score']),
                            logitDifference=abs(result['riskLogit']-row['riskLogit']),
                            labelMatches=result['classification']==row['classification']))
import numpy as np
head = np.load(scratch/'bundle/model/head.npz')
descriptor = json.loads((scratch/'bundle/model/head.json').read_text())
raw = (scratch/'bundle/model/head.bin').read_bytes()
head_parity = {}
for t in descriptor['tensors']:
    v = np.frombuffer(raw, dtype='<f4', count=t['bytes']//4, offset=t['offset']).reshape(t['shape'])
    head_parity[t['name']] = float(np.max(np.abs(v.astype(np.float64)-head[t['name']].astype(np.float64))))
(scratch/'parity.json').write_text(json.dumps(dict(comparisons=comparisons, headMaxDifferences=head_parity,headMathDifferences=head_math_differences), indent=2))
print(json.dumps(dict(count=len(comparisons), allTokensMatch=all(r['tokenIdsMatch'] for r in comparisons),
                      allLabelsMatch=all(r['labelMatches'] for r in comparisons),
                      maxScoreDifference=max(r['scoreDifference'] for r in comparisons),
                      maxLogitDifference=max(r['logitDifference'] for r in comparisons), headMaxDifferences=head_parity)))

"""Separate diagnostic against frozen 50-image index, never the live full index."""
import contextlib
import json
import sys
import hashlib
import importlib.util
from pathlib import Path
import numpy as np

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'server'))
spec=importlib.util.spec_from_file_location('ai_worker',ROOT/'server/ai-worker.py')
worker=importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)
load, encode=worker.load, worker.encode
DATA=ROOT/'datasets/retail-catalog'
OUT=DATA/'multiframe-expanded'
manifest=json.loads((OUT/'manifest.json').read_text())
products={p['key']:p for p in manifest['products']}
references=json.loads((DATA/'benchmark/references.json').read_text())
reference_hashes={hashlib.sha256((DATA/p['image_file']).read_bytes()).hexdigest() for p in references}
eligible={p['key'] for p in manifest['products'] if p['alternateSourcePhoto']}
assert all(products[key]['querySha256'] not in reference_hashes for key in eligible)
index=np.load(DATA/'benchmark/reference-embeddings.npz')
ids=[str(item) for item in index['ids']]
vectors=index['embeddings']


def photo(file):
    import base64
    return 'data:image/jpeg;base64,'+base64.b64encode(file.read_bytes()).decode()


def iou(a,b):
    intersection=max(0,min(a[2],b[2])-max(a[0],b[0]))*max(0,min(a[3],b[3])-max(a[1],b[1]))
    return intersection/((a[2]-a[0])*(a[3]-a[1])+(b[2]-b[0])*(b[3]-b[1])-intersection)


with contextlib.redirect_stdout(sys.stderr):
    load()
results=[]
for fixture in manifest['cases']:
    if fixture['condition']!='clear' or not fixture['name'].startswith('group-'):
        continue
    try:
        with contextlib.redirect_stdout(sys.stderr):
            encoded=encode(photo(OUT/fixture['photo']),'multiple',photo(OUT/fixture['background']))
        regions=encoded['regions']
        error=None
    except Exception as exc:
        regions=[]
        error=str(exc)
    edges=sorted([(iou(t['box'],p['box']),ti,pi) for ti,t in enumerate(fixture['truth']) for pi,p in enumerate(regions)],reverse=True)
    used_truth=set();used_regions=set();matches={}
    for overlap,ti,pi in edges:
        if overlap<.5 or ti in used_truth or pi in used_regions:
            continue
        used_truth.add(ti);used_regions.add(pi);matches[ti]=(pi,overlap)
    for ti,truth in enumerate(fixture['truth']):
        key=truth['key']
        if key not in eligible:
            continue
        product=products[key]
        row={'key':key,'name':product['name'],'scene':fixture['name'],'referenceId':product['referenceId'],'queryFile':product['queryFile'],'sameFileHashAsAnyReference':False,'localized':ti in matches,'correctTop1':False,'error':error}
        if ti in matches:
            pi,overlap=matches[ti]
            scores=vectors@np.asarray(regions[pi]['embedding'],dtype=np.float32)
            order=np.argsort(-scores)
            rank=int(np.flatnonzero(np.asarray(ids)[order]==product['referenceId'])[0])+1
            row.update({'iou':overlap,'rank':rank,'correctTop1':rank==1,'predictedId':ids[int(order[0])],'predictedName':references[int(order[0])]['name'],'similarity':float(scores[order[0]])})
        results.append(row)
report={'method':'Only 18 alternate retailer queries; no query file hash occurs in the frozen 50-image reference index. Crops come from clear composite scenes. Live full-index references were not removed or changed. Different source files can still share supplier origins; pack identity is based on retailer labels, not verified EANs.','referenceProducts':len(ids),'eligibleQueries':len(eligible),'localized':sum(r['localized'] for r in results),'correctTop1':sum(r['correctTop1'] for r in results),'items':results}
(OUT/'heldout-results.json').write_text(json.dumps(report,indent=2)+'\n')
rows='\n'.join(f"| {r['name']} | {r['localized']} | {r['correctTop1']} | {r.get('rank','missed')} | {r.get('predictedName','none')} |" for r in results)
(OUT/'HELDOUT.md').write_text('# Separate source-disjoint diagnostic\n\n'+report['method']+'\n\n| Query | Localized | Correct top match | Rank | Predicted |\n| --- | --- | --- | ---: | --- |\n'+rows+'\n')
print(json.dumps({k:v for k,v in report.items() if k!='items'}))

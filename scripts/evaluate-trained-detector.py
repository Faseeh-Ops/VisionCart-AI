"""Compare candidate localization to the previous 32-SKU scene segmentation results."""
import argparse
import html
import json
import os
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
os.environ['YOLO_CONFIG_DIR']=str(ROOT/'.tools/ai-training')
os.environ['MPLCONFIGDIR']=str(ROOT/'.tools/ai-training/matplotlib')


def overlap(a,b):
    area=max(0,min(a[2],b[2])-max(a[0],b[0]))*max(0,min(a[3],b[3])-max(a[1],b[1]))
    return area/((a[2]-a[0])*(a[3]-a[1])+(b[2]-b[0])*(b[3]-b[1])-area)


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--weights',default='models/retail-detector/candidate.pt')
    parser.add_argument('--dataset',default='datasets/retail-catalog/multiframe-expanded')
    parser.add_argument('--prefix',default='expanded')
    args=parser.parse_args()
    from ultralytics import YOLO
    data=ROOT/args.dataset
    original=json.loads((data/'results.json').read_text(encoding='utf-8'))
    manifest=json.loads((data/'manifest.json').read_text(encoding='utf-8'))
    training=json.loads((ROOT/'datasets/product-detector/manifest.json').read_text(encoding='utf-8'))
    training_hashes={p['sha256'] for p in training['sources']['train']}
    query_hashes={p['querySha256'] for p in manifest['products']} if 'products' in manifest else {p['sha256'] for p in manifest['sources'].values()}
    assert not training_hashes&query_hashes
    model=YOLO(str(ROOT/args.weights))
    rows=[]
    for case in original['cases']:
        prediction=model.predict(str(data/case['photo']),device=0,imgsz=640,conf=.25,verbose=False)[0]
        boxes=prediction.boxes.xyxy.cpu().tolist()
        edges=sorted([(overlap(t['box'],b),ti,pi) for ti,t in enumerate(case['truth']) for pi,b in enumerate(boxes)],reverse=True)
        used_truth=set();used_pred=set()
        for score,ti,pi in edges:
            if score<.5 or ti in used_truth or pi in used_pred:
                continue
            used_truth.add(ti);used_pred.add(pi)
        rows.append({'name':case['name'],'condition':case.get('condition'),'photo':case['photo'],
                     'expected':len(case['truth']),'previousLocalized':len(case['matches']),
                     'previousRegions':len(case['items']),'trainedLocalized':len(used_truth),
                     'trainedRegions':len(boxes),'trainedExtra':len(boxes)-len(used_pred),
                     'boxes':boxes,'truth':case['truth']})
    conditions=[]
    for condition in ('clear','rotated','shadow','glare','blur','touching','overlap'):
        subset=[r for r in rows if r['condition']==condition and r['name'].startswith('group-')]
        if not subset:
            continue
        conditions.append({'condition':condition,**{key:sum(r[key] for r in subset) for key in ('expected','previousLocalized','previousRegions','trainedLocalized','trainedRegions','trainedExtra')}})
    report={'weights':str(ROOT/args.weights),'scope':'Localization only; exact SKU matching has NOT been evaluated with the new crops. All scenes are synthetic. No identical training-source hash overlaps these query sources. Prior baseline is background-component segmentation, not generic YOLO.',
            'confidenceThreshold':.25,'iouMatchThreshold':.5,'conditions':conditions,'cases':rows}
    report['training']=json.loads((ROOT/'models/retail-detector/training-report.json').read_text(encoding='utf-8'))
    out=ROOT/'models/retail-detector'
    (out/(args.prefix+'-evaluation.json')).write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    table='| Condition | Expected | Previous localized | Trained localized | Trained extra regions |\n| --- | ---: | ---: | ---: | ---: |\n'
    table+='\n'.join(f"| {r['condition']} | {r['expected']} | {r['previousLocalized']} | {r['trainedLocalized']} | {r['trainedExtra']} |" for r in conditions)
    (out/(args.prefix.upper()+'-EVALUATION.md')).write_text('# Candidate detector comparison\n\n'+report['scope']+'\n\n'+table+'\n',encoding='utf-8')
    cards=[]
    for row in rows:
        # Relative path from the report's models directory to the existing fixture.
        source='../../'+args.dataset.replace('\\','/')+'/'+row['photo']
        shapes=''.join(f'<rect x="{b[0]}" y="{b[1]}" width="{b[2]-b[0]}" height="{b[3]-b[1]}" fill="none" stroke="#ffb020" stroke-width="3"/>' for b in row['boxes'])
        shapes+=''.join(f'<rect x="{t["box"][0]}" y="{t["box"][1]}" width="{t["box"][2]-t["box"][0]}" height="{t["box"][3]-t["box"][1]}" fill="none" stroke="#00ee77" stroke-width="2" stroke-dasharray="7 4"/>' for t in row['truth'])
        cards.append(f'<article><h2>{html.escape(row["name"])}</h2><p>Expected {row["expected"]}; localized before {row["previousLocalized"]}, after {row["trainedLocalized"]}; extra regions {row["trainedExtra"]}.</p><svg viewBox="0 0 640 480"><image href="{html.escape(source)}" width="640" height="480"/>{shapes}</svg></article>')
    source_count=len(manifest.get('products',manifest.get('sources',{})))
    header=f'<h2>Earlier {source_count}-product scenes</h2><table><tr><th>Condition</th><th>Expected</th><th>Old located</th><th>Trained located</th><th>Trained extras</th></tr>'
    header+=''.join('<tr>'+''.join(f'<td>{html.escape(str(r[k]))}</td>' for k in ('condition','expected','previousLocalized','trainedLocalized','trainedExtra'))+'</tr>' for r in conditions)+'</table>'
    trained=report['training']['trained'];baseline=report['training']['baseline']
    header+=f'<h2>Separate 180-scene synthetic test</h2><p>GPU: {html.escape(report["training"]["gpu"])}. Original generic YOLO, class-agnostic mAP50: {baseline["mAP50"]:.3f}; trained one-class YOLO mAP50: {trained["mAP50"]:.3f}. These metrics are not exact-SKU accuracy or live checkout performance.</p>'
    page='<!doctype html><meta charset="utf-8"><title>Trained detector evaluation</title><style>body{font:16px system-ui;margin:30px auto;max-width:1250px;background:#111827;color:#eee}main{display:grid;grid-template-columns:1fr 1fr;gap:20px}article{padding:16px;background:#202b40;border-radius:12px}svg{width:100%}h2{font-size:18px}table{border-collapse:collapse;width:100%}td,th{padding:10px;text-align:left;border-bottom:1px solid #596275}</style><h1>Experimental detector: localization results</h1><p>'+html.escape(report['scope'])+'</p>'+header+'<p>Green dashed: expected boxes; orange: candidate predictions.</p><main>'+''.join(cards)+'</main>'
    filename='EVALUATION.html' if args.prefix=='expanded' else args.prefix.upper()+'-EVALUATION.html'
    (out/filename).write_text(page,encoding='utf-8')
    print(json.dumps({'conditions':conditions,'cases':[{k:r[k] for k in ('name','expected','previousLocalized','trainedLocalized','trainedExtra')} for r in rows],'report':str(out/filename)}))


if __name__=='__main__':
    main()

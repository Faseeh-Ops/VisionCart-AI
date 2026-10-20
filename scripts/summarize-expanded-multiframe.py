import html
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'datasets/retail-catalog/multiframe-expanded'
report=json.loads((OUT/'results.json').read_text(encoding='utf-8'))
heldout=json.loads((OUT/'heldout-results.json').read_text(encoding='utf-8'))
manifest=json.loads((OUT/'manifest.json').read_text(encoding='utf-8'))
rows=[]
for condition in ('clear','rotated','shadow','glare','blur','touching','overlap'):
    cases=[c for c in report['cases'] if c.get('condition')==condition and c['name'].startswith('group-')]
    rows.append({'condition':condition,'expected':sum(len(c['truth']) for c in cases),
                 'regions':sum(len(c['items']) for c in cases),'localized':sum(len(c['matches']) for c in cases),
                 'correctExactSku':sum(c['correctTop1'] for c in cases),
                 'rejectedScenes':sum(c['outcome']=='rejected' for c in cases)})
summary={'products':len(report['expectedProducts']),'scenes':len(report['cases']),
         'appearances':sum(len(c['truth']) for c in report['cases']),
         'liveQuerySourcesAlreadyIndexed':sum(p['querySourceAlreadyIndexed'] is True for p in report['expectedProducts'].values()),
         'conditions':rows,'heldoutReferenceIndexSize':heldout['referenceProducts'],
         'heldoutExpected':heldout['eligibleQueries'],'heldoutLocalized':heldout['localized'],
         'heldoutCorrect':heldout['correctTop1'],'businessDataUnchanged':report['businessDataUnchanged']}
(OUT/'summary.json').write_text(json.dumps(summary,indent=2)+'\n',encoding='utf-8')
table='| Condition | Expected | Regions returned | Localized | Correct exact SKU | Rejected scenes |\n| --- | ---: | ---: | ---: | ---: | ---: |\n'
table+='\n'.join(f"| {r['condition']} | {r['expected']} | {r['regions']} | {r['localized']} | {r['correctExactSku']} | {r['rejectedScenes']} |" for r in rows)
products='\n'.join('- '+p['name'] for p in manifest['products'])
text=f"""# Expanded multi-product test summary

32 additional catalog SKUs, 51 simulated scenes, 229 product appearances. Tiger, Innovative and Mahmood are excluded. No new physical camera captures were available. Product cutouts were made from catalog images, preserving aspect ratios, and composed into 640×480 scenes. All annotated object bounds are inside the frame.

{table}

Localization requires a one-to-one match at intersection-over-union ≥0.5. A correct SKU requires that localized crop's top result to equal the expected product ID. Extra regions and rejected scenes are retained, not discarded. Numbers are repeated appearances of the same small SKU set, not independent trials or an estimate of checkout accuracy.

All {summary['liveQuerySourcesAlreadyIndexed']} live query sources were already indexed. This makes the live API test a robustness/integration check, not held-out recognition. Some retailer pictures show multipacks or several units for one listing, which is another ambiguity for physical counting. Identities are retailer-listing mappings, not verified EAN ground truth.

A separate frozen 50-product index omitted the exact file hashes of 18 alternate query photos. For clear composite crops it localized {heldout['localized']}/18 and ranked the expected reference first for {heldout['correctTop1']}/18. Different retailer files can still share supplier origins. This smaller, different index is not comparable to the live full catalog's score. See HELDOUT.md for every prediction.

No confirmations or invoices were submitted. Inventory units, inventory row counts, invoice counts and scan-log counts were unchanged: {report['businessDataUnchanged']}.

## Products

{products}
"""
(OUT/'SUMMARY.md').write_text(text,encoding='utf-8')
head='<section id="expanded-summary"><h2>Expanded results by condition</h2><p>32 additional SKUs; 51 simulated scenes; 229 appearances. All live query source photos were already indexed. These are robustness checks, not unseen-photo checkout accuracy.</p><table style="border-collapse:collapse;width:100%"><thead><tr><th>Condition</th><th>Expected</th><th>Regions</th><th>Localized</th><th>Correct SKU</th><th>Rejected scenes</th></tr></thead><tbody>'
head+=''.join('<tr>'+''.join(f'<td style="padding:8px;border-bottom:1px solid #596275">{html.escape(str(r[k]))}</td>' for k in ('condition','expected','regions','localized','correctExactSku','rejectedScenes'))+'</tr>' for r in rows)
head+=f'</tbody></table><p>Separate frozen 50-reference diagnostic: {heldout["correctTop1"]}/18 alternate source photos correctly matched; their exact file hashes are absent from that index. Different files may still share supplier origins. Scores across these two different indexes are not comparable.</p><p>Inventory, invoices and scan logs unchanged: {report["businessDataUnchanged"]}. Green dashed boxes show expected items; orange boxes show detected regions.</p><details><summary>All 32 tested products</summary><ul>'
head+=''.join('<li>'+html.escape(p['name'])+'</li>' for p in manifest['products'])+'</ul></details></section>'
page=(OUT/'RESULTS.html').read_text(encoding='utf-8')
if '<section id="expanded-summary">' in page:
    start=page.index('<section id="expanded-summary">')
    stop=page.index('</section>',start)+len('</section>')
    page=page[:start]+page[stop:]
page=page.replace('<main>',head+'<main>',1)
(OUT/'RESULTS.html').write_text(page,encoding='utf-8')
print(json.dumps(summary))

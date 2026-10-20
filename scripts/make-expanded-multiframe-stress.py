"""32 additional SKUs, deterministic composite scenes, with full source provenance."""
import hashlib
import json
from pathlib import Path
import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageEnhance

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT/'datasets/retail-catalog'
OUT = DATA/'multiframe-expanded'
OUT.mkdir(parents=True, exist_ok=True)
catalog = {p['id']:p for p in json.loads((DATA/'products.json').read_text())}
references = json.loads((DATA/'benchmark/references.json').read_text())
pairs = {p['reference_id']:p for p in json.loads((DATA/'benchmark/test-pairs.json').read_text())['pairs']}
selected = list(range(22))+[31,32,33,35,36,37,38,45,47,48]
assert len(selected)==32
sprites = {}
products = []
for i in selected:
    ref = references[i]
    pair = pairs.get(ref['id'])
    source = catalog[pair['query_id']] if pair else ref
    file = DATA/source['image_file']
    image = Image.open(file).convert('RGBA')
    rgb = np.asarray(image)[:,:,:3]
    white = (np.min(rgb,axis=2)>235).astype(np.uint8)
    _, labels = cv2.connectedComponents(white, connectivity=8)
    border_labels = np.unique(np.concatenate((labels[0],labels[-1],labels[:,0],labels[:,-1])))
    border_labels = border_labels[border_labels!=0]
    alpha = np.where(np.isin(labels,border_labels),0,255).astype(np.uint8)
    image.putalpha(Image.fromarray(alpha))
    bounds = image.getbbox()
    if not bounds:
        raise ValueError('Blank product image: '+source['id'])
    image = image.crop(bounds)
    key = 'sku-'+str(len(products)+1).zfill(2)
    sprites[key] = image
    products.append({'key':key,'name':source['name'],'sourceId':source['id'],
                     'referenceId':ref['id'],'referenceFile':ref['image_file'],
                     'queryFile':source['image_file'],'querySha256':hashlib.sha256(file.read_bytes()).hexdigest(),
                     'alternateSourcePhoto':bool(pair),
                     'foregroundExtraction':'Remove only border-connected near-white pixels; preserve internal white regions.'})

rng = np.random.default_rng(3229)
pixels = np.zeros((480,640,3),dtype=np.uint8)
for y in range(480):
    pixels[y] = np.clip(np.array([174,156,130])+int(8*np.sin(y/13))+rng.integers(-3,4,(640,3)),0,255)
background = Image.fromarray(pixels)
background.save(OUT/'empty.jpg',quality=86)
manifest = {'kind':'expanded_simulated_stress_test','physical_camera_capture':False,'products':products,
 'source_note':'32 SKUs beyond Tiger, Innovative and Mahmood. Synthetic composites from retailer photos; 18 use alternate retailer source files. The live full catalog may already index those query images: see per-product querySourceAlreadyIndexed. Alternate files are NOT held out from the live index. Separate frozen-index diagnostics use only source-disjoint queries. Retail listing identities are not independently EAN-verified.',
 'cases':[]}


def scene(name,keys,condition):
    image=background.copy().convert('RGBA')
    truth=[]
    n=len(keys)
    for i,key in enumerate(keys):
        obj=sprites[key].copy()
        obj.thumbnail((75,200) if condition=='rotated' else (90,270),Image.Resampling.LANCZOS)
        if condition=='rotated':
            obj=obj.rotate([-8,7,-5,8,-6][i],expand=True,resample=Image.Resampling.BICUBIC)
        slot=560/n
        x=round(40+slot*i+(slot-obj.width)/2)
        y=round(90+(300-obj.height)/2)
        if condition in ('touching','overlap') and truth:
            prev=truth[-1]['box']
            x=prev[2]-(8 if condition=='touching' else round(obj.width*.5))
            y=90 if condition=='touching' else 80+i*12
        if condition in ('touching','overlap') and not truth:
            x=35
            y=90 if condition=='touching' else 80
        assert 0<x<x+obj.width<640 and 0<y<y+obj.height<480, (name,key,x,y,obj.size)
        if condition=='shadow':
            layer=Image.new('RGBA',image.size)
            mask=Image.new('L',image.size)
            mask.paste(obj.getchannel('A'),(x+20,y+18))
            layer.putalpha(mask.filter(ImageFilter.GaussianBlur(12)).point(lambda p:int(p*.6)))
            image=Image.alpha_composite(image,layer)
        image.alpha_composite(obj,(x,y))
        truth.append({'key':key,'box':[x,y,x+obj.width,y+obj.height]})
    if condition=='glare':
        layer=Image.new('RGBA',image.size)
        draw=ImageDraw.Draw(layer)
        for item in truth:
            x1,y1,x2,y2=item['box'];height=y2-y1
            draw.polygon([(x1,y1+height*.25),(x2,y1+height*.45),(x2,y1+height*.58),(x1,y1+height*.38)],fill=(255,255,255,215))
        image=Image.alpha_composite(image,layer)
    image=image.convert('RGB')
    if condition=='blur':
        image=image.filter(ImageFilter.GaussianBlur(2))
    filename=name+'.jpg'
    image.save(OUT/filename,quality=55 if condition=='blur' else 86)
    manifest['cases'].append({'name':name,'photo':filename,'background':'empty.jpg','condition':condition,'truth':truth})


sizes=[5,5,5,5,4,4,4]
offset=0
for group,size in enumerate(sizes,1):
    keys=[p['key'] for p in products[offset:offset+size]]
    offset+=size
    for condition in ('clear','rotated','shadow','glare','blur','touching','overlap'):
        scene(f'group-{group:02d}-{condition}',keys,condition)
scene('duplicate-copies',[products[0]['key'],products[0]['key'],products[15]['key'],products[15]['key'],products[31]['key']],'clear')
scene('empty',[],'clear')
(OUT/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
probe=DATA/'multiframe-stress/camera-probe.json'
(OUT/'camera-probe.json').write_text(probe.read_text(encoding='utf-8') if probe.exists() else '[]\n',encoding='utf-8')
print(json.dumps({'products':len(products),'alternateSourcePhotos':sum(p['alternateSourcePhoto'] for p in products),'cases':len(manifest['cases']),'appearances':sum(len(c['truth']) for c in manifest['cases']),'output':str(OUT)}))

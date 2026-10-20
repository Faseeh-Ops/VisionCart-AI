"""Synthetic one-class detector data; source groups split before any augmentation."""
import hashlib
import json
import random
import re
from collections import Counter
from pathlib import Path
import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageEnhance

ROOT=Path(__file__).resolve().parents[1]
DATA=ROOT/'datasets/retail-catalog'
OUT=ROOT/'datasets/product-detector'
SEED=405032


def sprite(path):
    image=Image.open(path).convert('RGBA')
    if min(image.size)<60:
        raise ValueError('Small source')
    rgb=np.asarray(image)[:,:,:3]
    white=(rgb.min(axis=2)>235).astype(np.uint8)
    border=np.concatenate((white[0],white[-1],white[:,0],white[:,-1]))
    if border.mean()<.65:
        raise ValueError('Non-uniform source background')
    _,labels=cv2.connectedComponents(white,connectivity=8)
    outside=np.unique(np.concatenate((labels[0],labels[-1],labels[:,0],labels[:,-1])))
    outside=outside[outside!=0]
    alpha=np.where(np.isin(labels,outside),0,255).astype(np.uint8)
    count,_,stats,_=cv2.connectedComponentsWithStats(alpha,connectivity=8)
    if count<2 or stats[1:,4].max()/max(1,(alpha>0).sum())<.85:
        raise ValueError('Multiple disconnected source objects')
    image.putalpha(Image.fromarray(alpha))
    image=image.crop(image.getbbox())
    if min(image.size)<25 or max(image.size)/min(image.size)>7:
        raise ValueError('Unsuitable source shape')
    gray=np.asarray(image.convert('L').resize((9,8)))
    dhash=np.packbits((gray[:,1:]>gray[:,:-1]).reshape(-1)).tobytes().hex()
    return image,dhash


def background(rng):
    h=w=640
    base=np.array([rng.randint(55,220) for _ in range(3)])
    yy,xx=np.mgrid[:h,:w]
    grain=5*np.sin(yy/rng.uniform(6,30))+3*np.sin((xx+yy)/rng.uniform(15,45))
    gradient=(xx/w-.5)*rng.uniform(-35,35)
    pixels=np.clip(base[None,None,:]+grain[:,:,None]+gradient[:,:,None],0,255).astype(np.uint8)
    return Image.fromarray(pixels).convert('RGBA')


def make_scene(pool,rng):
    scene=background(rng)
    count=0 if rng.random()<.12 else rng.randint(1,6)
    visible=[]
    touch=rng.random()<.45
    last=None
    for _ in range(count):
        source=rng.choice(pool)
        obj=source['sprite'].copy()
        scale=rng.randint(110,265)/max(obj.size)
        obj=obj.resize((max(15,round(obj.width*scale)),max(15,round(obj.height*scale))),Image.Resampling.LANCZOS)
        obj=ImageEnhance.Brightness(obj).enhance(rng.uniform(.75,1.2))
        obj=obj.rotate(rng.uniform(-75,75),expand=True,resample=Image.Resampling.BICUBIC)
        x=rng.randint(8,632-obj.width);y=rng.randint(8,632-obj.height)
        if touch and last:
            x=max(8,min(632-obj.width,last[0]+rng.randint(-90,100)))
            y=max(8,min(632-obj.height,last[1]+rng.randint(-90,100)))
        last=(x,y)
        mask=Image.new('L',(640,640));mask.paste(obj.getchannel('A'),(x,y))
        if rng.random()<.65:
            shadow=Image.new('L',(640,640));shadow.paste(obj.getchannel('A'),(x+12,y+14))
            layer=Image.new('RGBA',(640,640));layer.putalpha(shadow.filter(ImageFilter.GaussianBlur(rng.uniform(4,14))).point(lambda p:int(p*.4)))
            scene=Image.alpha_composite(scene,layer)
        opaque=np.asarray(mask)>100
        visible=[(old & ~opaque,key,original) for old,key,original in visible]
        visible.append((opaque,source['id'],max(1,opaque.sum())))
        scene.alpha_composite(obj,(x,y))
        if rng.random()<.18:
            glare=Image.new('RGBA',(640,640));stripe=ImageDraw.Draw(glare)
            stripe.polygon([(x,y+obj.height*.3),(x+obj.width,y+obj.height*.4),(x+obj.width,y+obj.height*.5),(x,y+obj.height*.4)],fill=(255,255,255,110))
            scene=Image.alpha_composite(scene,glare)
    # Non-product clutter in empty scenes: geometric skin-colour fragments.
    if count==0 and rng.random()<.7:
        draw=ImageDraw.Draw(scene)
        x,y=rng.randint(0,400),rng.randint(0,400)
        draw.rounded_rectangle((x,y,x+100,y+180),radius=35,fill=(195,142,113,255))
    annotations=[]
    for mask,key,original in visible:
        ys,xs=np.where(mask)
        if len(xs)<300 or len(xs)/original<.35:
            # Heavily hidden objects remain present but are omitted only if tiny.
            # Entirely hidden instances are not countable from pixels.
            if len(xs)>=100:
                return None
            continue
        x1,y1,x2,y2=int(xs.min()),int(ys.min()),int(xs.max()+1),int(ys.max()+1)
        annotations.append((key,[x1,y1,x2,y2]))
    scene=scene.convert('RGB')
    if rng.random()<.2:
        scene=scene.filter(ImageFilter.GaussianBlur(rng.uniform(.3,1.4)))
    return scene,annotations


def main():
    rng=random.Random(SEED)
    catalog=json.loads((DATA/'products.json').read_text(encoding='utf-8'))
    reserved=json.loads((DATA/'multiframe-expanded/manifest.json').read_text(encoding='utf-8'))['products']
    frozen=json.loads((DATA/'benchmark/references.json').read_text(encoding='utf-8'))
    blocked_files={p[k] for p in reserved for k in ('referenceFile','queryFile')}|{p['image_file'] for p in frozen}
    blocked_hashes={hashlib.sha256((DATA/file).read_bytes()).hexdigest() for file in blocked_files}
    # Keep visually similar and normalized-name families in one split.
    candidates=list(catalog);rng.shuffle(candidates)
    sources=[];hashes=set();category_count=Counter();families=[];seen_names=set()
    for product in candidates:
        if len(sources)>=160:
            break
        if not product.get('image_file') or re.search(r'pack\s*(of|\()|\bx\s*\d+|tiger|innovative|mahmood',product['name'],re.I):
            continue
        normalized_name=re.sub(r'[^a-z0-9]','',product['name'].lower())
        if normalized_name in seen_names:
            continue
        path=DATA/product['image_file']
        if not path.exists():
            continue
        digest=hashlib.sha256(path.read_bytes()).hexdigest()
        if digest in hashes or digest in blocked_hashes:
            continue
        category=' / '.join(product.get('category_names',[]))
        if category_count[category]>=10:
            continue
        try:
            image,dhash=sprite(path)
        except (ValueError,OSError):
            continue
        # Reject near-duplicate source silhouettes rather than distributing them.
        if any((int(dhash,16)^int(old,16)).bit_count()<=6 for old in families):
            continue
        hashes.add(digest);families.append(dhash);category_count[category]+=1;seen_names.add(normalized_name)
        sources.append({'id':product['id'],'name':product['name'],'file':product['image_file'],'sha256':digest,'dhash':dhash,'category':category,'sprite':image})
    if len(sources)<120:
        raise ValueError(f'Only {len(sources)} suitable independent sources; inspect filtering.')
    rng.shuffle(sources)
    pools={'train':sources[:100],'val':sources[100:130],'test':sources[130:]}
    assert all(pools.values())
    splits={'train':600,'val':120,'test':180}
    manifest={'seed':SEED,'kind':'synthetic_bootstrap_only','class':'retail_product','excluded_prior_test_sources':len(blocked_hashes),'sources':{},'scenes':{},'limitations':'Pseudo boxes from catalog foreground masks. Source-disjoint synthetic splits, not physical checkout validation. No SKU classifier training.'}
    for split,pool in pools.items():
        manifest['sources'][split]=[{k:v for k,v in p.items() if k!='sprite'} for p in pool]
        images=OUT/'images'/split;labels=OUT/'labels'/split
        images.mkdir(parents=True,exist_ok=True);labels.mkdir(parents=True,exist_ok=True)
        scenes=[]
        for i in range(splits[split]):
            generated=None
            while generated is None:
                generated=make_scene(pool,rng)
            image,annotations=generated
            name=f'{split}-{i:04d}'
            image.save(images/(name+'.jpg'),quality=rng.randint(70,94))
            rows=[]
            for key,(x1,y1,x2,y2) in annotations:
                rows.append(f'0 {(x1+x2)/1280:.7f} {(y1+y2)/1280:.7f} {(x2-x1)/640:.7f} {(y2-y1)/640:.7f}')
            (labels/(name+'.txt')).write_text('\n'.join(rows)+ ('\n' if rows else ''),encoding='utf-8')
            scenes.append({'file':name+'.jpg','objects':[{'sourceId':key,'box':box} for key,box in annotations]})
        manifest['scenes'][split]=scenes
        print(json.dumps({'split':split,'images':len(scenes),'sources':len(pool),'instances':sum(len(s['objects']) for s in scenes)}),flush=True)
    # Source hashes must be disjoint across splits and the previous stress tests.
    for split,pool in pools.items():
        others={p['sha256'] for k,v in pools.items() if k!=split for p in v}
        assert not ({p['sha256'] for p in pool}&(others|blocked_hashes))
    OUT.mkdir(parents=True,exist_ok=True)
    (OUT/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
    (OUT/'data.yaml').write_text(f'path: {OUT.as_posix()}\ntrain: images/train\nval: images/val\ntest: images/test\nnames:\n  0: retail_product\n',encoding='utf-8')
    print(json.dumps({'dataset':str(OUT),'total_sources':len(sources),'images':sum(splits.values())}),flush=True)


if __name__=='__main__':
    main()

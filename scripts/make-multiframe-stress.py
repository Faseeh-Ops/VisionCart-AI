"""Deterministic stress fixtures from existing camera photos; not physical captures."""
import hashlib
import json
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageEnhance

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'datasets/retail-catalog/multiframe-stress'
OUT.mkdir(parents=True, exist_ok=True)
SOURCES = {
    'tiger': ('tiger.jpeg', [(295,35),(747,35),(705,200),(700,1170),(750,1279),(350,1279),(365,1190),(355,210)]),
    'innovative': ('innovita.jpeg', [(105,0),(715,0),(662,210),(656,810),(715,1279),(185,1279),(173,1000),(167,330)]),
    'mahmood': ('mehmood.jpeg', [(260,270),(785,250),(820,340),(790,1040),(847,1245),(203,1160),(230,1035),(236,420)]),
}
sprites, provenance = {}, {}
for key, (filename, polygon) in SOURCES.items():
    path = ROOT / 'models/product-pilot/images' / filename
    image = Image.open(path).convert('RGBA')
    mask = Image.new('L', image.size)
    ImageDraw.Draw(mask).polygon(polygon, fill=255)
    image.putalpha(mask)
    image = image.crop(mask.getbbox())
    sprites[key] = image
    provenance[key] = {'file': str(path.relative_to(ROOT)), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'mask_polygon': polygon}

rng = np.random.default_rng(419)
pixels = np.zeros((480, 640, 3), dtype=np.uint8)
for y in range(480):
    shade = int(8*np.sin(y/13))
    pixels[y] = np.clip(np.array([174,156,130])+shade+rng.integers(-3,4,(640,3)),0,255)
background = Image.fromarray(pixels)
manifest = {'kind': 'simulated_stress_test', 'physical_camera_capture': False,
            'independent_query_photos': False,
            'source_note': 'Manually masked camera-photo packets reused with transforms. Some catalog references may use these same source photos. No checkout accuracy claim.',
            'sources': provenance, 'cases': []}


def fixture(name, keys, *, layout='spaced', angles=None, shadow=False, glare=False, blur=False, exposure=1, shift=0, hand=False):
    scene = background.copy().convert('RGBA')
    if shift:
        scene = Image.fromarray(np.roll(pixels, shift, axis=1)).convert('RGBA')
    truth = []
    n = len(keys)
    for i, key in enumerate(keys):
        w = 105 if n==5 else 145
        h = 310
        if angles:
            w, h = 115, 270
        obj = sprites[key].resize((w,h), Image.Resampling.LANCZOS)
        if angles:
            obj = obj.rotate(angles[i], resample=Image.Resampling.BICUBIC, expand=True)
        x = (18+i*125) if n==5 else (45+i*205)
        y = 75
        if layout=='touching':
            # Slight intersecting boundaries ensure true foreground contact.
            x = 80+i*(w-12)
        if layout=='overlap':
            x = 110+i*70
            y = 55+i*35
        if shadow:
            layer = Image.new('RGBA', scene.size)
            alpha = Image.new('L', scene.size)
            alpha.paste(obj.getchannel('A'),(x+25,y+20))
            alpha = alpha.filter(ImageFilter.GaussianBlur(18)).point(lambda p:int(p*.55))
            layer.putalpha(alpha)
            scene = Image.alpha_composite(scene,layer)
        scene.alpha_composite(obj,(x,y))
        truth.append({'key':key,'box':[x,y,x+obj.width,y+obj.height]})
    if hand:
        # A real skin/background fragment from the source photo, no packet pixels.
        fragment = Image.open(ROOT/'models/product-pilot/images/tiger.jpeg').convert('RGBA').crop((0,0,290,1000))
        alpha = Image.new('L',fragment.size)
        ImageDraw.Draw(alpha).polygon([(0,0),(280,20),(285,950),(200,980),(100,850),(0,650)],fill=255)
        fragment.putalpha(alpha)
        scene.alpha_composite(fragment.resize((90,310),Image.Resampling.LANCZOS),(260,75))
    if glare:
        layer = Image.new('RGBA', scene.size)
        draw = ImageDraw.Draw(layer)
        for item in truth:
            x1,y1,x2,y2=item['box']
            draw.polygon([(x1,y1+60),(x2,y1+110),(x2,y1+150),(x1,y1+100)], fill=(255,255,255,215))
        scene = Image.alpha_composite(scene,layer)
    scene = scene.convert('RGB')
    if exposure!=1:
        scene = ImageEnhance.Brightness(scene).enhance(exposure)
    if blur:
        scene = scene.filter(ImageFilter.GaussianBlur(2))
    path = OUT / (name+'.jpg')
    scene.save(path,quality=55 if blur else 86)
    manifest['cases'].append({'name':name,'photo':path.name,'background':'empty-counter.jpg','truth':truth,
                              'conditions':{'layout':layout,'angles':angles,'shadow':shadow,'glare':glare,'blur':blur,'exposure':exposure,'background_shift_px':shift,'non_product_hand_fragment':hand}})


background.save(OUT/'empty-counter.jpg',quality=86)
three=['tiger','innovative','mahmood']
fixture('empty-counter',[])
fixture('three-separated',three)
fixture('five-separated',['tiger','innovative','mahmood','tiger','innovative'])
fixture('three-rotated',three,angles=[-12,15,-9])
fixture('three-cast-shadows',three,shadow=True)
fixture('three-glare',three,glare=True)
fixture('three-blur-low-quality',three,blur=True)
fixture('three-exposure-shift',three,exposure=1.10)
fixture('three-touching',three,layout='touching')
fixture('three-overlapping',three,layout='overlap')
fixture('three-shadow-and-glare',three,shadow=True,glare=True)
fixture('empty-camera-shift',[],shift=8)
fixture('empty-with-hand-fragment',[],hand=True)
(OUT/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps({'output':str(OUT),'cases':len(manifest['cases']),'physical_capture':False}))

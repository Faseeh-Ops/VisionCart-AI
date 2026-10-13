"""Initial inference experiment, not training or independent accuracy evaluation."""
import json
import os
from pathlib import Path
os.environ.setdefault('YOLO_CONFIG_DIR', str(Path(__file__).resolve().parent / '.ultralytics'))
import torch
from PIL import Image
from transformers import AutoModel, AutoProcessor
from ultralytics import YOLO

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
PRODUCTS = [
    {'key': 'mehmood', 'name': 'Mahmood Cappuccino Classic coffee 25 g', 'price': 250, 'barcode': '8697449918281'},
    {'key': 'innovita', 'name': 'Innovative Choc n Chip biscuits', 'price': 10, 'barcode': '8965310043173'},
    {'key': 'tiger', 'name': 'LU Tiger biscuits', 'price': 10, 'barcode': '8961003694271'},
]

def main():
    torch.set_num_threads(4)
    detector = YOLO(str(ROOT / 'models/detector/yolo26n.pt'))
    processor = AutoProcessor.from_pretrained(str(ROOT / 'models/siglip2'), local_files_only=True)
    model = AutoModel.from_pretrained(str(ROOT / 'models/siglip2'), local_files_only=True).eval()
    images = [Image.open(HERE / 'images' / (p['key'] + '.jpeg')).convert('RGB') for p in PRODUCTS]
    descriptions = [
        'A photo of a Mahmood Cappuccino Classic instant coffee sachet with black orange white and green packaging.',
        'A photo of Innovative Choc n Chip chocolate chip cookies in a blue biscuit packet.',
        'A photo of LU Tiger biscuits in a red and yellow packet.',
        'A photo of a computer keyboard.',
        'A photo of an empty wooden desk.',
    ]
    with torch.inference_mode():
        inputs = processor(images=images, text=descriptions, padding='max_length', return_tensors='pt')
        scores = model(**inputs).logits_per_image.tolist()
    results = []
    for product, image, row in zip(PRODUCTS, images, scores):
        detected = detector.predict(image, device='cpu', conf=0.25, verbose=False)[0]
        boxes = [{'class': detected.names[int(b.cls.item())], 'score': float(b.conf.item()), 'xyxy': b.xyxy[0].tolist()} for b in detected.boxes]
        ranked = sorted(zip(descriptions, row), key=lambda pair: pair[1], reverse=True)
        results.append({**product, 'yolo_detections': boxes, 'siglip_text_ranking': [{'description': text, 'raw_logit': score} for text, score in ranked]})
        print(product['key'], 'YOLO:', [b['class'] for b in boxes], 'SigLIP top:', ranked[0][0], flush=True)
    (HERE / 'model-results.json').write_text(json.dumps({'method': 'Full supplied front images ranked against five hand-written descriptions. Raw logits are not confidence percentages. No independent photos or training.', 'products': results}, indent=2), encoding='utf-8')

if __name__ == '__main__':
    main()

"""Local persistent image encoder. JSON-lines protocol; model output stays on stderr."""
import base64
import contextlib
import io
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['TRANSFORMERS_OFFLINE'] = '1'
os.environ['YOLO_CONFIG_DIR'] = str(ROOT / '.tools/ai-runtime')
Path(os.environ['YOLO_CONFIG_DIR']).mkdir(parents=True, exist_ok=True)
ImageModel = Processor = Detector = None


def load():
    global ImageModel, Processor, Detector
    import torch
    from transformers import AutoModel, AutoProcessor
    from ultralytics import YOLO
    torch.set_num_threads(4)
    Processor = AutoProcessor.from_pretrained(str(ROOT / 'models/siglip2'), local_files_only=True)
    ImageModel = AutoModel.from_pretrained(str(ROOT / 'models/siglip2'), local_files_only=True).eval()
    # This service only uses image features; release the unused text tower.
    ImageModel.text_model = None
    Detector = YOLO(str(ROOT / 'models/detector/yolo26n.pt'))


def read_photo(photo):
    from PIL import Image, ImageOps
    Image.MAX_IMAGE_PIXELS = 12_000_000
    raw = base64.b64decode(photo.split(',', 1)[1], validate=True)
    if len(raw) > 256 * 1024:
        raise ValueError('Use an image smaller than 256 KB.')
    with Image.open(io.BytesIO(raw)) as source:
        if source.width * source.height > 12_000_000:
            raise ValueError('Image dimensions are too large.')
        return ImageOps.exif_transpose(source).convert('RGB')


def image_vectors(images):
    import torch
    import torch.nn.functional as F
    inputs = Processor(images=images, return_tensors='pt')
    with torch.inference_mode():
        output = ImageModel.get_image_features(**inputs)
        pooled = output if isinstance(output, torch.Tensor) else output.pooler_output
        return F.normalize(pooled, dim=-1).tolist()


def encode(photo, mode='single', background_photo=None, purpose='query'):
    from scene_regions import product_regions, SceneError
    image = read_photo(photo)
    if mode == 'multiple':
        if not background_photo:
            raise SceneError('Clear the counter and set the empty scan area before scanning multiple products.')
        boxes = product_regions(image, read_photo(background_photo))
        crops = [image.crop(box) for box in boxes]
        vectors = image_vectors(crops) if crops else []
        regions = []
        for box, crop, vector in zip(boxes, crops, vectors):
            preview = crop.copy()
            preview.thumbnail((160, 160))
            stream = io.BytesIO()
            preview.save(stream, format='JPEG', quality=75)
            regions.append({'box': box, 'embedding': vector, 'photo': 'data:image/jpeg;base64,' + base64.b64encode(stream.getvalue()).decode()})
        return {'regions': regions, 'imageSize': list(image.size), 'model': 'siglip2-base-patch16-224:image-v1',
                'localization': 'separated_counter_products', 'detector': 'calibrated_background_components', 'detections': []}
    if purpose == 'reference':
        return {'embedding': image_vectors([image])[0], 'model': 'siglip2-base-patch16-224:image-v1',
                'localization': 'reference_image', 'detector': 'not_used', 'detections': []}
    detection = Detector.predict(image, device='cpu', conf=.25, imgsz=640, verbose=False)[0]
    boxes = [{'label': detection.names[int(b.cls.item())], 'score': float(b.conf.item()), 'xyxy': b.xyxy[0].tolist()} for b in detection.boxes]
    width, height = image.size
    margin_x, margin_y = round(width * .07), round(height * .07)
    focused = image.crop((margin_x, margin_y, width - margin_x, height - margin_y))
    vectors = image_vectors([focused, image])
    return {'embedding': vectors[0], 'embeddings': vectors, 'model': 'siglip2-base-patch16-224:image-v1', 'localization': 'focused_and_full_image', 'detector': 'yolo26n', 'detections': boxes}


def main():
    try:
        with contextlib.redirect_stdout(sys.stderr):
            load()
        print(json.dumps({'ready': True}), flush=True)
    except Exception:
        print(json.dumps({'fatal': 'Local AI models could not load. Check the AI Python environment and downloaded weights.'}), flush=True)
        return
    for line in sys.stdin:
        request = {}
        try:
            request = json.loads(line)
            with contextlib.redirect_stdout(sys.stderr):
                result = encode(request['photo'], request.get('mode', 'single'), request.get('backgroundPhoto'), request.get('purpose', 'query'))
            print(json.dumps({'id': request['id'], 'result': result}), flush=True)
        except Exception as error:
            from scene_regions import SceneError
            if isinstance(error, SceneError):
                print(json.dumps({'id': request.get('id'), 'error': str(error)}), flush=True)
                continue
            print(json.dumps({'id': request.get('id'), 'error': 'The AI model could not read this image. Use a clear JPEG, PNG or WebP product photo.'}), flush=True)


if __name__ == '__main__':
    main()

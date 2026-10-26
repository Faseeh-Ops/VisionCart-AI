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
Device = 'cpu'


def load():
    global ImageModel, Processor, Detector, Device
    # Load camera-alignment dependencies during server warm-up so the first
    # checkout frame does not pay their import cost.
    import cv2
    import numpy
    import torch
    from transformers import AutoModel, AutoProcessor
    torch.set_num_threads(max(1, min(8, os.cpu_count() or 4)))
    Device = 'cuda' if torch.cuda.is_available() else 'cpu'
    Processor = AutoProcessor.from_pretrained(str(ROOT / 'models/siglip2'), local_files_only=True)
    ImageModel = AutoModel.from_pretrained(str(ROOT / 'models/siglip2'), local_files_only=True).eval().to(Device)
    # This service only uses image features; release the unused text tower.
    ImageModel.text_model = None
    # The generic detector does not improve single-pack identity matching, so it
    # is opt-in. This avoids adding a second CPU inference to every checkout scan.
    if os.environ.get('AI_ENABLE_YOLO') == '1':
        from ultralytics import YOLO
        Detector = YOLO(str(ROOT / 'models/detector/yolo26n.pt'))
    # Exercise OpenCV's lazy initialization before advertising readiness.
    import numpy as np
    from PIL import Image
    rng = np.random.default_rng(1)
    warm_frame = Image.fromarray(rng.integers(70, 190, (240, 320, 3), dtype=np.uint8))
    background_change(warm_frame, warm_frame)


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
    inputs = {key: value.to(Device) for key, value in Processor(images=images, return_tensors='pt').items()}
    with torch.inference_mode():
        output = ImageModel.get_image_features(**inputs)
        pooled = output if isinstance(output, torch.Tensor) else output.pooler_output
        return F.normalize(pooled, dim=-1).cpu().tolist()


def background_change(image, background):
    """Align a moving camera to its empty scene, then measure real foreground."""
    import cv2
    import numpy as np
    size = (320, 240)
    current = np.asarray(image.resize(size), dtype=np.uint8)
    empty = np.asarray(background.resize(size), dtype=np.uint8)
    gray_current = cv2.cvtColor(current, cv2.COLOR_RGB2GRAY)
    gray_empty = cv2.cvtColor(empty, cv2.COLOR_RGB2GRAY)
    aligned, valid, alignment = empty, np.full((size[1], size[0]), 255, np.uint8), False
    detector = cv2.ORB_create(nfeatures=900, fastThreshold=8)
    points_empty, descriptors_empty = detector.detectAndCompute(gray_empty, None)
    points_current, descriptors_current = detector.detectAndCompute(gray_current, None)
    if descriptors_empty is not None and descriptors_current is not None:
        pairs = cv2.BFMatcher(cv2.NORM_HAMMING).knnMatch(descriptors_empty, descriptors_current, k=2)
        matches = [pair[0] for pair in pairs if len(pair) == 2 and pair[0].distance < .75 * pair[1].distance]
        if len(matches) >= 12:
            source = np.float32([points_empty[item.queryIdx].pt for item in matches]).reshape(-1, 1, 2)
            target = np.float32([points_current[item.trainIdx].pt for item in matches]).reshape(-1, 1, 2)
            transform, inliers = cv2.findHomography(source, target, cv2.RANSAC, 3.0)
            if transform is not None and inliers is not None and int(inliers.sum()) >= 8:
                aligned = cv2.warpPerspective(empty, transform, size, flags=cv2.INTER_LINEAR)
                valid = cv2.warpPerspective(np.full_like(gray_empty, 255), transform, size, flags=cv2.INTER_NEAREST)
                alignment = True
    usable = valid > 0
    delta = current.astype(np.float32) - aligned.astype(np.float32)
    if usable.any():
        delta -= np.median(delta[usable], axis=0)
    difference = np.abs(delta).mean(axis=2)
    mask = np.uint8((difference > 22) & usable) * 255
    kernel = np.ones((3, 3), np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8))
    count, _, stats, _ = cv2.connectedComponentsWithStats(mask)
    usable_area = max(1, int(usable.sum()))
    largest = max((int(stats[index, cv2.CC_STAT_AREA]) for index in range(1, count)), default=0)
    foreground = int(cv2.countNonZero(mask))
    largest_ratio, foreground_ratio = largest / usable_area, foreground / usable_area
    return {'changed': largest_ratio >= .006 or foreground_ratio >= .015,
            'largestRatio': largest_ratio, 'foregroundRatio': foreground_ratio,
            'aligned': alignment}


def cosine(left, right):
    return sum(a * b for a, b in zip(left, right))


def encode(photo, mode='single', background_photo=None, purpose='query'):
    from scene_regions import product_regions, SceneError
    image = read_photo(photo)
    background = read_photo(background_photo) if background_photo else None
    if mode == 'multiple':
        if not background_photo:
            raise SceneError('Clear the counter and set the empty scan area before scanning multiple products.')
        boxes = product_regions(image, background)
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
    change = background_change(image, background) if background is not None else None
    scene_changed = change['changed'] if change is not None else None
    if scene_changed is False:
        return {'model': 'siglip2-base-patch16-224:image-v1', 'localization': 'empty_background',
                'detector': 'aligned_background_comparison', 'detections': [], 'sceneChanged': False,
                'foregroundRatio': change['foregroundRatio'], 'largestForegroundRatio': change['largestRatio'],
                'backgroundAligned': change['aligned']}
    boxes = []
    if Detector is not None:
        detection = Detector.predict(image, device=0 if Device == 'cuda' else 'cpu', conf=.25, imgsz=640, verbose=False)[0]
        boxes = [{'label': detection.names[int(b.cls.item())], 'score': float(b.conf.item()), 'xyxy': b.xyxy[0].tolist()} for b in detection.boxes]
    width, height = image.size
    # DroidCam commonly letterboxes the feed. Use the center where checkout
    # products are placed and exclude borders/watermarks from recognition.
    margin_x, margin_y = round(width * .12), round(height * .12)
    focused = image.crop((margin_x, margin_y, width - margin_x, height - margin_y))
    inputs = [focused]
    if background is not None:
        bg_width, bg_height = background.size
        bg_margin_x, bg_margin_y = round(bg_width * .12), round(bg_height * .12)
        inputs.append(background.crop((bg_margin_x, bg_margin_y, bg_width - bg_margin_x, bg_height - bg_margin_y)))
    vectors = image_vectors(inputs)
    background_similarity = None
    if background is not None:
        background_similarity = cosine(vectors[0], vectors[1])
    return {'embedding': vectors[0], 'embeddings': [vectors[0]], 'model': 'siglip2-base-patch16-224:image-v1', 'localization': 'focused_product_view', 'detector': 'yolo26n' if Detector is not None else 'aligned_background_and_siglip', 'detections': boxes, 'sceneChanged': scene_changed, 'backgroundSimilarity': background_similarity,
            'foregroundRatio': change['foregroundRatio'] if change else None,
            'largestForegroundRatio': change['largestRatio'] if change else None,
            'backgroundAligned': change['aligned'] if change else False}


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

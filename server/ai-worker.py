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
DetectorMode = 'off'
DetectorName = None


def load():
    global ImageModel, Processor, Detector, Device, DetectorMode, DetectorName
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
    # The detector is a reversible experiment. "custom" uses the locally trained
    # retail-product checkpoint; "generic" preserves the older diagnostic model.
    legacy_enabled = os.environ.get('AI_ENABLE_YOLO') == '1'
    DetectorMode = os.environ.get('AI_YOLO_MODE', 'generic' if legacy_enabled else 'off').strip().lower()
    if DetectorMode not in {'off', 'custom', 'generic'}:
        DetectorMode = 'off'
    if DetectorMode != 'off':
        from ultralytics import YOLO
        detector_path = (ROOT / ('models/retail-detector/candidate.pt'
                                  if DetectorMode == 'custom' else 'models/detector/yolo26n.pt'))
        if detector_path.exists():
            Detector = YOLO(str(detector_path))
            DetectorName = detector_path.name
        else:
            DetectorMode = 'off'
    # Exercise OpenCV's lazy initialization before advertising readiness.
    import numpy as np
    from PIL import Image
    rng = np.random.default_rng(1)
    warm_frame = Image.fromarray(rng.integers(70, 190, (240, 320, 3), dtype=np.uint8))
    background_change(warm_frame, warm_frame)
    if Detector is not None:
        Detector.predict(warm_frame, device=0 if Device == 'cuda' else 'cpu',
                         conf=float(os.environ.get('AI_YOLO_CONFIDENCE', '.35')),
                         imgsz=int(os.environ.get('AI_YOLO_IMAGE_SIZE', '512')),
                         max_det=10, half=Device == 'cuda', verbose=False)


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


def detect_products(image):
    """Run one detector pass and return clipped, useful product boxes."""
    if Detector is None:
        return []
    result = Detector.predict(
        image,
        device=0 if Device == 'cuda' else 'cpu',
        conf=float(os.environ.get('AI_YOLO_CONFIDENCE', '.35')),
        imgsz=int(os.environ.get('AI_YOLO_IMAGE_SIZE', '512')),
        max_det=10,
        half=Device == 'cuda',
        verbose=False
    )[0]
    width, height = image.size
    minimum_area = width * height * .003
    detections = []
    for item in result.boxes:
        x1, y1, x2, y2 = item.xyxy[0].tolist()
        x1, y1 = max(0, int(x1)), max(0, int(y1))
        x2, y2 = min(width, int(x2)), min(height, int(y2))
        if x2 <= x1 or y2 <= y1 or (x2-x1) * (y2-y1) < minimum_area:
            continue
        class_id = int(item.cls.item())
        names = result.names
        label = names.get(class_id, str(class_id)) if isinstance(names, dict) else names[class_id]
        detections.append({'label': label, 'score': float(item.conf.item()),
                           'xyxy': [x1, y1, x2, y2]})
    return sorted(detections, key=lambda item: item['score'], reverse=True)


def padded_crop(image, box, padding=.035):
    width, height = image.size
    x1, y1, x2, y2 = box
    pad_x, pad_y = round((x2-x1) * padding), round((y2-y1) * padding)
    return image.crop((max(0, x1-pad_x), max(0, y1-pad_y),
                       min(width, x2+pad_x), min(height, y2+pad_y)))


def encode(photo, mode='single', background_photo=None, purpose='query'):
    from scene_regions import product_regions, SceneError
    image = read_photo(photo)
    background = read_photo(background_photo) if background_photo else None
    if mode == 'multiple':
        if not background_photo:
            raise SceneError('Clear the counter and set the empty scan area before scanning multiple products.')
        change = background_change(image, background)
        width, height = image.size
        margin_x, margin_y = round(width * .12), round(height * .12)
        bg_width, bg_height = background.size
        bg_margin_x, bg_margin_y = round(bg_width * .12), round(bg_height * .12)
        scene_vectors = image_vectors([
            image.crop((margin_x, margin_y, width-margin_x, height-margin_y)),
            background.crop((bg_margin_x, bg_margin_y, bg_width-bg_margin_x, bg_height-bg_margin_y))
        ])
        background_similarity = cosine(scene_vectors[0], scene_vectors[1])
        strong_background_limit = float(os.environ.get('AI_STRONG_BACKGROUND_SIMILARITY', '.82'))
        if background_similarity >= strong_background_limit:
            return {'regions': [], 'imageSize': list(image.size),
                    'model': 'siglip2-base-patch16-224:image-v1',
                    'localization': 'separated_counter_products',
                    'detector': 'semantic_empty_counter', 'detections': [],
                    'sceneChanged': False, 'backgroundSimilarity': background_similarity,
                    'foregroundRatio': change['foregroundRatio'],
                    'largestForegroundRatio': change['largestRatio'],
                    'backgroundAligned': change['aligned']}
        if change['changed'] is False:
            return {'regions': [], 'imageSize': list(image.size),
                    'model': 'siglip2-base-patch16-224:image-v1',
                    'localization': 'separated_counter_products',
                    'detector': 'aligned_background_components', 'detections': [],
                    'sceneChanged': False, 'backgroundSimilarity': background_similarity,
                    'foregroundRatio': change['foregroundRatio'],
                    'largestForegroundRatio': change['largestRatio'],
                    'backgroundAligned': change['aligned']}
        detections = detect_products(image) if DetectorMode == 'custom' else []
        edge_margin = max(3, round(min(image.size) * .008))
        complete_detections = [item for item in detections if item['xyxy'][0] > edge_margin and item['xyxy'][1] > edge_margin and item['xyxy'][2] < image.size[0]-edge_margin and item['xyxy'][3] < image.size[1]-edge_margin]
        skipped_edge_regions = len(detections)-len(complete_detections)
        detections = complete_detections
        boxes = [item['xyxy'] for item in detections]
        localization = 'custom_yolo_product_regions'
        detector_name = f'custom_yolo:{DetectorName}'
        if not boxes:
            boxes, region_details = product_regions(image, background, allow_partial=True, return_details=True)
            skipped_edge_regions += region_details['skippedEdgeRegions']
            localization = 'separated_counter_products'
            detector_name = 'calibrated_background_components_fallback' if DetectorMode == 'custom' else 'calibrated_background_components'
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
                'localization': localization, 'detector': detector_name, 'detections': detections,
                'sceneChanged': True, 'backgroundSimilarity': background_similarity,
                'foregroundRatio': change['foregroundRatio'], 'largestForegroundRatio': change['largestRatio'],
                'backgroundAligned': change['aligned'], 'skippedEdgeRegions': skipped_edge_regions}
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
    detections = detect_products(image) if Detector is not None else []
    width, height = image.size
    # DroidCam commonly letterboxes the feed. Use the center where checkout
    # products are placed and exclude borders/watermarks from recognition.
    margin_x, margin_y = round(width * .12), round(height * .12)
    focused = image.crop((margin_x, margin_y, width - margin_x, height - margin_y))
    query_images = []
    # For the custom retail checkpoint, let SigLIP compare both the localized
    # product and the established center view. Ranking uses the best score, so a
    # missed or imperfect crop cannot remove the previous recognition signal.
    if DetectorMode == 'custom' and detections:
        query_images.append(padded_crop(image, detections[0]['xyxy']))
    query_images.append(focused)
    inputs = list(query_images)
    if background is not None:
        bg_width, bg_height = background.size
        bg_margin_x, bg_margin_y = round(bg_width * .12), round(bg_height * .12)
        inputs.append(background.crop((bg_margin_x, bg_margin_y, bg_width - bg_margin_x, bg_height - bg_margin_y)))
    vectors = image_vectors(inputs)
    query_vectors = vectors[:len(query_images)]
    background_similarity = None
    if background is not None:
        background_similarity = cosine(query_vectors[-1], vectors[-1])
    localization = 'custom_yolo_crop_with_focused_fallback' if DetectorMode == 'custom' and detections else 'focused_product_view'
    detector_name = f'{DetectorMode}_yolo:{DetectorName}' if Detector is not None else 'aligned_background_and_siglip'
    return {'embedding': query_vectors[0], 'embeddings': query_vectors, 'model': 'siglip2-base-patch16-224:image-v1', 'localization': localization, 'detector': detector_name, 'detections': detections, 'sceneChanged': scene_changed, 'backgroundSimilarity': background_similarity,
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

"""Resumable batch SigLIP indexing of local packshots; no training or downloads."""
import base64
import contextlib
import hashlib
import io
import json
import os
from pathlib import Path
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'datasets/retail-catalog'
OUT = DATA / 'library-import'
MODEL = 'siglip2-base-patch16-224:image-v1'
os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['TRANSFORMERS_OFFLINE'] = '1'


def emit(value):
    print(json.dumps(value), flush=True)


def prepare(file):
    from PIL import Image, ImageOps, ImageStat
    target = (DATA / file).resolve()
    target.relative_to(DATA.resolve())
    with Image.open(target) as source:
        if source.width * source.height > 12_000_000 or min(source.size) < 32:
            raise ValueError('invalid_image_dimensions')
        image = ImageOps.exif_transpose(source).convert('RGBA')
        white = Image.new('RGBA', image.size, 'white')
        white.alpha_composite(image)
        image = white.convert('RGB')
    stats = ImageStat.Stat(image.resize((64, 64)))
    if max(stats.stddev) < 2:
        raise ValueError('blank_or_uniform_photo')
    image.thumbnail((640, 640))
    raw = io.BytesIO()
    image.save(raw, format='JPEG', quality=88)
    if len(raw.getvalue()) > 256 * 1024:
        raw = io.BytesIO()
        image.save(raw, format='JPEG', quality=65)
    if len(raw.getvalue()) > 256 * 1024:
        raise ValueError('photo_too_large')
    photo = 'data:image/jpeg;base64,' + base64.b64encode(raw.getvalue()).decode('ascii')
    # Match the live worker: encode the decoded JPEG stored as the reference.
    from PIL import Image
    decoded = Image.open(io.BytesIO(raw.getvalue())).convert('RGB')
    digest = hashlib.sha256(photo.encode()).hexdigest()
    return decoded, photo, digest


def main():
    import torch
    import torch.nn.functional as F
    from transformers import AutoModel, AutoProcessor
    torch.set_num_threads(4)
    torch.set_num_interop_threads(1)
    cache = OUT / 'cache'
    cache.mkdir(parents=True, exist_ok=True)
    plan = json.loads((OUT / 'plan.json').read_text(encoding='utf-8'))
    tasks = plan['photos']
    emit({'type': 'loading', 'photos': len(tasks)})
    with contextlib.redirect_stdout(sys.stderr):
        processor = AutoProcessor.from_pretrained(str(ROOT / 'models/siglip2'), local_files_only=True)
        model = AutoModel.from_pretrained(str(ROOT / 'models/siglip2'), local_files_only=True).eval()
        model.text_model = None
    # Measure thread counts on mixed-core CPUs without changing model weights.
    from PIL import Image
    sample = processor(images=[Image.new('RGB', (224, 224), 'white')] * 8, return_tensors='pt')
    timings = {}
    with torch.inference_mode(), contextlib.redirect_stdout(sys.stderr):
        model.get_image_features(**sample)
        for threads in [4, 8, 12]:
            if threads > (os.cpu_count() or 4):
                continue
            torch.set_num_threads(threads)
            begin = time.monotonic()
            model.get_image_features(**sample)
            timings[threads] = time.monotonic() - begin
    chosen = min(timings, key=timings.get)
    torch.set_num_threads(chosen)
    del sample
    emit({'type': 'cpu', 'threads': chosen, 'batch8Seconds': timings})
    batch, completed, started = [], 0, time.monotonic()

    def flush():
        nonlocal batch, completed
        if not batch:
            return
        with contextlib.redirect_stdout(sys.stderr), torch.inference_mode():
            inputs = processor(images=[row[1] for row in batch], return_tensors='pt')
            output = model.get_image_features(**inputs)
            pooled = output if isinstance(output, torch.Tensor) else output.pooler_output
            vectors = F.normalize(pooled, dim=-1).cpu().tolist()
        files = []
        for (task, image, photo, digest), embedding in zip(batch, vectors):
            if len(embedding) != 768 or abs(sum(v*v for v in embedding) - 1) > .01:
                raise ValueError('Invalid reference embedding')
            target = cache / (digest + '.json')
            temp = target.with_suffix('.tmp')
            temp.write_text(json.dumps({'model': MODEL, 'hash': digest, 'photo': photo, 'embedding': embedding}), encoding='utf-8')
            temp.replace(target)
            files.append({'key': task['key'], 'sourceId': task['sourceId'], 'cache': str(target)})
            image.close()
        completed += len(batch)
        emit({'type': 'batch', 'files': files, 'completed': completed, 'total': len(tasks), 'elapsed': round(time.monotonic()-started, 1)})
        batch = []

    for task in tasks:
        try:
            image, photo, digest = prepare(task['file'])
        except Exception as error:
            completed += 1
            emit({'type': 'skipped', 'sourceId': task['sourceId'], 'reason': str(error)[:150], 'completed': completed})
            continue
        cached = cache / (digest + '.json')
        if cached.exists():
            saved = json.loads(cached.read_text(encoding='utf-8'))
            if saved.get('model') == MODEL and saved.get('hash') == digest and len(saved.get('embedding', [])) == 768:
                image.close()
                completed += 1
                emit({'type': 'batch', 'files': [{'key': task['key'], 'sourceId': task['sourceId'], 'cache': str(cached)}], 'completed': completed, 'total': len(tasks), 'cached': True})
                continue
        batch.append((task, image, photo, digest))
        if len(batch) == 16:
            flush()
    flush()
    emit({'type': 'done', 'completed': completed, 'elapsed': round(time.monotonic()-started, 1)})


if __name__ == '__main__':
    main()

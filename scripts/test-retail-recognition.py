"""Offline, reproducible reference-image retrieval benchmark; no billing writes."""
import argparse
import hashlib
import html
import json
import os
import random
import re
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'datasets/retail-catalog'
OUT = DATA / 'benchmark'
os.environ.setdefault('HF_HUB_OFFLINE', '1')
os.environ.setdefault('TRANSFORMERS_OFFLINE', '1')
os.environ['YOLO_CONFIG_DIR'] = str(ROOT / '.tools/retail-benchmark-ultralytics')
Path(os.environ['YOLO_CONFIG_DIR']).mkdir(parents=True, exist_ok=True)
from PIL import Image, ImageChops, ImageOps, ImageStat
import numpy as np


def read_image(file):
    with Image.open(file) as image:
        return ImageOps.exif_transpose(image).convert('RGB')


def identity(name):
    name = name.lower()
    name = re.sub(r'\b(?:grams|gram|gr|gms|gm)\b', 'g', name)
    name = re.sub(r'\b(?:litre|litres|ltr|ltrs|lt)\b', 'l', name)
    return re.sub(r'[^a-z0-9]', '', name)


def image_signature(file):
    image = read_image(file)
    foreground = ImageChops.difference(image, Image.new('RGB', image.size, 'white')).convert('L').point(lambda v: 255 if v > 35 else 0)
    bbox = foreground.getbbox()
    if bbox is None or sum(ImageStat.Stat(foreground).mean) / 255 < .005:
        return None
    cropped = image.crop(bbox)
    small = np.array(cropped.resize((32, 32))).astype(np.float32) / 255
    grey = np.array(cropped.convert('L').resize((9, 8))).astype(np.int16)
    return {'sha': hashlib.sha256(file.read_bytes()).hexdigest(), 'small': small, 'dhash': (grey[:, 1:] > grey[:, :-1]).flatten()}


def near_duplicate(a, b):
    distance = int(np.count_nonzero(a['dhash'] != b['dhash']))
    mae = float(np.mean(np.abs(a['small'] - b['small'])))
    return a['sha'] == b['sha'] or (distance <= 8 and mae <= .08), distance, mae


def prepare():
    products = json.loads((DATA / 'products.json').read_text(encoding='utf-8'))
    by_id = {p['id']: p for p in products}
    signatures = {}

    def sig(p):
        if p['id'] not in signatures:
            file = DATA / p['image_file']
            signatures[p['id']] = image_signature(file) if file.exists() else None
        return signatures[p['id']]

    grouped = {}
    for p in products:
        grouped.setdefault(identity(p['name']), []).append(p)
    refs, pairs, excluded = [], [], []
    for group in grouped.values():
        a = next((p for p in group if p['store'] == 'rahim'), None)
        b = next((p for p in group if p['store'] == 'carrefour'), None)
        if not a or not b:
            continue
        sa, sb = sig(a), sig(b)
        if sa is None or sb is None:
            excluded.append({'reference': a['id'], 'query': b['id'], 'reason': 'blank_or_missing_photo'})
            continue
        duplicate, distance, mae = near_duplicate(sa, sb)
        if duplicate:
            excluded.append({'reference': a['id'], 'query': b['id'], 'reason': 'identical_or_near_duplicate_photo', 'dhash_distance': distance, 'foreground_mae': mae})
            continue
        refs.append(a)
        pairs.append({'reference_id': a['id'], 'query_id': b['id'], 'query_name': b['name'], 'query_file': b['image_file'], 'dhash_distance': distance, 'foreground_mae': mae})

    def add(p):
        signature = sig(p)
        if signature is None or any(p['id'] == old['id'] or sig(old)['sha'] == signature['sha'] for old in refs):
            return
        refs.append(p)

    # Known Tiger reference and a deliberately different Innovative multipack.
    for key in ['rahim:34076', 'carrefour:251577:offer_carrefour_:EXPRESS']:
        add(by_id[key])
    hard = [p for p in products if re.search(r'pepsi|lay.s|klassno|lu tiger|innovative|guard.*rice|falak.*rice', p['name'], re.I)]
    for p in hard:
        if len(refs) >= 44:
            break
        add(p)
    candidates = [p for p in products if any(c in {'Coffee', 'Lu', 'Innovative', 'Soft Drinks', 'Ghee', 'Rice', 'Frozen Foods', 'Bisconni', 'Oil'} for c in p['category_names'])]
    random.Random(20261019).shuffle(candidates)
    for p in candidates:
        if len(refs) == 50:
            break
        add(p)
    if len(refs) != 50:
        raise RuntimeError(f'Expected 50 reference products, found {len(refs)}')
    all_reference_hashes = {sig(p)['sha'] for p in refs}
    clean_pairs = []
    for pair in pairs:
        if sig(by_id[pair['query_id']])['sha'] in all_reference_hashes:
            excluded.append({**pair, 'reason': 'query_photo_hash_present_elsewhere_in_index'})
        else:
            clean_pairs.append(pair)
    return refs, clean_pairs, excluded


def write_json(name, value):
    (OUT / name).write_text(json.dumps(value, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')


def file_url(file):
    return Path(os.path.relpath(file, OUT)).as_posix()


def review_page(refs, pairs):
    by_id = {p['id']: p for p in refs}
    cards = []
    for pair in pairs:
        ref = by_id[pair['reference_id']]
        cards.append(f'<article><h3>{html.escape(ref["name"])}</h3><div class="photos"><figure><img src="{html.escape(file_url(DATA / ref["image_file"]))}"><figcaption>Reference: Rahim</figcaption></figure><figure><img src="{html.escape(file_url(DATA / pair["query_file"]))}"><figcaption>Query: Carrefour</figcaption></figure></div><p>{html.escape(pair["query_name"])}</p></article>')
    page = '<!doctype html><meta charset="utf-8"><title>Reference pair review</title><style>body{font:15px system-ui;background:#f3f5fa;color:#17213d;padding:24px}main{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}article{background:white;border-radius:12px;padding:16px}h3{height:42px}.photos{display:flex}figure{margin:4px;flex:1}img{width:100%;height:160px;object-fit:contain}figcaption{font-size:12px}</style><h1>Cross-store reference pair review</h1><p>Matching names and pack labels; no verified barcode ground truth. Supplier photo reuse may remain.</p><main>' + ''.join(cards) + '</main>'
    (OUT / 'pair-review.html').write_text(page, encoding='utf-8')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--prepare-only', action='store_true')
    args = parser.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    refs, pairs, excluded = prepare()
    write_json('references.json', refs)
    write_json('test-pairs.json', {'pairs': pairs, 'excluded': excluded})
    review_page(refs, pairs)
    print(f'Prepared {len(refs)} references, {len(pairs)} cross-store query pairs; excluded {len(excluded)} pairs', flush=True)
    if args.prepare_only:
        return

    import torch
    import torch.nn.functional as F
    import transformers
    from transformers import AutoModel, AutoProcessor
    from ultralytics import YOLO
    torch.set_num_threads(4)
    torch.manual_seed(20261019)
    device = 'cpu'
    started = time.perf_counter()
    processor = AutoProcessor.from_pretrained(str(ROOT / 'models/siglip2'), local_files_only=True)
    model = AutoModel.from_pretrained(str(ROOT / 'models/siglip2'), local_files_only=True).eval().to(device)
    load_seconds = time.perf_counter() - started
    print(f'SigLIP loaded on CPU in {load_seconds:.2f}s', flush=True)

    def encode(images, label):
        features = []
        begin = time.perf_counter()
        for offset in range(0, len(images), 8):
            inputs = processor(images=images[offset:offset + 8], return_tensors='pt').to(device)
            with torch.inference_mode():
                outputs = model.get_image_features(**inputs)
                # Transformers 5 returns pooled model output; earlier versions return a tensor.
                pooled = outputs if isinstance(outputs, torch.Tensor) else outputs.pooler_output
                if pooled is None:
                    raise RuntimeError('No pooled SigLIP image features returned')
                features.append(F.normalize(pooled, dim=-1).cpu())
            print(f'{label}: {min(offset + 8, len(images))}/{len(images)} encoded', flush=True)
        return torch.cat(features), time.perf_counter() - begin

    reference_images = [read_image(DATA / p['image_file']) for p in refs]
    index, index_seconds = encode(reference_images, 'Reference library')
    np.savez_compressed(OUT / 'reference-embeddings.npz', embeddings=index.numpy(), ids=np.array([p['id'] for p in refs]))

    def ranked(feature):
        scores = (feature @ index.T).flatten()
        order = torch.argsort(scores, descending=True, stable=True)[:5].tolist()
        return [{'id': refs[i]['id'], 'name': refs[i]['name'], 'cosine_similarity': float(scores[i]), 'image_file': refs[i]['image_file'], 'regular_price_pkr': refs[i]['regular_price']} for i in order]

    query_images = [read_image(DATA / pair['query_file']) for pair in pairs]
    query_features, query_seconds = encode(query_images, 'Cross-store queries') if pairs else ([], 0)
    evaluations = []
    for pair, feature in zip(pairs, query_features):
        ranking = ranked(feature)
        scores = (feature @ index.T).flatten()
        expected_index = next(i for i, p in enumerate(refs) if p['id'] == pair['reference_id'])
        rank = torch.argsort(scores, descending=True, stable=True).tolist().index(expected_index) + 1
        evaluations.append({**pair, 'expected_rank': rank, 'correct_top1': ranking[0]['id'] == pair['reference_id'], 'top5': ranking})

    camera_specs = [
        {'key': 'tiger', 'name': 'LU Tiger Rs 10 packet', 'expected_id': 'rahim:34076', 'status': 'known_candidate_pack_label_match_not_barcode_verified'},
        {'key': 'innovita', 'name': 'Innovative Choc n Chip individual packet', 'expected_id': None, 'status': 'exact_unit_sku_absent_multipack_is_not_equivalent'},
        {'key': 'mehmood', 'name': 'Mahmood Cappuccino Classic 25 g', 'expected_id': None, 'status': 'brand_and_sku_absent_from_reference_library'},
    ]
    camera_images = [read_image(ROOT / 'models/product-pilot/images' / (p['key'] + '.jpeg')) for p in camera_specs]
    # Separate orientation diagnostic. Each source photo still counts as one photo.
    rotations = [image.rotate(angle, expand=True) for image in camera_images for angle in (0, 90, 180, 270)]
    camera_features, camera_seconds = encode(rotations, 'Camera-photo rotations')
    camera_results = []
    for i, spec in enumerate(camera_specs):
        results = []
        for j, angle in enumerate((0, 90, 180, 270)):
            ranking = ranked(camera_features[i * 4 + j])
            results.append({'rotation_degrees': angle, 'top5': ranking, 'correct_top1': ranking[0]['id'] == spec['expected_id'] if spec['expected_id'] else None})
        camera_results.append({**spec, 'file': f'models/product-pilot/images/{spec["key"]}.jpeg', 'original': results[0], 'rotations': results, 'decision': 'cashier_review_required', 'unknown_rejection_validated': False})

    print('Running YOLO on the three original camera photos', flush=True)
    detector = YOLO(str(ROOT / 'models/detector/yolo26n.pt'))
    yolo_results = []
    for spec, image in zip(camera_specs, camera_images):
        begin = time.perf_counter()
        detected = detector.predict(image, device=device, conf=.25, imgsz=640, verbose=False)[0]
        boxes = [{'class': detected.names[int(b.cls.item())], 'detector_score': float(b.conf.item()), 'xyxy': b.xyxy[0].tolist()} for b in detected.boxes]
        yolo_results.append({'photo': spec['key'], 'boxes': boxes, 'seconds': time.perf_counter() - begin})
        print(spec['key'], 'YOLO classes:', [b['class'] for b in boxes], flush=True)

    total = len(evaluations)
    summary = {'reference_products': len(refs), 'cross_store_queries': total, 'top1_correct': sum(p['correct_top1'] for p in evaluations), 'top3_correct': sum(p['expected_rank'] <= 3 for p in evaluations), 'top5_correct': sum(p['expected_rank'] <= 5 for p in evaluations), 'excluded_pair_count': len(excluded), 'camera_photos': 3, 'known_camera_photos': 1, 'known_camera_original_top1_correct': int(camera_results[0]['original']['correct_top1']), 'unknown_camera_photos': 2, 'unknown_rejection_validated': False}
    for k in (1, 3, 5):
        summary[f'top{k}_percent'] = round(100 * summary[f'top{k}_correct'] / total, 2) if total else None
    report = {'tested_at': datetime.now(timezone.utc).isoformat(), 'method': 'Pretrained SigLIP image-to-image cosine retrieval against 50 fixed catalog references; no fine-tuning. Cross-store labels paired by normalized exact names and pack units, not verified EANs. Exact/near duplicates filtered by SHA256 and foreground dHash/MAE before inference.', 'limitations': ['This is not checkout-camera accuracy or an end-to-end billing test.', 'Cross-store photos can share supplier origins despite pixel duplicate filtering; barcode ground truth is unavailable.', 'Only one available camera photo has a corresponding candidate unit SKU; two are unknown-SKU probes.', 'Four rotations of one image are not four independent test images.', 'No validated acceptance/rejection threshold; cosine similarity is not a confidence percentage.', 'YOLO boxes lack annotated ground truth, so detection precision/recall/mAP are not reported.', 'The installed Transformers version emitted token-ID configuration warnings during loading; image inference completed. Dependency/configuration compatibility needs validation before deployment.', 'Reference prices are retailer snapshots; no prices, stock or invoices were written to MongoDB.'], 'versions': {'torch': torch.__version__, 'transformers': transformers.__version__, 'device': device, 'threads': 4}, 'summary': summary, 'timings': {'model_load_seconds': load_seconds, 'reference_encoding_seconds': index_seconds, 'query_encoding_seconds': query_seconds, 'camera_12_rotations_encoding_seconds': camera_seconds}, 'cross_store_results': evaluations, 'camera_results': camera_results, 'yolo_results': yolo_results, 'excluded_pairs': excluded}
    write_json('results.json', report)
    create_report(report, refs)
    print(json.dumps(summary, indent=2), flush=True)


def create_report(report, refs):
    s = report['summary']
    tested = datetime.fromisoformat(report['tested_at']).astimezone(timezone(timedelta(hours=5), 'PKT')).strftime('%d %B %Y, %I:%M %p PKT')
    lines = ['# Product Recognition Test Results', '', f'Tested: {tested}', '', f'**Outcome:** SigLIP first-choice matches: {s["top1_correct"]}/{s["cross_store_queries"]} cross-store queries and {s["known_camera_original_top1_correct"]}/1 known camera photo. End-to-end AI billing remains unproven; review the detector and unknown-SKU results below.', '', '## Measured results', '', '| Test | Result |', '| --- | --- |', f'| Reference library | {s["reference_products"]} products |', f'| Cross-store top 1 | {s["top1_correct"]}/{s["cross_store_queries"]} ({s["top1_percent"]}%) |', f'| Cross-store top 3 | {s["top3_correct"]}/{s["cross_store_queries"]} ({s["top3_percent"]}%) |', f'| Cross-store top 5 | {s["top5_correct"]}/{s["cross_store_queries"]} ({s["top5_percent"]}%) |', f'| Identical/near-duplicate, blank or overlapping query pairs excluded | {s["excluded_pair_count"]} |', f'| Original known camera photo top 1 | {s["known_camera_original_top1_correct"]}/1 |', '| Unknown-SKU rejection | Not calibrated or validated |', '', 'Cross-store results measure reference-photo transfer under the stated label-matching rules. They are not real checkout accuracy.', '', '## Cross-store queries', '', '| Expected product | Rank | First suggested product |', '| --- | --- | --- |']
    by_id = {p['id']: p for p in refs}
    for row in report['cross_store_results']:
        lines.append(f'| {by_id[row["reference_id"]]["name"]} | {row["expected_rank"]} | {row["top5"][0]["name"]} |')
    lines.extend(['', '## Supplied camera photos', '', '| Photo | Original top suggestion | Cosine score | Expected status |', '| --- | --- | --- | --- |'])
    for row in report['camera_results']:
        top = row['original']['top5'][0]
        lines.append(f'| {row["name"]} | {top["name"]} | {top["cosine_similarity"]:.4f} | {row["status"]} |')
    lines.extend(['', 'Scores are similarities, not confidence percentages. Rotated diagnostic results are in `results.json`.', '', 'The Innovative individual packet matched a 14 g x 24 multipack; that is not a correct billing SKU. Mahmood coffee is absent from the reference library and received a different-brand coffee suggestion. These probes show why nearest-match scores alone cannot approve a sale.', '', '## YOLO camera detections', ''])
    for row in report['yolo_results']:
        lines.append(f'- {row["photo"]}: ' + (', '.join(b['class'] for b in row['boxes']) or 'No detections above 0.25'))
    lines.extend(['', '## Limits', ''] + ['- ' + line for line in report['limitations']])
    lines.extend(['', '## Timing', '', 'CPU only, four threads; times exclude camera capture and network transfer.', ''] + [f'- {key}: {value:.3f}' for key, value in report['timings'].items()])
    lines.extend(['', '## Reproduce', '', '```powershell', r'.\.venv-ai\Scripts\python.exe scripts/test-retail-recognition.py', '```', '', 'Local weights only. Raw records: `results.json`; frozen index: `reference-embeddings.npz`; references: `references.json`; visual pair review: `pair-review.html`.', '', 'API reference: [Google SigLIP 2 image encoding](https://huggingface.co/google/siglip2-base-patch16-224), [Ultralytics prediction](https://docs.ultralytics.com/modes/predict/).'])
    (OUT / 'RESULTS.md').write_text('\n'.join(lines) + '\n', encoding='utf-8')
    create_html_report(report, refs)


def create_html_report(report, refs):
    escape = html.escape
    s = report['summary']
    tested = datetime.fromisoformat(report['tested_at']).astimezone(timezone(timedelta(hours=5), 'PKT')).strftime('%d %B %Y, %I:%M %p PKT')
    camera_cards = []
    for row in report['camera_results']:
        top = row['original']['top5'][0]
        status = ('Expected Tiger candidate matched' if row['original']['correct_top1'] else 'Known candidate was not matched first') if row['expected_id'] else 'Exact unit SKU absent: suggested item is not safe to bill'
        camera_cards.append(f'<article><h3>{escape(row["name"])}</h3><div class="pictures"><figure><img src="{escape(file_url(ROOT / row["file"]))}"><figcaption>Supplied camera photo</figcaption></figure><figure><img src="{escape(file_url(DATA / top["image_file"]))}"><figcaption>Nearest catalog reference</figcaption></figure></div><strong>{escape(top["name"])}</strong><p>Cosine similarity: {top["cosine_similarity"]:.4f}</p><p class="status">{escape(status)}</p></article>')
    by_id = {p['id']: p for p in refs}
    rows = ''.join(f'<tr><td>{escape(by_id[r["reference_id"]]["name"])}</td><td>{r["expected_rank"]}</td><td>{escape(r["top5"][0]["name"])}</td></tr>' for r in report['cross_store_results'])
    yolo = ''.join(f'<tr><td>{escape(r["photo"])}</td><td>{escape(", ".join(b["class"] for b in r["boxes"]) or "No detections")}</td></tr>' for r in report['yolo_results'])
    page = f'''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Aspire recognition test results</title>
<style>body{{font:16px/1.5 system-ui,sans-serif;background:#f4f5fa;color:#18213b;margin:0}}main{{max-width:1200px;margin:auto;padding:32px}}h1{{margin-bottom:4px}}.muted{{color:#5b6478}}.summary,.camera{{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}}article,.metric,section{{background:white;border:1px solid #e0e3ee;border-radius:14px;padding:20px}}.metric strong{{display:block;font-size:30px;color:#5d4ac5}}h3{{min-height:50px}}.pictures{{display:flex}}figure{{margin:0 6px;flex:1}}img{{width:100%;height:200px;object-fit:contain}}figcaption{{font-size:12px;color:#5b6478}}.status{{padding:10px;background:#fff3dc;border-radius:8px}}section{{margin-top:22px}}table{{width:100%;border-collapse:collapse}}th,td{{text-align:left;padding:12px;border-bottom:1px solid #e0e3ee}}a{{color:#5140b6}}@media(max-width:850px){{.summary,.camera{{grid-template-columns:1fr}}table{{font-size:13px}}}}</style>
<main><p class="muted">Aspire AI Billing · Offline recognition benchmark</p><h1>Product recognition test results</h1><p class="muted">{escape(tested)}</p><p><strong>Reference matching requires camera validation. Detector performance and unknown-product handling need review before automatic billing.</strong></p>
<div class="summary"><div class="metric"><strong>{s['reference_products']}</strong>Reference products</div><div class="metric"><strong>{s['top1_correct']} / {s['cross_store_queries']}</strong>Cross-store first-choice matches</div><div class="metric"><strong>{s['known_camera_original_top1_correct']} / 1</strong>Known original camera photo matched</div></div>
<p>Small reference-photo test, not checkout accuracy. {s['excluded_pair_count']} blank, duplicate or overlapping pairs were excluded. Similarity scores are not confidence percentages.</p>
<h2>Camera-photo checks</h2><div class="camera">{''.join(camera_cards)}</div><section><h2>YOLO detections on camera photos</h2><p>No reliable product packet detection was demonstrated. Detection accuracy cannot be calculated without ground-truth boxes.</p><table><thead><tr><th>Photo</th><th>Generic detected classes</th></tr></thead><tbody>{yolo}</tbody></table></section>
<section><h2>Cross-store queries</h2><p>Matching normalized product names and pack units; EAN ground truth is unavailable. Shared supplier photos may remain.</p><table><thead><tr><th>Expected listing</th><th>Rank</th><th>First suggestion</th></tr></thead><tbody>{rows}</tbody></table></section><section><h2>Evidence and method</h2><p><a href="RESULTS.md">Full report</a> · <a href="results.json">Raw results</a> · <a href="pair-review.html">Side-by-side photo review</a></p><ul>{''.join('<li>'+escape(x)+'</li>' for x in report['limitations'])}</ul></section></main></html>'''
    (OUT / 'RESULTS.html').write_text(page, encoding='utf-8')


if __name__ == '__main__':
    main()

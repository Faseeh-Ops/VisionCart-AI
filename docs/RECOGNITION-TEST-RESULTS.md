# Product Recognition Pilot Results

**Tested:** 19 October 2026 · Local CPU · YOLO26n and SigLIP 2 · No model fine-tuning

**Result:** Reference-image matching worked on this small sample. Product detection and unknown-SKU handling still need work before automatic AI billing.

| Check | Observed result |
| --- | --- |
| Frozen reference library | 50 catalog listings; 768-dimensional image embeddings |
| Cross-store queries | Expected listing ranked first for 18/18 queries |
| Data filtering | 8 blank, duplicate, near-duplicate or overlapping query pairs excluded |
| Tiger camera photo | Tiger Ticky Pack ranked first; barcode identity not verified |
| Unknown unit SKUs | 2 probes; nearest candidates were unsuitable for billing |
| YOLO on 3 camera photos | Person, keyboard, tie and donut detections; no reliable packet localization demonstrated |

## Camera-photo findings

| Supplied photo | First suggested reference | Interpretation |
| --- | --- | --- |
| LU Tiger Rs 10 packet | Lu Tiger Ticky Pack | Matching pack candidate; cosine similarity 0.7251 |
| Innovative Choc n Chip individual packet | INNOVATIVE CHOC N CHIP 14GX24 | Multipack rather than the individual unit; similarity 0.7523 |
| Mahmood Cappuccino Classic 25 g | Klassno Classic Pure Soluble Coffee In Granules 2 gr | Wrong brand and size; the actual Mahmood reference is absent; similarity 0.5846 |

The incorrect Innovative multipack suggestion scored higher than the correct Tiger suggestion. A similarity score alone is insufficient to approve a billing SKU or choose a universal confidence threshold. Prices belong in MongoDB, linked to a confirmed product ID.

## What these results establish

- The local SigLIP image encoder and frozen reference index run successfully.
- Cross-store reference-photo matching looks promising for the selected 18 query pairs against 50 candidates.
- The supplied Tiger camera photo retrieved its corresponding candidate pack. Rotating the same photo also retained that first suggestion; rotations are not independent test images.
- A generic nearest-reference search can suggest the wrong unit, multipack or brand when the correct SKU is missing.

The 18/18 result is **not general checkout accuracy**. Cross-store pairs use normalized names and pack units rather than verified EAN labels; supplier photos may share origins despite duplicate filtering. The camera checks used three previously supplied photos, with only one corresponding unit candidate available. Live video, multiple products, occlusion, reliable quantities and unknown rejection remain unvalidated. YOLO has no annotated boxes in this test, so detection precision, recall and mAP are not reported.

The installed Transformers version emitted token-ID configuration warnings while loading; image inference completed. Checkpoint and dependency compatibility need validation before deployment.

## Evidence and reproduction

- Visual results (local artifact: `../datasets/retail-catalog/benchmark/RESULTS.html`)
- Detailed report (local artifact: `../datasets/retail-catalog/benchmark/RESULTS.md`)
- Raw scores and detections (local artifact: `../datasets/retail-catalog/benchmark/results.json`)
- Reference pair review (local artifact: `../datasets/retail-catalog/benchmark/pair-review.html`)
- Frozen index: `datasets/retail-catalog/benchmark/reference-embeddings.npz`

Generated evidence stays local with the retailer dataset. Index integrity, metric totals and disjoint reference/query file hashes were checked. CPU encoding took about 7.6 seconds for 50 references and 2.7 seconds for 18 queries, excluding model loading, camera capture and network transfer.

```powershell
.\.venv-ai\Scripts\python.exe scripts/test-retail-recognition.py
```

**Next:** collect labelled checkout photos for a product detector, add separate reference photos for exact unit SKUs, and evaluate new camera captures with known and unknown products. The benchmark runs offline and does not write prices, invoices or stock to MongoDB.

## Application browser test

The [earlier barcode-only application test](APPLICATION-DATASET-TEST-RESULTS.md) identified the missing AI connection. That integration has now been implemented; see the [current AI application test](AI-APPLICATION-TEST-RESULTS.md) for real inference calls, confirmed products and persisted invoices.

# Verification and model evaluation

**Updated: 20 October 2026.** Application integration, synthetic localization, and exact-SKU matching are separate measurements. None of these tests establish unattended physical checkout accuracy.

## Application verification

All 62 automated checks passed, and the production build completed successfully.

| Verification | Result |
| --- | --- |
| JavaScript unit tests | 30 passed |
| Python geometry tests | 5 passed |
| Application browser workflows | 17 passed |
| Dataset-backed barcode workflows | 3 passed |
| Local AI integration scenarios | 7 passed |
| Production build | Passed |
| Documentation screenshots | 7 generated |

Browser scenarios use an isolated `aspire_test_<timestamp>` database, fictional accounts, real application APIs and, for AI scenarios, actual local model inference. Camera transports use controlled frames. Production invoices and stock are not test fixtures.

The AI suite covers admin enrollment, candidate ordering, confirmed invoices, current price/stock checks, unknown rejection, expired/replayed/store-bound predictions, empty-scene suppression, identical-item rescan cycles, and a five-card multi-product review queue. The dataset suite verifies the separate barcode/QR backup rather than treating packaging photos as readable barcodes.

## Before training: 32-product stress suite

51 simulated scenes contained 229 appearances of 32 additional retailer-listed products. These included beverages, rice, bread, dairy cream, frozen foods, eggs, diapers, toothbrushes, face wash, oil and coffee variants.

| Condition | Expected items | Regions returned | Correctly located | Exact top SKU matches |
| --- | ---: | ---: | ---: | ---: |
| Clear and separated | 32 | 33 | 32 | 24 |
| Rotation | 32 | 28 | 28 | 17 |
| Cast shadows | 32 | 21 | 18 | 12 |
| Glare | 32 | 32 | 32 | 20 |
| Blur | 32 | 32 | 32 | 3 |
| Touching | 32 | 7 | 1 | 1 |
| Overlap | 32 | 7 | 0 | 0 |

A correctly located item requires a one-to-one box match at IoU >=0.5. Exact matching additionally requires the first suggested inventory ID to equal the expected listing-linked product. Extra regions and rejected scenes remain part of the results.

All 32 query image sources were already present in the live reference library. These are crop/scene robustness checks, not unseen-image recognition accuracy. Retailer listing names and photos do not establish manufacturer barcode identity; multipack photographs can depict several objects for one listing.

A separate diagnostic used 18 alternate retailer-photo queries against a frozen 50-reference index. No query file hash occurred in that smaller index. It localized 18/18 and retrieved the expected reference first for 17/18. Different supplier images can still share origins. Its smaller search space makes that result incomparable to the full live-catalog score.

## GPU detector training

A YOLO26n model was fine-tuned to one class, `retail_product`, on an RTX 4050 Laptop GPU with 6 GB VRAM using PyTorch 2.14.1+cu130 and torchvision 0.29.1+cu130. Training stopped early after 24 epochs, with 25 requested and a batch size of eight.

The 900 generated scenes used 160 catalog source photos: 600 training scenes from 100 sources, 120 validation scenes from 30 other sources, and 180 final test scenes from 30 other sources. File hashes and normalized source names are disjoint across splits; near-identical foreground hashes were filtered during source selection. Previously tested 32-product source/reference files were excluded. Labels were generated from foreground masks and visible object regions, not manually reviewed physical captures.

| Metric on 180 synthetic test scenes | Original YOLO, class-agnostic | Fine-tuned retail candidate |
| --- | ---: | ---: |
| Precision | 72.6% | 91.6% |
| Recall | 60.0% | 86.8% |
| mAP at IoU 0.5 | 70.6% | 93.4% |
| mAP at IoU 0.5-0.95 | 57.3% | 77.6% |

The generic YOLO baseline treats every COCO prediction as a possible product region. Validation selects the checkpoint; the final synthetic test split is not used for early stopping or model selection. mAP is a localization metric, not a confidence percentage or exact-SKU accuracy.

## Trained boxes on the earlier stress scenes

The following comparison is with the application's calibrated counter segmentation, not with the generic YOLO baseline above. The candidate used confidence threshold 0.25 and one-to-one IoU matching at 0.5.

| Condition | Expected | Counter segmentation: located | Candidate: located | Candidate: extra regions |
| --- | ---: | ---: | ---: | ---: |
| Clear and separated | 32 | 32 | 32 | 2 |
| Rotation | 32 | 28 | 32 | 3 |
| Cast shadows | 32 | 18 | 32 | 2 |
| Glare | 32 | 32 | 32 | 4 |
| Blur | 32 | 32 | 32 | 1 |
| Touching | 32 | 1 | 29 | 3 |
| Overlap | 32 | 0 | 23 | 8 |

These evaluate boxes only. SigLIP was not trained, and SKU matching with these new candidate crops has not been measured. The separate hand-fragment probe still produced false boxes. Dense bottle stacks also returned partial, grouped, and duplicate-looking regions rather than a reliable physical count.

**Deployment status:** the trained candidate remains local and is not active in billing. Counter calibration and individual cashier confirmation remain required by the current app. Physical checkout photos with reviewed annotations, unknown objects, hands, glare and hidden items are still needed before deployment or automatic counting.

## Reproduce

```powershell
npm.cmd test
npm.cmd run build
npm.cmd run test:e2e
npm.cmd run test:dataset
npm.cmd run test:ai
.\.venv-ai\Scripts\python.exe scripts/test-scene-regions.py
.\.venv-ai\Scripts\python.exe scripts/make-expanded-multiframe-stress.py
node scripts/test-multiframe-stress.mjs
.\.venv-ai\Scripts\python.exe scripts/test-expanded-heldout.py
```

For the expanded live-API stress suite, set `STRESS_DATA_DIR=datasets/retail-catalog/multiframe-expanded` and point `STRESS_API_ORIGIN` at the chosen local backend before running the Node stress script. The default suite uses the three earlier camera-photo composites. A prepared local retailer dataset and downloaded model weights are required.

See [GPU training instructions](GPU-DETECTOR-TRAINING.md) for environment setup, dataset generation, training and evaluation commands. Generated scenes, raw predictions, trained weights, local before/after stock backups and inference caches are deliberately excluded from Git. Public documentation preserves aggregate measurements and their limits; full evidence can be regenerated locally.

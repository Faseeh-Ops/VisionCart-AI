# Change log

## 20 October 2026

Per-file release notes accompany the focused Git commits. Generated retailer snapshots, local account data, secrets, environments and model weights are excluded.

### feat(catalog): add audited extraction and reference imports

| File | Change |
| --- | --- |
| `datasets/retail-catalog/README.md` | Explain source coverage, extraction commands, data provenance and reference-image limitations. |
| `docs/APPLICATION-DATASET-TEST-RESULTS.md` | Record the historical packaging-to-barcode baseline without claiming AI accuracy. |
| `docs/RECOGNITION-TEST-RESULTS.md` | Document the reference-matching pilot and its unknown-product and localization failures. |
| `docs/RETAIL-LIBRARY-IMPORT-RESULTS.md` | Record import totals, excluded photos, stock preservation and historical UI verification. |
| `docs/RETAIL-LIBRARY-IMPORT.md` | Document dry-run/apply imports, canonical identities, source prices, caches and branch-stock rules. |
| `playwright.dataset.config.js` | Configure dataset-backed barcode and invoice browser verification. |
| `scripts/encode-retail-library.py` | Batch local reference embeddings and cache validated image/vector records for resumable imports. |
| `scripts/extract-retail-catalog.mjs` | Extract accessible retailer catalogs with resumable caches, provenance and rate-limit handling. |
| `scripts/import-retail-library.mjs` | Apply reviewed imports while preserving existing prices, stock and product identities. |
| `scripts/retail-catalog-parsers.mjs` | Parse retailer metadata, prices and categories without executing retailer scripts. |
| `scripts/retail-catalog-parsers.test.mjs` | Check price provenance, category deduplication, Flight reconstruction and CSV safety. |
| `scripts/retail-import-plan.mjs` | Build deterministic import identities and reject ambiguous shared photographs. |
| `scripts/retail-import-plan.test.mjs` | Verify deterministic merging, existing-identity reuse and malformed-price rejection. |
| `scripts/test-retail-recognition.py` | Benchmark reference retrieval, duplicate filtering, unknown probes and camera-photo diagnostics. |
| `scripts/validate-retail-catalog.mjs` | Audit extracted records, image integrity and conflicting or duplicate photos. |
| `scripts/verify-retail-library.mjs` | Verify the imported library and exercise real application views without exposing credentials. |
| `tests/dataset-application.e2e.js` | Validate barcode fallback and persisted invoices using isolated catalog-backed fixtures. |

### feat(recognition): add local AI matching and multi-product review

| File | Change |
| --- | --- |
| `.env.example` | Document the replica-set URI and optional local AI interpreter. |
| `docs/AI-APPLICATION-TEST-RESULTS.md` | Preserve historical real-inference integration evidence and point to current evaluation. |
| `docs/AI-RECOGNITION.md` | Document reference enrollment, per-region review, calibrated capture and duplicate prevention. |
| `package.json` | Expose catalog parser checks, AI/data suites, screenshot capture and retail import commands. |
| `playwright.ai.config.js` | Configure isolated real-inference browser verification. |
| `scripts/test-scene-regions.py` | Check region geometry, empty counters, exposure changes, noise and clipped products. |
| `server/ai-index.js` | Validate normalized vectors and rank exact inventory products by their best reference match. |
| `server/ai-index.test.js` | Verify malformed-vector filtering and best-reference ranking. |
| `server/ai-recognition.js` | Add protected reference management, per-region predictions and store/user-bound one-time confirmations. |
| `server/ai-runtime.js` | Manage the persistent Python worker, readiness, bounded requests and inference timeouts. |
| `server/ai-worker.py` | Encode full images or calibrated region crops with local model weights and batched image features. |
| `server/camera-cycle.test.js` | Verify scene stability, stationary duplicate guards, empty calibration and identical-item rearming. |
| `server/index.js` | Mount authenticated AI routes and allow bounded scene/background payloads. |
| `server/scene_regions.py` | Separate calibrated foreground components and reject invalid or ambiguous region geometry. |
| `src/AiBilling.jsx` | Add photo/webcam/RTSP recognition, calibration, region previews and sequential cashier review. |
| `src/AiProductReferences.jsx` | Provide administrator reference-photo management for exact inventory products. |
| `src/CatalogPhotos.jsx` | Load authenticated reference thumbnails for catalog browsing. |
| `src/RtspScanner.jsx` | Add decoded-frame capture and callbacks while preserving the barcode backup workflow. |
| `src/ai.css` | Style recognition controls, reference photos, numbered regions and the review queue. |
| `src/camera-cycle.js` | Track steady scene changes and calibrated departures without claiming object identity tracking. |
| `src/main.jsx` | Integrate AI review, catalog photo browsing, larger inventories and camera-mode switching into billing. |
| `src/product-photo.js` | Prepare bounded JPEG payloads from files and decoded camera elements. |
| `src/useCameras.jsx` | Preserve shared camera preferences and keep discovery behavior consistent across scan modes. |
| `tests/ai-billing.e2e.js` | Exercise real enrollment/inference, per-region review, quantities, stock checks and replay protection. |
| `tests/workflows.spec.js` | Update existing workflows for camera capture and a larger private catalog. |

### feat(training): add CUDA detector training and stress evaluation

| File | Change |
| --- | --- |
| `.gitignore` | Keep local environments, model weights, generated datasets, runs and caches out of Git. |
| `docs/GPU-DETECTOR-TRAINING.md` | Describe isolated CUDA setup, source-disjoint synthetic data, training and checkpoint limitations. |
| `docs/MODEL-EVALUATION.md` | Publish aggregate verification, stress-test and GPU-training results with explicit scope boundaries. |
| `scripts/evaluate-trained-detector.py` | Compare candidate boxes against prior scene ground truth and retain extra/missed detections. |
| `scripts/make-expanded-multiframe-stress.py` | Generate deterministic 32-SKU stress scenes with annotation and source provenance. |
| `scripts/make-multiframe-stress.py` | Generate packet-photo composites for glare, blur, hands, shadows and overlap testing. |
| `scripts/prepare-detector-training.py` | Prepare synthetic YOLO scenes after separating and filtering catalog source images. |
| `scripts/summarize-expanded-multiframe.py` | Produce per-condition and source-disjoint diagnostic summaries for the expanded stress suite. |
| `scripts/test-expanded-heldout.py` | Evaluate alternate source photos against the frozen 50-reference index without changing live references. |
| `scripts/test-multiframe-stress.mjs` | Exercise the real recognition API with annotated scenes and verify business-data totals remain unchanged. |
| `scripts/train-retail-detector.py` | Fine-tune YOLO on CUDA, select by validation, evaluate held-out synthetic data and preserve a candidate. |

### docs: publish current workflows and application screenshots

| File | Change |
| --- | --- |
| `README.md` | Present current capabilities, setup, architecture, limits, evidence and seven application screenshots. |
| `docs/CHANGELOG.md` | Provide a per-file index for every addition or modification in this release. |
| `docs/COMPLETE-PROJECT-OVERVIEW.md` | Refresh the implementation overview for calibrated multi-product review and the candidate detector. |
| `docs/OPERATIONS.md` | Update operational guidance for local AI and camera workflows. |
| `docs/PROJECT-README.md` | Separate available workflows from the remaining physical-detection roadmap. |
| `docs/screenshots/ai-recognition.png` | Show actual local matching against fictional inventory entries and exact-pack reference images. |
| `docs/screenshots/billing.png` | Show the current checkout, reference-library status, quantity controls and barcode backup. |
| `docs/screenshots/dashboard-overview.png` | Refresh the overview with fictional store activity and current inventory totals. |
| `docs/screenshots/invoice-search.png` | Refresh cashier-filtered receipt history and reprint actions. |
| `docs/screenshots/multi-product.png` | Show a generated three-product scene, numbered regions, the review queue and merged quantities. |
| `docs/screenshots/stock-transfer.png` | Refresh the stock-allocation preview and branch quantity context. |
| `docs/screenshots/store-details.png` | Refresh branch stock, cashier activity and export controls with isolated sample data. |
| `models/README.md` | Describe local runtime setup and the separate, inactive trained candidate. |
| `models/TRAINING-PROPOSAL.md` | Mark original planning assumptions as historical and correct the YOLO class-name example. |
| `scripts/capture-readme.mjs` | Reproduce seven screenshots with fictional accounts, exact-pack references and temporary database cleanup. |
| `tests/TEST-REPORT.md` | Label the earlier workflow report as historical and link current release verification. |

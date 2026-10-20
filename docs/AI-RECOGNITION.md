# AI Product Recognition

The billing screen uses local models for single-product matching and calibrated, separated multi-product scenes. Recognition suggests inventory products; the cashier confirms each visible region and exact pack before adding it to the bill.

## Start

1. Keep the downloaded weights in `models/detector/yolo26n.pt` and `models/siglip2/`.
2. Use the existing `.venv-ai` Python environment containing PyTorch, Transformers, Ultralytics, Pillow, OpenCV and NumPy. If your environment is elsewhere, set `AI_PYTHON_PATH` to its absolute Python executable path in `.env`.
3. Start the application from the project folder:

```powershell
npm.cmd run dev
```

The Node backend starts the local Python worker automatically on the first reference upload or recognition. No separate inference-server command or cloud API key is needed. The first request takes longer while weights load.

## Admin: prepare exact products

1. Register a product with its real barcode, price and branch stock.
2. Open **Products > AI photos** on that product.
3. Add clear reference photos of its exact size, flavour and unit packaging. Up to eight photos are supported.

A multipack and an individual packet need separate entries. Reference photos and image embeddings are stored in MongoDB against product IDs and are shared across branches; quantities remain branch-specific. Adding or removing references is admin-only. Duplicate uploads to the same product reuse the existing reference.

The earlier application tests enrolled products only in a temporary database. The local retailer catalog can now be imported into live inventory and indexed in bulk; see [retail library import](RETAIL-LIBRARY-IMPORT.md). Imported items start with zero branch stock until an administrator allocates real quantities. You can still attach your own reference photos manually.

## Cashier: recognize and confirm

- **Recognize product photo:** upload a product picture.
- **Open AI camera:** choose a webcam. With **Automatically recognize camera products** enabled, the camera submits a product photo for recognition and pauses when suggestions arrive.
- **Connect RTSP camera** or **AI network camera:** enter the RTSP address. When frames arrive and the reference library is ready, AI automatically analyses the product without looking for a printed code.
- The webcam and RTSP capture buttons remain available for manual recognition; uncheck automatic recognition if you prefer to capture each photo yourself.
- AI and barcode camera modes release the camera when switching. The selected camera preference is shared between them.
- Review up to three suggestions, their reference photos, current price and stock in your selected store.
- Click **Confirm & add one** only for the correct product and pack size. Edit quantities in the bill as usual.
- For repeated identical packets, clear the view and click **Set empty scan area** once with the camera fixed. This suppresses empty-counter suggestions and requires the area to clear between units. Calibration resets when switching cameras; manual **Scan next product** also clears it.
- After confirming or rejecting, replace the previous product and hold the next one steady. Automatic recognition resumes when the central camera view changes and settles for about 800 ms. **Scan next product** remains a manual override. This visual change gate is a heuristic, not object tracking: moving the same packet or changing lighting can cause another suggestion, and visually identical replacements may need the override. Cashier confirmation is still required. Webcam checks run every 250 ms; RTSP checks follow arriving frames.
- Use **None of these products** for an unknown item. It creates an unverified AI event without charging a product. Barcode/QR scanning and manual search remain available.

**Barcode / QR RTSP camera** is the separate backup for printed codes. It does not identify packaging. If the AI library is empty, the application displays setup instructions and does not repeatedly submit camera frames to the model. Add reference pictures through the admin account first.

Stock is deducted only when the existing invoice API confirms the sale. Confirmation rechecks price, availability, store and prediction ownership; an already-confirmed suggestion cannot be replayed to add another unit. Suggestions expire after five minutes.

## Models and limits

| Component | Current behavior |
| --- | --- |
| SigLIP 2 | Encodes a single-product photo or batches separate calibrated-counter crops, then compares with inventory reference embeddings |
| YOLO26n | Diagnostic boxes in single-product mode; multiple-product mode uses calibrated foreground components instead |
| Express + MongoDB | Supply exact product IDs, prices, discounts and store stock |
| Cashier | Confirms or rejects every suggestion |

Visual similarity is not a calibrated confidence percentage. Unknown products can resemble registered ones. There is no validated automatic unknown rejection or general retail object detection. Calibrated multi-product localization supports separated foreground regions only; counts require review. Model weights are unchanged; this feature builds and searches a reference library.

## Tests and evidence

See [AI application test results](AI-APPLICATION-TEST-RESULTS.md) for actual model calls through the browser, dataset matches, invoices and limitations.

```powershell
npm.cmd run build
npx.cmd playwright test --config=playwright.ai.config.js
```

The test opens Edge and uses a temporary `aspire_test_*` database. Inference, authentication, inventory and invoice APIs are real. Camera transports use controlled frames; physical camera/network performance needs separate testing.

## Multiple products on a fixed counter

Enable **Multiple products on counter**. Keep the camera fixed, remove all products, and click **Set empty scan area** once. For uploaded scenes, use **Upload empty counter photo** from the same camera position and dimensions, then upload the product scene.

Place up to ten items entirely inside the view, with clear gaps and fronts visible. The service compares the scene to the empty counter, segments separate foreground components, batches their crops through SigLIP, and returns independent suggestions for each region. Each crop is shown for review. Confirming two regions as the same SKU increases that bill row to quantity two. Reject a false region without charging it. Clear the whole area between batches; leaving previously billed items in the next batch can charge them again after confirmation.

This is a constrained background-subtraction feature, not a newly trained retail detector. Shadows, hands, reflections, camera movement, similar foreground/background colours, fragmented packaging, touching and occlusion can cause missed or extra regions. Inspect the region count and crops; separate products and recapture when the count is wrong. The system cannot establish how many packets are hidden in a connected region. Unknown SKUs still require cashier rejection. Prices and stock use the existing live inventory checks, and each region prediction can be confirmed only once.

Geometry checks: `.\.venv-ai\Scripts\python.exe scripts/test-scene-regions.py`. Browser coverage includes a generated five-card scene with real local inference and a repeated SKU; synthetic cards do not measure live checkout accuracy.

## Trained detector candidate

The separately trained YOLO checkpoint is a synthetic-data experiment. This application router still uses calibrated foreground components for multiple products; placing `candidate.pt` on disk does not enable it. Read [current evaluation](MODEL-EVALUATION.md) before interpreting detection metrics as SKU accuracy or deciding to integrate a checkpoint.

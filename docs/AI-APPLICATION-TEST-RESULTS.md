# AI Recognition: Application Test Results

**Historical integration report.** See [current verification and evaluation](MODEL-EVALUATION.md) for calibrated multi-product support and the trained detector candidate.

**Tested:** 19 October 2026 · Visible Microsoft Edge · Local CPU · Real SigLIP 2, YOLO26n, Express and MongoDB

**AI is now connected to the billing application.** Admins enrolled product photos through the UI. Cashiers uploaded dataset images, reviewed actual model suggestions, confirmed products and generated a saved invoice.

**Live library update:** The real store database now contains 9,360 products and 8,621 AI reference photos. See [live import and browser verification](RETAIL-LIBRARY-IMPORT-RESULTS.md). The six-product results below describe the separate, isolated integration suite.

## Dataset recognition

The library contained **six exact inventory products**. These are application-integration checks, not a general retail accuracy estimate.

| Product | Query/reference relationship | First suggested product |
| --- | --- | --- |
| Pepsi 1.5 lt | Same source photo | Correct |
| LU Tiger Ticky Pack | Same source photo | Correct |
| Dalda VTF Banaspati Ghee 1 kg | Same source photo | Correct |
| Falak Daily Basmati Rice 1 kg | Different retailer photos | Correct |
| K&N's Nuggets 1 kg | Different retailer photos | Correct |
| Nestle Milk Pak Dairy Cream 200 ml | Different retailer photos | Correct |

**6/6 first-choice matches**, including **3/3 cross-store photos**. The three same-photo cases verify the wiring and are not evidence of generalization. A separate, previously supplied handheld Tiger photo also ranked the Tiger reference first; its cosine similarity was **0.6856**, not a confidence percentage. Pack identity in cross-store samples uses catalog labels; manufacturer barcode ground truth remains unavailable.

## Confirmed sale

- Every match required **Confirm & add one**. No item entered the bill automatically.
- One of each product produced an invoice for **Rs 2,759** using MongoDB prices.
- All six branch quantities changed from **10 to 9** only after invoice creation.
- The admin sales report recorded **6 units, 1 invoice, Rs 2,759**.
- Repeat confirmations and another cashier's attempts to confirm a suggestion were rejected.

## Capture and safeguards

| Check | Result |
| --- | --- |
| Admin UI photo enrollment and persisted embeddings | Passed; six 768-dimensional reference vectors |
| Duplicate reference upload | Reused the existing reference |
| Reference management by cashier | Denied |
| Malformed image | Rejected |
| Supplied Tiger camera photo | Correct first candidate |
| Webcam capture → real inference | Passed with a controlled dataset MediaStream |
| Main RTSP control opens AI recognition | Passed; barcode/QR RTSP backup has a separate, explicit control |
| Empty AI reference library | Setup warning shown; automatic camera requests blocked |
| Automatic RTSP frames → real inference | Passed with controlled camera frames; no capture click required |
| RTSP frame loading and recovery | Capture waits for a decoded frame, works while the visible preview reloads, and recovers after unreadable frames |
| Automatic recognition during review | Paused; no repeated inference while suggestions await confirmation |
| After confirming or rejecting an RTSP match | Paused; Scan next product re-arms recognition without repeatedly adding a stationary packet |
| Unknown Mahmood photo | Cashier rejected suggestions; unverified AI event created; no sale |
| Price changed after suggestion | Confirmation used the current database price |
| Product made out of stock | Confirmation blocked |
| Working store changed | Old prediction could not be confirmed |

Inference, reference enrollment, authentication, inventory and invoice endpoints were real. Only camera transport was simulated for repeatability; these tests do not validate physical webcam focus, actual RTSP connectivity or camera/network latency.

The updated AI suite passed **5/5 browser scenarios** in **1.2 minutes**, including automatic RTSP recognition and empty-library behavior. The **three targeted camera regressions** also passed in **26.4 seconds**: camera discovery, navigation cleanup and RTSP QR decoding. The RTSP regression now provisions its own cashier so it can run independently. The earlier **14 unit tests**, **15 application workflow tests** and **3 barcode/QR regression scenarios** also passed. Tests use temporary databases and generated internal product identifiers; production inventory and accounts are not changed.

## Current limits

- SigLIP uses the full single-product image. YOLO runs and reports boxes, but its generic packet detections remain unreliable and are not used as trusted crops.
- Unknown items can still receive similar-looking suggestions. The cashier must reject them; automatic unknown rejection is not calibrated.
- Multiple products, automatic quantities and unattended checkout remain unvalidated.
- This builds a reference library; it does not fine-tune model weights.
- Reference photos must be attached to actual inventory products before live use. The test library was in a temporary database that was removed afterward.

The tested AI environment used PyTorch 2.14.1+cpu, Transformers 5.19.0, Ultralytics 8.4.174, Pillow 12.3.0 and NumPy 2.5.2. Model token-ID configuration warnings were observed during the earlier offline benchmark; this integration uses image features only, and the current compatibility evidence is limited to the tests described here.

## Evidence

- Admin reference photos (local artifact: `../datasets/retail-catalog/ai-application-test/admin-ai-photos.png`)
- AI photo and suggestions in the real billing screen (local artifact: `../datasets/retail-catalog/ai-application-test/ai-suggestions.png`)
- Confirmed AI bill (local artifact: `../datasets/retail-catalog/ai-application-test/ai-confirmed-bill.png`)
- Independent Tiger camera-photo result (local artifact: `../datasets/retail-catalog/ai-application-test/tiger-camera-photo.png`)
- AI invoice PDF (local artifact: `../datasets/retail-catalog/ai-application-test/ai-invoice.pdf`)
- Raw observations, detections, scores and test statuses (local artifact: `../datasets/retail-catalog/ai-application-test/results.json`)
- [Playwright report](../playwright-report/ai-application/index.html)

For setup, daily use and the repeatable test command, see [AI recognition](AI-RECOGNITION.md).

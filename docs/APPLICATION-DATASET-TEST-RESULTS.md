# Application Test with Dataset Images

**Historical barcode-only baseline. AI recognition is now connected and tested through its own photo/camera controls. See the [current AI application results](AI-APPLICATION-TEST-RESULTS.md).** The findings below describe the earlier barcode-only input.

**Tested:** 19 October 2026, 1:24 PM PKT · Microsoft Edge, visible browser · Fresh production build · Real Express API and MongoDB test database

**Outcome:** Barcode/QR checkout worked in the tested flow. Automatic recognition from product packaging is **not connected to the application**.

## Product-photo uploads

Uploaded six actual photos from the prepared retailer dataset through **Scan a barcode photo**. Each product was registered in the isolated test catalog before the upload.

| Dataset product | Regular price used | App result |
| --- | ---: | --- |
| Pepsi 1.5 lt | Rs 200 | No barcode found; no product added |
| Lu Tiger Ticky Pack | Rs 10 | No barcode found; no product added |
| Dalda VTF Fortified Banaspati Ghee Pouch 1 kg | Rs 604 | No barcode found; no product added |
| Falak Daily Basmati Rice 1kg | Rs 350 | No barcode found; no product added |
| K&N's Nuggets 1 kg | Rs 1,350 | No barcode found; no product added |
| Nestle Milk Pak Dairy Cream 200 ml | Rs 245 | No barcode found; no product added |

**Packaging identification: unavailable, 0/6 added.** These uploads produced no API POST requests, no invoices and no stock changes. The browser photo handler only runs ZXing barcode/QR decoding. It does not call the offline SigLIP index or YOLO model. This is an integration gap, not a measurement of SigLIP accuracy.

## Barcode/QR and billing checks

| Check | Result |
| --- | --- |
| Admin creates cashier; temporary password replaced | Passed |
| Cashier signs in through the browser | Passed |
| EAN-13 photo decodes and selects registered Pepsi | Passed |
| QR photo decodes and selects registered Tiger | Passed |
| Quantity controls update prices | Passed |
| Two Pepsi bottles plus one Tiger packet | **Rs 410**, correct |
| Branch stock after invoice | Pepsi **10 → 8**; Tiger **10 → 9** |
| Invoice persistence, reload, search and receipt reopening | Passed |
| Receipt renders to PDF | Passed |
| Admin sales report | Rs 410 revenue, 3 units, 1 invoice |
| Cashier blocked from admin reports; admin blocked from billing | Passed |
| Unknown QR | Logged as QR_CODE, listed as unverified, no charged item |

**Final Playwright run: 3/3 scenarios passed in 28.9 seconds.** The packaging-photo scenario verifies safe rejection by the current scanner; it does not certify AI recognition. No uncaught browser errors or API 5xx responses were observed in these scenarios.

The successful barcode/QR controls use **generated test identifiers**, not verified manufacturer codes from the downloaded product photos. Names and regular prices came from the dataset. No decoder, API or model was mocked. The temporary database was removed after testing; production accounts and inventory were not changed. Live camera/RTSP hardware was outside this image-upload test.

## Evidence

- Photo-upload result (local artifact: `../datasets/retail-catalog/application-test/photo-1.png`)
- Recognized barcode/QR bill (local artifact: `../datasets/retail-catalog/application-test/recognized-bill.png`)
- Saved receipt (local artifact: `../datasets/retail-catalog/application-test/invoice.png`)
- PDF receipt (local artifact: `../datasets/retail-catalog/application-test/invoice-reprint.pdf`)
- Raw test observations (local artifact: `../datasets/retail-catalog/application-test/results.json`)
- [Playwright HTML report](../playwright-report/dataset-application/index.html)

Generated screenshots, reports and fixture codes stay local with the ignored dataset and test output.

## Reproduce

MongoDB must be running with the local `aspire-rs` replica set. The test starts its own server on port 4001 and uses a fresh `aspire_test_*` database.

```powershell
npm.cmd run build
npx.cmd playwright test --config=playwright.dataset.config.js
```

**Next integration:** connect a local image-inference service to the billing screen, map confirmed matches to real MongoDB product IDs, and retain cashier confirmation for uncertain or unknown products. The [offline model experiment](RECOGNITION-TEST-RESULTS.md) is separate evidence; its 18/18 reference-photo result is not application recognition accuracy.

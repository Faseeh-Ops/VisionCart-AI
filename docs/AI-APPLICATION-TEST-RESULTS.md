# AI Recognition: Application Test Results

**Tested:** 25 October 2026 · Visible browser · Local CPU · Real SigLIP2, YOLO26n, Express and MongoDB

The end-to-end AI test now covers **18 products**, not only Tiger biscuit or the original six-item sample. Every query uses a Carrefour image while its enrolled reference is a different Rahim Store image. No inference, catalogue, authentication, inventory or invoice API was mocked.

## Summary

| Metric | Result |
| --- | ---: |
| Products tested | 18 |
| Different-retailer query/reference pairs | 18/18 |
| Top-1 accuracy | **94.44% (17/18)** |
| Top-3 accuracy | **100% (18/18)** |
| Micro precision | **94.44%** |
| Micro recall | **94.44%** |
| Micro F1 | **94.44%** |
| Average top suggestion similarity | **0.8655** |
| Average end-to-end scan time | **4.48 seconds** |
| Browser errors | **0** |
| Playwright scenarios | **7/7 passed** in 4.8 minutes |

Precision, recall and F1 are equal here because this is a single-label test with one query per product. This small curated set is integration evidence, not a production accuracy guarantee.

## Product results

| Expected product | First suggestion | Rank of correct product | Similarity | Time |
| --- | --- | ---: | ---: | ---: |
| Bread & Beyond Milky Bread Large | Correct | 1 | 0.7351 | 5.55 s |
| Borges Red Wine Vinegar 500 ml | Correct | 1 | 0.8576 | 4.64 s |
| K&N's Nuggets 1 kg | Correct | 1 | 0.8963 | 4.78 s |
| K&N's Croquettes 1 kg | Correct | 1 | 0.8691 | 4.59 s |
| Shangrila Tomato Ketchup 3.25 kg | Correct | 1 | 0.8610 | 4.61 s |
| Butterfly Mother Comforts Extra Large 10 pcs | Correct | 1 | 0.8953 | 4.86 s |
| Co Natural Tea Tree & Neem Face Wash 60 ml | Correct | 1 | 0.9264 | 4.52 s |
| Milk Fields Dairy Cream 200 ml | Correct | 1 | 0.8529 | 4.39 s |
| Top-Tip's Cotton Buds 300 pcs | Correct | 1 | 0.8013 | 4.47 s |
| Haleeb Fresh Milk Cream 200 ml | Correct | 1 | 0.9074 | 4.29 s |
| Sensodyne Gum Care Extra Soft Toothbrush | Correct | 1 | 0.9623 | 4.30 s |
| Cappy Pulpy Orange 350 ml | Correct | 1 | 0.8341 | 4.33 s |
| Nestle Pure Life Water 500 ml | Correct | 1 | 0.9332 | 4.28 s |
| Nestle Milk Pak Dairy Cream 200 ml | Correct | 1 | 0.8833 | 4.45 s |
| Falak Daily Basmati Rice 1 kg | Correct | 1 | 0.9345 | 4.30 s |
| Coca Cola 500 ml | Correct | 1 | 0.9369 | 4.32 s |
| Fresher Mango Nectar Juice 500 ml | Correct | 1 | 0.8973 | 3.47 s |
| Farm Fresh Omega-3 Eggs 12 pcs | Coca Cola 500 ml | **3** | 0.5943 | 4.49 s |

The eggs pack is the only top-1 error. The correct eggs product still appeared as the third suggestion, so the cashier could select it. Similarity is a cosine similarity score, not a confidence percentage.

## Billing and safety results

- All 18 suggestions required cashier confirmation before entering the bill.
- The confirmed invoice contained 18 products and totalled **Rs 8,460**.
- Confirmed branch stock changed from 10 to 9 only after invoice creation.
- Another cashier could not confirm someone else's recognition result.
- Replayed confirmations were rejected.
- An unknown Mahmood coffee photo was rejected and logged without creating a sale.
- Current price, stock and selected store were rechecked during confirmation.
- An empty AI library showed setup guidance and did not send repeated inference requests.

## Camera and multi-product checks

- K&N's Nuggets replaced Tiger as the webcam and RTSP inference fixture.
- Webcam capture called the actual model through a controlled MediaStream.
- RTSP recognition waited for decoded frames, paused during review and recovered after an invalid frame.
- Empty-frame calibration blocked repeated scans of an empty counter.
- Two scans of the same physical SKU merged into quantity two.
- Five separated catalogue cards were localized and reviewed; repeated Shangrila ketchup merged by SKU.

Camera transport was simulated with real dataset frames for repeatability. This run does not measure a physical camera's focus, lighting, network latency or FFmpeg reliability.

## Evidence

- [Raw observations and scores](../datasets/retail-catalog/ai-application-test/results.json)
- [Playwright report](../playwright-report/ai-application/index.html)
- `datasets/retail-catalog/ai-application-test/ai-suggestions.png`
- `datasets/retail-catalog/ai-application-test/ai-confirmed-bill.png`
- `datasets/retail-catalog/ai-application-test/cross-store-camera-photo.png`
- `datasets/retail-catalog/ai-application-test/multi-product-review.png`
- `datasets/retail-catalog/ai-application-test/ai-invoice.pdf`

Run the same test with:

```powershell
npm run test:ai
```

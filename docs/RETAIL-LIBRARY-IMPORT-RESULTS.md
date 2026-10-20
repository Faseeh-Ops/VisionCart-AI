# Live retail library: import results

**Completed and checked: 19 October 2026. Database: `aspire_billing`.**

| Item | Result |
| --- | ---: |
| Extracted retailer listings | 9,378 |
| New catalog products after identical-label consolidation | 9,351 |
| Existing products preserved | 9 |
| Total live products | 9,360 |
| Stored AI reference photos and image vectors | 8,621 |
| Products with usable AI photos | 8,598 |
| Products awaiting photo review | 762 |
| Original branch-stock records preserved | 10 |

## What was imported

- Names, categories, regular prices in **Rs**, source URLs, listing IDs and scrape dates.
- Frozen SigLIP image vectors linked to MongoDB product IDs; model weights were not trained or replaced.
- Supplied Tiger, Innovative biscuit and Mahmood coffee photos linked to their existing barcode products.
- Internal `RETAIL-...` codes for new items, because verified manufacturer barcodes were absent from the snapshot.
- Existing names, prices, barcodes and stock stayed unchanged. New products have zero branch stock and no imported discounts.

Only identical normalized labels consolidate. Their identity is not verified by manufacturer barcode. Rahim's regular price is preferred for identical labels, with Carrefour as the fallback; other source prices remain in provenance records.

## Photo review

The importer excluded **757 listing photos** shared across different labels and skipped **two unreadable files**. Some excluded listings share a catalog identity or have another usable photo, so these counts are not additive product counts. The review list also includes existing catalog entries without photos.

Admins can open **Products > AI photos** to add or replace pictures for an exact product and pack size.

## Live application check

Visible Edge used the **actual live database and local AI models**:

| Uploaded photo | First match | Database price | Result |
| --- | --- | ---: | --- |
| Retailer Pepsi 1.5 L photo | Pepsi 1.5 lt | Rs 200 | Correct |
| Supplied Tiger handheld photo | LU Tiger biscuits | Rs 10 | Correct |

Both images were enrolled in this library. These checks establish working integration with the populated catalog, not independent accuracy. The first request took about 26 seconds including startup; the second took about 1.8 seconds. These are two UI observations, not a latency benchmark.

Catalog pagination, search and the admin photo display worked. AI returned suggestions with current prices. The selected branch had zero stock for the probes; billing remained blocked. No invoice was created, no stock was allocated and no browser errors occurred. Physical RTSP performance was not tested here.

The **18 unit tests**, **15 application workflows**, **5 isolated AI browser scenarios** and production build also passed during this change.

## Start testing

1. Refresh `http://localhost:4000` with **Ctrl + Shift + R**.
2. Admins review imported prices and add actual quantities to the appropriate branch.
3. Cashiers choose their working store, connect **AI network camera** and show one product clearly.
4. Confirm the exact pack. Use barcode/QR backup or reject an incorrect suggestion.

## Local evidence

Generated retailer data and screenshots stay local and are excluded from Git:

- Import counters and preservation checks (local artifact: `../datasets/retail-catalog/library-import/results.json`)
- Live browser observations (local artifact: `../datasets/retail-catalog/library-import/live-verification.json`)
- Products needing photo review (local artifact: `../datasets/retail-catalog/library-import/products-needing-photo-review.csv`)
- Imported Pepsi photo in the admin screen (local artifact: `../datasets/retail-catalog/library-import/live-imported-product.png`)
- Live Tiger recognition in the cashier screen (local artifact: `../datasets/retail-catalog/library-import/live-ai-recognition.png`)

The import resumed from saved checkpoints. The raw report's `newProducts` field describes the final attempt; `addedProductsSinceSnapshot` records the full 9,351-product addition. See [import rules and commands](RETAIL-LIBRARY-IMPORT.md).

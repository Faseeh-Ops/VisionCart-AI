# Pakistani Retail Catalog Snapshot

Product references from the three retailer links supplied for Aspire AI Billing. Scope: **all discovered, accessible categories**, including non-food items.

First collection, 19 October 2026: **7,489 Rahim listings** across all 164 discovered categories, plus **1,889 Carrefour listings** before its server returned HTTP 429 after 52 category attempts. Carrefour coverage is partial; 2,687 discovered categories remain unattempted. Imtiaz's shopping hostname failed DNS resolution. See `coverage.json` for current results.

All **9,378 image files** were downloaded (about 133 MB). The audit found no field/file integrity errors and flagged **341 identical-photo groups** across listings. Some variants share the same retailer photo, so collect distinct camera photos before expecting exact size, colour or shade recognition.

| File | Contents |
| --- | --- |
| `products.csv` | Open in Excel; product names, prices, categories and image links |
| `products.json` | Same records for scripts and future import tools |
| `categories.json` | Category results, reported totals and incomplete pagination |
| `coverage.json` | Counts, timestamps, source limitations and failed URLs |
| `validation.json` | Data checks, image integrity and duplicate-photo groups |
| `images/` | Original downloaded image files, when image download is enabled |

## Refresh or resume

From the project folder, using Node.js 20 or newer:

```powershell
node scripts/extract-retail-catalog.mjs
node scripts/extract-retail-catalog.mjs --images-only
node scripts/validate-retail-catalog.mjs
```

The first command collects listings; the second downloads their images; the third checks the result. Cached category responses let interrupted runs resume. Use `--refresh` for a fresh listing snapshot, or `--download-images` to collect listings and pictures in one run. Image URLs always remain in the CSV and JSON, including failed downloads. The extractor stops requests to a host that returns an access denial or rate limit.

## Prices and coverage

- **Rahim:** regular price is the displayed “Was” price where available; otherwise it is the displayed price. Current selling price has its own column.
- **Carrefour:** `markedPrice` is the regular/list price; `sellingPrice` is separate. Default delivery context was observed as Akram Abad Walton, Lahore during inspection. Prices and availability may differ by delivery area. Category first pages are collected; pagination URLs excluded by the site's robots.txt are not requested.
- **Imtiaz:** the supplied site is corporate. The shopping subdomain could not be retrieved during inspection. See `coverage.json` for the actual run result; no promotional or guessed prices are substituted.
- Empty regular prices mean unavailable data. Retailer IDs are **not EAN barcodes**; missing barcodes stay empty. This is a timestamped snapshot, not live pricing.

## Use with YOLO and SigLIP 2

The first 50-item recognition experiment has run. See the [pilot results](../../docs/RECOGNITION-TEST-RESULTS.md) for measured matching results, camera-photo checks and detector limitations.

1. Review names, sizes, variants and duplicate listings across stores. Assign your own canonical SKU IDs.
2. Keep prices in the application's product database, separate from model weights.
3. Use retailer photos as candidate reference images for a **SigLIP 2 retrieval index**. Some Rahim photos are only 200 × 200; Carrefour links currently serve 300 × 300 packshots. Confirm retrieval quality on independent camera photos before considering fine-tuning.
4. Add real checkout images and bounding-box annotations for **YOLO training**. These catalog images have no detection boxes and do not demonstrate camera angles, occlusion or multiple products.
5. Keep held-out photos from different capture sessions for evaluation. Do not split copies of the same retailer image across training and testing.

Products sold in Pakistan can include imported goods. Photos remain retailer/supplier content; public access does not grant a training or redistribution license. Review permissions before wider use. Generated snapshots and photos are excluded from Git. Nothing is imported into MongoDB automatically.

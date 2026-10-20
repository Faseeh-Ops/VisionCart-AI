# Retail product library

The local retailer snapshot can populate MongoDB products and searchable AI reference photos. This uses the downloaded SigLIP image encoder; it does not train or replace model weights.

## Import rules

- New products use the source **regular price in Rs**, with no imported discount.
- For identical labels listed by both retailers, Rahim's regular price is preferred and Carrefour is the fallback; all source prices remain in the provenance records. These are scraped catalog prices, not a live price feed.
- Existing names, prices, barcodes and branch quantities stay unchanged.
- New products have **zero stock** until an administrator allocates actual quantities to a branch.
- `RETAIL-...` identifiers are internal codes. No manufacturer barcodes were available in this snapshot.
- Only identical normalized labels consolidate. Similar-looking names, sizes and multipacks are not merged automatically. Identical labels are not manufacturer-barcode verification.
- Source URLs, original listing IDs, retailer prices and scrape dates are retained on products.
- Photos shared across different labels are excluded from automatic indexing for review. Blank, unreadable or oversized photos are also skipped; their products remain in the catalog.
- The three supplied handheld photos are linked to the existing Tiger, Innovative biscuit and Mahmood coffee products using their known barcodes.

## Reproduce or resume

Run from the existing project folder with MongoDB running and `.env` configured:

```powershell
# Preview counts without changing products or stock
npm.cmd run import:retail

# Import products and build reference vectors
npm.cmd run import:retail -- --apply
```

The importer requires an existing active administrator. It has no public endpoint and creates no accounts. Reference vectors are generated locally in batches and cached so an interrupted import can resume. Re-running preserves edited prices and existing stock and reuses matching references.

Generated evidence stays local:

| File | Purpose |
| --- | --- |
| `datasets/retail-catalog/library-import/before.json` | Original product and branch-stock snapshot |
| `datasets/retail-catalog/library-import/results.json` | Final import counts, skipped photos and preservation checks |
| `datasets/retail-catalog/library-import/encoder.log` | Local model loading diagnostics |
| `datasets/retail-catalog/library-import/cache/` | Resumable photo and embedding cache |

## Use in the app

1. Refresh and sign in. Products are searchable by name or internal code; the catalog initially shows 60 matches.
2. Admins can review a product's **AI photos**, correct the price/barcode and allocate real branch stock.
3. Cashiers choose their working store and open **AI network camera** or upload a product photo.
4. Confirm the exact product, size and pack. Unknown products still require cashier rejection.

Recognition can show an out-of-stock product, but it cannot be added to a bill until stock exists in the cashier's branch. Retailer packshots are reference material; their import is not evidence of reliable recognition under CCTV lighting, distance, occlusion or multiple-product scenes.

The runtime searches a short-lived cached vector index, then reads live prices and stock only for the best verified candidates. Admin photo changes invalidate the index immediately; changes made by the bulk importer appear after the next cache refresh, within 15 seconds.

# Three-product photo experiment

## Results

These tests actually ran on the supplied images using local downloaded YOLO26n and SigLIP2 weights, the app's ZXing browser decoder, and the existing invoice calculation function.

| Product | Supplied price | Barcode read from printed digits | SigLIP2 description ranking | ZXing photo decoding |
| --- | --- | --- | --- | --- |
| Mahmood Cappuccino Classic, 25 g | Rs 250 | 8697449918281 | Correct description ranked first | Decoded after 90-degree rotation |
| Innovative Choc n Chip biscuits | Rs 10 | 8965310043173 | Correct description ranked first | Decoded after a cropped retry |
| LU Tiger biscuits | Rs 10 | 8961003694271 | Correct description ranked first | Failed on supplied photo, including rotated and cropped retries |

The spelling on the packaging is Mahmood and Innovative; the source filenames retain the supplied mehmood/innovita spellings. All three transcribed barcode numbers pass the EAN-13 check-digit calculation. A valid check digit does not prove the image decoder read a barcode: Tiger is manually transcribed and remains unverified by scanning.

YOLO did not reliably detect the product packets: Mahmood's photo returned keyboard/person boxes, Innovative's returned person/donut/keyboard, and Tiger's returned person/tie/keyboard. The pretrained model therefore cannot yet provide dependable product crops for this pilot.

SigLIP2 ranked each full front photo against five hand-written descriptions: the three supplied products, a keyboard and an empty desk. All three product descriptions ranked first. This is a small closed-choice, zero-shot experiment, not trained SKU recognition, independent accuracy measurement or a validated confidence percentage. Descriptions include packaging colours; the result does not establish brand-reading ability, size discrimination or unknown rejection. SigLIP2 was tested on full photos, independently of YOLO; this was not a successful end-to-end detection pipeline.

The billing test used the supplied prices with one of each product and zero discount: **Rs 270 total**. It ran the existing `calculateInvoice` function with synthetic IDs and stock fixtures. No production inventory, real stock or invoice was written. No stock quantity was supplied by the user, so none was invented for live inventory.

## Barcode test details

The original full-photo decoder failed on all three unrotated images. Rotation and crop retries decoded Mahmood and Innovative; Tiger failed. The application now uses a shared production decoder with harder decoding, four rotations and crop retries in both billing and inventory. The pilot harness imports that same production decoder and confirms Mahmood and Innovative still decode while Tiger does not. Camera scanning requests higher resolution and shorter scan intervals; real camera recognition speed remains dependent on focus, lighting and device capability.

This exercises the same ZXing decoder used by the application; it does not demonstrate live-camera operation, authenticated product registration or persisted checkout. Tiger needs a new sharp, straight-on photo of the entire barcode with margins and reduced reflection, or manual barcode entry followed by verification on the physical packet.

## Reproduce

Run from the existing project folder after installing the AI dependencies:

```powershell
.\.venv-ai\Scripts\python.exe models/product-pilot/test_models.py
node models/product-pilot/test-barcodes.mjs
node models/product-pilot/test-prices.mjs
```

The browser experiment requires installed Microsoft Edge and available local port 5189. It uses a temporary local image server and closes it after testing. Model inference uses CPU, local weights and no training. The script confines Ultralytics settings to this pilot directory.

Raw evidence is saved in `model-results.json`, `barcode-results.json` and `price-results.json`. Model loading emitted Transformers configuration warnings about default token IDs; outputs were produced successfully, but dependency/configuration compatibility should be resolved and pinned before relying on deployment results.

## Next work

1. Obtain several new photos per SKU and a clearer Tiger barcode image. Keep independent evaluation images apart from reference images.
2. Register the products through admin inventory with these real barcodes, supplied prices and confirmed stock counts.
3. Create the SKU-to-MongoDB-ID reference manifest and frozen image-embedding index; evaluate new photos and unknown items.
4. Fine-tune YOLO on annotated packet scenes because the downloaded general detector missed these packets.
5. Integrate candidate display and cashier confirmation before enabling any AI billing.

These six images were copied into `images/` inside the existing project. Original files in Downloads were preserved. This experiment does not train either model or enable AI checkout.

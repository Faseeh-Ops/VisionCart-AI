# Aspire AI Billing: Pakistani product recognition and pricing proposal

## Executive proposal

Begin with a pilot of 5–10 exact Pakistani grocery products. YOLO locates items in camera images; SigLIP2 compares each detected crop with reference photos linked to inventory products. The cashier confirms matches, and the backend retrieves current prices from MongoDB. Recognition models should identify products, not learn or generate their prices.

Downloaded pretrained weights provide a starting point, not a ready-made catalogue of Pakistani brands, sizes and flavours. Product photos, evaluation and application integration are still required. This document proposes future work; it does not implement AI checkout or run training.


## Current project and intended flow

The MERN app already stores products, prices, discounts, stock and invoices. YOLO26n is downloaded in `models/detector/yolo26n.pt`; SigLIP2 is downloaded in `models/siglip2/`. AI inference and reference-photo management are not yet connected to checkout.

```text
Camera capture -> YOLO item boxes -> cropped product images
  -> SigLIP2 reference matching -> candidate inventory product IDs
  -> cashier confirms product and quantity
  -> Express reads MongoDB price, discount and stock
  -> invoice saved and inventory deducted
```

## 1. Prepare the product catalogue and photos

Create a separate inventory entry for each exact SKU: for example Pepsi 500 ml, Pepsi 1.5 litres, Lay's Salted 52 g and a particular coffee sachet size. Record its actual barcode, exact name, pack size, price in Rs and MongoDB product ID. A price change alone does not require a new visual class.

For a first reference-matching experiment, collect 10–20 diverse reference images per SKU. For detector training, initially budget around 100–300 labelled product appearances per SKU across checkout scenes. These are planning suggestions, not guaranteed sufficient quantities; expand based on measured errors.

Photograph fronts, backs, sides and tilted packs under different lighting, distances and backgrounds. Include glare, partially hidden products, multiple copies and mixed products. Use multiple physical packs where possible. Also collect empty-counter scenes and products outside the catalogue. Nearly identical video frames do not provide much diversity.

Keep everything inside the existing project:

```text
models/reference-products/pepsi-500ml/front.jpg
models/reference-products/pepsi-500ml/side.jpg
models/reference-products/lays-salted-52g/front.jpg
datasets/pakistani-products/images/train/
datasets/pakistani-products/images/val/
datasets/pakistani-products/images/test/
datasets/pakistani-products/labels/train/
datasets/pakistani-products/labels/val/
datasets/pakistani-products/labels/test/
datasets/pakistani-products/data.yaml
```

A reference manifest must link each folder to a real MongoDB product ID. Folder names do not automatically connect to inventory. Packaging changes require updated references and testing.

## 2. Train YOLO to find products

Recommended approach: fine-tune YOLO with one class, `retail_product`, to detect each grocery item. Let SigLIP2 identify the SKU. Alternatively, a small fixed catalogue can use one YOLO class per SKU, but adding new classes then requires dataset updates and detector retraining.

Use an annotation tool such as CVAT or Label Studio to draw boxes around every visible product and export YOLO detection labels. Each image has a corresponding `.txt` file. Each line contains a zero-based class ID followed by normalized box coordinates:

```text
class_id x_center y_center width height
0 0.50 0.45 0.30 0.60
```

The numbers are illustrative. Each physical item needs its own box, including two copies of the same product. Include reviewed negative images without product boxes. See the [official detection dataset format](https://docs.ultralytics.com/datasets/detect/).

Split approximately 70% training, 15% validation and 15% held-out testing by capture session, video, physical pack or location before augmentation. Do not put related video frames in different splits. Keep final test images out of the SigLIP2 reference gallery too.

Example `data.yaml` for the recommended single-class detector:

```yaml
path: C:/Users/Faseeh/Desktop/VisionCart AI/datasets/pakistani-products
train: images/train
val: images/val
test: images/test
names:
  0: retail_product-
```

After installing the AI dependencies and preparing the labelled dataset, run from the project folder:

```powershell
.\.venv-ai\Scripts\yolo.exe detect train model=./models/detector/yolo26n.pt data=./datasets/pakistani-products/data.yaml epochs=50 imgsz=640 batch=4 device=cpu workers=0 project=./models/runs name=pakistani-detector
```

These are initial experiment settings. CPU training can be slow. With a compatible NVIDIA GPU and CUDA-enabled PyTorch installation, use `device=0` and adjust batch size to memory. Duration depends on hardware and dataset size.

The checkpoint is normally `models/runs/pakistani-detector/weights/best.pt`; repeated runs may create numbered folders. Evaluate the trained checkpoint:

```powershell
.\.venv-ai\Scripts\yolo.exe detect val model=./models/runs/pakistani-detector/weights/best.pt data=./datasets/pakistani-products/data.yaml split=test device=cpu workers=0
```

Ultralytics supports fine-tuning from pretrained weights. This command trains YOLO only, not SigLIP2. See [official training documentation](https://docs.ultralytics.com/modes/train/).

## 3. Start with frozen SigLIP2; fine-tune if evaluation requires it

Initially, do not change SigLIP2 weights. Encode each labelled reference photo into an image embedding, normalize it and store it with the product ID. Encode a YOLO crop using the same preprocessing and compare embeddings with cosine similarity. Return candidate SKU IDs, using several reference views for each product. Validate how scores from multiple views are combined.

This is building a reference index, not training model weights. Adding reference photos can support new SKUs without retraining the encoder, but detection coverage and recognition accuracy must still be tested. The indexing and matching service needs implementation. SigLIP2 provides [image feature extraction](https://huggingface.co/docs/transformers/model_doc/siglip2).

If it confuses products, first improve reference images and detector crops. If failures persist, fine-tune the image encoder using labelled crops and supervised contrastive or triplet learning. Different views of the same SKU are positive pairs; different SKUs are negatives. Include hard negatives such as identical branding with different sizes or flavours. A supervised SKU classification head is an alternative for a fixed catalogue, but adding classes requires updating that head.

This fine-tuning needs a custom training pipeline, suitable compute and comparison with the frozen baseline. There is no YOLO command that also trains SigLIP2. Include older products during updates to reduce forgetting. After encoder weights change, regenerate all reference embeddings and version the encoder and index together.

Choose rejection thresholds and the required difference between the two highest SKU scores using validation data, not the final test set. Unknown products must not be forced into the closest known SKU. Cosine similarity is not a calibrated confidence percentage; displaying “97% confidence” requires calibration and evaluation.

## 4. Prices belong in MongoDB

**The admin enters prices and discounts in inventory. Neither model needs to learn prices.** Recognition returns a product ID. Express retrieves that product's current database price, validates stock and applies the stored discount before billing.

Illustrative fields supported by the current catalogue:

```json
{
  "_id": "<actual MongoDB product ID>",
  "name": "Pepsi 500 ml",
  "barcode": "<barcode printed on the actual bottle>",
  "price": 120,
  "discountPercent": 0,
  "stock": 60,
  "verified": true
}
```

Rs 120 and stock 60 are examples, not live market values. ID and barcode are placeholders. Brand and pack size can currently be included in the name; separate fields could be added later.

If the admin changes Pepsi's price from Rs 120 to Rs 130, future invoices use Rs 130 without retraining. Existing invoices retain their recorded sale prices. Browser or AI output must never bypass backend catalogue prices, permissions or stock validation.

Proposed reference manifest, which is not implemented yet:

```json
{
  "pepsi-500ml": {
    "productId": "<actual MongoDB product ID>",
    "images": ["models/reference-products/pepsi-500ml/front.jpg"]
  }
}
```

## 5. Proposed application features

| User | Workflow |
| --- | --- |
| Admin | Add inventory by barcode or manually, set price/discount/stock, attach reference photos, rebuild reference index and review errors. |
| Cashier | Capture camera image, inspect candidate names and crops, confirm or correct matches and quantity, use barcode fallback, generate invoice. |

Begin with capture-and-confirm. Continuous scanning needs tracking or another duplicate-prevention mechanism so one stationary item is not added on every frame. Detection counts are candidate quantities and need validation.

Unknown or ambiguous products should be excluded from the bill until resolved. The local Python inference service should receive images through an authenticated Express endpoint. Existing cashier-only billing, admin-only inventory controls and store checks must remain enforced by the backend.

## 6. Pilot evaluation and delivery

Measure detection precision/recall, exact-SKU accuracy, unknown rejection, false acceptance, size/flavour confusion, quantity errors, cashier corrections and end-to-end latency on the intended computer. Test actual checkout scenes, unseen packs and out-of-catalogue products. Review performance by SKU; an overall average can hide a failure on one size or flavour.

Agree with management on acceptable error rates before testing. Keep cashier confirmation until results justify automation. Low-certainty matches always need fallback.

Suggested delivery stages:

1. Select 5–10 SKUs, verify catalogue entries and collect labelled photos.
2. Test still-image matching with frozen SigLIP2 and downloaded YOLO; identify missed packets and confused variants.
3. Fine-tune YOLO where necessary and evaluate on held-out scenes.
4. Build admin photo management, the inference service and cashier confirmation interface.
5. Add live scanning with duplicate prevention and quantity testing.
6. Fine-tune the encoder only if measured errors remain; compare against the frozen baseline before deployment.

The primary work is data collection, annotation, integration and testing. Accuracy and schedule cannot be promised from downloaded weights alone.

## Licenses and scope

[YOLO26](https://huggingface.co/Ultralytics/YOLO26) uses AGPL-3.0; review obligations and enterprise options before commercial deployment. [SigLIP2](https://huggingface.co/google/siglip2-base-patch16-224) uses Apache-2.0.

This proposal keeps the **VisionCart AI** folder and **Aspire AI Billing** name. It changes documentation only; no training or app integration has been performed by writing this document.

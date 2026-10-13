# Local AI model preparation

YOLO26n and SigLIP2 weights have been downloaded locally, but the app does not load them yet. This directory stays inside **VisionCart AI**. See [the training and pricing proposal](TRAINING-PROPOSAL.md) for a plan that can be shared with management.

Recommended initial experiment: a product detector plus a catalog image encoder. The detector crops items, and the encoder compares those crops with labeled reference photos of each exact SKU. Generic pretrained models are not a ready-made Pakistani grocery SKU recognizer. Their suitability must be measured on your actual products, lighting, camera, quantities, and overlapping items; detector fine-tuning may be necessary.

## Official downloads

- [Ultralytics YOLO26 nano weights](https://huggingface.co/Ultralytics/YOLO26/blob/main/yolo26n.pt): detector starting point. [Model documentation](https://docs.ultralytics.com/models/yolo26/). Ultralytics provides AGPL-3.0 and Enterprise licensing options; evaluate the license for your intended business deployment.
- [Google SigLIP 2 base](https://huggingface.co/google/siglip2-base-patch16-224): image/text encoder for a catalog-matching experiment; Apache-2.0. Download its complete model folder, including configuration, preprocessing/tokenizer files, and safetensors.
- [Qwen3.5-4B](https://huggingface.co/Qwen/Qwen3.5-4B): optional vision-language model for examining packaging and text; Apache-2.0. It is a separate, larger experiment rather than a requirement for the initial pipeline.

To download the initial pair, run these commands from the project folder using an AI-compatible Python environment:

```powershell
python -m pip install -U huggingface_hub
hf download Ultralytics/YOLO26 yolo26n.pt --local-dir ./models/detector
hf download google/siglip2-base-patch16-224 --local-dir ./models/siglip2
```

These only download files. They do not install the inference stack or activate AI billing. [Official Hugging Face CLI instructions](https://huggingface.co/docs/huggingface_hub/guides/cli).

Collect labeled photos of each product and pack size from several angles as an initial reference set. For example, Pepsi 500 ml and Pepsi 1.5 litre need separate catalog entries. Reference images, a measured rejection threshold, and cashier confirmation are essential for ambiguous matches. Similarity scores must not be presented as calibrated confidence percentages without validation.

The planned integration is: camera frames -> local Python inference service -> catalog product IDs and candidate scores -> cashier confirmation -> existing Express invoice and inventory APIs. Prices must always come from MongoDB, never from generated AI text. Adding a product through barcode inventory scanning currently stores its barcode and catalog details; it does not train an AI model or add a visual reference automatically.

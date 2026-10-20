# Local AI recognition

The app now loads local YOLO26n and SigLIP 2 weights through a persistent Python worker when AI reference photos or recognition are first used. See [AI setup and use](../docs/AI-RECOGNITION.md) and the [training and pricing proposal](TRAINING-PROPOSAL.md).

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

The implemented path is: one product photo or captured frame -> local Python worker -> SigLIP reference matching -> MongoDB product IDs and current branch stock -> cashier confirmation -> existing invoice API. Admins attach reference photos through **Products > AI photos**. Indexing reference photos does not fine-tune model weights.

YOLO runs and returns diagnostic boxes. Its generic packet detections failed the pilot, so the current recognizer uses the whole single-product image instead of treating person/tie/donut boxes as product crops. Calibrated multi-product mode instead uses foreground components, batches their crops through SigLIP, and reviews each region separately. Prices always come from MongoDB.

An experimental one-class YOLO candidate was trained on 900 synthetic scenes using an RTX 4050. Its weights remain local under `models/retail-detector/candidate.pt` and are not automatically loaded into billing. See [GPU setup and training](../docs/GPU-DETECTOR-TRAINING.md) and [measured evaluation](../docs/MODEL-EVALUATION.md).

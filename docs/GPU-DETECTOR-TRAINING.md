# Local GPU detector bootstrap

This experiment fine-tunes the existing YOLO26n checkpoint to detect one class, `retail_product`. It does not train SigLIP or assign exact inventory IDs. The app's CPU Python environment and live recognition settings remain unchanged.

The checked computer has an NVIDIA RTX 4050 Laptop GPU with 6 GB VRAM. Its existing `.venv-ai` environment contains CPU-only PyTorch. `.venv-train-gpu` installs CUDA PyTorch separately and reuses the other local AI dependencies through a `.pth` path; keep both environments available. No system CUDA toolkit installation is required for the downloaded Windows PyTorch wheel.

## Data and limits

`scripts/prepare-detector-training.py` selects 160 catalog images, removes border-connected white backgrounds, and creates 900 deterministic 640×640 scenes with rotation, partial overlap, shadows, mild glare/blur and negative scenes. Labels are generated from the visible foreground masks. These are automatically generated synthetic labels, not reviewed physical checkout annotations.

- Train: 600 scenes from 100 source photos.
- Validation: 120 scenes from 30 other source photos.
- Test: 180 scenes from 30 other source photos.

Identical file hashes and near-identical foreground hashes are excluded while selecting sources. The source hashes are disjoint across splits, and the previously tested 32-product source/reference files are excluded. Related supplier photos and inaccurate retailer packaging depictions can still limit the results. Generalization to a real counter, hands, glare and occlusion remains unproven.

## Environment

Create `.venv-ai` and install the inference dependencies first. The separate training environment can reuse those packages while overriding only PyTorch and torchvision locally:

```powershell
.\.venv-ai\Scripts\python.exe -m venv .venv-train-gpu
(Join-Path (Get-Location) ".venv-ai/Lib/site-packages") | Set-Content .venv-train-gpu/Lib/site-packages/visioncart-runtime.pth
.\.venv-train-gpu\Scripts\python.exe -m pip install --no-deps --ignore-installed torch==2.14.1+cu130 torchvision==0.29.1+cu130 --index-url https://download.pytorch.org/whl/cu130
.\.venv-train-gpu\Scripts\python.exe -c "import torch; print(torch.cuda.is_available(), torch.cuda.get_device_name(0))"
```

These are the CUDA 13.0 package versions used for this run. Use the [official PyTorch installer](https://pytorch.org/get-started/locally/) to select compatible wheels for another Python/driver setup. The CUDA download is approximately 2 GB.

## Run

The training data builder expects a prepared retailer snapshot, the frozen reference benchmark and the expanded stress manifest. Generate those prerequisites first if they are absent:

```powershell
.\.venv-ai\Scripts\python.exe scripts/test-retail-recognition.py
.\.venv-ai\Scripts\python.exe scripts/make-multiframe-stress.py
.\.venv-ai\Scripts\python.exe scripts/make-expanded-multiframe-stress.py
```

Then prepare and train:

```powershell
.\.venv-ai\Scripts\python.exe scripts/prepare-detector-training.py
.\.venv-train-gpu\Scripts\python.exe scripts/train-retail-detector.py --epochs 25 --batch 8
```

Training explicitly requires CUDA device 0. It first measures the original model class-agnostically on the synthetic test split, then fine-tunes a one-class detector and evaluates the best checkpoint on the same test split. Only validation metrics select the checkpoint or stop training; the final test is not used to choose training settings.

The original detector comparison treats every COCO prediction as a possible product region; it is a class-agnostic localization baseline, not an existing retail classifier. Precision, recall, mAP at IoU 0.5 and mAP averaged over IoU 0.5–0.95 are recorded. Synthetic test improvement does not establish real-world accuracy or exact-SKU improvement.

Artifacts:

- `datasets/product-detector/manifest.json`: sources, provenance, split membership and generated boxes.
- `models/runs/retail-bootstrap-4050/`: training configuration, losses, validation metrics and original checkpoints.
- `models/retail-detector/candidate.pt`: copy of the selected experimental checkpoint.
- `models/retail-detector/training-report.json`: GPU, before/after results and limitations.
- `models/retail-detector/progress.json`: last finished epoch.

The training script does not activate its candidate in the billing app or change inventory. Validate the checkpoint on new, manually annotated physical checkout scenes before treating it as a reliable detector. Exact SKU matching, unknown rejection and duplicate tracking require their own evaluations.

## Recorded result

The local run stopped early after 24 epochs. On 180 source-disjoint synthetic test scenes, class-agnostic detector mAP50 increased from 70.6% to 93.4%; recall increased from 60.0% to 86.8%. False detections remain, particularly with overlap and hand fragments. Full results and verification scope are summarized in [model evaluation](MODEL-EVALUATION.md). The billing app continues to use its existing recognition path.

"""GPU bootstrap fine-tuning, with before/after held-out synthetic evaluation."""
import argparse
import json
import os
import time
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
os.environ['YOLO_CONFIG_DIR']=str(ROOT/'.tools/ai-training')
os.environ['YOLO_AUTOINSTALL']='false'
os.environ['MPLCONFIGDIR']=str(ROOT/'.tools/ai-training/matplotlib')
os.environ['TORCH_HOME']=str(ROOT/'.tools/ai-training/torch')
Path(os.environ['YOLO_CONFIG_DIR']).mkdir(parents=True,exist_ok=True)


def metric_summary(metrics):
    return {'precision':float(metrics.box.mp),'recall':float(metrics.box.mr),
            'mAP50':float(metrics.box.map50),'mAP50_95':float(metrics.box.map)}


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--epochs',type=int,default=25)
    parser.add_argument('--batch',type=int,default=8)
    parser.add_argument('--name',default='retail-bootstrap-4050')
    args=parser.parse_args()
    import torch
    from ultralytics import YOLO,settings
    if not torch.cuda.is_available():
        raise RuntimeError('CUDA is unavailable. Use .venv-train-gpu with CUDA PyTorch.')
    settings.update({'weights_dir':str(ROOT/'models/detector'),'runs_dir':str(ROOT/'models/runs'),'datasets_dir':str(ROOT/'datasets'),'sync':False,'clearml':False,'comet':False,'dvc':False,'mlflow':False,'raytune':False,'wandb':False})
    data=ROOT/'datasets/product-detector/data.yaml'
    manifest=json.loads((data.parent/'manifest.json').read_text(encoding='utf-8'))
    run=ROOT/'models/runs'/args.name
    if (run/'weights/best.pt').exists():
        raise RuntimeError('Run already has trained weights; choose another --name to preserve them.')
    output=ROOT/'models/retail-detector'
    output.mkdir(parents=True,exist_ok=True)
    report={'startedAt':time.strftime('%Y-%m-%dT%H:%M:%S'),'gpu':torch.cuda.get_device_name(0),
            'gpuVramBytes':torch.cuda.get_device_properties(0).total_memory,'torch':torch.__version__,
            'cuda':torch.version.cuda,'epochsRequested':args.epochs,'batch':args.batch,
            'images':{k:len(v) for k,v in manifest['scenes'].items()},
            'sourceImages':{k:len(v) for k,v in manifest['sources'].items()},
            'limitations':manifest['limitations'],'liveAppChanged':False}
    (output/'training-report.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    baseline=YOLO(str(ROOT/'models/detector/yolo26n.pt'))
    # Class-agnostic comparison: every generic COCO box is treated as a product candidate.
    baseline_metrics=baseline.val(data=str(data),split='test',device=0,imgsz=640,batch=args.batch,
                                   single_cls=True,workers=0,plots=False,project=str(ROOT/'models/runs'),name=args.name+'-baseline',verbose=False)
    report['baseline']=metric_summary(baseline_metrics)
    del baseline
    torch.cuda.empty_cache()
    model=YOLO(str(ROOT/'models/detector/yolo26n.pt'))
    def progress(trainer):
        record={'epoch':trainer.epoch+1,'epochs':args.epochs,'gpu':report['gpu'],'metrics':{k:float(v) for k,v in trainer.metrics.items()}}
        (output/'progress.json').write_text(json.dumps(record,indent=2)+'\n',encoding='utf-8')
        print('TRAIN_PROGRESS '+json.dumps(record),flush=True)
    model.add_callback('on_fit_epoch_end',progress)
    started=time.monotonic()
    model.train(data=str(data),epochs=args.epochs,imgsz=640,batch=args.batch,device=0,
                workers=2,amp=True,cache=False,seed=405032,deterministic=True,
                project=str(ROOT/'models/runs'),name=args.name,exist_ok=False,
                optimizer='AdamW',lr0=.001,lrf=.05,weight_decay=.0005,
                patience=8,warmup_epochs=2,close_mosaic=5,mosaic=.5,mixup=0,
                degrees=10,translate=.1,scale=.3,fliplr=.2,flipud=.1,
                plots=True,save=True,save_period=5,verbose=False)
    best=Path(model.trainer.best)
    trained=YOLO(str(best))
    tested=trained.val(data=str(data),split='test',device=0,imgsz=640,batch=args.batch,
                       workers=0,plots=True,project=str(ROOT/'models/runs'),name=args.name+'-test',verbose=False)
    report.update({'trained':metric_summary(tested),'trainingSeconds':time.monotonic()-started,
                   'bestCheckpoint':str(best),'completedEpochs':model.trainer.epoch+1})
    import csv
    import hashlib
    history=list(csv.DictReader((Path(model.trainer.save_dir)/'results.csv').read_text(encoding='utf-8').splitlines()))
    report['completedEpochs']=len(history)
    report['earlyStopped']=len(history)<args.epochs
    report['datasetManifestSha256']=hashlib.sha256((data.parent/'manifest.json').read_bytes()).hexdigest()
    report['improvedOnSyntheticTest']=report['trained']['mAP50_95']>report['baseline']['mAP50_95']
    # Preserve candidate weights independently; this does not activate them in the app.
    import shutil
    shutil.copy2(best,output/'candidate.pt')
    (output/'training-report.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    (output/'progress.json').write_text(json.dumps({'status':'completed','completedEpochs':report['completedEpochs'],'epochsRequested':args.epochs,'earlyStopped':report['earlyStopped'],'testMetrics':report['trained']},indent=2)+'\n',encoding='utf-8')
    print('TRAIN_COMPLETE '+json.dumps(report),flush=True)


if __name__=='__main__':
    main()

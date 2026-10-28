import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createInterface} from 'node:readline';

let child=null,starting=null,ready=false;
const pending=new Map();
const python=()=>process.env.AI_PYTHON_PATH||path.resolve(process.platform==='win32'?'.venv-ai/Scripts/python.exe':'.venv-ai/bin/python');
export function aiAvailability(){
  const yoloMode=String(process.env.AI_YOLO_MODE||'off').toLowerCase();
  const detectorPath=yoloMode==='custom'?'models/retail-detector/candidate.pt':'models/detector/yolo26n.pt';
  const yoloAvailable=yoloMode!=='off'&&existsSync(path.resolve(detectorPath));
  return {available:existsSync(python())&&existsSync(path.resolve('models/siglip2/model.safetensors')),loaded:ready,model:'SigLIP 2 product matching',yoloAvailable,yoloMode,detector:yoloAvailable?path.basename(detectorPath):null,mode:'Unified code and appearance matching with cashier confirmation'};
}
const unavailable=()=>Object.assign(Error('Local AI is unavailable. Install the AI environment and downloaded model files.'),{status:503});
function start(){
  if(ready)return Promise.resolve();
  if(starting)return starting;
  if(!aiAvailability().available)throw unavailable();
  starting=new Promise((resolve,reject)=>{
    const processHandle=spawn(python(),['-u',path.resolve('server/ai-worker.py')],{windowsHide:true,stdio:['pipe','pipe','pipe']});
    child=processHandle;
    const timer=setTimeout(()=>{reject(unavailable());processHandle.kill();},180000);
    const fail=()=>{
      clearTimeout(timer);if(child!==processHandle)return;
      ready=false;starting=null;child=null;reject(unavailable());
      for(const {reject:deny,timer:t}of pending.values()){clearTimeout(t);deny(unavailable());}pending.clear();
    };
    processHandle.on('error',fail);processHandle.on('exit',fail);
    // Model diagnostics may be verbose. Never send them or image bytes to clients.
    processHandle.stderr.on('data',()=>{});
    createInterface({input:processHandle.stdout}).on('line',line=>{
      let message;try{message=JSON.parse(line);}catch{return;}
      if(message.ready){clearTimeout(timer);ready=true;resolve();return;}
      if(message.fatal){fail();processHandle.kill();return;}
      const job=pending.get(message.id);if(!job)return;
      pending.delete(message.id);clearTimeout(job.timer);
      if(message.error)job.reject(Object.assign(Error(message.error),{status:400}));else job.resolve(message.result);
    });
  });
  return starting;
}
export const warmAiRuntime=()=>start();
export async function encodeProductPhoto(photo,{mode='single',backgroundPhoto,purpose='query'}={}){
  if(pending.size>=4)throw Object.assign(Error('AI is busy. Try again in a moment.'),{status:429});
  await start();
  if(pending.size>=4)throw Object.assign(Error('AI is busy. Try again in a moment.'),{status:429});
  return new Promise((resolve,reject)=>{
    const id=randomUUID();
    const timer=setTimeout(()=>{pending.delete(id);reject(Object.assign(Error('AI recognition timed out. Please try again.'),{status:504}));},45000);
    pending.set(id,{resolve,reject,timer});
    child.stdin.write(JSON.stringify({id,photo,mode,backgroundPhoto,purpose})+'\n',error=>{if(error){pending.delete(id);clearTimeout(timer);reject(unavailable());}});
  });
}
process.once('exit',()=>child?.kill());

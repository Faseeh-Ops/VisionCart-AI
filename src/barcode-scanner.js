import {BrowserMultiFormatReader} from '@zxing/browser';
import {BarcodeFormat,DecodeHintType} from '@zxing/library';

export function createBarcodeReader() {
  const hints=new Map();
  hints.set(DecodeHintType.TRY_HARDER,true);
  hints.set(DecodeHintType.POSSIBLE_FORMATS,[BarcodeFormat.EAN_13,BarcodeFormat.EAN_8,BarcodeFormat.UPC_A,BarcodeFormat.UPC_E,BarcodeFormat.CODE_128,BarcodeFormat.CODE_39,BarcodeFormat.ITF,BarcodeFormat.QR_CODE]);
  return new BrowserMultiFormatReader(hints,{delayBetweenScanAttempts:120,delayBetweenScanSuccess:400});
}

export function cameraConstraints(deviceId,devices=[]) {
  const virtual=/droidcam|iriun|virtual|obs|camo/i.test(devices.find(d=>d.deviceId===deviceId)?.label||'');
  // Virtual drivers negotiate their own pixel format and resolution. Forcing
  // HD capture can produce invalid frames on some phone-webcam drivers.
  return {audio:false,video:{...(deviceId?{deviceId:{exact:deviceId}}:{facingMode:{ideal:'environment'}}),...(!virtual?{width:{ideal:1280},height:{ideal:720},frameRate:{ideal:30}}:{})}};
}

export function watchCameraFrames(video,onProblem) {
  const canvas=document.createElement('canvas');canvas.width=32;canvas.height=24;
  let greenFrames=0,reported=false;
  const timer=setInterval(()=>{
    if(video.readyState<2||!video.videoWidth)return;
    try {
      const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(video,0,0,32,24);
      const pixels=ctx.getImageData(0,0,32,24).data;
      let green=0;
      for(let i=0;i<pixels.length;i+=4)if(pixels[i+1]>35&&pixels[i+1]>pixels[i]*2+15&&pixels[i+1]>pixels[i+2]*2+15)green++;
      greenFrames=green>32*24*.98?greenFrames+1:0;
      if(greenFrames>=3&&!reported){reported=true;onProblem('The selected camera is sending solid green frames. Check the DroidCam Windows preview, reconnect the phone, then restart the camera. If that preview works, try disabling browser graphics acceleration and restarting the browser.');}
    } catch {}
  },1500);
  return()=>clearInterval(timer);
}


export async function decodeBarcodePhoto(url) {
  const image=new Image();image.src=url;await image.decode();
  const scale=Math.min(1,2400/Math.max(image.width,image.height));
  const base=document.createElement('canvas');base.width=Math.round(image.width*scale);base.height=Math.round(image.height*scale);
  base.getContext('2d').drawImage(image,0,0,base.width,base.height);
  const w=base.width,h=base.height;
  const regions=[[0,0,w,h],[w*.2,h*.3,w*.5,h*.4],[w*.25,h*.44,w*.4,h*.23],[w*.34,h*.30,w*.32,h*.39]];
  const reader=createBarcodeReader();
  for(const region of regions) for(const angle of [0,90,180,270]) {
    const [x,y,rw,rh]=region;
    const canvas=document.createElement('canvas');canvas.width=Math.round(angle%180?rh:rw);canvas.height=Math.round(angle%180?rw:rh);
    const ctx=canvas.getContext('2d');ctx.translate(canvas.width/2,canvas.height/2);ctx.rotate(angle*Math.PI/180);
    ctx.drawImage(base,x,y,rw,rh,-rw/2,-rh/2,rw,rh);
    try {return await reader.decodeFromImageUrl(canvas.toDataURL('image/png'));} catch {}
    // Yield so photo retries don't freeze the interface.
    await new Promise(resolve=>setTimeout(resolve,0));
  }
  throw new Error('Barcode could not be decoded. Try a sharp photo without glare, or enter the printed number.');
}

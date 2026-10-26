import React,{useEffect,useRef,useState} from 'react';
import {createScanConsensus,decodeBarcodePhoto,scanDetails} from './barcode-scanner.js';
import {productPhotoFromElement} from './product-photo.js';

export default function RtspScanner({api,token,onCode,onStop,onCapture,onFrame,scanPaused=false,captureBusy=false,captureDisabled=false}) {
 const [address,setAddress]=useState(''),[id,setId]=useState(''),[error,setError]=useState(''),[status,setStatus]=useState(''),[busy,setBusy]=useState(false),[frameReady,setFrameReady]=useState(false);
 const preview=useRef(),decodedFrame=useRef(null),seen=useRef({text:'',accepted:false}),consensus=useRef(createScanConsensus()),callback=useRef(onCode),capture=useRef(onCapture),frameCallback=useRef(onFrame),paused=useRef(scanPaused);
 callback.current=onCode;capture.current=onCapture;frameCallback.current=onFrame;paused.current=scanPaused;
 const connect=async event=>{
  event.preventDefault();setBusy(true);setError('');setFrameReady(false);decodedFrame.current=null;
  try{const result=await api('/cameras/rtsp/connect',{url:address});seen.current={text:'',accepted:false};consensus.current.reset();setId(result.id);setStatus('Connecting to camera…');setAddress('');}
  catch(e){setError(e.message);}finally{setBusy(false);}
 };
 useEffect(()=>{
  if(!id)return;
  let cancelled=false,currentUrl,pendingUrl,timer,decoding=false;
  decodedFrame.current=null;setFrameReady(false);
  const poll=async()=>{
   try{
    const response=await fetch('/api/cameras/rtsp/'+id+'/frame',{headers:{Authorization:'Bearer '+token},cache:'no-store',signal:AbortSignal.timeout(10000)});
    if(cancelled)return;
    if(response.status===202){decodedFrame.current=null;setFrameReady(false);setStatus('Waiting for camera frames?');}
    else if(!response.ok){const data=await response.json();throw Error(data.error||'Camera stream failed.');}
    else{
     const blob=await response.blob();if(cancelled)return;
     const url=URL.createObjectURL(blob);pendingUrl=url;
     // Decode separately so capture never reads an image between preview loads.
     const image=new Image();image.src=url;
     let usable=false;
     try{await image.decode();usable=image.naturalWidth>0&&image.naturalHeight>0;}catch{}
     if(cancelled){URL.revokeObjectURL(url);return;}
     pendingUrl=null;
     if(!usable){
      URL.revokeObjectURL(url);decodedFrame.current=null;setFrameReady(false);
      setError('The camera sent an unreadable frame. Waiting for the next frame.');setStatus('Waiting for a usable camera frame?');
     }else{
      const previousUrl=currentUrl;currentUrl=url;decodedFrame.current=image;
      if(preview.current)preview.current.src=url;
      if(previousUrl)URL.revokeObjectURL(previousUrl);
      setFrameReady(true);setError('');setStatus(capture.current?'RTSP camera live · checking codes and product appearance':'RTSP camera live · scanning barcodes and QR codes');
      if(capture.current)frameCallback.current?.(image);
      if(callback.current&&!paused.current&&!decoding){
       decoding=true;
       (async()=>{try{
        const result=await decodeBarcodePhoto(url);if(cancelled)return;
        const details=scanDetails(result),confirmed=consensus.current.add(result.getText(),details.format);
        if(confirmed&&seen.current.text!==confirmed.text){const response=await callback.current(confirmed.text,confirmed.format,image);if(cancelled)return;const exactMatch=Boolean(response?.verified??response);seen.current={text:confirmed.text,accepted:exactMatch};setStatus(exactMatch?'Exact '+details.label+' match detected':details.label+' is unknown · checking product appearance');}
       }catch{}finally{decoding=false;}})();
      }
     }
    }
   }catch(e){if(!cancelled){decodedFrame.current=null;setFrameReady(false);setError(e.message);setId('');}return;}
   // A faster preview cadence makes automatic product recognition responsive
   // while still leaving enough time for JPEG decoding on modest hardware.
   if(!cancelled)timer=setTimeout(poll,300);
  };
  poll();
  return()=>{
   cancelled=true;clearTimeout(timer);decodedFrame.current=null;
   if(currentUrl)URL.revokeObjectURL(currentUrl);if(pendingUrl)URL.revokeObjectURL(pendingUrl);
   fetch('/api/cameras/rtsp/'+id+'/disconnect',{method:'POST',headers:{Authorization:'Bearer '+token}}).catch(()=>{});
  };
 },[id,token]);
 const captureProduct=()=>{
  if(!decodedFrame.current){setFrameReady(false);setStatus('Waiting for camera frames?');return;}
  try{const photo=productPhotoFromElement(decodedFrame.current);setError('');capture.current(photo,decodedFrame.current);}catch(e){setError(e.message);}
 };
 return <div className="rtsp-controls">{!id?<form onSubmit={connect}>
  <label>RTSP camera address<input aria-label="RTSP camera address" type="password" autoComplete="off" placeholder="rtsp://192.168.1.50:554/stream1" required value={address} onChange={e=>setAddress(e.target.value)}/></label>
  <p>Use the stream address provided by your camera. Credentials stay on the server for this connection only.</p><button className="primary" disabled={busy}>{busy?'Connecting?':'Connect RTSP camera'}</button>
 </form>:<>
  <div className="scan-window"><img ref={preview} alt="RTSP camera preview" style={{width:'100%',height:'100%',objectFit:'contain'}}/></div><p role="status">{status}</p>
  {onCapture&&<button className="primary" disabled={captureBusy||captureDisabled||!frameReady} onClick={captureProduct}>Recognize RTSP product</button>}
  {!onCapture&&<button className="secondary" onClick={()=>{seen.current={text:'',accepted:false};consensus.current.reset();}}>Scan next unit</button>}
  <button className="secondary" onClick={()=>{setFrameReady(false);setId('');}}>Disconnect RTSP</button>
 </>}{error&&<p role="alert">{error}</p>}<button className="text-button" onClick={onStop}>Use webcam instead</button></div>;
}

import React,{useEffect,useRef,useState} from 'react';
import {decodeBarcodePhoto,scanDetails} from './barcode-scanner.js';
export default function RtspScanner({api,token,onCode,onStop}) {
 const [address,setAddress]=useState(''),[id,setId]=useState(''),[error,setError]=useState(''),[status,setStatus]=useState(''),[busy,setBusy]=useState(false);
 const preview=useRef(),seen=useRef(''),callback=useRef(onCode);callback.current=onCode;
 const connect=async event=>{event.preventDefault();setBusy(true);setError('');try{const result=await api('/cameras/rtsp/connect',{url:address});seen.current='';setId(result.id);setStatus('Connecting to camera…');setAddress('');}catch(e){setError(e.message);}finally{setBusy(false);}};
 useEffect(()=>{
  if(!id)return;let cancelled=false,currentUrl,timer;
  const poll=async()=>{
   try {
    const response=await fetch('/api/cameras/rtsp/'+id+'/frame',{headers:{Authorization:`Bearer ${token}`},cache:'no-store',signal:AbortSignal.timeout(10000)});
    if(cancelled)return;
    if(response.status===202){setStatus('Waiting for camera frames…');}
    else if(!response.ok){const data=await response.json();throw Error(data.error||'Camera stream failed.');}
    else {
     const blob=await response.blob();if(cancelled)return;
     if(currentUrl)URL.revokeObjectURL(currentUrl);currentUrl=URL.createObjectURL(blob);
     if(preview.current)preview.current.src=currentUrl;setStatus('RTSP camera live · scanning barcodes and QR codes');
     try{const result=await decodeBarcodePhoto(currentUrl);if(!cancelled&&seen.current!==result.getText()){seen.current=result.getText();setStatus('Detected '+scanDetails(result).label+' ('+scanDetails(result).format+')');callback.current(result.getText(),scanDetails(result).format);}}catch{}
    }
   }catch(e){if(!cancelled){setError(e.message);setId('');}return;}
   if(!cancelled)timer=setTimeout(poll,700);
  };poll();
  return()=>{cancelled=true;clearTimeout(timer);if(currentUrl)URL.revokeObjectURL(currentUrl);fetch('/api/cameras/rtsp/'+id+'/disconnect',{method:'POST',headers:{Authorization:`Bearer ${token}`}}).catch(()=>{});};
 },[id,token]);
 return <div className="rtsp-controls">{!id?<form onSubmit={connect}><label>RTSP camera address<input aria-label="RTSP camera address" type="password" autoComplete="off" placeholder="rtsp://192.168.1.50:554/stream1" required value={address} onChange={e=>setAddress(e.target.value)}/></label><p>Use the stream address provided by your camera. Credentials stay on the server for this connection only.</p><button className="primary" disabled={busy}>{busy?'Connecting…':'Connect RTSP camera'}</button></form>:<><div className="scan-window"><img ref={preview} alt="RTSP camera preview" style={{width:'100%',height:'100%',objectFit:'contain'}}/></div><p role="status">{status}</p><button className="secondary" onClick={()=>{seen.current='';}}>Scan next unit</button><button className="secondary" onClick={()=>setId('')}>Disconnect RTSP</button></>}{error&&<p role="alert">{error}</p>}<button className="text-button" onClick={onStop}>Use webcam instead</button></div>;
}

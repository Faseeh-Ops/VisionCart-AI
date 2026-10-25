import React,{useEffect,useRef,useState} from 'react';
import {Camera,ImagePlus,Sparkles,Check,X} from 'lucide-react';
import useCameras from './useCameras.jsx';
import {cameraConstraints,createBarcodeReader,decodeBarcodePhoto,scanDetails,watchCameraFrames} from './barcode-scanner.js';
import {prepareProductPhoto,productPhotoFromElement} from './product-photo.js';
import {productPrice} from '../shared/pricing.js';
import RtspScanner from './RtspScanner.jsx';
import './ai.css';
import {createCameraCycle,cameraFingerprint} from './camera-cycle.js';
const money=value=>'Rs '+Number(value).toLocaleString('en-PK',{maximumFractionDigits:2});

export default function AiBilling({api,session,storeId,cart,onProduct,onCode,onRejected,onSignIn,onCameraOpen,networkRequest=false,onNetworkHandled}){
 const [status,setStatus]=useState(null),[photo,setPhoto]=useState(''),[prediction,setPrediction]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[camera,setCamera]=useState(false),[cameraReady,setCameraReady]=useState(false),[network,setNetwork]=useState(false);
 const [automatic,setAutomatic]=useState(true),[waitingNext,setWaitingNext]=useState(false),[libraryError,setLibraryError]=useState(''),[calibrated,setCalibrated]=useState(false),[codeStatus,setCodeStatus]=useState('');
 const video=useRef(),revision=useRef(0),recognitionEpoch=useRef(0),inFlight=useRef(false),lastAutomatic=useRef(0),exactSeen=useRef({code:'',time:0,accepted:false}),exactHandler=useRef(),section=useRef(),cameras=useCameras();
 const [multiple,setMultiple]=useState(false),[backgroundPhoto,setBackgroundPhoto]=useState(''),[queue,setQueue]=useState([]),[scene,setScene]=useState(null);
 const cycle=useRef(createCameraCycle()),latestElement=useRef(null);
 const canRecognize=Boolean(status?.available&&status.referenceCount>0);
 useEffect(()=>{const version=++revision.current;recognitionEpoch.current++;inFlight.current=false;exactSeen.current={code:'',time:0,accepted:false};cycle.current.reset();latestElement.current=null;setCalibrated(false);setBackgroundPhoto('');setQueue([]);setScene(null);setStatus(null);setLibraryError('');setBusy(false);setPrediction(null);setPhoto('');setError('');setCodeStatus('');setWaitingNext(false);setCamera(false);setNetwork(false);const loadStatus=()=>api('/ai/status').then(data=>{if(version===revision.current){setStatus(data);setLibraryError('');}}).catch(e=>{if(version===revision.current)setLibraryError(e.message);});let timer;if(session){loadStatus();timer=setInterval(loadStatus,15000);}return()=>{clearInterval(timer);revision.current++;recognitionEpoch.current++;};},[session?.token,storeId]);
 useEffect(()=>{if(networkRequest&&session){onCameraOpen?.();setCamera(false);setNetwork(true);onNetworkHandled?.();section.current?.scrollIntoView({behavior:'smooth',block:'start'});}},[networkRequest]);
 useEffect(()=>{
  if(!camera)return;if(!navigator.mediaDevices?.getUserMedia){setError('Camera access requires localhost or HTTPS. Upload a product photo instead.');setCamera(false);return;}let cancelled=false,stream,stopWatch;setCameraReady(false);
  navigator.mediaDevices.getUserMedia(cameraConstraints(cameras.deviceId,cameras.devices)).then(async media=>{
   if(cancelled){media.getTracks().forEach(t=>t.stop());return;}stream=media;video.current.srcObject=media;await video.current.play();if(cancelled)return;setCameraReady(true);stopWatch=watchCameraFrames(video.current,setError);cameras.refresh();
  }).catch(()=>{if(!cancelled){setError('Could not open the AI camera. Allow camera access, choose your camera, or upload a product photo.');setCamera(false);}});
  return()=>{cancelled=true;stopWatch?.();stream?.getTracks().forEach(t=>t.stop());};
 },[camera,cameras.deviceId]);
 const handleExactCode=async(code,format,element)=>{
  const now=Date.now(),previous=exactSeen.current;
  if(previous.code===code)return previous.accepted;
  exactSeen.current={code,time:now,accepted:false};setCodeStatus(`Detected ${format==='QR_CODE'?'QR code':'barcode'} ${code}. Checking the store catalog…`);
  try{
   const result=await onCode?.(code,format),accepted=Boolean(result?.verified);
   exactSeen.current={code,time:Date.now(),accepted};
   if(accepted){recognitionEpoch.current++;inFlight.current=false;setBusy(false);setError('');setPrediction(null);setQueue([]);setScene(null);setWaitingNext(true);if(element){const frame=cameraFingerprint(element);if(frame)cycle.current.capture(frame);}setCodeStatus(`Exact ${format==='QR_CODE'?'QR':'barcode'} match: ${result.product.name}. Added to the bill.`);}
   else setCodeStatus('The code is not registered for this store. Continuing with visual product recognition.');
   return accepted;
  }catch(e){setCodeStatus('The printed code could not be checked. Continuing with visual product recognition.');return false;}
 };
 exactHandler.current=handleExactCode;
 useEffect(()=>{
  if(!camera||!cameraReady||!video.current)return;let cancelled=false,controls;
  const reader=createBarcodeReader();
  reader.decodeFromVideoElement(video.current,result=>{if(result&&!cancelled){const details=scanDetails(result);exactHandler.current?.(result.getText(),details.format,video.current);}}).then(value=>{if(cancelled)value.stop();else controls=value;}).catch(()=>{});
  return()=>{cancelled=true;controls?.stop();};
 },[camera,cameraReady,cameras.deviceId]);
 const recognize=async (image,element)=>{
  if(inFlight.current)return;if(multiple&&!backgroundPhoto){setError('Clear the counter and set the empty scan area first, or upload an empty counter photo.');return;}if(element){const frame=cameraFingerprint(element);if(frame)cycle.current.capture(frame);}onCameraOpen?.();const job=Symbol(),version=revision.current,epoch=recognitionEpoch.current;inFlight.current=job;setBusy(true);setError('');setWaitingNext(false);setPhoto(image);setPrediction(null);setQueue([]);setScene(null);
  try{const data=await api('/ai/recognize',{photo:image,mode:multiple?'multiple':'single',...(multiple?{backgroundPhoto}:{})});if(version===revision.current&&epoch===recognitionEpoch.current){if(data.items){const items=data.items.map(item=>({...item,mode:data.mode}));setScene({items,imageSize:data.imageSize});setPrediction(items[0]||null);setQueue(items.slice(1));if(!items.length)setWaitingNext(true);}else setPrediction(data);}}catch(e){if(version===revision.current&&epoch===recognitionEpoch.current)setError(e.message);}finally{if(inFlight.current===job)inFlight.current=false;if(version===revision.current&&epoch===recognitionEpoch.current)setBusy(false);}
 };
 const recognizeHybrid=async(image,element)=>{
  setCodeStatus('Checking this frame for a barcode or QR code first…');
  try{const result=await decodeBarcodePhoto(image),details=scanDetails(result);if(await handleExactCode(result.getText(),details.format,element))return;}catch{}
  setCodeStatus('No registered code found. Using visual product recognition.');await recognize(image,element);
 };
 const automaticFrame=element=>{
  latestElement.current=element;
  if(!automatic||!canRecognize||error||(multiple&&!backgroundPhoto))return;
  try{
   const frame=cameraFingerprint(element);if(!frame)return;
   if(waitingNext){
    if(calibrated&&cycle.current.isBackground(frame)){cycle.current.setBackground(frame);setWaitingNext(false);setPrediction(null);setPhoto('');setCodeStatus('');exactSeen.current={code:'',time:0,accepted:false};lastAutomatic.current=0;}
    else cycle.current.observe(frame,Date.now());
    return;
   }
   if(!cycle.current.observe(frame,Date.now()))return;
   if(prediction||inFlight.current)return;
   if(Date.now()-lastAutomatic.current<1200)return;
   cycle.current.capture(frame);lastAutomatic.current=Date.now();
   recognize(productPhotoFromElement(element),element);
  }catch(e){setError(e.message);}
 };
 const frameHandler=useRef();frameHandler.current=automaticFrame;
 useEffect(()=>{cycle.current.reset();latestElement.current=null;setCalibrated(false);setBackgroundPhoto('');if(!camera||!cameraReady)return;const timer=setInterval(()=>frameHandler.current(video.current),250);return()=>clearInterval(timer);},[camera,cameraReady,cameras.deviceId,network]);
 const upload=async event=>{const file=event.target.files?.[0];if(!file)return;const version=revision.current;try{const image=await prepareProductPhoto(file);if(version===revision.current)await recognizeHybrid(image);}catch(e){if(version===revision.current)setError(e.message);}finally{event.target.value='';}};
 const advance=()=>{setPrediction(queue[0]||null);setQueue(queue.slice(1));setWaitingNext(queue.length===0);};
 const uploadBackground=async event=>{const file=event.target.files?.[0];if(!file)return;const version=revision.current;try{const image=await prepareProductPhoto(file);if(version===revision.current){setBackgroundPhoto(image);setCalibrated(true);setError('');}}catch(e){setError(e.message);}finally{event.target.value='';}};
 const confirm=async product=>{
  if(inFlight.current)return;const job=Symbol(),version=revision.current;inFlight.current=job;setBusy(true);setError('');
  try{const data=await api('/ai/confirm',{recognitionId:prediction.recognitionId,productId:product._id});if(version===revision.current){onProduct(data.product);advance();}}
  catch(e){if(version===revision.current)setError(e.message);}finally{if(inFlight.current===job)inFlight.current=false;if(version===revision.current)setBusy(false);}
 };
 const reject=async()=>{
  if(inFlight.current)return;const job=Symbol(),version=revision.current;inFlight.current=job;setBusy(true);setError('');
  try{await api('/ai/reject',{recognitionId:prediction.recognitionId});if(version===revision.current){advance();await onRejected();setError('');}}
  catch(e){if(version===revision.current)setError(e.message);}finally{if(inFlight.current===job)inFlight.current=false;if(version===revision.current)setBusy(false);}
 };
 return <section ref={section} className="ai-billing" aria-label="AI product recognition"><div className="ai-heading"><Sparkles size={20}/><h3>Smart product scanning</h3><span>Code + appearance</span></div><p>{multiple?'Place up to ten products separately on a fixed counter, fronts visible, with clear gaps. Set an empty scan area first. Review each detected item; touching or hidden packets can be missed.':'Show one product at a time. The scanner checks its barcode or QR code and its visual appearance. Exact registered codes are added directly; visual matches require confirmation.'}</p>{!session?<button className="primary" onClick={onSignIn}>Sign in to use AI recognition</button>:<>
 <div className="ai-capture-actions"><label className="image-scan-button"><ImagePlus size={17}/> Recognize product photo<input type="file" aria-label="Recognize product photo with AI" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={upload}/></label><button className="secondary" disabled={busy} onClick={()=>{if(!camera)onCameraOpen?.();setNetwork(false);setCamera(!camera);}}><Camera size={16}/>{camera?'Close AI camera':'Open AI camera'}</button><button className="text-button" disabled={busy} onClick={()=>{if(!network)onCameraOpen?.();setCamera(false);setNetwork(!network);}}>AI network camera</button></div>
 <div className="ai-live-options"><label><input type="checkbox" checked={multiple} disabled={busy||Boolean(prediction)} onChange={e=>{setMultiple(e.target.checked);setQueue([]);setScene(null);setError('');}}/> Multiple products on counter</label><small>Keep the camera fixed and clear the whole scan area between batches. Every visible region is reviewed separately.</small>{multiple&&<label className="image-scan-button">Upload empty counter photo<input type="file" aria-label="Upload empty counter photo" accept="image/jpeg,image/png,image/webp" disabled={busy||Boolean(prediction)} onChange={uploadBackground}/></label>}</div>
 <div className="ai-live-options"><label><input type="checkbox" checked={automatic} onChange={e=>setAutomatic(e.target.checked)}/> Automatically recognize camera products</label><small>After review, replace the product and hold the next one steady. The camera scans again when the view changes.</small></div>
 {(camera||network)&&<div className="ai-live-options"><button className="secondary" disabled={busy||Boolean(prediction)} onClick={()=>{try{const element=camera?video.current:latestElement.current;const frame=element&&cameraFingerprint(element);if(!frame)throw Error('Wait for a live camera frame.');cycle.current.setBackground(frame);setBackgroundPhoto(productPhotoFromElement(element));setCalibrated(true);setError('');}catch(e){setError(e.message);}}}>Set empty scan area</button><small>{calibrated?'Scan area saved. Pass each packet through, then clear the area before the next unit.':'For repeated identical packets, clear the camera view and set the empty scan area once. Keep the camera fixed.'}</small></div>}
 {error&&<button className="secondary" disabled={busy} onClick={()=>{setError('');if(!prediction&&photo)recognize(photo);}}>Retry camera recognition</button>}
 {libraryError&&<p className="inventory-error" role="alert">Could not refresh the AI library: {libraryError}</p>}
 {status&&<p className={'ai-library-status '+(!canRecognize?'ai-setup-needed':'')} role="status">{!status.available?'Local AI models are unavailable. Check the AI setup.':status.referenceCount?`${status.referenceCount} inventory reference photos available`:'AI product library is empty. An administrator must open Products > AI photos and add reference pictures to your inventory products before recognition can work.'}</p>}
 {camera&&<div className="ai-camera"><video ref={video} autoPlay playsInline muted/><div className="camera-controls"><label>AI camera<select aria-label="AI camera" value={cameras.preference} onChange={e=>cameras.select(e.target.value)}><option value="">Automatic camera</option>{cameras.devices.map((d,i)=><option key={d.deviceId||i} value={d.deviceId}>{d.label||`Camera ${i+1}`}</option>)}</select></label><button className="primary" disabled={busy||!cameraReady} onClick={()=>{try{recognizeHybrid(productPhotoFromElement(video.current),video.current);}catch(e){setError(e.message);}}}>Scan code or recognize product</button></div></div>}
 {network&&<RtspScanner api={api} token={session.token} onCode={handleExactCode} onCapture={recognizeHybrid} onFrame={automaticFrame} captureBusy={busy} captureDisabled={!canRecognize} onStop={()=>setNetwork(false)}/>}
 {codeStatus&&<p className="ai-code-status" role="status">{codeStatus}</p>}
 {waitingNext&&<div className="ai-next-product" role="status"><p>Ready for the next product. Remove this product and hold the next one steady in view.</p><button className="primary" disabled={busy} onClick={()=>{setWaitingNext(false);setPrediction(null);setPhoto('');setError('');setCodeStatus('');exactSeen.current={code:'',time:0,accepted:false};lastAutomatic.current=0;cycle.current.reset();setCalibrated(false);setBackgroundPhoto('');setScene(null);setQueue([]);}}>Scan next product</button></div>}
 {busy&&<p className="ai-progress" role="status">Recognizing with local AI… The first request may take longer while models start.</p>}
 {error&&<p className="inventory-error" role="alert">{error}</p>}
 {scene&&<p role="status">{scene.items.length?`${scene.items.length} separate regions found. ${queue.length+(prediction?1:0)} left to review.`:'No separate products found. Check the view and spacing if items were missed.'}</p>}
 {scene?.items.length>0&&scene.imageSize&&<div className="ai-scene-preview"><img src={photo} alt="Scene with numbered detected product regions"/>{scene.items.map((item,i)=>{const [x1,y1,x2,y2]=item.box,[w,h]=scene.imageSize;return <span key={item.recognitionId} className={prediction?.recognitionId===item.recognitionId?'active':''} style={{left:`${x1/w*100}%`,top:`${y1/h*100}%`,width:`${(x2-x1)/w*100}%`,height:`${(y2-y1)/h*100}%`}}>{i+1}</span>;})}</div>}
 {photo&&<div className="ai-query-photo"><img src={photo} alt="Product submitted to AI"/><span>Current product photo</span>{prediction?.photo&&<><img src={prediction.photo} alt="Detected item being reviewed"/><span>Review this detected item</span></>}</div>}
 {prediction&&<div className="ai-suggestions"><h4>Possible matches · confirm the exact pack</h4><p>Visual similarity scores are not confidence percentages. An unknown product may look similar.</p>{prediction.candidates.map(candidate=>{const p=candidate.product,remaining=p.stock-(cart.find(i=>i.productId===p._id)?.quantity||0);return <article className="ai-candidate" key={p._id}>{candidate.referencePhoto&&<img src={candidate.referencePhoto} alt={'AI reference for '+p.name}/>}<div><strong>{p.name}</strong><p>{money(productPrice(p).price)} · {p.stock} in this store</p><small>Visual similarity {candidate.similarity.toFixed(3)}</small><button className="primary" disabled={busy||remaining<1} onClick={()=>confirm(p)} aria-label={'Confirm AI match '+p.name}><Check size={15}/>{p.stock<1?'Out of stock':remaining<1?'No more stock':'Confirm & add one'}</button></div></article>;})}<button className="secondary" disabled={busy} onClick={reject}><X size={15}/> None of these products</button></div>}
 </>}</section>;
}

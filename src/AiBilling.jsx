import React,{useEffect,useRef,useState} from 'react';
import {Camera,ImagePlus,Sparkles,Check,X} from 'lucide-react';
import useCameras from './useCameras.jsx';
import {cameraConstraints,createBarcodeReader,createScanConsensus,decodeBarcodePhoto,scanDetails,watchCameraFrames} from './barcode-scanner.js';
import {prepareProductPhoto,productPhotoFromElement} from './product-photo.js';
import {productPrice} from '../shared/pricing.js';
import RtspScanner from './RtspScanner.jsx';
import './ai.css';
import {createCameraCycle,cameraFingerprint,frameDistance,meaningfulFrameChange} from './camera-cycle.js';
const money=value=>'Rs '+Number(value).toLocaleString('en-PK',{maximumFractionDigits:2});

export default function AiBilling({api,session,storeId,cart,onProduct,onCode,onRejected,onSignIn,onCameraOpen,networkRequest=false,onNetworkHandled}){
 const [status,setStatus]=useState(null),[photo,setPhoto]=useState(''),[prediction,setPrediction]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[camera,setCamera]=useState(false),[cameraReady,setCameraReady]=useState(false),[network,setNetwork]=useState(false);
 const [automatic,setAutomatic]=useState(true),[waitingNext,setWaitingNext]=useState(false),[libraryError,setLibraryError]=useState(''),[calibrated,setCalibrated]=useState(false),[codeStatus,setCodeStatus]=useState('');
 const video=useRef(),revision=useRef(0),recognitionEpoch=useRef(0),inFlight=useRef(false),lastAutomatic=useRef(0),exactSeen=useRef({code:'',time:0,accepted:false}),exactHandler=useRef(),section=useRef(),cameras=useCameras();
 const [multiple,setMultiple]=useState(false),[backgroundPhoto,setBackgroundPhoto]=useState(''),[queue,setQueue]=useState([]),[scene,setScene]=useState(null);
 const cycle=useRef(createCameraCycle()),latestElement=useRef(null),baseline=useRef({frame:null,since:0}),clearSince=useRef(0),recognizedFrame=useRef(null),nextView=useRef({frame:null,since:0}),departure=useRef({since:0,ready:false});
 const canRecognize=Boolean(status?.available&&status.referenceCount>0);
 useEffect(()=>{const version=++revision.current;let statusLoaded=false,statusFailures=0;recognitionEpoch.current++;inFlight.current=false;exactSeen.current={code:'',time:0,accepted:false};cycle.current.reset();baseline.current={frame:null,since:0};clearSince.current=0;recognizedFrame.current=null;nextView.current={frame:null,since:0};departure.current={since:0,ready:false};latestElement.current=null;setCalibrated(false);setBackgroundPhoto('');setQueue([]);setScene(null);setStatus(null);setLibraryError('');setBusy(false);setPrediction(null);setPhoto('');setError('');setCodeStatus('');setWaitingNext(false);setCamera(false);setNetwork(false);const loadStatus=()=>api('/ai/status').then(data=>{if(version===revision.current){statusLoaded=true;statusFailures=0;setStatus(data);setLibraryError('');}}).catch(e=>{if(version===revision.current){statusFailures++;if(!statusLoaded||statusFailures>=3)setLibraryError(statusLoaded?'Connection to the AI service was interrupted. Retrying automatically…':e.message);}});let timer;if(session){loadStatus();timer=setInterval(loadStatus,3000);}return()=>{clearInterval(timer);revision.current++;recognitionEpoch.current++;};},[session?.token,storeId]);
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
   if(accepted){recognitionEpoch.current++;inFlight.current=false;setBusy(false);setError('');setPrediction(null);setQueue([]);setScene(null);setWaitingNext(true);clearSince.current=0;nextView.current={frame:null,since:0};departure.current={since:0,ready:false};if(element){const frame=cameraFingerprint(element);if(frame){recognizedFrame.current=frame;cycle.current.capture(frame);}}setCodeStatus(`Exact ${format==='QR_CODE'?'QR':'barcode'} match: ${result.product.name}. Added to the bill.`);}
   else setCodeStatus('The code is not registered for this store. Continuing with visual product recognition.');
   return accepted;
  }catch(e){setCodeStatus('The printed code could not be checked. Continuing with visual product recognition.');return false;}
 };
 exactHandler.current=handleExactCode;
 useEffect(()=>{
  // Barcode decoding is CPU intensive. Pause it while SigLIP is working or a
  // visual result is awaiting review so both engines never compete.
  if(!camera||!cameraReady||!video.current||busy||prediction)return;let cancelled=false,controls;
  const reader=createBarcodeReader(),consensus=createScanConsensus();
  reader.decodeFromVideoElement(video.current,result=>{if(result&&!cancelled){const details=scanDetails(result),confirmed=consensus.add(result.getText(),details.format);if(confirmed)exactHandler.current?.(confirmed.text,confirmed.format,video.current);}}).then(value=>{if(cancelled)value.stop();else controls=value;}).catch(()=>{});
  return()=>{cancelled=true;controls?.stop();};
 },[camera,cameraReady,cameras.deviceId,busy,prediction?.recognitionId]);
 const recognize=async (image,element)=>{
  if(inFlight.current)return;if(multiple&&!backgroundPhoto){setError('Clear the counter and set the empty scan area first, or upload an empty counter photo.');return;}if(element){const frame=cameraFingerprint(element);if(frame){recognizedFrame.current=frame;cycle.current.capture(frame);}}onCameraOpen?.();const job=Symbol(),version=revision.current,epoch=recognitionEpoch.current;inFlight.current=job;setBusy(true);setError('');setWaitingNext(false);setCodeStatus('Product detected · identifying it now…');setPhoto(image);setPrediction(null);setQueue([]);setScene(null);
  try{const data=await api('/ai/recognize',{photo:image,mode:multiple?'multiple':'single',cameraTriggered:Boolean(element),...(backgroundPhoto?{backgroundPhoto}:{})});if(version===revision.current&&epoch===recognitionEpoch.current){if(data.noMatch){setPhoto('');setPrediction(null);setQueue([]);setScene(null);clearSince.current=0;nextView.current={frame:null,since:0};departure.current={since:0,ready:false};setWaitingNext(Boolean(element));setCodeStatus('No product detected. The scanner remains active and will retry when the view changes.');}else if(data.items){const items=data.items.map(item=>({...item,mode:data.mode}));setScene({items,imageSize:data.imageSize});setPrediction(items[0]||null);setQueue(items.slice(1));setCodeStatus(items.length?'Product detected · confirm the exact match below.':'No separate product detected. Adjust the products and try again.');if(!items.length)setWaitingNext(true);}else{setPrediction(data);setCodeStatus('Product detected · confirm the exact match below.');}}}catch(e){if(version===revision.current&&epoch===recognitionEpoch.current)setError(e.message);}finally{if(inFlight.current===job)inFlight.current=false;if(version===revision.current&&epoch===recognitionEpoch.current)setBusy(false);}
 };
 const recognizeHybrid=async(image,element)=>{
  setCodeStatus('Checking this frame for a barcode or QR code first…');
  try{const result=await decodeBarcodePhoto(image),details=scanDetails(result);if(await handleExactCode(result.getText(),details.format,element))return;}catch{}
  setCodeStatus('No registered code found. Using visual product recognition.');await recognize(image,element);
 };
 const automaticFrame=element=>{
  latestElement.current=element;
  if(!canRecognize||error)return;
  try{
   const frame=cameraFingerprint(element);if(!frame)return;
   if(!calibrated){const now=Date.now(),sample=baseline.current;if(!sample.frame||frameDistance(sample.frame,frame)>18){baseline.current={frame,since:now};return;}baseline.current.frame=frame;if(now-sample.since<600)return;cycle.current.setBackground(frame);baseline.current={frame,since:now};setBackgroundPhoto(productPhotoFromElement(element));setCalibrated(true);setPhoto('');setPrediction(null);setCodeStatus('No product detected · scanner ready.');return;}
   if(!automatic||(multiple&&!backgroundPhoto))return;
   if(waitingNext){
    const now=Date.now();
    if(cycle.current.isBackground(frame)){
     nextView.current={frame:null,since:0};
     if(!clearSince.current)clearSince.current=now;
     if(now-clearSince.current>=300){cycle.current.setBackground(frame);setBackgroundPhoto(productPhotoFromElement(element));clearSince.current=0;recognizedFrame.current=null;departure.current={since:0,ready:false};setWaitingNext(false);setPrediction(null);setPhoto('');setError('');setCodeStatus('No product detected · ready for the next product.');exactSeen.current={code:'',time:0,accepted:false};lastAutomatic.current=0;setScene(null);setQueue([]);}
    }else{
     clearSince.current=0;
     const previous=recognizedFrame.current,different=previous&&meaningfulFrameChange(previous,frame),departed=departure.current;
     if(different){if(!departed.since)departed.since=now;if(now-departed.since>=150&&!departed.ready){departed.ready=true;exactSeen.current={code:'',time:0,accepted:false};}}
     else if(!departed.ready){departed.since=0;nextView.current={frame:null,since:0};}
     if(different||departed.ready){const candidate=nextView.current;if(!candidate.frame||frameDistance(candidate.frame,frame)>10)nextView.current={frame,since:now};else if(now-candidate.since>=200){nextView.current={frame:null,since:0};departure.current={since:0,ready:false};setWaitingNext(false);setPrediction(null);setPhoto('');setError('');setCodeStatus('Next unit detected · recognizing now.');exactSeen.current={code:'',time:0,accepted:false};lastAutomatic.current=now;recognize(productPhotoFromElement(element),element);}}
    }
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
 useEffect(()=>{cycle.current.reset();baseline.current={frame:null,since:0};clearSince.current=0;recognizedFrame.current=null;nextView.current={frame:null,since:0};departure.current={since:0,ready:false};latestElement.current=null;setCalibrated(false);setBackgroundPhoto('');if(!camera||!cameraReady)return;const timer=setInterval(()=>frameHandler.current(video.current),100);return()=>clearInterval(timer);},[camera,cameraReady,cameras.deviceId,network]);
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
 return <section ref={section} className="ai-billing" aria-label="Smart product scanner"><div className="ai-heading"><Sparkles size={20}/><h3>One smart scanner</h3><span>Product + code</span></div><p>{multiple?'Place the products separately on a fixed counter with their fronts visible.':'Use one camera for everything. Aspire checks a barcode or QR code first; when no registered code is visible, it identifies the product by appearance.'}</p>{!session?<button className="primary" onClick={onSignIn}>Sign in to use smart scanning</button>:<>
 <div className="ai-capture-actions"><button className="primary" disabled={busy||!status?.loaded} onClick={()=>{if(!camera){onCameraOpen?.();setAutomatic(true);}setNetwork(false);setCamera(!camera);}}><Camera size={16}/>{!status?.loaded?'AI starting…':camera?'Stop smart camera':'Start smart camera'}</button><button className="secondary" disabled={busy||!status?.loaded} onClick={()=>{if(!network){onCameraOpen?.();setAutomatic(true);}setCamera(false);setNetwork(!network);}}>{network?'Disconnect network camera':'Connect RTSP camera'}</button><label className="image-scan-button"><ImagePlus size={17}/> Upload product photo<input type="file" aria-label="Scan a product photo" accept="image/jpeg,image/png,image/webp" disabled={busy||!status?.loaded} onChange={upload}/></label></div>
 <details className="ai-advanced"><summary>Advanced scanning options</summary><div className="ai-live-options"><label><input type="checkbox" checked={automatic} onChange={e=>setAutomatic(e.target.checked)}/> Scan automatically when the product is steady</label><small>Enabled whenever the smart camera starts. Turn it off only when testing or positioning the camera.</small></div><div className="ai-live-options"><label><input type="checkbox" checked={multiple} disabled={busy||Boolean(prediction)} onChange={e=>{setMultiple(e.target.checked);setQueue([]);setScene(null);setError('');}}/> Multiple products on counter</label><small>Keep the camera fixed and leave clear gaps between products.</small>{multiple&&<label className="image-scan-button">Upload empty counter photo<input type="file" aria-label="Upload empty counter photo" accept="image/jpeg,image/png,image/webp" disabled={busy||Boolean(prediction)} onChange={uploadBackground}/></label>}</div>{(camera||network)&&<div className="ai-live-options"><button className="secondary" disabled={busy||Boolean(prediction)} onClick={()=>{try{const element=camera?video.current:latestElement.current;const frame=element&&cameraFingerprint(element);if(!frame)throw Error('Wait for a live camera frame.');cycle.current.setBackground(frame);baseline.current={frame,since:Date.now()};setBackgroundPhoto(productPhotoFromElement(element));setCalibrated(true);setPhoto('');setPrediction(null);setError('');setCodeStatus('Empty scan area calibrated. Place one product in view.');}catch(e){setError(e.message);}}}>Relearn empty scan area</button><small>{calibrated?'Empty area calibrated. Clear the counter between products.':'The camera calibrates an empty view automatically when it starts.'}</small></div>}</details>
 {error&&<button className="secondary" disabled={busy} onClick={()=>{setError('');if(!prediction&&photo)recognize(photo);}}>Retry camera recognition</button>}
 {libraryError&&<p className="inventory-error" role="alert">Could not refresh the AI library: {libraryError}</p>}
 {status&&<p className={'ai-library-status '+(!canRecognize?'ai-setup-needed':'')} role="status">{!status.available?'Local AI models are unavailable. Check the AI setup.':!status.loaded?'AI engine is warming up. Keep this page open; the scanner will enable automatically.':status.referenceCount?`AI ready · ${status.referenceCount} inventory reference photos`:'AI product library is empty. An administrator must open Products > AI photos and add reference pictures to your inventory products before recognition can work.'}</p>}
 {camera&&<div className="ai-camera"><video ref={video} autoPlay playsInline muted/><div className="camera-controls"><label>Camera<select aria-label="Smart scanner camera" value={cameras.preference} onChange={e=>cameras.select(e.target.value)}><option value="">Automatic camera</option>{cameras.devices.map((d,i)=><option key={d.deviceId||i} value={d.deviceId}>{d.label||`Camera ${i+1}`}</option>)}</select></label><span className="smart-scan-live"><i/>{busy?'Recognizing product…':!cameraReady?'Starting camera…':!calibrated?'Keep the scan area empty briefly…':'Automatic scanning active · place one product in view'}</span></div></div>}
 {network&&<RtspScanner api={api} token={session.token} onCode={handleExactCode} onCapture={recognizeHybrid} onFrame={automaticFrame} scanPaused={busy||Boolean(prediction)} captureBusy={busy} captureDisabled={!canRecognize} onStop={()=>setNetwork(false)}/>}
 {(prediction||codeStatus)&&<p className="ai-code-status" role="status">{prediction?'Product detected · confirm the exact match below.':codeStatus}</p>}
 {waitingNext&&<div className="ai-next-product" role="status"><p>{codeStatus.startsWith('No product detected')?'No product is locked in. Clear, move or replace the view and scanning will retry automatically.':camera||network?'Product added. Remove or replace this unit—another unit of the same product is supported. Scanning resumes automatically.':'Product added. Upload another product photo when ready.'}</p></div>}
 {busy&&<p className="ai-progress" role="status">{status?.loaded?'Identifying product with local AI…':'Starting local AI models…'}</p>}
 {error&&<p className="inventory-error" role="alert">{error}</p>}
 {scene&&<p role="status">{scene.items.length?`${scene.items.length} separate regions found. ${queue.length+(prediction?1:0)} left to review.`:'No separate products found. Check the view and spacing if items were missed.'}</p>}
 {scene?.items.length>0&&scene.imageSize&&<div className="ai-scene-preview"><img src={photo} alt="Scene with numbered detected product regions"/>{scene.items.map((item,i)=>{const [x1,y1,x2,y2]=item.box,[w,h]=scene.imageSize;return <span key={item.recognitionId} className={prediction?.recognitionId===item.recognitionId?'active':''} style={{left:`${x1/w*100}%`,top:`${y1/h*100}%`,width:`${(x2-x1)/w*100}%`,height:`${(y2-y1)/h*100}%`}}>{i+1}</span>;})}</div>}
 {photo&&<div className="ai-query-photo"><img src={photo} alt="Product submitted to AI"/><span>Current product photo</span>{prediction?.photo&&<><img src={prediction.photo} alt="Detected item being reviewed"/><span>Review this detected item</span></>}</div>}
 {prediction&&<div className="ai-suggestions"><h4>Possible matches · confirm the exact pack</h4><p>Visual similarity scores are not confidence percentages. An unknown product may look similar.</p>{prediction.candidates.map(candidate=>{const p=candidate.product,remaining=p.stock-(cart.find(i=>i.productId===p._id)?.quantity||0);return <article className="ai-candidate" key={p._id}>{candidate.referencePhoto&&<img src={candidate.referencePhoto} alt={'AI reference for '+p.name}/>}<div><strong>{p.name}</strong><p>{money(productPrice(p).price)} · {p.stock} in this store</p><small>Visual similarity {candidate.similarity.toFixed(3)}</small><button className="primary" disabled={busy||remaining<1} onClick={()=>confirm(p)} aria-label={'Confirm AI match '+p.name}><Check size={15}/>{p.stock<1?'Out of stock':remaining<1?'No more stock':'Confirm & add one'}</button></div></article>;})}<button className="secondary" disabled={busy} onClick={reject}><X size={15}/> None of these products</button></div>}
 </>}</section>;
}

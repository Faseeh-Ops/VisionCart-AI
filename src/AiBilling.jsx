import React,{useEffect,useRef,useState} from 'react';
import {Camera,ImagePlus,Sparkles,Check,X,Minus,Plus} from 'lucide-react';
import useCameras from './useCameras.jsx';
import {cameraConstraints,createBarcodeReader,createScanConsensus,decodeBarcodePhoto,scanDetails,watchCameraFrames} from './barcode-scanner.js';
import {barcodePhotoFromElement,prepareProductPhoto,productPhotoFromElement} from './product-photo.js';
import {productPrice} from '../shared/pricing.js';
import RtspScanner from './RtspScanner.jsx';
import './ai.css';
import {createCameraCycle,cameraFingerprint,frameDistance,meaningfulFrameChange} from './camera-cycle.js';
const money=value=>'Rs '+Number(value).toLocaleString('en-PK',{maximumFractionDigits:2});

export default function AiBilling({api,session,storeId,cart,onProduct,onCode,onRejected,onSignIn,onCameraOpen,networkRequest=false,onNetworkHandled}){
 const [status,setStatus]=useState(null),[photo,setPhoto]=useState(''),[prediction,setPrediction]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[camera,setCamera]=useState(false),[cameraReady,setCameraReady]=useState(false),[network,setNetwork]=useState(false);
 const [automatic,setAutomatic]=useState(true),[waitingNext,setWaitingNext]=useState(false),[libraryError,setLibraryError]=useState(''),[calibrated,setCalibrated]=useState(false),[codeStatus,setCodeStatus]=useState('');
 const video=useRef(),revision=useRef(0),recognitionEpoch=useRef(0),inFlight=useRef(false),hybridInFlight=useRef(false),lastAutomatic=useRef(0),exactSeen=useRef({code:'',time:0,accepted:false}),exactHandler=useRef(),section=useRef(),cameras=useCameras();
 const [multiple,setMultiple]=useState(false),[backgroundPhoto,setBackgroundPhoto]=useState(''),[queue,setQueue]=useState([]),[scene,setScene]=useState(null),[regionKept,setRegionKept]=useState(false),[quantities,setQuantities]=useState({});
 const cycle=useRef(createCameraCycle()),latestElement=useRef(null),baseline=useRef({frame:null,since:0}),clearSince=useRef(0),recognizedFrame=useRef(null),nextView=useRef({frame:null,since:0}),departure=useRef({since:0,ready:false});
 const canRecognize=Boolean(status?.available&&status.referenceCount>0);
 useEffect(()=>{const version=++revision.current;let statusLoaded=false,statusFailures=0;recognitionEpoch.current++;inFlight.current=false;hybridInFlight.current=false;exactSeen.current={code:'',time:0,accepted:false};cycle.current.reset();baseline.current={frame:null,since:0};clearSince.current=0;recognizedFrame.current=null;nextView.current={frame:null,since:0};departure.current={since:0,ready:false};latestElement.current=null;setCalibrated(false);setBackgroundPhoto('');setQueue([]);setScene(null);setStatus(null);setLibraryError('');setBusy(false);setPrediction(null);setPhoto('');setError('');setCodeStatus('');setWaitingNext(false);setCamera(false);setNetwork(false);const loadStatus=()=>api('/ai/status').then(data=>{if(version===revision.current){statusLoaded=true;statusFailures=0;setStatus(data);setLibraryError('');}}).catch(e=>{if(version===revision.current){statusFailures++;if(!statusLoaded||statusFailures>=3)setLibraryError(statusLoaded?'Connection to the AI service was interrupted. Retrying automatically…':e.message);}});let timer;if(session){loadStatus();timer=setInterval(loadStatus,3000);}return()=>{clearInterval(timer);revision.current++;recognitionEpoch.current++;};},[session?.token,storeId]);
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
  exactSeen.current={code,time:now,accepted:false};setCodeStatus('Product detected. Identifying it now…');
  try{
   const result=await onCode?.(code,format),accepted=Boolean(result?.verified);
   exactSeen.current={code,time:Date.now(),accepted};
   if(accepted){recognitionEpoch.current++;inFlight.current=false;setBusy(false);setError('');setPrediction(null);setQueue([]);setScene(null);setWaitingNext(true);clearSince.current=0;nextView.current={frame:null,since:0};departure.current={since:0,ready:false};if(element){const frame=cameraFingerprint(element);if(frame){recognizedFrame.current=frame;cycle.current.capture(frame);}}setCodeStatus(`Product detected: ${result.product.name}. Added to the bill.`);}
   else setCodeStatus('Product detected. Identifying it now…');
   return accepted;
  }catch(e){setCodeStatus('Product detected. Identifying it now…');return false;}
 };
 exactHandler.current=handleExactCode;
 useEffect(()=>{
  // Barcode decoding is CPU intensive. Pause it while SigLIP is working or a
  // visual result is awaiting review so both engines never compete.
  if(!camera||!cameraReady||!video.current||busy||prediction||multiple)return;let cancelled=false,controls;
  const reader=createBarcodeReader(),consensus=createScanConsensus();
  reader.decodeFromVideoElement(video.current,result=>{if(result&&!cancelled){const details=scanDetails(result),confirmed=consensus.add(result.getText(),details.format);if(confirmed)exactHandler.current?.(confirmed.text,confirmed.format,video.current);}}).then(value=>{if(cancelled)value.stop();else controls=value;}).catch(()=>{});
  return()=>{cancelled=true;controls?.stop();};
 },[camera,cameraReady,cameras.deviceId,busy,prediction?.recognitionId,multiple]);
 const recognize=async (image,element)=>{
  if(inFlight.current)return;if(multiple&&!backgroundPhoto){setError(element?'Save the empty counter before scanning products.':'Upload an empty-counter reference only when testing a saved group photo.');return;}const submittedFrame=element&&cameraFingerprint(element);if(submittedFrame){recognizedFrame.current=submittedFrame;cycle.current.capture(submittedFrame);}onCameraOpen?.();const job=Symbol(),version=revision.current,epoch=recognitionEpoch.current;inFlight.current=job;setBusy(true);setError('');setWaitingNext(false);setCodeStatus(multiple?'Products detected. Identifying them now…':'Product detected. Identifying it now…');setPhoto(image);setPrediction(null);setQueue([]);setScene(null);
  try{const data=await api('/ai/recognize',{photo:image,mode:multiple?'multiple':'single',cameraTriggered:Boolean(element),...(backgroundPhoto?{backgroundPhoto}:{})});if(version===revision.current&&epoch===recognitionEpoch.current){if(data.noMatch){const verifiedEmpty=Boolean(submittedFrame&&data.noMatchReason==='aligned_empty_background');if(verifiedEmpty){cycle.current.setBackground(submittedFrame);setBackgroundPhoto(image);recognizedFrame.current=null;}setPhoto('');setPrediction(null);setQueue([]);setScene(null);clearSince.current=0;nextView.current={frame:null,since:0};departure.current={since:0,ready:false};setWaitingNext(Boolean(element)&&!verifiedEmpty);setCodeStatus(verifiedEmpty?'No product detected · empty-counter reference refreshed.':'No product detected. The scanner remains active and will retry when the view changes.');}else if(data.items){const items=data.items.map(item=>({...item,mode:data.mode}));setScene({items,imageSize:data.imageSize,skippedEdgeRegions:data.skippedEdgeRegions||0});setPrediction(items[0]||null);setQueue(items.slice(1));setCodeStatus(items.length?'Product detected · confirm the exact match below.':'No separate product detected. Adjust the products and try again.');if(!items.length)setWaitingNext(true);}else{setPrediction(data);setCodeStatus('Product detected · confirm the exact match below.');}}}catch(e){if(version===revision.current&&epoch===recognitionEpoch.current)setError(e.message);}finally{if(inFlight.current===job)inFlight.current=false;if(version===revision.current&&epoch===recognitionEpoch.current)setBusy(false);}
 };
 const recognizeHybrid=async(image,element)=>{
  if(hybridInFlight.current||inFlight.current)return;hybridInFlight.current=true;
  try{
   if(multiple){await recognize(image,element);return;}
   setCodeStatus('Product detected. Identifying it now…');
   try{const barcodeImage=element?barcodePhotoFromElement(element):image,result=await decodeBarcodePhoto(barcodeImage,{fast:Boolean(element)}),details=scanDetails(result);if(await handleExactCode(result.getText(),details.format,element))return;}catch{}
   await recognize(image,element);
  }finally{hybridInFlight.current=false;}
 };
 const automaticFrame=element=>{
  latestElement.current=element;
  if(!canRecognize||error)return;
  try{
   const frame=cameraFingerprint(element);if(!frame)return;
   if(!calibrated){setCodeStatus('Clear the counter, then save the empty-counter reference before scanning.');return;}
   if(!automatic||(multiple&&!backgroundPhoto))return;
   if(prediction&&!inFlight.current){
    const now=Date.now();
    if(cycle.current.isBackground(frame)){
     if(!clearSince.current)clearSince.current=now;
     if(now-clearSince.current>=800){recognitionEpoch.current++;cycle.current.setBackground(frame);setBackgroundPhoto(productPhotoFromElement(element));clearSince.current=0;recognizedFrame.current=null;nextView.current={frame:null,since:0};departure.current={since:0,ready:false};setPrediction(null);setQueue([]);setScene(null);setPhoto('');setWaitingNext(false);setError('');setCodeStatus('No product in the frame.');exactSeen.current={code:'',time:0,accepted:false};lastAutomatic.current=0;}
    }else clearSince.current=0;
    return;
   }
   if(waitingNext){
    const now=Date.now();
    if(cycle.current.isBackground(frame)){
     nextView.current={frame:null,since:0};
     if(!clearSince.current)clearSince.current=now;
     if(now-clearSince.current>=800){cycle.current.setBackground(frame);setBackgroundPhoto(productPhotoFromElement(element));clearSince.current=0;recognizedFrame.current=null;departure.current={since:0,ready:false};setWaitingNext(false);setPrediction(null);setPhoto('');setError('');setCodeStatus('No product in the frame.');exactSeen.current={code:'',time:0,accepted:false};lastAutomatic.current=0;setScene(null);setQueue([]);}
    }else{
     clearSince.current=0;
     const previous=recognizedFrame.current,different=previous&&meaningfulFrameChange(previous,frame),departed=departure.current;
     if(different){if(!departed.since)departed.since=now;if(now-departed.since>=150&&!departed.ready){departed.ready=true;exactSeen.current={code:'',time:0,accepted:false};}}
     else if(!departed.ready){departed.since=0;nextView.current={frame:null,since:0};}
     if(different||departed.ready){const candidate=nextView.current;if(!candidate.frame||frameDistance(candidate.frame,frame)>10)nextView.current={frame,since:now};else if(now-candidate.since>=200){nextView.current={frame:null,since:0};departure.current={since:0,ready:false};setWaitingNext(false);setPrediction(null);setPhoto('');setError('');setCodeStatus('Next unit detected · recognizing now.');exactSeen.current={code:'',time:0,accepted:false};lastAutomatic.current=now;recognizeHybrid(productPhotoFromElement(element),element);}}
    }
    return;
   }
   if(!cycle.current.observe(frame,Date.now()))return;
   if(prediction||inFlight.current)return;
   if(Date.now()-lastAutomatic.current<1200)return;
   cycle.current.capture(frame);lastAutomatic.current=Date.now();
   recognizeHybrid(productPhotoFromElement(element),element);
  }catch(e){setError(e.message);}
 };
 const frameHandler=useRef();frameHandler.current=automaticFrame;
 useEffect(()=>{cycle.current.reset();baseline.current={frame:null,since:0};clearSince.current=0;recognizedFrame.current=null;nextView.current={frame:null,since:0};departure.current={since:0,ready:false};latestElement.current=null;setCalibrated(false);setBackgroundPhoto('');if(!camera||!cameraReady)return;const timer=setInterval(()=>frameHandler.current(video.current),100);return()=>clearInterval(timer);},[camera,cameraReady,cameras.deviceId,network]);
 const upload=async event=>{const file=event.target.files?.[0];if(!file)return;const version=revision.current;try{const image=await prepareProductPhoto(file);if(version===revision.current)await recognizeHybrid(image);}catch(e){if(version===revision.current)setError(e.message);}finally{event.target.value='';}};
 const advance=()=>{setPrediction(queue[0]||null);setQueue(queue.slice(1));setRegionKept(false);setQuantities({});setWaitingNext(queue.length===0);};
 const uploadBackground=async event=>{const file=event.target.files?.[0];if(!file)return;const version=revision.current;try{const image=await prepareProductPhoto(file);if(version===revision.current){setBackgroundPhoto(image);setCalibrated(true);setError('');}}catch(e){setError(e.message);}finally{event.target.value='';}};
 const calibrateCounter=()=>{try{const element=camera?video.current:latestElement.current,frame=element&&cameraFingerprint(element);if(!frame)throw Error('Wait for a clear live camera frame.');cycle.current.setBackground(frame);baseline.current={frame,since:Date.now()};setBackgroundPhoto(productPhotoFromElement(element));setCalibrated(true);setWaitingNext(false);setPhoto('');setPrediction(null);setQueue([]);setScene(null);setError('');setCodeStatus('No product in the frame.');exactSeen.current={code:'',time:0,accepted:false};lastAutomatic.current=0;}catch(e){setError(e.message);}};
 const confirm=async(product,quantity=1)=>{
  if(inFlight.current)return;const job=Symbol(),version=revision.current;inFlight.current=job;setBusy(true);setError('');
  try{const data=await api('/ai/confirm',{recognitionId:prediction.recognitionId,productId:product._id,quantity});if(version===revision.current){onProduct(data.product,data.quantity);advance();}}
  catch(e){if(version===revision.current)setError(e.message);}finally{if(inFlight.current===job)inFlight.current=false;if(version===revision.current)setBusy(false);}
 };
 const reject=async()=>{
  if(inFlight.current)return;const job=Symbol(),version=revision.current;inFlight.current=job;setBusy(true);setError('');
  try{await api('/ai/reject',{recognitionId:prediction.recognitionId});if(version===revision.current){advance();await onRejected();setError('');}}
  catch(e){if(version===revision.current)setError(e.message);}finally{if(inFlight.current===job)inFlight.current=false;if(version===revision.current)setBusy(false);}
 };
 const displayStatus=prediction?.candidates?.[0]?.product?.name?`Product detected: ${prediction.candidates[0].product.name}.`:codeStatus.startsWith('No product detected')?'No product in the frame.':codeStatus;
 return <section ref={section} className="ai-billing" aria-label="Smart product scanner"><div className="ai-heading"><Sparkles size={20}/><h3>One smart scanner</h3><span>Product + code</span></div><p>{multiple?'Place the products separately on a fixed counter with their fronts visible.':'Place one product in view. The scanner identifies it automatically and uses a visible code when available.'}</p>{!session?<button className="primary" onClick={onSignIn}>Sign in to use smart scanning</button>:<>
 <div className="ai-capture-actions"><button className="primary" disabled={busy||!status?.loaded} onClick={()=>{if(!camera){onCameraOpen?.();setAutomatic(true);}setNetwork(false);setCamera(!camera);}}><Camera size={16}/>{!status?.loaded?'AI starting…':camera?'Stop smart camera':'Start smart camera'}</button><button className="secondary" disabled={busy||!status?.loaded} onClick={()=>{if(!network){onCameraOpen?.();setAutomatic(true);}setCamera(false);setNetwork(!network);}}>{network?'Disconnect network camera':'Connect RTSP camera'}</button><label className="image-scan-button"><ImagePlus size={17}/> Upload product photo<input type="file" aria-label="Scan a product photo" accept="image/jpeg,image/png,image/webp" disabled={busy||!status?.loaded} onChange={upload}/></label></div>
 <details className="ai-advanced"><summary>Advanced scanning options</summary><div className="ai-live-options"><label><input type="checkbox" checked={automatic} onChange={e=>setAutomatic(e.target.checked)}/> Scan automatically when the product is steady</label><small>Enabled whenever the smart camera starts. Turn it off only when testing or positioning the camera.</small></div><div className="ai-live-options"><label><input type="checkbox" checked={multiple} disabled={busy||Boolean(prediction)} onChange={e=>{setMultiple(e.target.checked);setQueue([]);setScene(null);setError('');}}/> Multiple products on counter</label><small>{multiple?'Barcode scanning pauses while Aspire identifies the separated products.':'Keep the camera fixed and show one product clearly.'}</small>{multiple&&!camera&&!network&&<label className="image-scan-button">Empty-counter reference for saved group photos<input type="file" aria-label="Upload empty counter photo" accept="image/jpeg,image/png,image/webp" disabled={busy||Boolean(prediction)} onChange={uploadBackground}/></label>}</div></details>
 {error&&<button className="secondary" disabled={busy} onClick={()=>{setError('');if(!prediction&&photo)recognize(photo);}}>Retry camera recognition</button>}
 {libraryError&&<p className="inventory-error" role="alert">Could not refresh the AI library: {libraryError}</p>}
 {status&&<p className={'ai-library-status '+(!canRecognize?'ai-setup-needed':'')} role="status">{!status.available?'Local AI models are unavailable. Check the AI setup.':!status.loaded?'AI engine is warming up. Keep this page open; the scanner will enable automatically.':status.referenceCount?`AI ready · ${status.referenceCount} inventory reference photos`:'AI product library is empty. An administrator must open Products > AI photos and add reference pictures to your inventory products before recognition can work.'}</p>}
 {camera&&<div className="ai-camera"><video ref={video} autoPlay playsInline muted/><div className="camera-controls"><label>Camera<select aria-label="Smart scanner camera" value={cameras.preference} onChange={e=>cameras.select(e.target.value)}><option value="">Automatic camera</option>{cameras.devices.map((d,i)=><option key={d.deviceId||i} value={d.deviceId}>{d.label||`Camera ${i+1}`}</option>)}</select></label><span className="smart-scan-live"><i/>{busy?'Recognizing product…':!cameraReady?'Starting camera…':!calibrated?'Clear the counter and save it below':multiple?'Automatic scanning active · place separated products':'Automatic scanning active · place one product in view'}</span></div></div>}
 {network&&<RtspScanner api={api} token={session.token} onCode={handleExactCode} onCapture={recognizeHybrid} onFrame={automaticFrame} scanPaused={multiple||busy||Boolean(prediction)} captureBusy={busy} captureDisabled={!canRecognize} onStop={()=>setNetwork(false)}/>}
 {(camera||network)&&<div className="ai-live-options ai-counter-calibration"><button className={calibrated?'secondary':'primary'} disabled={busy||Boolean(prediction)||(camera&&!cameraReady)} onClick={calibrateCounter}>{calibrated?'Relearn empty counter':'Save empty counter'}</button><small>{calibrated?'Reference locked. Aspire compares every live frame with this saved empty counter.':'Remove every product, then save one empty frame. Scanning stays paused until this is done.'}</small></div>}
 {(prediction||displayStatus)&&<p className="ai-code-status" role="status">{displayStatus}</p>}
 {waitingNext&&<div className="ai-next-product" role="status"><p>{displayStatus.startsWith('No product in')?'No product in the frame. Place one product in view.':camera||network?'Product added. Remove or replace this unit—another unit of the same product is supported. Scanning resumes automatically.':'Product added. Upload another product photo when ready.'}</p></div>}
 {busy&&<p className="ai-progress" role="status">{status?.loaded?'Identifying product…':'Starting product scanner…'}</p>}
 {error&&<p className="inventory-error" role="alert">{error}</p>}
 {scene&&<p role="status">{scene.items.length?`${scene.items.length} complete product${scene.items.length===1?'':'s'} found. ${queue.length+(prediction?1:0)} left to review.${scene.skippedEdgeRegions?` ${scene.skippedEdgeRegions} cut-off item${scene.skippedEdgeRegions===1?' was':'s were'} skipped; move ${scene.skippedEdgeRegions===1?'it':'them'} fully into view.`:''}`:scene.skippedEdgeRegions?`${scene.skippedEdgeRegions} cut-off product${scene.skippedEdgeRegions===1?' was':'s were'} skipped. Move ${scene.skippedEdgeRegions===1?'it':'them'} fully into view and scan again.`:'No separate products found. Check the view and spacing if items were missed.'}</p>}
 {scene?.items.length>0&&scene.imageSize&&<div className="ai-scene-preview"><img src={photo} alt="Scene with numbered detected product regions"/>{scene.items.map((item,i)=>{const [x1,y1,x2,y2]=item.box,[w,h]=scene.imageSize;return <span key={item.recognitionId} className={prediction?.recognitionId===item.recognitionId?'active':''} style={{left:`${x1/w*100}%`,top:`${y1/h*100}%`,width:`${(x2-x1)/w*100}%`,height:`${(y2-y1)/h*100}%`}}>{i+1}</span>;})}</div>}
 {photo&&<div className="ai-query-photo">{multiple&&prediction?.photo?<><img src={prediction.photo} alt="Detected item being reviewed"/><div className="ai-region-review"><span>Current product photo</span><small>Keep this crop to choose its exact product below, or discard only this detected region.</small><div><button type="button" className={'ai-region-action keep '+(regionKept?'selected':'')} disabled={busy} onClick={()=>setRegionKept(true)} aria-label="Keep this detected product"><Check size={17}/>{regionKept?'Kept':'Keep'}</button><button type="button" className="ai-region-action discard" disabled={busy} onClick={reject} aria-label="Discard this detected product"><X size={17}/>Discard</button></div></div></>:<><img src={photo} alt="Product submitted to AI"/><span>Current product photo</span></>}</div>}
 {prediction&&<div className="ai-suggestions"><h4>Possible matches · confirm the exact pack</h4><p>Visual similarity scores are not confidence percentages. Choose the number of identical units, then confirm the exact product. The live camera continues monitoring the counter.</p>{prediction.candidates.map(candidate=>{const p=candidate.product,remaining=p.stock-(cart.find(i=>i.productId===p._id)?.quantity||0),maximum=Math.min(99,Math.max(1,remaining)),quantity=Math.min(maximum,Math.max(1,quantities[p._id]||1)),changeQuantity=next=>setQuantities(old=>({...old,[p._id]:Math.min(maximum,Math.max(1,next))}));return <article className="ai-candidate" key={p._id}>{candidate.referencePhoto&&<img src={candidate.referencePhoto} alt={'AI reference for '+p.name}/>}<div><strong>{p.name}</strong><p>{money(productPrice(p).price)} · {p.stock} in this store</p><small>Visual similarity {candidate.similarity.toFixed(3)}</small><div className="ai-match-quantity"><span>Quantity</span><button type="button" disabled={busy||quantity<=1} onClick={()=>changeQuantity(quantity-1)} aria-label={'Reduce AI quantity for '+p.name}><Minus size={13}/></button><strong>{quantity}</strong><button type="button" disabled={busy||remaining<1||quantity>=maximum} onClick={()=>changeQuantity(quantity+1)} aria-label={'Increase AI quantity for '+p.name}><Plus size={13}/></button></div><button className="primary" disabled={busy||remaining<1} onClick={()=>confirm(p,quantity)} aria-label={'Confirm AI match '+p.name}>{<Check size={15}/>} {p.stock<1?'Out of stock':remaining<1?'No more stock':`Confirm & add ${quantity}`}</button></div></article>;})}<button className="secondary" disabled={busy} onClick={reject}><X size={15}/> None of these products</button></div>}
 </>}</section>;
}

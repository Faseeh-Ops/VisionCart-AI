import React,{useCallback,useEffect,useState} from 'react';

export const isExternalCamera=device=>/logitech|\blogi\b|usb|external|c130|c270|c310|c920|droidcam|iriun|virtual|obs|camo/i.test(device.label||'');
export default function useCameras() {
  const [devices,setDevices]=useState([]),[discoveryError,setDiscoveryError]=useState('');
  const [preference,setPreference]=useState(()=>{try{return localStorage.getItem('asp-camera-device')||'';}catch{return '';}});
  const refresh=useCallback(async()=>{
    if(!navigator.mediaDevices?.enumerateDevices)return;
    try {setDevices((await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='videoinput'));setDiscoveryError('');}catch {setDiscoveryError('Camera devices could not be listed. Check browser and Windows camera permissions.');}
  },[]);
  const authorize=useCallback(async()=>{
    if(!navigator.mediaDevices?.getUserMedia){setDiscoveryError('Camera access requires localhost or HTTPS.');return;}
    let stream;
    try{stream=await navigator.mediaDevices.getUserMedia({audio:false,video:true});await refresh();}
    catch{setDiscoveryError('Camera permission was denied or no working camera was found. Check Windows camera privacy settings.');}
    finally{stream?.getTracks().forEach(track=>track.stop());}
  },[refresh]);
  useEffect(()=>{
    refresh();
    const media=navigator.mediaDevices;
    media?.addEventListener('devicechange',refresh);
    window.addEventListener('focus',refresh);
    return()=>{media?.removeEventListener('devicechange',refresh);window.removeEventListener('focus',refresh);};
  },[refresh]);
  const selected=devices.find(d=>d.deviceId===preference);
  const automatic=devices.find(isExternalCamera);
  const deviceId=selected?.deviceId||automatic?.deviceId||'';
  const select=value=>{setPreference(value);try{localStorage.setItem('asp-camera-device',value);}catch{}};
  useEffect(()=>{const sync=event=>setPreference(event.detail||'');window.addEventListener('asp-camera-preference',sync);return()=>window.removeEventListener('asp-camera-preference',sync);},[]);
  const selectShared=value=>{select(value);window.dispatchEvent(new CustomEvent('asp-camera-preference',{detail:value}));};
  return {devices,deviceId,preference:selected?preference:'',select:selectShared,refresh,authorize,automatic,discoveryError};
}

export function CameraPicker({cameras}) {
  return <div className="camera-controls"><label>Camera <select aria-label="Select camera" value={cameras.preference} onChange={event=>cameras.select(event.target.value)}><option value="">Automatic{cameras.automatic?' — '+cameras.automatic.label:' / default camera'}</option>{cameras.devices.map((device,index)=><option key={device.deviceId||index} value={device.deviceId}>{device.label||`Camera ${index+1}`}</option>)}</select></label><button type="button" className="text-button" onClick={cameras.authorize}>Detect / refresh cameras</button>{cameras.discoveryError?<small role="alert">{cameras.discoveryError}</small>:!cameras.devices.some(d=>d.label)?<small>Allow camera access to display names such as DroidCam Video.</small>:<small>{cameras.devices.length} camera{cameras.devices.length===1?'':'s'} detected. Select DroidCam explicitly if automatic selection uses the laptop camera.</small>}</div>;
}

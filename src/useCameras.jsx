import React,{useCallback,useEffect,useState} from 'react';

export const isExternalCamera=device=>/logitech|\blogi\b|usb|external|c130|c270|c310|c920/i.test(device.label||'');
export default function useCameras() {
  const [devices,setDevices]=useState([]);
  const [preference,setPreference]=useState(()=>{try{return localStorage.getItem('asp-camera-device')||'';}catch{return '';}});
  const refresh=useCallback(async()=>{
    if(!navigator.mediaDevices?.enumerateDevices)return;
    try {setDevices((await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='videoinput'));}catch {}
  },[]);
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
  return {devices,deviceId,preference: selected?preference:'',select:selectShared,refresh,automatic};
}

export function CameraPicker({cameras}) {
  return <div className="camera-controls"><label>Camera <select aria-label="Select camera" value={cameras.preference} onChange={event=>cameras.select(event.target.value)}><option value="">Automatic{cameras.automatic?' — '+cameras.automatic.label:' / default camera'}</option>{cameras.devices.map((device,index)=><option key={device.deviceId||index} value={device.deviceId}>{device.label||`Camera ${index+1}`}</option>)}</select></label><button type="button" className="text-button" onClick={cameras.refresh}>Refresh cameras</button>{!cameras.devices.some(d=>d.label)&&<small>Open camera and allow access to display device names.</small>}</div>;
}

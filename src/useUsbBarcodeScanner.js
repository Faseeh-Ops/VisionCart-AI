import {useEffect,useRef,useState} from 'react';

const editableTarget=target=>target instanceof HTMLElement&&(target.matches('input,textarea,select,[contenteditable="true"]')||target.closest('[contenteditable="true"]'));

export default function useUsbBarcodeScanner(onScan,{enabled=true,minLength=4,maxGap=300}={}){
  const callback=useRef(onScan),buffer=useRef(''),lastKeyAt=useRef(0),clearTimer=useRef(),[lastScanAt,setLastScanAt]=useState(0),[ready,setReady]=useState(false);
  callback.current=onScan;
  useEffect(()=>{
    if(!enabled){setReady(false);return;}
    const reset=()=>{buffer.current='';lastKeyAt.current=0;clearTimeout(clearTimer.current);};
    const keydown=event=>{
      if(event.defaultPrevented||event.ctrlKey||event.altKey||event.metaKey||editableTarget(event.target))return;
      const now=performance.now();
      if(event.key==='Enter'||event.key==='Tab'){
        const code=buffer.current;reset();
        if(code.length>=minLength){event.preventDefault();setLastScanAt(Date.now());callback.current(code);}
        return;
      }
      if(event.key.length!==1)return;
      if(lastKeyAt.current&&now-lastKeyAt.current>maxGap)buffer.current='';
      buffer.current+=event.key;lastKeyAt.current=now;
      clearTimeout(clearTimer.current);clearTimer.current=setTimeout(reset,Math.max(250,maxGap*3));
    };
    window.addEventListener('keydown',keydown,true);setReady(true);return()=>{window.removeEventListener('keydown',keydown,true);reset();};
  },[enabled,minLength,maxGap]);
  return {lastScanAt,ready};
}

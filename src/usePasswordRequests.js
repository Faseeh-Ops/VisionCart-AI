import {useCallback,useEffect,useRef,useState} from 'react';

export default function usePasswordRequests(api,session) {
 const [requests,setRequests]=useState([]),[error,setError]=useState('');
 const apiRef=useRef(api),generation=useRef(0),latestRead=useRef(0);apiRef.current=api;
 const token=session?.token,enabled=session?.user.role==='admin';
 const refresh=useCallback(async()=>{
  if(!enabled)return;
  const current=generation.current,read=++latestRead.current;
  try{const data=await apiRef.current('/admin/password-resets');if(current===generation.current&&read===latestRead.current){setRequests(data);setError('');}}
  catch(e){if(current===generation.current&&read===latestRead.current)setError(e.message);}
 },[token,enabled]);
 useEffect(()=>{
  generation.current++;setRequests([]);setError('');if(!enabled)return;
  refresh();const timer=setInterval(refresh,5000);window.addEventListener('focus',refresh);
  return()=>{generation.current++;clearInterval(timer);window.removeEventListener('focus',refresh);};
 },[refresh,enabled]);
 return {requests,error,refresh};
}

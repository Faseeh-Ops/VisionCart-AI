import React,{useState,useEffect,useRef} from 'react';
import {LogOut,Users} from 'lucide-react';
export function Avatar({user,small=false}){
  const [failed,setFailed]=useState(false);
  useEffect(()=>setFailed(false),[user?.photo]);
  return <span className={'avatar '+(small?'small':'')}>{user?.photo&&!failed?<img src={user.photo} alt={`${user.name}'s profile photo`} onError={()=>setFailed(true)}/>:user?.name?.trim()?.[0]?.toUpperCase()||'A'}</span>;
}
export default function AccountMenu({session,onLogout,onProfile,onSignIn}){
  const [open,setOpen]=useState(false),[busy,setBusy]=useState(false);const container=useRef(),trigger=useRef();
  useEffect(()=>{if(!open)return;const close=e=>{if(!container.current?.contains(e.target))setOpen(false);};const key=e=>{if(e.key==='Escape'){setOpen(false);trigger.current?.focus();}};document.addEventListener('pointerdown',close);document.addEventListener('keydown',key);return()=>{document.removeEventListener('pointerdown',close);document.removeEventListener('keydown',key);};},[open]);
  useEffect(()=>setOpen(false),[session?.token]);
  return <div className="account-menu" ref={container}><button ref={trigger} className="avatar-trigger" aria-label="Open account menu" aria-expanded={open} aria-controls="account-dropdown" onClick={()=>setOpen(!open)}><Avatar user={session?.user} small/></button>{open&&<div id="account-dropdown" className="account-dropdown" aria-label="Account options"><div className="account-menu-identity"><Avatar user={session?.user}/><div><strong>{session?.user.name||'Guest workspace'}</strong><small>{session?.user.email||'Demo mode'}</small>{session&&<span className="pill">{session.user.role}</span>}</div></div>{session?<><button onClick={()=>{setOpen(false);onProfile();}}><Users size={17}/> Profile & photo</button><button className="logout-menu-item" disabled={busy} onClick={async()=>{setBusy(true);try{await onLogout();setOpen(false);}finally{setBusy(false);}}}><LogOut size={17}/>{busy?'Logging out…':'Log out'}</button></>:<button onClick={()=>{setOpen(false);onSignIn();}}>Sign in</button>}</div>}</div>;
}

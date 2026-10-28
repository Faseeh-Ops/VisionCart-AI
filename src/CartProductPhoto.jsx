import React,{useEffect,useState} from 'react';
import {Package} from 'lucide-react';

const cache=new Map();

export default function CartProductPhoto({productId,name,api,token,revision=0}){
 const cacheKey=`${token||'demo'}:${productId}:${revision}`;
 const [photo,setPhoto]=useState(()=>cache.get(cacheKey)||null),[loading,setLoading]=useState(Boolean(token&&!cache.has(cacheKey))),[failed,setFailed]=useState(false);
 useEffect(()=>{
  let cancelled=false;setFailed(false);
  if(!token||!productId){setLoading(false);setPhoto(null);return()=>{cancelled=true;};}
  const saved=cache.get(cacheKey);if(saved){setPhoto(saved);setLoading(false);return()=>{cancelled=true;};}
  setLoading(true);
  api('/ai/product-photos',{productIds:[productId]}).then(result=>{
   if(cancelled)return;const next=result.photos?.[productId]||null;if(next)cache.set(cacheKey,next);setPhoto(next);
  }).catch(()=>{if(!cancelled)setPhoto(null);}).finally(()=>{if(!cancelled)setLoading(false);});
  return()=>{cancelled=true;};
 },[api,cacheKey,productId,token]);
 return <span className="cart-product-photo">{photo&&!failed?<img src={photo} alt={'Product photo of '+name} onError={()=>setFailed(true)}/>:loading?<span className="cart-photo-loading"/>:<Package size={21}/>}</span>;
}

import React,{createContext,useContext,useEffect,useState} from 'react';
import {Package} from 'lucide-react';

const Photos=createContext({photos:{},loading:false});
export function CatalogPhotos({products,api,token,revision,children}){
 const [state,setState]=useState({photos:{},loading:false}),[error,setError]=useState('');
 const ids=products.map(p=>p._id).join(',');
 useEffect(()=>{
  let cancelled=false;setError('');
  if(!token){setState({photos:{},loading:false});return;}
  setState(old=>({...old,loading:true}));
  const productIds=ids?ids.split(','):[];
  const load=async()=>{
   const photos={};
   for(let i=0;i<productIds.length;i+=60){
    if(cancelled)return;
    const result=await api('/ai/product-photos',{productIds:productIds.slice(i,i+60)});
    Object.assign(photos,result.photos);
   }
   if(!cancelled)setState({photos,loading:false});
  };
  load().catch(e=>{if(!cancelled){setError(e.message);setState({photos:{},loading:false});}});
  return()=>{cancelled=true;};
 },[ids,token,revision]);
 return <Photos.Provider value={state}>{error&&<p className="inventory-error" role="alert">Could not load product pictures: {error}</p>}{children}</Photos.Provider>;
}
export default function CatalogPhoto({product}){
 const {photos,loading}=useContext(Photos),photo=photos[product._id];
 const [failed,setFailed]=useState(false);useEffect(()=>setFailed(false),[photo]);
 return <div className="catalog-product-photo">{photo&&!failed?<img src={photo} alt={'Product photo of '+product.name} loading="lazy" onError={()=>setFailed(true)}/>:<div className="catalog-photo-placeholder"><Package size={30}/><small>{loading?'Loading photo…':'No photo available'}</small></div>}</div>;
}

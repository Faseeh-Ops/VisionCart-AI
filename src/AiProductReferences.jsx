import React,{useEffect,useRef,useState} from 'react';
import {X,ImagePlus,Trash2} from 'lucide-react';
import {prepareProductPhoto} from './product-photo.js';
import './ai.css';

export default function AiProductReferences({product,api,onClose}){
 const [references,setReferences]=useState([]),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const revision=useRef(0);
 const load=()=>api(`/ai/products/${product._id}/references`).then(setReferences);
 useEffect(()=>{load().catch(e=>setError(e.message));return()=>{revision.current++;};},[product._id]);
 const upload=async event=>{
  const file=event.target.files?.[0];if(!file||busy)return;const version=revision.current;setBusy(true);setError('');
  try{await api(`/ai/products/${product._id}/references`,{photo:await prepareProductPhoto(file)});if(version===revision.current)await load();}
  catch(e){if(version===revision.current)setError(e.message);}finally{if(version===revision.current)setBusy(false);event.target.value='';}
 };
 const remove=async id=>{if(busy)return;setBusy(true);setError('');try{await api(`/ai/references/${id}/remove`,{});await load();}catch(e){setError(e.message);}finally{setBusy(false);}};
 return <div className="modal-backdrop"><section className="modal ai-reference-modal" role="dialog" aria-modal="true" aria-labelledby="ai-reference-title"><button className="modal-close" aria-label="Close AI photos" onClick={onClose} disabled={busy}><X size={20}/></button><h2 id="ai-reference-title">AI product photos</h2><h3>{product.name}</h3><p>Add clear photos of this exact size and individual pack. A box of packets needs its own product entry. These photos help cashiers find the right product.</p><label className="image-scan-button"><ImagePlus size={18}/> {busy?'Preparing AI reference…':'Add reference photo'}<input type="file" aria-label="Add AI reference photo" accept="image/jpeg,image/png,image/webp" disabled={busy||references.length>=8} onChange={upload}/></label><p>{references.length}/8 reference photos · The first image may take longer while local models start.</p>{error&&<p role="alert" className="inventory-error">{error}</p>}<div className="ai-reference-grid">{references.map(reference=><figure key={reference._id}><img src={reference.photo} alt={'Reference for '+product.name}/><button className="text-button" aria-label="Remove AI reference photo" disabled={busy} onClick={()=>remove(reference._id)}><Trash2 size={14}/> Remove</button></figure>)}</div>{!references.length&&!busy&&<p className="subtle-empty">Add the first product photo to enable visual matching.</p>}</section></div>;
}

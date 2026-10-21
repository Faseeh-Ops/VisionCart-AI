import React,{useEffect,useRef,useState} from 'react';
import {Check,ExternalLink,Globe2,ImagePlus,Search,Trash2,X} from 'lucide-react';
import {prepareProductPhoto} from './product-photo.js';
import './ai.css';

export default function AiProductReferences({product,api,onClose}){
 const [references,setReferences]=useState([]),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [query,setQuery]=useState(product.name),[suggestions,setSuggestions]=useState([]),[searching,setSearching]=useState(false),[savingSuggestion,setSavingSuggestion]=useState(''),[searchNote,setSearchNote]=useState('');
 const revision=useRef(0);
 const browserImageSearch=`https://www.google.com/search?tbm=isch&q=${encodeURIComponent((query||product.name)+' product pack')}`;
 const load=()=>api(`/ai/products/${product._id}/references`).then(setReferences);
 const searchPictures=async(searchQuery=query)=>{
  if(searching)return;const version=revision.current;setSearching(true);setError('');setSearchNote('');
  try{const result=await api(`/ai/products/${product._id}/image-suggestions?q=${encodeURIComponent(searchQuery)}`);if(version!==revision.current)return;setSuggestions(result.candidates||[]);setSearchNote(result.externalError||result.attribution||'');}
  catch(e){if(version===revision.current)setError(e.message);}finally{if(version===revision.current)setSearching(false);}
 };
 useEffect(()=>{load().catch(e=>setError(e.message));searchPictures(product.name);return()=>{revision.current++;};},[product._id]);
 const upload=async event=>{
  const file=event.target.files?.[0];if(!file||busy)return;const version=revision.current;setBusy(true);setError('');
  try{await api(`/ai/products/${product._id}/references`,{photo:await prepareProductPhoto(file)});if(version===revision.current)await load();}
  catch(e){if(version===revision.current)setError(e.message);}finally{if(version===revision.current)setBusy(false);event.target.value='';}
 };
 const chooseSuggestion=async(candidate,index)=>{
  if(busy||savingSuggestion||references.length>=8)return;const key=candidate.provider+'-'+index;setSavingSuggestion(key);setError('');
  try{await api(`/ai/products/${product._id}/reference-from-suggestion`,{provider:candidate.provider,referenceId:candidate.referenceId,imageUrl:candidate.imageUrl});await load();setSuggestions(old=>old.filter((_,candidateIndex)=>candidateIndex!==index));}
  catch(e){setError(e.message);}finally{setSavingSuggestion('');}
 };
 const remove=async id=>{if(busy)return;setBusy(true);setError('');try{await api(`/ai/references/${id}/remove`,{});await load();}catch(e){setError(e.message);}finally{setBusy(false);}};
 return <div className="modal-backdrop"><section className="modal ai-reference-modal" role="dialog" aria-modal="true" aria-labelledby="ai-reference-title"><button className="modal-close" aria-label="Close AI photos" onClick={onClose} disabled={busy||Boolean(savingSuggestion)}><X size={20}/></button><h2 id="ai-reference-title">Product pictures & AI photos</h2><h3>{product.name}</h3><p>Confirm the exact brand, flavour, size and pack before saving a suggested picture. The first saved picture appears in the catalogue and all saved pictures help AI recognition.</p>
 <form className="product-image-search" onSubmit={event=>{event.preventDefault();searchPictures();}}><label htmlFor="product-image-query">Find pictures by product name</label><div><Search size={17}/><input id="product-image-query" value={query} onChange={event=>setQuery(event.target.value)} maxLength={120}/><button className="secondary" disabled={searching||!query.trim()}>{searching?'Searching…':'Search'}</button></div><div className="browser-image-search"><span>Cannot find the exact pack?</span><a className="secondary" href={browserImageSearch} target="_blank" rel="noreferrer"><ExternalLink size={15}/> Search Google Images</a><small>Download the correct front-pack image, return here, then use “Upload your own photo”.</small></div></form>
 {suggestions.length>0&&<div className="image-suggestion-section"><div className="image-suggestion-heading"><h4>Choose the exact product</h4><span>{suggestions.length} suggestions</span></div><div className="image-suggestion-grid">{suggestions.map((candidate,index)=>{const key=candidate.provider+'-'+index;return <article className="image-suggestion" key={key}><img src={candidate.imageUrl} alt={candidate.name}/><div><strong>{candidate.name}</strong>{candidate.details&&<small>{candidate.details}</small>}<span><Globe2 size={13}/>{candidate.sourceLabel}</span>{candidate.sourceUrl&&<a href={candidate.sourceUrl} target="_blank" rel="noreferrer">View source</a>}<button className="primary" disabled={Boolean(savingSuggestion)||busy||references.length>=8} onClick={()=>chooseSuggestion(candidate,index)}>{savingSuggestion===key?'Saving & preparing AI…':<><Check size={15}/> Use this picture</>}</button></div></article>;})}</div></div>}
 {!searching&&!suggestions.length&&<p className="subtle-empty">No close picture match was found. Try the brand and product name, or upload your own clear pack photo.</p>}{searchNote&&<p className="image-search-note">{searchNote}</p>}
 <div className="photo-library-heading"><h4>Saved product pictures</h4><label className="image-scan-button"><ImagePlus size={18}/> {busy?'Preparing AI reference…':'Upload your own photo'}<input type="file" aria-label="Add AI reference photo" accept="image/jpeg,image/png,image/webp" disabled={busy||Boolean(savingSuggestion)||references.length>=8} onChange={upload}/></label></div><p>{references.length}/8 saved pictures · Add several real angles later for stronger camera recognition.</p>{error&&<p role="alert" className="inventory-error">{error}</p>}<div className="ai-reference-grid">{references.map(reference=><figure key={reference._id}><img src={reference.photo} alt={'Reference for '+product.name}/>{reference.sourceLabel&&<small>{reference.sourceLabel}</small>}<button className="text-button" aria-label="Remove AI reference photo" disabled={busy||Boolean(savingSuggestion)} onClick={()=>remove(reference._id)}><Trash2 size={14}/> Remove</button></figure>)}</div>{!references.length&&!busy&&<p className="subtle-empty">Choose a suggestion or upload the first photo to show this product in the catalogue.</p>}</section></div>;
}

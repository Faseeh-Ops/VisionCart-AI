import React,{useEffect,useMemo,useState} from 'react';
import {Percent,Search,X} from 'lucide-react';
import {productPrice} from '../shared/pricing.js';
import './discounts.css';

const money=value=>'Rs '+new Intl.NumberFormat('en-PK',{maximumFractionDigits:2}).format(value);
const globalView=products=>products.map(product=>({...product,discountPercent:product.globalDiscountPercent??(product.discountScope==='all'?product.discountPercent:0),discountScope:'all',storeDiscountPercent:null}));

export default function Discounts({products,stores,api,onSaved,notify}){
 const [target,setTarget]=useState('all'),[catalog,setCatalog]=useState(()=>globalView(products)),[query,setQuery]=useState(''),[selected,setSelected]=useState(null),[percent,setPercent]=useState(0),[busy,setBusy]=useState(false),[loading,setLoading]=useState(false),[error,setError]=useState('');
 const targetStore=stores.find(store=>store._id===target),targetName=target==='all'?'All stores':targetStore?.name||'Selected store';
 const loadTarget=async value=>{
  if(value==='all'){setCatalog(globalView(products));return;}
  setLoading(true);setError('');
  try{setCatalog(await api('/products?storeId='+encodeURIComponent(value)));}catch(e){setError(e.message);}finally{setLoading(false);}
 };
 useEffect(()=>{setSelected(null);setQuery('');setError('');loadTarget(target);},[target]);
 useEffect(()=>{if(target==='all')setCatalog(globalView(products));},[products,target]);
 const matches=useMemo(()=>{const term=query.trim().toLowerCase();return catalog.filter(product=>!term||(product.name+' '+product.barcode).toLowerCase().includes(term)).slice(0,60);},[catalog,query]);
 const choose=product=>{setSelected(product);setPercent(target==='all'?(product.globalDiscountPercent??product.discountPercent??0):(product.storeDiscountPercent??product.discountPercent??0));setError('');};
 const save=async event=>{
  event.preventDefault();const value=Number(percent);if(!selected||!Number.isFinite(value)||value<0||value>100){setError('Enter a discount from 0 to 100%.');return;}
  setBusy(true);setError('');
  try{
   await api('/products/'+selected._id+'/discount',{discountPercent:value,storeId:target});
   await onSaved();await loadTarget(target);
   notify(target==='all'?`${value}% company-wide discount applied to all stores.`:`${value}% discount applied to ${targetName}.`);setSelected(null);
  }catch(e){setError(e.message);}finally{setBusy(false);}
 };
 return <section className="discount-page">
  <div className="discount-hero"><span><Percent size={24}/></span><div><div className="eyebrow">PROMOTION CONTROL</div><h2>Product discounts</h2><p>Choose the promotion target here, then apply the discount to a product.</p></div></div>
  <section className="panel discount-target"><div><h3>Where should this promotion run?</h3><p>Choose all branches for one company-wide offer, or select a specific store for a local promotion.</p></div><label>Discount target<select aria-label="Discount target" value={target} onChange={event=>setTarget(event.target.value)}><option value="all">All stores — company-wide</option>{stores.map(store=><option value={store._id} key={store._id}>{store.name} · {store.location}{store.active===false?' (Inactive)':''}</option>)}</select></label></section>
  {selected&&<form className="panel discount-editor" onSubmit={save}><div className="panel-title"><div><Percent size={18}/><h2>Set discount · {selected.name}</h2></div><button type="button" aria-label="Close discount editor" onClick={()=>setSelected(null)}><X size={18}/></button></div><div className="discount-editor-fields"><label>Discount percentage<input aria-label="Discount percentage" type="number" min="0" max="100" step="0.01" required value={percent} onChange={event=>setPercent(event.target.value)}/></label><div className="discount-preview"><small>Customer price in {targetName}</small><strong>{money(productPrice({...selected,discountPercent:Number(percent)||0}).price)}</strong><span>Regular price {money(selected.price)}</span></div></div><p className="discount-explanation">{target==='all'?'This company-wide discount will apply in every store and replace existing branch-specific discounts for this product.':`This creates an offer for ${targetName} only. Every other store keeps its current discount.`}</p>{error&&<p className="inventory-error" role="alert">{error}</p>}<button className="primary discount-save" disabled={busy}>{busy?'Saving discount…':'Save discount'}</button></form>}
  <section className="panel discount-catalog"><div className="panel-title"><h2>Choose a product <span className="count-pill">{targetName}</span></h2><span className="count-pill">{catalog.length} products</span></div><label className="catalog-search"><Search size={18}/><input aria-label="Search discount products" value={query} onChange={event=>setQuery(event.target.value)} placeholder="Search product name or barcode…"/></label>{loading?<p role="status" className="subtle-empty">Loading products for {targetName}…</p>:<div className="discount-list">{matches.map(product=>{const hasOverride=target!=='all'&&Number.isFinite(product.storeDiscountPercent);return <article key={product._id}><div><strong>{product.name}</strong><small>{product.barcode} · {target==='all'?'Shared product catalogue':`${product.stock} in ${targetName}`}</small></div><div className="discount-current"><strong>{product.discountPercent||0}%</strong><span>{target==='all'?'Company-wide':hasOverride?'Store override':'Inherits company discount'}</span></div><div className="discount-price"><span>{money(productPrice(product).price)}</span>{product.discountPercent>0&&<small>{money(product.price)}</small>}</div><button className="secondary" onClick={()=>choose(product)}>Manage discount</button></article>;})}</div>}{catalog.length>60&&!query&&<p className="section-note">Search by product name or barcode to find the rest of the catalog.</p>}{!loading&&!matches.length&&<p className="subtle-empty">No products match your search.</p>}</section>
 </section>;
}

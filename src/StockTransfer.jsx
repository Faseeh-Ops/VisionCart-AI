import React,{useEffect,useRef,useState} from 'react';
import {ArrowRightLeft,X} from 'lucide-react';

export default function StockTransfer({api,initialStoreId,onClose,onSaved}){
 const [stores,setStores]=useState([]),[source,setSource]=useState(initialStoreId),[destination,setDestination]=useState(''),[products,setProducts]=useState([]),[targetProducts,setTargetProducts]=useState([]),[productId,setProductId]=useState(''),[quantity,setQuantity]=useState(''),[history,setHistory]=useState([]),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[success,setSuccess]=useState('');
 const requestId=useRef(crypto.randomUUID());
 const product=products.find(p=>p._id===productId),target=targetProducts.find(p=>p._id===productId),units=Number(quantity);
 const from=stores.find(s=>s._id===source),to=stores.find(s=>s._id===destination);
 useEffect(()=>{let alive=true;Promise.all([api('/stores'),api('/inventory/transfers')]).then(([s,h])=>{if(alive){setStores(s);setHistory(h);}}).catch(e=>{if(alive)setError(e.message);});return()=>{alive=false;};},[]);
 useEffect(()=>{let alive=true;setLoading(true);setProducts([]);setTargetProducts([]);setError('');
 Promise.all([api('/products?storeId='+encodeURIComponent(source)),destination?api('/products?storeId='+encodeURIComponent(destination)):Promise.resolve([])]).then(([p,t])=>{if(alive){setProducts(p);setTargetProducts(t);}}).catch(e=>{if(alive)setError(e.message);}).finally(()=>{if(alive)setLoading(false);});return()=>{alive=false;};},[source,destination]);
 const changed=()=>{requestId.current=crypto.randomUUID();setError('');setSuccess('');};
 const save=async e=>{e.preventDefault();if(busy||loading)return;setBusy(true);setError('');setSuccess('');
 try{await api('/inventory/transfers',{productId,fromStoreId:source,toStoreId:destination,quantity:units,requestId:requestId.current});
 setSuccess(`${units} units of ${product.name} transferred from ${from.name} to ${to.name}.`);
 const [p,t,h]=await Promise.all([api('/products?storeId='+source),api('/products?storeId='+destination),api('/inventory/transfers')]);setProducts(p);setTargetProducts(t);setHistory(h);setQuantity('');requestId.current=crypto.randomUUID();await onSaved();
 }catch(e){setError(e.message);}finally{setBusy(false);}};
 return <div className="modal-backdrop"><section className="modal stock-transfer-modal" role="dialog" aria-modal="true" aria-labelledby="stock-transfer-title"><button className="modal-close" aria-label="Close stock allocation" disabled={busy} onClick={onClose}><X size={20}/></button><span className="brand-icon"><ArrowRightLeft/></span><h2 id="stock-transfer-title">Allocate stock between stores</h2><p>Move existing stock to another branch. The total number of products stays the same.</p>
 <form onSubmit={save}><div className="transfer-stores"><label>From store<select aria-label="From store" required value={source} disabled={busy} onChange={e=>{changed();setSource(e.target.value);setProductId('');setDestination('');}}>{stores.map(s=><option key={s._id} value={s._id} disabled={!s.active}>{s.name}{s.active?'':' (Inactive)'}</option>)}</select></label><label>To store<select aria-label="To store" required value={destination} disabled={busy} onChange={e=>{changed();setDestination(e.target.value);}}><option value="">Choose destination</option>{stores.filter(s=>s._id!==source&&s.active).map(s=><option key={s._id} value={s._id}>{s.name}</option>)}</select></label></div>
 <label>Product to allocate<select aria-label="Product to allocate" required value={productId} disabled={busy||loading} onChange={e=>{changed();setProductId(e.target.value);}}><option value="">{loading?'Loading stock...':'Choose a product'}</option>{products.map(p=><option key={p._id} value={p._id}>{p.name} ({p.stock} available)</option>)}</select></label>
 <label>Units to transfer<input required type="number" min="1" max={Math.min(product?.stock||100000,100000)} step="1" value={quantity} disabled={busy} onChange={e=>{changed();setQuantity(e.target.value);}}/></label>
 {product&&destination&&!loading&&<div className="transfer-preview"><strong>Stock after this transfer</strong><div>{from?.name}<span>{product.stock} → {product.stock-(units||0)} units</span></div><div>{to?.name}<span>{target?.stock||0} → {(target?.stock||0)+(units||0)} units</span></div></div>}
 {error&&<p role="alert" className="inventory-error">{error}</p>}{success&&<p role="status" className="store-success">{success}</p>}
 <button className="primary" disabled={busy||loading||!product||!from?.active||!destination||source===destination||!Number.isSafeInteger(units)||units<1||units>product.stock||units>100000}><ArrowRightLeft size={17}/>{busy?'Transferring...':'Transfer stock'}</button></form>
 <div className="transfer-history"><h3>Recent stock transfers</h3>{history.length?<div className="transfer-history-scroll"><table><thead><tr><th>Product / date</th><th>Stores</th><th>Units</th><th>Admin</th></tr></thead><tbody>{history.map(t=><tr key={t._id}><td>{t.productName}<small>{new Date(t.createdAt).toLocaleString('en-PK',{timeZone:'Asia/Karachi'})}</small></td><td>{t.fromStoreName} → {t.toStoreName}</td><td>{t.quantity}</td><td>{t.adminName}</td></tr>)}</tbody></table></div>:<p>No stock transfers yet.</p>}</div>
 </section></div>;
}

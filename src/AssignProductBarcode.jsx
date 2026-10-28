import React,{useEffect,useRef,useState} from 'react';
import {CheckCircle2,Package,ScanLine,X} from 'lucide-react';
import useUsbBarcodeScanner from './useUsbBarcodeScanner.js';
import {hasInternalProductCode,normalizeProductBarcode,validPhysicalProductBarcode} from '../shared/product-barcode.js';

export default function AssignProductBarcode({product,storeId,api,onClose,onSaved}){
  const [barcode,setBarcode]=useState(''),[error,setError]=useState(''),[saving,setSaving]=useState(false),[captured,setCaptured]=useState(false);
  const inputRef=useRef(null);
  const needsBarcode=hasInternalProductCode(product);
  const scanner=useUsbBarcodeScanner(code=>{setBarcode(normalizeProductBarcode(code));setCaptured(true);setError('');},{enabled:!saving});

  useEffect(()=>{inputRef.current?.focus();},[]);

  const save=async event=>{
    event.preventDefault();
    const code=normalizeProductBarcode(barcode);
    if(!validPhysicalProductBarcode(code)){setError('Scan a valid printed barcode containing 4 to 128 characters.');return;}
    setSaving(true);setError('');
    try{
      const saved=await api(`/products/${product._id}/barcode`,{barcode:code,storeId});
      await onSaved(saved);
      onClose();
    }catch(cause){setError(cause.message);}finally{setSaving(false);}
  };

  return <div className="modal-backdrop"><section className="modal assign-barcode-modal" role="dialog" aria-modal="true" aria-labelledby="assign-barcode-heading">
    <button className="modal-close" aria-label="Close barcode assignment" onClick={onClose}><X size={20}/></button>
    <span className="brand-icon"><ScanLine size={22}/></span>
    <h2 id="assign-barcode-heading">{needsBarcode?'Assign printed barcode':'Change printed barcode'}</h2>
    <p>Scan the barcode printed on this exact product pack. Its stock, price, photos, discounts, and sales history will stay unchanged.</p>
    <div className="barcode-product-summary"><Package size={22}/><div><strong>{product.name}</strong><small>{needsBarcode?'Current internal code':'Current printed barcode'}: {product.barcode}</small></div></div>
    <form onSubmit={save}>
      <label>Printed barcode
        <input ref={inputRef} value={barcode} maxLength={128} autoComplete="off" placeholder="Scan with the USB scanner or enter manually" onChange={event=>{setBarcode(event.target.value);setCaptured(false);setError('');}}/>
      </label>
      <div className="scanner-ready"><span className="little-dot"/> {scanner.ready?'USB scanner ready':'Preparing scanner…'}</div>
      {captured&&<div className="barcode-captured"><CheckCircle2 size={17}/> Barcode captured from scanner</div>}
      {error&&<p className="form-error" role="alert">{error}</p>}
      <button className="primary" disabled={saving||!barcode.trim()}>{saving?'Saving barcode…':needsBarcode?'Assign barcode to product':'Replace product barcode'}</button>
    </form>
  </section></div>;
}

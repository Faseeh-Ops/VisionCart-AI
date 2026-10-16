import {productPrice} from '../shared/pricing.js';
export function calculateInvoice(items, products) {
  if (!Array.isArray(items) || !items.length || items.length > 200) throw new Error('Add products to the invoice.');
  const merged = new Map();
  for (const item of items) {
    if (!item || typeof item.productId !== 'string' || !item.productId) throw new Error('Invalid invoice item.');
    if (!Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 10000) throw new Error('Invalid quantity.');
    merged.set(item.productId, (merged.get(item.productId) || 0) + item.quantity);
  }
  return [...merged].map(([id, quantity]) => {
    const p = products.find(p => String(p._id) === id);
    if (!p || !p.verified) throw new Error('Only verified products can be billed.');
    if (p.stock < quantity) throw new Error(`Insufficient stock for ${p.name}.`);
    const pricing=productPrice(p);
    return {productId:id,name:p.name,barcode:p.barcode,...pricing,quantity,total:Math.round(pricing.price*100)*quantity/100,discountTotal:Math.round(pricing.discountPerUnit*100)*quantity/100};
  });
}

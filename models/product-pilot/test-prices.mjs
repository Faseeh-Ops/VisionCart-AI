import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {calculateInvoice} from '../../server/billing.js';
const data=JSON.parse(await readFile(new URL('./model-results.json',import.meta.url),'utf8'));
// Synthetic IDs and stock are test fixtures, not real inventory quantities.
const products=data.products.map(p=>({_id:p.key,name:p.name,barcode:p.barcode,price:p.price,discountPercent:0,verified:true,stock:1}));
const items=calculateInvoice(products.map(p=>({productId:p._id,quantity:1})),products);
const total=items.reduce((sum,item)=>sum+item.total,0);
assert.equal(total,270);
assert.deepEqual(items.map(item=>item.price),[250,10,10]);
await writeFile(new URL('./price-results.json',import.meta.url),JSON.stringify({note:'In-memory test only. No database writes, real stock changes or invoice creation.',items,total},null,2));
console.log('Existing billing calculation passed: Rs 250 + Rs 10 + Rs 10 = Rs '+total);

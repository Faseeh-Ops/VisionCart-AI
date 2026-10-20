import test from 'node:test';import assert from 'node:assert/strict';
import {buildImportPlan,productIdentity} from './retail-import-plan.mjs';
const listing=(id,name,price=100)=>({id,name,store:'rahim',regular_price:price,selling_price:50,currency:'PKR',image_status:'downloaded',image_file:'images/'+id+'.jpg',category_names:['Food']});
test('regular prices are selected, exact existing identity reused, names preserve sizes',()=>{
 const plan=buildImportPlan([listing('one','Pepsi 1.5 L',200),listing('two','Pepsi 15 L',900)],[{_id:'known',name:'Pepsi 1.5 L',barcode:'123',price:180}]);
 assert.equal(plan.products.length,2);assert.equal(plan.products[0].existingId,'known');assert.equal(plan.products[0].barcode,'123');assert.equal(plan.products[0].price,200);assert.notEqual(productIdentity('Pepsi 1.5 L'),productIdentity('Pepsi 15 L'));
});
test('identical labels consolidate provenance, while conflicting shared photos are excluded',()=>{
 const a=listing('a','Tiger 10 g'),b={...listing('b','Tiger 10 g'),store:'carrefour'},c=listing('c','Tiger 100 g');
 const plan=buildImportPlan([a,b,c],[],[{product_ids:['a','c']}]);
 assert.equal(plan.products.length,2);assert.equal(plan.products[0].sources.length,2);assert.deepEqual(plan.products[0].photos.map(p=>p.sourceId),['b']);assert.equal(plan.products[1].photos.length,0);assert.equal(plan.ambiguousListingCount,2);
});
test('repeated plans keep stable internal IDs and malformed prices are rejected',()=>{
 const rows=[listing('a','Product')],first=buildImportPlan(rows,[]).products[0];
 const next=buildImportPlan(rows,[{_id:'saved',catalogImportKey:first.key,name:'Renamed by admin',barcode:first.barcode}]).products[0];
 assert.equal(next.existingId,'saved');assert.equal(next.barcode,first.barcode);assert.match(first.barcode,/^RETAIL-/);
 assert.throws(()=>buildImportPlan([listing('bad','Broken',NaN)],[]));
});

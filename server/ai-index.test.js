import test from 'node:test';import assert from 'node:assert/strict';
import {makeReferenceIndex,rankReferenceProducts} from './ai-index.js';
const vector=i=>Array.from({length:768},(_,n)=>n===i?1:0);
test('reference index excludes malformed vectors and picks the best photo per product',()=>{
 const index=makeReferenceIndex([{_id:'a1',productId:'a',embedding:vector(0)},{_id:'a2',productId:'a',embedding:vector(1)},{_id:'b1',productId:'b',embedding:vector(2)},{_id:'invalid',productId:'bad',embedding:[1]}]);
 assert.equal(index.length,3);assert.ok(index[0].vector instanceof Float32Array);
 const ranked=rankReferenceProducts(vector(1),index);assert.equal(ranked.length,2);assert.equal(ranked[0].productId,'a');assert.equal(ranked[0].referenceId,'a2');assert.equal(ranked[0].similarity,1);
});
test('focused and full-frame embeddings favor the product over background clutter',()=>{
 const index=makeReferenceIndex([{_id:'product-photo',productId:'product',embedding:vector(1)},{_id:'background-photo',productId:'background',embedding:vector(0)}]);
 const ranked=rankReferenceProducts([vector(1),vector(0)],index);
 assert.equal(ranked[0].productId,'product');
 assert.ok(ranked[0].similarity>ranked[1].similarity);
});

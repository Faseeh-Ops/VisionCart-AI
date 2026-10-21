import test from 'node:test';
import assert from 'node:assert/strict';
import {downloadOpenFoodFactsImage,isOpenFoodFactsImage,searchOpenFoodFacts} from './product-image-search.js';

test('Open Food Facts search returns safe image suggestions and removes duplicates',async()=>{
  const calls=[];
  const fetchImpl=async url=>{
    calls.push(String(url));
    if(String(url).includes('/api/v2/product/'))return new Response(JSON.stringify({product:{code:'8961003694271',product_name:'Tiger Biscuits',brands:'LU',quantity:'6 biscuits',image_front_small_url:'https://images.openfoodfacts.org/images/products/896/100/369/4271/front_en.200.jpg',url:'https://world.openfoodfacts.org/product/8961003694271'}}),{status:200,headers:{'content-type':'application/json'}});
    return new Response(JSON.stringify({products:[{product_name:'Tiger Biscuits duplicate',image_front_small_url:'https://images.openfoodfacts.org/images/products/896/100/369/4271/front_en.200.jpg'},{product_name:'Tiger Glucose Biscuits',image_front_small_url:'https://images.openfoodfacts.org/images/products/123/456/789/0123/front_en.200.jpg'}]}),{status:200,headers:{'content-type':'application/json'}});
  };
  const rows=await searchOpenFoodFacts({query:'LU Tiger Biscuits',barcode:'8961003694271',fetchImpl,userAgent:'AspireTest/1.0 (test@example.com)'});
  assert.equal(rows.length,2);assert.equal(rows[0].name,'Tiger Biscuits');assert.equal(rows[1].name,'Tiger Glucose Biscuits');assert.match(calls[1],/search_terms=LU\+Tiger\+Biscuits/);
});

test('only official product image paths may be downloaded',async()=>{
  assert.equal(isOpenFoodFactsImage('https://images.openfoodfacts.org/images/products/123/front.jpg'),true);
  assert.equal(isOpenFoodFactsImage('https://images.openfoodfacts.org.evil.test/images/products/123/front.jpg'),false);
  await assert.rejects(()=>downloadOpenFoodFactsImage('https://example.com/product.jpg'),/returned by Open Food Facts/);
  const jpeg=Buffer.from([255,216,255,224,0,16,74,70,73,70,0,1]);
  const photo=await downloadOpenFoodFactsImage('https://images.openfoodfacts.org/images/products/123/front.jpg',{fetchImpl:async()=>new Response(jpeg,{status:200,headers:{'content-type':'image/jpeg','content-length':String(jpeg.length)}})});
  assert.match(photo,/^data:image\/jpeg;base64,/);
});

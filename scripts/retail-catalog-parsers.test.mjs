import test from 'node:test';
import assert from 'node:assert/strict';
import {rahimListing,rahimCategories,carrefourListing,carrefourCategories,csv} from './retail-catalog-parsers.mjs';

const category = {id:'001',name:'Ghee',url:'https://www.rahimstore.com/category/001'};
function rahimCard(price, was = '') {
  return `<div class='item img-hover-zoom--quick-zoom'><img src='https://www.rahimstore.com//img/products/001/4320.jpg?123' alt='Oil &amp; Ghee' productId='4320'><strong><sup>Rs</sup>${price}</strong>${was}<button id='btn-add-to-cart' data='4320~Oil &amp; Ghee~50~619.00~562.00~0~10'>Add to Cart</button></div>`;
}
test('discounted Rahim listing preserves Was price separately from selling price',()=>{
  const parsed=rahimListing('Items 1-20 of 1,234 '+rahimCard('562.00','<sup>Was</sup><strike>619.00</strike>'),category,'2026-10-19');
  assert.equal(parsed.total,1234);assert.equal(parsed.products.length,1);
  const p=parsed.products[0];assert.equal(p.regular_price,619);assert.equal(p.selling_price,562);assert.equal(p.name,'Oil & Ghee');assert.equal(p.barcode,null);assert.equal(p.image_url,'https://www.rahimstore.com/img/products/001/4320.jpg');
});
test('missing or unparseable prices remain null rather than becoming zero',()=>{
  const p=rahimListing(rahimCard('Call for price'),category,'today').products[0];
  assert.equal(p.regular_price,null);assert.equal(p.selling_price,null);
  assert.deepEqual(rahimListing('<img src="logo.png" alt="Store">',category,'today').products,[]);
});
test('category discovery deduplicates IDs and combines navigation with sitemap',()=>{
  assert.equal(rahimCategories(`<a hitem_code='001' href='/category/001'>Ghee</a><a hitem_code='001' href='/category/001'>Ghee</a>`).length,1);
  const result=carrefourCategories('<a href="/mafpak/en//c/FPAK1700000"><img alt="Food"></a>','<loc>https://www.carrefour.pk/mafpak/en/c/FPAK1700000</loc><loc>https://www.carrefour.pk/mafpak/en/c/NFPAK8010000</loc>');
  assert.equal(result.length,2);assert.equal(result[0].name,'Food');assert.equal(result[0].url,'https://www.carrefour.pk/mafpak/en/c/FPAK1700000');
  assert.equal(carrefourCategories('<a href="/mafpak/en/c/FPAK1700000">View All</a>')[0].name,null);
});
test('Carrefour Flight chunks are reassembled; missing markedPrice is not inferred',()=>{
  const product={productId:'123',productName:'Sample "Milk"',sellingPrice:80,markedPrice:100,currency:'PKR',productUrl:'/mafpak/en/milk/p/123',imageUrl:'https://example.com/photo.jpg'};
  const data='a:'+JSON.stringify({products:[product,product,{...product,productId:'124',markedPrice:undefined}],pagination:{totalResults:250,totalPages:5},additionalAttributes:{title:'Milk'}})+'\n';
  const html=[data.slice(0,20),data.slice(20)].map(s=>`<script>self.__next_f.push(${JSON.stringify([1,s])})</script>`).join('');
  const parsed=carrefourListing(html,{id:'FPAK1630000',name:'Dairy'},'today');
  assert.equal(parsed.products.length,2);assert.equal(parsed.products[0].regular_price,100);assert.equal(parsed.products[0].selling_price,80);assert.equal(parsed.products[1].regular_price,null);assert.equal(parsed.pagination.totalResults,250);assert.equal(parsed.title,'Milk');
});
test('CSV quotes commas and double quotes and neutralizes spreadsheet formulas',()=>{
  const result=csv([{name:'Biscuit, "small"',other:'=HYPERLINK("bad")'}],['name','other']);
  assert.ok(result.includes('"Biscuit, ""small"""'));assert.ok(result.includes('"\'=HYPERLINK(""bad"")"'));
});

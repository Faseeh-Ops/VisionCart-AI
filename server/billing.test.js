import {invoiceFilter} from './invoice-search.js';
import {csvCell} from './store-reports.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {calculateInvoice} from './billing.js';
import {dateRange} from './reports.js';
import {validatePhoto} from './profile-photo.js';
const products=[{_id:'one',name:'Milk',barcode:'123',price:2.55,stock:3,verified:true}];
test('prices come from catalog and quantities merge',()=>assert.deepEqual(calculateInvoice([{productId:'one',quantity:1,price:0},{productId:'one',quantity:2}],products)[0].total,7.65));
test('reject overselling',()=>assert.throws(()=>calculateInvoice([{productId:'one',quantity:4}],products),/stock/));
test('reject unverified products',()=>assert.throws(()=>calculateInvoice([{productId:'one',quantity:1}],[{...products[0],verified:false}]),/verified/));
test('reject invalid quantities',()=>assert.throws(()=>calculateInvoice([{productId:'one',quantity:-1}],products),/quantity/));
test('discount comes from catalog with cent rounding and immutable snapshot',()=>{const line=calculateInvoice([{productId:'one',quantity:2,discountPercent:100}],[{...products[0],discountPercent:10}])[0];assert.equal(line.price,2.3);assert.equal(line.originalPrice,2.55);assert.equal(line.total,4.6);assert.equal(line.discountTotal,.5);});
test('reject discounts outside allowed range',()=>assert.throws(()=>calculateInvoice([{productId:'one',quantity:1}],[{...products[0],discountPercent:101}]),/discount/));
test('daily filters use Pakistan midnight and inclusive end day',()=>{const range=dateRange({from:'2026-10-09',to:'2026-10-09'}).createdAt;assert.equal(range.$gte.toISOString(),'2026-10-08T19:00:00.000Z');assert.equal(range.$lt.toISOString(),'2026-10-09T19:00:00.000Z');});
test('reject invalid dates and reversed ranges',()=>{assert.throws(()=>dateRange({from:'2026-02-30'}),/date/);assert.throws(()=>dateRange({from:'2026-10-10',to:'2026-10-09'}),/End date/);});
test('profile photos reject active formats, fake images, and oversized content; removal is allowed',()=>{assert.equal(validatePhoto(null),null);assert.throws(()=>validatePhoto('data:image/svg+xml;base64,PHN2Zz4='),/JPEG/);assert.throws(()=>validatePhoto('data:image/png;base64,'+Buffer.alloc(20).toString('base64')),/format/);assert.throws(()=>validatePhoto('data:image/png;base64,'+Buffer.alloc(300000).toString('base64')),/256 KB/);});

test('malformed invoice items return explicit validation errors',()=>{for(const item of [null,{}, {productId:12,quantity:1}])assert.throws(()=>calculateInvoice([item],[]),/Invalid invoice item/);});

test('CSV reports quote delimiters and neutralize spreadsheet formulas',()=>{assert.equal(csvCell('a,"b"\nc'),'"a,""b""\nc"');for(const value of ['=SUM(A1)','+cmd','-cmd','@formula',' \t=cmd'])assert.ok(csvCell(value).startsWith('"\''));assert.equal(csvCell(250),'"250"');assert.equal(csvCell(null),'""');});

test('invoice filters escape literal search and enforce cashier scope and Pakistan dates',()=>{
 const id='000000000000000000000002',other='000000000000000000000003',user={id,role:'cashier'};
 const filter=invoiceFilter({q:'ASP-[.*',from:'2025-01-11',to:'2025-01-11',store:other},user);
 assert.equal(filter.cashier,id);assert.equal(filter.storeId,other);assert.ok(new RegExp(filter.number.$regex,'i').test('asp-[.*'));assert.ok(!new RegExp(filter.number.$regex,'i').test('ASP-123'));
 assert.equal(filter.createdAt.$gte.toISOString(),'2025-01-10T19:00:00.000Z');assert.equal(filter.createdAt.$lt.toISOString(),'2025-01-11T19:00:00.000Z');
 assert.throws(()=>invoiceFilter({cashier:other},user),/only view your own/);assert.throws(()=>invoiceFilter({q:'x'.repeat(101)},user),/100/);assert.throws(()=>invoiceFilter({q:{$ne:null}},user));assert.throws(()=>invoiceFilter({store:'bad'},user));assert.throws(()=>invoiceFilter({from:'2025-02-30'},user));
 assert.equal(invoiceFilter({cashier:other},{id,role:'admin'}).cashier,other);
});

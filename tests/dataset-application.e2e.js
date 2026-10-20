import {test,expect} from '@playwright/test';
import {QRCodeWriter,BarcodeFormat} from '@zxing/library';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import config from '../playwright.config.js';
import {barcodeImage} from './barcode-fixture.js';

// Run with playwright.dataset.config.js; uses real UI, decoder, API and MongoDB.
const root=process.cwd();
const directory=path.join(root,'datasets/retail-catalog/barcode-regression');
const dataset=JSON.parse(await fs.readFile(path.join(root,'datasets/retail-catalog/products.json'),'utf8'));
const sourceIds=['carrefour:46313:offer_carrefour_:EXPRESS','rahim:34076','carrefour:36440:offer_carrefour_:EXPRESS','rahim:4188','carrefour:20528:offer_carrefour_:EXPRESS','carrefour:36850:offer_carrefour_:EXPRESS'];
const samples=sourceIds.map(id=>{const product=dataset.find(p=>p.id===id);if(!product)throw Error(`Dataset reference missing: ${id}`);return product;});
const adminCredentials={email:'dataset-admin@test.local',password:'DatasetAdmin123!',role:'admin'};
const cashierCredentials={email:'dataset-cashier@test.local',password:'DatasetCashier123!',role:'cashier'};
const result={tested_at:null,database:config.metadata.database,input_mode:'barcode_qr_backup',production_data_touched:false,api_mocks:false,code_note:'Generated test EAN/QR values are temporary fixture identifiers, not verified manufacturer barcodes. Product names, regular prices and six photos come from the retailer dataset. Dedicated AI recognition is tested in ai-billing.e2e.js.',photo_uploads:[],checks:[],browser_errors:[],server_errors:[],tests:[]};
let adminHeaders,cashierHeaders,products;
test.describe.configure({mode:'serial'});
const addCheck=(name,details={})=>result.checks.push({name,result:'passed',...details});

async function qrImage(page,text){
  const matrix=new QRCodeWriter().encode(text,BarcodeFormat.QR_CODE,320,320,new Map());
  const size=matrix.getWidth(),bits=[];
  for(let y=0;y<size;y++)for(let x=0;x<size;x++)if(matrix.get(x,y))bits.push([x,y]);
  const base64=await page.evaluate(({size,bits})=>{const c=document.createElement('canvas');c.width=size;c.height=size;const ctx=c.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,size,size);ctx.fillStyle='black';for(const [x,y]of bits)ctx.fillRect(x,y,1,1);return c.toDataURL('image/png').split(',')[1];},{size,bits});
  return Buffer.from(base64,'base64');
}

async function login(page){
  await page.goto('/');
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await page.getByLabel('Email',{exact:true}).fill(cashierCredentials.email);
  await page.getByLabel('Password',{exact:true}).fill(cashierCredentials.password);
  await page.locator('.modal').getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(page.locator('.connection')).toContainText('Connected workspace');
  await expect(page.locator('.modal-backdrop')).toHaveCount(0);
  await page.getByRole('button',{name:'New sale',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Current bill'})).toBeVisible();
}

test.beforeAll(async({request})=>{
  if(!/^aspire_test_\d+$/.test(config.metadata.database))throw Error('Only an isolated test database is permitted');
  await fs.mkdir(directory,{recursive:true});
  result.tested_at=new Date().toISOString();
  await mongoose.connect(`mongodb://127.0.0.1:27017/${config.metadata.database}?replicaSet=aspire-rs`);
  await mongoose.connection.db.collection('users').insertOne({name:'Dataset Test Admin',email:adminCredentials.email,password:await bcrypt.hash(adminCredentials.password,12),role:'admin',active:true});
  await mongoose.disconnect();
  const admin=await request.post('/api/auth/login',{data:adminCredentials});expect(admin.ok()).toBe(true);
  adminHeaders={Authorization:`Bearer ${(await admin.json()).token}`};
  const created=await request.post('/api/users/cashiers',{headers:adminHeaders,data:{name:'Dataset Test Cashier',email:cashierCredentials.email,password:'DatasetTemporary123!'}});expect(created.status()).toBe(201);
  const temporary=await (await request.post('/api/auth/login',{data:{...cashierCredentials,password:'DatasetTemporary123!'}})).json();
  expect(temporary.user.mustChangePassword).toBe(true);
  const changed=await request.post('/api/auth/change-password',{headers:{Authorization:`Bearer ${temporary.token}`},data:{currentPassword:'DatasetTemporary123!',newPassword:cashierCredentials.password}});expect(changed.ok()).toBe(true);
  cashierHeaders={Authorization:`Bearer ${(await changed.json()).token}`};
  addCheck('Admin creates cashier; cashier replaces temporary password');
  products=[];
  for(const [i,p]of samples.entries()){
    const barcode=i===0?'1234567890128':`DATASET-TEST-${i}-${p.source_product_id}`;
    const response=await request.post('/api/products',{headers:adminHeaders,data:{name:p.name,barcode,price:p.regular_price,stock:10,category:p.category_names[0],discountPercent:0}});
    expect(response.ok()).toBe(true);products.push(await response.json());
  }
  addCheck('Dataset names and regular prices registered in isolated branch inventory',{products:products.map(p=>({name:p.name,price:p.price,stock:p.stock}))});
});

test.beforeEach(async({page})=>{
  page.on('pageerror',e=>result.browser_errors.push(e.message));
  page.on('response',response=>{if(response.status()>=500&&new URL(response.url()).pathname.startsWith('/api/'))result.server_errors.push({path:new URL(response.url()).pathname,status:response.status()});});
  await login(page);
});

test.afterEach(async({},info)=>{
  result.tests.push({name:info.title,status:info.status,expected_status:info.expectedStatus,errors:info.errors.map(e=>e.message)});
});

test.afterAll(async()=>{
  if(!/^aspire_test_\d+$/.test(config.metadata.database))throw Error('Refusing to clean a non-test database');
  await mongoose.connect(`mongodb://127.0.0.1:27017/${config.metadata.database}?replicaSet=aspire-rs`);
  await mongoose.connection.dropDatabase();await mongoose.disconnect();
  result.test_database_removed=true;
  await fs.writeFile(path.join(directory,'results.json'),JSON.stringify(result,null,2)+'\n');
});

test('barcode backup safely rejects dataset photos without readable codes',async({page,request})=>{
  test.setTimeout(120000);
  const uploads=page.getByLabel('Scan barcode / QR photo');
  for(const [i,product]of samples.entries()){
    const posts=[];
    const listener=req=>{if(req.method()==='POST'&&new URL(req.url()).pathname.startsWith('/api/'))posts.push(new URL(req.url()).pathname);};
    page.on('request',listener);
    if(await page.getByLabel('Dismiss notification').isVisible())await page.getByLabel('Dismiss notification').click();
    const start=Date.now();
    await uploads.setInputFiles(path.join(root,'datasets/retail-catalog',product.image_file));
    await expect(uploads).toHaveValue('',{timeout:20000});
    const notice=await page.locator('.toast').innerText().catch(()=>'');
    await expect(page.locator('.cart-row')).toHaveCount(0);
    await expect(page.getByRole('button',{name:'Generate invoice',exact:true})).toBeDisabled();
    page.off('request',listener);
    result.photo_uploads.push({source_id:product.id,name:product.name,image_file:product.image_file,notice,api_post_paths:posts,product_added_to_bill:false,elapsed_ms:Date.now()-start,input_mode:'barcode_qr_backup'});
    await page.screenshot({path:path.join(directory,`photo-${i+1}.png`),fullPage:true});
  }
  expect(result.photo_uploads).toHaveLength(6);
  expect(result.photo_uploads.every(r=>r.notice.includes('No barcode found'))).toBe(true);
  const invoices=await (await request.get('/api/invoices',{headers:cashierHeaders})).json();expect(invoices).toHaveLength(0);
  const after=await (await request.get('/api/products',{headers:adminHeaders})).json();
  expect(products.every(p=>after.find(x=>x._id===p._id).stock===10)).toBe(true);
  addCheck('Barcode backup rejects six code-free pack images; no invoices or stock changes',{images:6,recognized:0});
});

test('real barcode and QR decoding, quantity corrections, saved invoice, branch stock and reprint',async({page,request})=>{
  const upload=page.getByLabel('Scan barcode / QR photo');
  const barcode=Buffer.from(await page.evaluate(barcodeImage),'base64');
  await fs.writeFile(path.join(directory,'test-ean.png'),barcode);
  await upload.setInputFiles({name:'generated-test-ean.png',mimeType:'image/png',buffer:barcode});
  await expect(page.locator('.detection-result')).toContainText('EAN_13');
  await expect(page.locator('.cart-row')).toContainText(products[0].name);
  await expect(page.locator('.cart-price')).toContainText(`Rs ${products[0].price}`);
  addCheck('Generated EAN-13 decodes through production photo scanner and finds dataset-priced Pepsi');
  const qr=await qrImage(page,products[1].barcode);
  await fs.writeFile(path.join(directory,'test-qr.png'),qr);
  await upload.setInputFiles({name:'generated-test-qr.png',mimeType:'image/png',buffer:qr});
  await expect(page.locator('.cart-row')).toHaveCount(2);
  await expect(page.locator('.detection-result')).toContainText('QR_CODE');
  await expect(page.locator('.detection-result')).toContainText(products[1].name);
  addCheck('Generated QR code decodes automatically and finds dataset-priced Tiger');
  await page.getByLabel('Increase '+products[0].name,{exact:true}).click();
  await expect(page.locator('.cart-row').filter({hasText:products[0].name}).locator('.cart-price')).toContainText('Rs 400');
  await page.getByLabel('Reduce '+products[0].name,{exact:true}).click();
  await page.getByLabel('Increase '+products[0].name,{exact:true}).click();
  await page.screenshot({path:path.join(directory,'recognized-bill.png'),fullPage:true});
  addCheck('Quantity increase and decrease update bill totals');
  const before=(await (await request.get('/api/products',{headers:adminHeaders})).json());
  expect(before.find(p=>p._id===products[0]._id).stock).toBe(10);
  expect(before.find(p=>p._id===products[1]._id).stock).toBe(10);
  const saved=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/invoices'&&r.request().method()==='POST');
  await page.getByRole('button',{name:'Generate invoice',exact:true}).click();
  const response=await saved;expect(response.ok()).toBe(true);const invoice=await response.json();
  const total=products[0].price*2+products[1].price;
  expect(invoice.total).toBe(total);expect(invoice.total).toBe(410);
  expect(invoice.cashierName).toBe('Dataset Test Cashier');
  await expect(page.locator('.receipt-modal')).toContainText('Rs 410');
  await expect(page.locator('.receipt-modal')).toContainText(products[1].name);
  await page.screenshot({path:path.join(directory,'invoice.png'),fullPage:true});
  await page.getByLabel('Close dialog').click();
  await expect(page.locator('.cart-row')).toHaveCount(0);
  const stock=(await (await request.get('/api/products',{headers:adminHeaders})).json());
  expect(stock.find(p=>p._id===products[0]._id).stock).toBe(8);
  expect(stock.find(p=>p._id===products[1]._id).stock).toBe(9);
  addCheck('Invoice persists with correct cashier, PKR prices and atomic branch stock deduction',{invoice_number:invoice.number,total,pepsi_remaining:8,tiger_remaining:9});
  await page.reload();await page.getByRole('button',{name:'Invoices',exact:true}).click();
  await page.getByLabel('Search invoice number').fill(invoice.number);
  await page.getByRole('button',{name:'Search invoices',exact:true}).click();
  await expect(page.locator('.invoice-history tbody tr')).toHaveCount(1);
  await page.locator('.invoice-history').getByRole('button',{name:'View',exact:true}).click();
  await expect(page.locator('.receipt-modal')).toContainText('Rs 410');
  expect(await page.getByRole('button',{name:'Print / Save PDF',exact:true}).isVisible()).toBe(true);
  await page.pdf({path:path.join(directory,'invoice-reprint.pdf'),printBackground:true});
  await page.getByLabel('Close dialog').click();
  addCheck('Saved invoice survives reload, is searchable, reopens and renders to PDF');
  const report=await (await request.get('/api/admin/sales',{headers:adminHeaders})).json();
  expect(report.summary).toMatchObject({revenue:410,units:3,invoices:1});
  expect((await request.get('/api/admin/sales',{headers:cashierHeaders})).status()).toBe(403);
  expect((await request.post('/api/invoices',{headers:adminHeaders,data:{items:[]}})).status()).toBe(403);
  addCheck('Admin sales report tracks cashier sale; cashier report access and admin billing are denied');
});

test('unknown QR stays unverified and never becomes a charged product',async({page,request})=>{
  const unknown='DATASET-TEST-UNKNOWN-NOT-A-PRODUCT';
  await page.getByLabel('Scan barcode / QR photo').setInputFiles({name:'unknown.png',mimeType:'image/png',buffer:await qrImage(page,unknown)});
  await expect(page.locator('.detection-warning')).toContainText('Unverified product');
  await expect(page.locator('.cart-row')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Generate invoice',exact:true})).toBeDisabled();
  await page.screenshot({path:path.join(directory,'unknown-qr.png'),fullPage:true});
  await page.getByRole('button',{name:/^Unverified/}).click();
  await expect(page.locator('.list-panel')).toContainText(unknown);
  const history=await (await request.get('/api/invoices',{headers:cashierHeaders})).json();expect(history).toHaveLength(1);
  const scans=await (await request.get('/api/scans',{headers:cashierHeaders})).json();expect(scans.some(s=>s.barcode===unknown&&s.format==='QR_CODE')).toBe(true);
  addCheck('Unregistered QR is logged as QR_CODE, appears in unverified queue and creates no sale');
  expect(result.browser_errors).toEqual([]);expect(result.server_errors).toEqual([]);
});

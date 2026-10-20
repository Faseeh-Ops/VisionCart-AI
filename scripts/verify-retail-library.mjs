// Verify the requested live import without creating sales or changing stock.
import 'dotenv/config';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import fs from 'node:fs/promises';
import path from 'node:path';
import {chromium,expect} from '@playwright/test';

if(!process.argv.includes('--live'))throw Error('Use --live to verify the imported application library.');
const out=path.resolve('datasets/retail-catalog/library-import'),base='http://localhost:4000';
let browser;
try{
 await mongoose.connect(process.env.MONGODB_URI||'mongodb://127.0.0.1:27017/aspire_billing');
 const db=mongoose.connection.db,original=JSON.parse(await fs.readFile(path.join(out,'before.json'),'utf8'));
 const all=await db.collection('products').find({}).toArray(),inventory=await db.collection('storeinventories').find({}).toArray();
 for(const old of original.products){const p=all.find(p=>String(p._id)===old._id);for(const field of ['name','price','barcode','stock'])expect(p[field]).toBe(old[field]);}
 for(const old of original.storeInventory){const row=inventory.find(r=>String(r._id)===old._id);expect(row.stock).toBe(old.stock);}
 const imported=all.filter(p=>p.catalogImportKey?.startsWith('retail-v1:'));
 expect(imported.length).toBeGreaterThan(9000);
 expect(imported.every(p=>p.stock===0&&p.discountPercent===0&&p.price===p.retailSources[0].regularPrice)).toBe(true);
 const newIds=new Set(imported.map(p=>String(p._id)));expect(inventory.filter(r=>newIds.has(String(r.productId)))).toHaveLength(0);
 const references=await db.collection('aireferences').countDocuments({model:'siglip2-base-patch16-224:image-v1'});expect(references).toBeGreaterThan(7000);
 const linked=new Set((await db.collection('aireferences').distinct('productId',{model:'siglip2-base-patch16-224:image-v1'})).map(String));
 const missing=all.filter(p=>!linked.has(String(p._id)));
 const csvCell=value=>'"'+(/^[=+\-@\t\r\n]/.test(String(value??''))?"'"+String(value??''):String(value??'')).replaceAll('"','""')+'"';
 await fs.writeFile(path.join(out,'products-needing-photo-review.csv'),[['Product','Code','Price Rs','Source URL'],...missing.map(p=>[p.name,p.barcode,p.price,p.retailSources?.[0]?.url||''])].map(row=>row.map(csvCell).join(',')).join('\r\n')+'\r\n');
 const broken=await db.collection('aireferences').aggregate([{$match:{model:'siglip2-base-patch16-224:image-v1'}},{$project:{size:{$size:'$embedding'}}},{$match:{size:{$ne:768}}},{$count:'total'}]).toArray();expect(broken).toHaveLength(0);
 async function account(role){
  const users=await db.collection('users').find({role,active:{$ne:false},mustChangePassword:{$ne:true}},{projection:{password:0}}).toArray();
  for(const u of users){
   const selectedStore=await db.collection('stores').findOne({_id:u.selectedStore||new mongoose.Types.ObjectId('000000000000000000000001'),active:true});if(!selectedStore)continue;
   return {token:jwt.sign({id:String(u._id),role:u.role,version:u.tokenVersion||0},process.env.JWT_SECRET,{expiresIn:'10m'}),user:{name:u.name,email:u.email,role:u.role,photo:u.photo||null,mustChangePassword:false,selectedStore:{...selectedStore,_id:String(selectedStore._id)}}};
  }throw Error('No active '+role+' with an active working store is available for verification.');
 }
 const admin=await account('admin'),cashier=await account('cashier');
 const pepsi=all.find(p=>p.retailSources?.some(s=>s.listingId==='carrefour:46313:offer_carrefour_:EXPRESS'));
 const tiger=all.find(p=>p.barcode==='8961003694271');expect(pepsi).toBeTruthy();expect(tiger).toBeTruthy();
 const invoicesBefore=await db.collection('invoices').countDocuments(),errors=[];
 const report={testedAt:new Date().toISOString(),products:all.length,importedProducts:imported.length,referencePhotos:references,productsAwaitingPhotoReview:missing.length,originalProductsPreserved:original.products.length,branchRowsPreserved:original.storeInventory.length,probes:[],cameraHardwareTested:false,note:'Live MongoDB and real model calls. Uploads reuse enrolled photos; this checks integration, not independent recognition accuracy. No sale is created and no stock is allocated.'};
 browser=await chromium.launch({channel:'msedge',headless:false});
 async function pageFor(session){const context=await browser.newContext({viewport:{width:1440,height:1000}});await context.addInitScript(session=>localStorage.setItem('asp-session',JSON.stringify(session)),session);const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));return page;}
 const adminPage=await pageFor(admin);await adminPage.goto(base+'/#/products');await expect(adminPage.locator('.catalog-product')).toHaveCount(60,{timeout:30000});
 await expect(adminPage.locator('.catalog-pager')).toContainText('of '+all.length+' matching products');
 await adminPage.getByRole('button',{name:'Show more products',exact:true}).click();await expect(adminPage.locator('.catalog-product')).toHaveCount(120);
 await adminPage.getByLabel('Search products',{exact:true}).fill(pepsi.barcode);await expect(adminPage.locator('.catalog-product')).toHaveCount(1);await expect(adminPage.locator('.catalog-product h3')).toHaveText(pepsi.name);
 await adminPage.getByRole('button',{name:'AI photos',exact:true}).click();await expect.poll(()=>adminPage.getByRole('dialog',{name:'AI product photos'}).locator('figure').count()).toBeGreaterThan(0);
 await adminPage.screenshot({path:path.join(out,'live-imported-product.png')});await adminPage.getByLabel('Close AI photos').click();
 const page=await pageFor(cashier);await page.goto(base+'/#/billing');await expect(page.locator('.ai-library-status')).toContainText('inventory reference photos available',{timeout:30000});
 const catalog=JSON.parse(await fs.readFile(path.resolve('datasets/retail-catalog/products.json'),'utf8'));
 const source=catalog.find(p=>p.id==='carrefour:46313:offer_carrefour_:EXPRESS');
 for(const [product,file]of [[pepsi,path.resolve('datasets/retail-catalog',source.image_file)],[tiger,path.resolve('models/product-pilot/images/tiger.jpeg')]]){
  const begin=Date.now(),response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/ai/recognize'&&r.request().method()==='POST',{timeout:120000});
  await page.getByLabel('Recognize product photo with AI').setInputFiles(file);const received=await response;expect(received.ok()).toBe(true);const result=await received.json();
  expect(result.candidates[0].product._id).toBe(String(product._id));expect(result.candidates[0].product.price).toBe(product.price);await expect(page.locator('.ai-candidate')).toHaveCount(3);await expect(page.locator('.cart-row')).toHaveCount(0);
  if(product===pepsi)await expect(page.getByRole('button',{name:'Confirm AI match '+pepsi.name,exact:true})).toBeDisabled();
  report.probes.push({name:product.name,price:product.price,correctTop1:true,similarity:result.candidates[0].similarity,totalMilliseconds:Date.now()-begin,stock:result.candidates[0].product.stock});
 }
 await page.screenshot({path:path.join(out,'live-ai-recognition.png')});expect(errors).toEqual([]);
 expect(await db.collection('invoices').countDocuments()).toBe(invoicesBefore);report.browserErrors=errors;report.noInvoicesCreated=true;
 await fs.writeFile(path.join(out,'live-verification.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}finally{await browser?.close();await mongoose.disconnect();}

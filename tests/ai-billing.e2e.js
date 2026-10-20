import {test,expect} from '@playwright/test';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import config from '../playwright.config.js';

const root=process.cwd(),dataDir=path.join(root,'datasets/retail-catalog'),output=path.join(dataDir,'ai-application-test');
const catalog=JSON.parse(await fs.readFile(path.join(dataDir,'products.json'),'utf8'));
const keys=['carrefour:46313:offer_carrefour_:EXPRESS','rahim:34076','carrefour:36440:offer_carrefour_:EXPRESS','rahim:4188','carrefour:20528:offer_carrefour_:EXPRESS','carrefour:36850:offer_carrefour_:EXPRESS'];
const referenceKeys=[keys[0],keys[1],keys[2],keys[3],'rahim:2338','rahim:24567'];
const queryKeys=[keys[0],keys[1],keys[2],'carrefour:4096:offer_carrefour_:EXPRESS',keys[4],keys[5]];
const samples=keys.map((id,i)=>({product:catalog.find(p=>p.id===id),reference:catalog.find(p=>p.id===referenceKeys[i]),query:catalog.find(p=>p.id===queryKeys[i])}));
if(samples.some(s=>!s.product||!s.reference||!s.query))throw Error('Required retail dataset samples are missing');
const credentials={admin:{email:'ai-admin@test.local',password:'AiAdminPassword123!',role:'admin'},cashier:{email:'ai-cashier@test.local',password:'AiCashierPassword123!',role:'cashier'}};
const result={tested_at:new Date().toISOString(),mode:'Real local SigLIP 2 and YOLO26n subprocess through Express; real browser UI and MongoDB. No inference, catalog, auth or invoice API mocks. Webcam and RTSP transport use controlled dataset frames.',training:false,photos:[],checks:[],tests:[],browser_errors:[],dataset_images:samples.map(s=>({name:s.product.name,reference:s.reference.image_file,query:s.query.image_file,same_source_image:s.reference.image_file===s.query.image_file}))};
let adminHeaders,cashierHeaders,otherHeaders,products;
test.describe.configure({mode:'serial'});
async function login(page,role='cashier'){
 await page.goto('/');await page.getByRole('button',{name:'Sign in',exact:true}).click();
 if(role==='admin')await page.getByRole('button',{name:'Administrator',exact:true}).click();
 await page.getByLabel('Email',{exact:true}).fill(credentials[role].email);await page.getByLabel('Password',{exact:true}).fill(credentials[role].password);
 await page.locator('.modal').getByRole('button',{name:'Sign in',exact:true}).click();await expect(page.locator('.connection')).toContainText('Connected workspace');
 if(role==='cashier')await page.getByRole('button',{name:'New sale',exact:true}).click();
}
const check=(name,details={})=>result.checks.push({name,...details});
async function recognize(page,file){
 const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/ai/recognize'&&r.request().method()==='POST');
 await page.getByLabel('Recognize product photo with AI').setInputFiles(file);
 const received=await response;expect(received.ok()).toBe(true);const data=await received.json();
 await expect(page.locator('.ai-candidate')).toHaveCount(3);expect(data.requiresConfirmation).toBe(true);expect(data.mode).toBe('full_image_single_product');expect(data.detector.name).toBe('yolo26n');return data;
}

test.beforeAll(async({request})=>{
 if(!/^aspire_test_\d+$/.test(config.metadata.database))throw Error('Only isolated test databases are allowed');
 await fs.mkdir(output,{recursive:true});
 await mongoose.connect(`mongodb://127.0.0.1:27017/${config.metadata.database}?replicaSet=aspire-rs`);
 await mongoose.connection.db.collection('users').insertOne({name:'AI Test Admin',email:credentials.admin.email,password:await bcrypt.hash(credentials.admin.password,12),role:'admin',active:true});await mongoose.disconnect();
 const admin=await request.post('/api/auth/login',{data:credentials.admin});expect(admin.ok()).toBe(true);adminHeaders={Authorization:`Bearer ${(await admin.json()).token}`};
 async function cashier(email,name){
  const created=await request.post('/api/users/cashiers',{headers:adminHeaders,data:{name,email,password:'AiTemporaryPassword123!'}});expect(created.status()).toBe(201);
  const temporary=await (await request.post('/api/auth/login',{data:{email,password:'AiTemporaryPassword123!',role:'cashier'}})).json();
  const changed=await request.post('/api/auth/change-password',{headers:{Authorization:`Bearer ${temporary.token}`},data:{currentPassword:'AiTemporaryPassword123!',newPassword:credentials.cashier.password}});expect(changed.ok()).toBe(true);return {Authorization:`Bearer ${(await changed.json()).token}`};
 }
 cashierHeaders=await cashier(credentials.cashier.email,'AI Test Cashier');otherHeaders=await cashier('ai-other@test.local','Other AI Cashier');products=[];
 for(const [i,s]of samples.entries()){
  const response=await request.post('/api/products',{headers:adminHeaders,data:{name:s.product.name,barcode:`AI-TEST-INTERNAL-${i}`,price:s.product.regular_price,stock:10,discountPercent:0,category:s.product.category_names[0]}});expect(response.ok()).toBe(true);products.push(await response.json());
 }
});
test.beforeEach(async({page})=>{page.on('pageerror',e=>result.browser_errors.push(e.message));});
test.afterEach(async({},info)=>{result.tests.push({name:info.title,status:info.status,errors:info.errors.map(e=>e.message)});});
test.afterAll(async()=>{
 if(!/^aspire_test_\d+$/.test(config.metadata.database))throw Error('Refusing to clean a non-test database');
 await mongoose.connect(`mongodb://127.0.0.1:27017/${config.metadata.database}?replicaSet=aspire-rs`);await mongoose.connection.dropDatabase();await mongoose.disconnect();result.temporary_database_removed=true;
 await fs.writeFile(path.join(output,'results.json'),JSON.stringify(result,null,2)+'\n');
});

test('RTSP product recognition explains an empty AI library without sending recognition requests',async({page})=>{
 await login(page);const panel=page.locator('.ai-billing');
 await expect(panel.getByRole('status')).toContainText('AI product library is empty');
 let calls=0;page.on('request',r=>{if(new URL(r.url()).pathname==='/api/ai/recognize')calls++;});
 const frame=await fs.readFile(path.join(dataDir,samples[1].query.image_file));
 await page.route('**/api/cameras/rtsp/connect',route=>route.fulfill({status:201,json:{id:'empty-library'}}));
 await page.route('**/api/cameras/rtsp/empty-library/frame',route=>route.fulfill({contentType:'image/jpeg',body:frame}));
 await page.route('**/api/cameras/rtsp/empty-library/disconnect',route=>route.fulfill({json:{success:true}}));
 await page.getByRole('button',{name:'Connect RTSP camera',exact:true}).click();
 await panel.getByLabel('RTSP camera address').fill('rtsp://192.168.1.50:8554/test');
 await panel.getByRole('button',{name:'Connect RTSP camera',exact:true}).click();
 await expect.poll(()=>panel.locator('.rtsp-controls img').evaluate(img=>img.naturalWidth)).toBeGreaterThan(0);
 await expect(panel.getByRole('button',{name:'Recognize RTSP product',exact:true})).toBeDisabled();
 await page.waitForTimeout(2300);expect(calls).toBe(0);await expect(page.locator('.cart-row')).toHaveCount(0);
 check('Main RTSP control opens AI mode; an empty reference library explains setup and does not repeatedly request inference');
});

test('admin attaches real dataset reference photos through the app; real models create embeddings',async({page,request})=>{
 await login(page,'admin');await page.getByRole('button',{name:'Products',exact:true}).click();
 for(const [i,p]of products.entries()){
  await page.locator('.catalog-product').filter({hasText:p.barcode}).getByRole('button',{name:'AI photos',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'AI product photos'});
  const saved=page.waitForResponse(r=>new URL(r.url()).pathname===`/api/ai/products/${p._id}/references`&&r.request().method()==='POST');
  await dialog.getByLabel('Add AI reference photo').setInputFiles(path.join(dataDir,samples[i].reference.image_file));
  expect((await saved).ok()).toBe(true);await expect(dialog.locator('figure')).toHaveCount(1);await expect(dialog.getByLabel('Close AI photos')).toBeEnabled();
  if(i===0){await dialog.getByLabel('Add AI reference photo').setInputFiles(path.join(dataDir,samples[i].reference.image_file));await expect(dialog.getByLabel('Add AI reference photo')).toBeEnabled();await expect(dialog.locator('figure')).toHaveCount(1);}
  if(i===5)await page.screenshot({path:path.join(output,'admin-ai-photos.png'),fullPage:true});
  await dialog.getByLabel('Close AI photos').click();
 }
 const status=await (await request.get('/api/ai/status',{headers:cashierHeaders})).json();expect(status.loaded).toBe(true);expect(status.referenceCount).toBe(6);
 const thumbnails=await request.post('/api/ai/product-photos',{headers:cashierHeaders,data:{productIds:products.map(p=>p._id)}});expect(thumbnails.ok()).toBe(true);
 const thumbnailBody=await thumbnails.json();expect(Object.keys(thumbnailBody.photos)).toHaveLength(6);expect(thumbnailBody.photos[products[0]._id]).toMatch(/^data:image\//);expect(JSON.stringify(thumbnailBody)).not.toContain('embedding');
 expect((await request.post('/api/ai/product-photos',{data:{productIds:[]}})).status()).toBe(401);
 expect((await request.post('/api/ai/product-photos',{headers:cashierHeaders,data:{productIds:['invalid']}})).status()).toBe(400);
 expect((await request.post('/api/ai/product-photos',{headers:cashierHeaders,data:{productIds:Array(61).fill(products[0]._id)}})).status()).toBe(400);
 const card=page.locator('.catalog-product').filter({hasText:products[0].barcode});await expect(card.getByRole('img',{name:'Product photo of '+products[0].name,exact:true})).toBeVisible();
 await expect.poll(()=>card.locator('img').evaluate(img=>img.naturalWidth)).toBeGreaterThan(0);
 check('Catalog displays stored product photos; cashier photo batches are authenticated, limited to 60 IDs and exclude vectors');
 expect((await request.get(`/api/ai/products/${products[0]._id}/references`,{headers:cashierHeaders})).status()).toBe(403);
 expect((await request.post(`/api/ai/products/${products[0]._id}/references`,{headers:cashierHeaders,data:{photo:null}})).status()).toBe(403);
 expect((await request.post(`/api/ai/products/${products[0]._id}/references`,{headers:adminHeaders,data:{photo:'data:image/jpeg;base64,broken'}})).status()).toBe(400);
 await mongoose.connect(`mongodb://127.0.0.1:27017/${config.metadata.database}?replicaSet=aspire-rs`);
 const vectors=await mongoose.connection.db.collection('aireferences').find().toArray();expect(vectors).toHaveLength(6);expect(vectors.every(r=>r.embedding.length===768)).toBe(true);await mongoose.disconnect();
 check('Six admin reference photos persisted with real 768-dimensional image embeddings; duplicate upload is idempotent');check('Cashiers cannot manage references; malformed image rejected');
});

test('cashier recognizes six dataset photos with AI, confirms exact products and saves a real invoice',async({page,request})=>{
 await login(page);
 await page.getByRole('button',{name:'Products',exact:true}).click();
 await expect(page.locator('.catalog-product').filter({hasText:products[1].barcode}).getByRole('img',{name:'Product photo of '+products[1].name,exact:true})).toBeVisible();
 await page.getByRole('button',{name:'New sale',exact:true}).click();
 for(const [i,p]of products.entries()){
  const start=Date.now(),data=await recognize(page,path.join(dataDir,samples[i].query.image_file));
  result.photos.push({name:p.name,reference:samples[i].reference.image_file,query:samples[i].query.image_file,same_image:samples[i].reference.image_file===samples[i].query.image_file,top1:data.candidates[0].product.name,correct_top1:data.candidates[0].product._id===p._id,similarity:data.candidates[0].similarity,elapsed_ms:Date.now()-start,mode:data.mode,yolo_detections:data.detector.detections});
  expect(data.candidates[0].product._id).toBe(p._id);
  await expect(page.locator('.cart-row')).toHaveCount(i); // Nothing billed before confirmation.
  if(i===0){expect((await request.post('/api/ai/confirm',{headers:otherHeaders,data:{recognitionId:data.recognitionId,productId:p._id}})).status()).toBe(409);await page.screenshot({path:path.join(output,'ai-suggestions.png'),fullPage:true});}
  await page.getByRole('button',{name:'Confirm AI match '+p.name,exact:true}).click();
  await expect(page.locator('.cart-row')).toHaveCount(i+1);
  expect((await request.post('/api/ai/confirm',{headers:cashierHeaders,data:{recognitionId:data.recognitionId,productId:p._id}})).status()).toBe(409);
 }
 const total=products.reduce((sum,p)=>sum+p.price,0);
 await page.screenshot({path:path.join(output,'ai-confirmed-bill.png'),fullPage:true});
 const saved=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/invoices'&&r.request().method()==='POST');
 await page.getByRole('button',{name:'Generate invoice',exact:true}).click();const response=await saved;expect(response.ok()).toBe(true);const invoice=await response.json();
 expect(invoice.total).toBe(total);expect(invoice.items).toHaveLength(6);await expect(page.locator('.receipt-modal')).toContainText('AI Test Cashier');
 await page.screenshot({path:path.join(output,'ai-invoice.png'),fullPage:true});await page.pdf({path:path.join(output,'ai-invoice.pdf'),printBackground:true});
 const inventory=await (await request.get('/api/products',{headers:adminHeaders})).json();expect(products.every(p=>inventory.find(x=>x._id===p._id).stock===9)).toBe(true);
 const reports=await (await request.get('/api/admin/sales',{headers:adminHeaders})).json();expect(reports.summary).toMatchObject({revenue:total,invoices:1,units:6});
 await mongoose.connect(`mongodb://127.0.0.1:27017/${config.metadata.database}?replicaSet=aspire-rs`);const scans=await mongoose.connection.db.collection('scans').find({format:'AI',verified:true}).toArray();expect(scans).toHaveLength(6);await mongoose.disconnect();
 check('Dataset photos recognized through the running application',{top1_correct:result.photos.filter(p=>p.correct_top1).length,total:6,cross_store_queries:result.photos.filter(p=>!p.same_image).length});
 check('Explicit confirmation required; another cashier and replayed confirmations are rejected');
 check('Real AI-confirmed invoice, sales report and atomic branch stock update',{total,invoice:invoice.number,products:6,stock_before:10,stock_after:9});
});

test('independent Tiger photo, webcam and RTSP capture call actual inference',async({page})=>{
 await login(page);
 await page.getByLabel('Automatically recognize camera products').uncheck();
 const independent=await recognize(page,path.join(root,'models/product-pilot/images/tiger.jpeg'));
 expect(independent.candidates[0].product._id).toBe(products[1]._id);await expect(page.locator('.cart-row')).toHaveCount(0);
 result.independent_tiger={correct_top1:true,similarity:independent.candidates[0].similarity};await page.screenshot({path:path.join(output,'tiger-camera-photo.png'),fullPage:true});
 await page.getByRole('button',{name:'New sale',exact:true}).click();
 const uri='data:image/jpeg;base64,'+(await fs.readFile(path.join(dataDir,samples[1].query.image_file))).toString('base64');
 await page.evaluate(async uri=>{const image=new Image();image.src=uri;await image.decode();const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const ctx=canvas.getContext('2d');const draw=()=>{ctx.drawImage(image,0,0);requestAnimationFrame(draw);};draw();navigator.mediaDevices.getUserMedia=async()=>canvas.captureStream(10);},uri);
 await page.getByRole('button',{name:'Open AI camera',exact:true}).click();await expect(page.getByRole('button',{name:'Recognize current product',exact:true})).toBeEnabled();
 const device=await page.getByLabel('AI camera',{exact:true}).locator('option').nth(1).getAttribute('value');
 await page.getByLabel('AI camera',{exact:true}).selectOption(device);await expect(page.getByLabel('Select camera',{exact:true})).toHaveValue(device);await expect(page.getByRole('button',{name:'Recognize current product',exact:true})).toBeEnabled();
 const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/ai/recognize'&&r.request().method()==='POST');await page.getByRole('button',{name:'Recognize current product',exact:true}).click();const prediction=await (await response).json();expect(prediction.candidates[0].product._id).toBe(products[1]._id);
 check('Independent supplied Tiger camera photo ranked first',{similarity:independent.candidates[0].similarity});check('Webcam capture UI calls actual model inference',{camera_transport:'simulated MediaStream using a real dataset image; not physical hardware validation'});
 await page.getByRole('button',{name:'Live camera',exact:true}).click();await expect(page.locator('.ai-camera video')).toHaveCount(0);await expect(page.locator('.scan-window video')).toBeVisible();
 await page.getByRole('button',{name:'Open AI camera',exact:true}).click();await expect(page.locator('.scan-window video')).toHaveCount(0);await expect(page.getByRole('button',{name:'Recognize current product',exact:true})).toBeEnabled();
 await page.getByRole('button',{name:'Close AI camera',exact:true}).click();check('AI and barcode camera modes release each other; device preference stays synchronized');
 const frame=await fs.readFile(path.join(dataDir,samples[1].query.image_file));
 let frameMode='waiting';
 await page.route('**/api/cameras/rtsp/connect',route=>route.fulfill({status:201,json:{id:'ai-test-camera'}}));
 await page.route('**/api/cameras/rtsp/ai-test-camera/frame',route=>frameMode==='waiting'?route.fulfill({status:202,json:{pending:true}}):route.fulfill({contentType:'image/jpeg',body:frameMode==='broken'?Buffer.from('unreadable camera frame'):frame}));
 await page.route('**/api/cameras/rtsp/ai-test-camera/disconnect',route=>route.fulfill({json:{success:true}}));
 await page.getByLabel('Automatically recognize camera products').check();
 let recognitionCalls=0;page.on('request',r=>{if(new URL(r.url()).pathname==='/api/ai/recognize')recognitionCalls++;});
 await page.getByRole('button',{name:'Connect RTSP camera',exact:true}).click();
 const panel=page.locator('.ai-billing');await panel.getByLabel('RTSP camera address').fill('rtsp://192.168.1.50:8554/test');
 const captured=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/ai/recognize'&&r.request().method()==='POST');
 await panel.getByRole('button',{name:'Connect RTSP camera',exact:true}).click();
 await expect(panel.getByRole('button',{name:'Recognize RTSP product',exact:true})).toBeDisabled();
 await expect(panel.locator('.rtsp-controls').getByRole('status')).toContainText('Waiting for camera frames');frameMode='valid';
 await expect.poll(()=>panel.locator('.rtsp-controls img').evaluate(img=>img.naturalWidth)).toBeGreaterThan(0);
 const networkPrediction=await (await captured).json();expect(networkPrediction.candidates[0].product._id).toBe(products[1]._id);
 await expect(panel.locator('.ai-candidate')).toHaveCount(3);await page.waitForTimeout(2300);expect(recognitionCalls).toBe(1);
 await expect(page.locator('.cart-row')).toHaveCount(0);
 await page.getByRole('button',{name:'Confirm AI match '+products[1].name,exact:true}).click();
 await expect(page.locator('.cart-row')).toHaveCount(1);await expect(panel.getByRole('button',{name:'Scan next product',exact:true})).toBeVisible();
 await page.waitForTimeout(2300);expect(recognitionCalls).toBe(1);await expect(page.locator('.cart-row')).toHaveCount(1);
 const next=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/ai/recognize'&&r.request().method()==='POST');
 await panel.getByRole('button',{name:'Scan next product',exact:true}).click();expect((await next).ok()).toBe(true);expect(recognitionCalls).toBe(2);
 await expect(panel.locator('.ai-candidate')).toHaveCount(3);
 await page.getByRole('button',{name:'None of these products',exact:true}).click();
 await page.waitForTimeout(2300);expect(recognitionCalls).toBe(2);
 check('RTSP automatically calls actual model inference, pauses for review and after confirmation/rejection, and resumes only for the next unit',{camera_transport:'simulated RTSP transport with a real dataset frame; no physical camera or FFmpeg validation'});
 await page.getByLabel('Automatically recognize camera products').uncheck();
 // Reproduce a preview reporting zero dimensions during its next image load.
 // Recognition must read the independently decoded frame, not this preview.
 await page.evaluate(()=>{
  for(const property of ['naturalWidth','naturalHeight']){
   const original=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,property).get;
   Object.defineProperty(HTMLImageElement.prototype,property,{configurable:true,get(){return this.alt==='RTSP camera preview'?0:original.call(this);}});
  }
 });
 const manual=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/ai/recognize'&&r.request().method()==='POST');
 await panel.getByRole('button',{name:'Recognize RTSP product',exact:true}).click();
 const manualResult=await (await manual).json();expect(manualResult.candidates[0].product._id).toBe(products[1]._id);
 await expect(panel.getByText('Camera or image is not ready.',{exact:true})).toHaveCount(0);
 frameMode='broken';await expect(panel.locator('.rtsp-controls').getByRole('alert')).toContainText('unreadable frame');
 await expect(panel.getByRole('button',{name:'Recognize RTSP product',exact:true})).toBeDisabled();
 frameMode='valid';await expect(panel.getByRole('button',{name:'Recognize RTSP product',exact:true})).toBeEnabled();
 await expect(panel.locator('.rtsp-controls').getByRole('alert')).toHaveCount(0);
 await expect(page.locator('.cart-row')).toHaveCount(1);
 check('RTSP capture waits for decoded frames, remains usable while the preview reloads, and clears frame errors after recovery');
});

test('calibrated camera skips empty frames and merges two identical packets without next-scan clicks',async({page})=>{
 await login(page);
 await page.getByLabel('Automatically recognize camera products').uncheck();
 const blank=Buffer.from(await page.evaluate(()=>{const c=document.createElement('canvas');c.width=640;c.height=480;const x=c.getContext('2d');x.fillStyle='#eeeeee';x.fillRect(0,0,640,480);return c.toDataURL('image/jpeg').split(',')[1];}),'base64');
 const packet=await fs.readFile(path.join(dataDir,samples[1].query.image_file));let current=blank,calls=0;
 page.on('request',r=>{if(new URL(r.url()).pathname==='/api/ai/recognize')calls++;});
 await page.route('**/api/cameras/rtsp/connect',route=>route.fulfill({status:201,json:{id:'cycle-test'}}));
 await page.route('**/api/cameras/rtsp/cycle-test/frame',route=>route.fulfill({contentType:'image/jpeg',body:current}));
 await page.route('**/api/cameras/rtsp/cycle-test/disconnect',route=>route.fulfill({json:{success:true}}));
 await page.getByRole('button',{name:'Connect RTSP camera',exact:true}).click();
 const panel=page.locator('.ai-billing');await panel.getByLabel('RTSP camera address').fill('rtsp://192.168.1.50:8554/test');
 await panel.getByRole('button',{name:'Connect RTSP camera',exact:true}).click();
 await expect(panel.getByRole('button',{name:'Recognize RTSP product',exact:true})).toBeEnabled();
 await panel.getByRole('button',{name:'Set empty scan area',exact:true}).click();
 await expect(panel).toContainText('Scan area saved');
 await page.getByLabel('Automatically recognize camera products').check();
 await page.waitForTimeout(2400);expect(calls).toBe(0);
 for(const quantity of [1,2]){
  current=packet;
  await expect(panel.locator('.ai-candidate')).toHaveCount(3,{timeout:30000});
  await panel.getByRole('button',{name:'Confirm AI match '+products[1].name,exact:true}).click();
  await expect(page.locator('.cart-row')).toHaveCount(1);
  await expect(page.locator('.cart-row .quantity span')).toHaveText(String(quantity));
  await page.waitForTimeout(2400);expect(calls).toBe(quantity);
  current=blank;await page.waitForTimeout(2600);expect(calls).toBe(quantity);
 }
 check('Calibrated RTSP skips empty frames, blocks stationary duplicates and merges identical unit scans into quantity two without Scan next product clicks');
});

test('five separated catalog cards are localized, reviewed and merged by SKU',async({page,request})=>{
 await login(page);
 await page.getByLabel('Automatically recognize camera products').uncheck();
 await page.getByLabel('Multiple products on counter').check();
 const indices=[0,1,2,1,4];
 const photos=await Promise.all(indices.map(async i=>'data:image/jpeg;base64,'+(await fs.readFile(path.join(dataDir,samples[i].reference.image_file))).toString('base64')));
 const fixture=await page.evaluate(async sources=>{
  const c=document.createElement('canvas');c.width=640;c.height=480;const x=c.getContext('2d');x.fillStyle='#333333';x.fillRect(0,0,640,480);
  const background=c.toDataURL('image/jpeg',.9).split(',')[1];
  for(let i=0;i<sources.length;i++){
   const im=new Image();im.src=sources[i];await im.decode();
   const left=15+i*125,top=110,w=105,h=Math.min(240,Math.max(55,105*im.naturalHeight/im.naturalWidth));x.fillStyle='#ffffff';x.fillRect(left,top,w,h);
   const scale=Math.min((w-8)/im.naturalWidth,(h-8)/im.naturalHeight);
   const iw=im.naturalWidth*scale,ih=im.naturalHeight*scale;
   x.drawImage(im,left+(w-iw)/2,top+(h-ih)/2,iw,ih);
  }
  return {background,scene:c.toDataURL('image/jpeg',.9).split(',')[1]};
 },photos);
 await page.getByLabel('Upload empty counter photo').setInputFiles({name:'empty-counter.jpg',mimeType:'image/jpeg',buffer:Buffer.from(fixture.background,'base64')});
 const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/ai/recognize'&&r.request().method()==='POST');
 await page.getByLabel('Recognize product photo with AI').setInputFiles({name:'five-catalog-cards.jpg',mimeType:'image/jpeg',buffer:Buffer.from(fixture.scene,'base64')});
 const received=await response;const data=await received.json();expect(received.ok(),JSON.stringify(data)).toBe(true);
 expect(data.mode).toBe('separated_counter_products');expect(data.items).toHaveLength(5);
 expect(new Set(data.items.map(i=>i.recognitionId)).size).toBe(5);
 for(let i=0;i<indices.length;i++){
  expect(data.items[i].candidates[0].product._id).toBe(products[indices[i]]._id);
  await page.getByRole('button',{name:'Confirm AI match '+products[indices[i]].name,exact:true}).click();
  await expect(page.locator('.ai-billing')).toContainText(`${indices.length-i-1} left to review`);
 }
 await expect(page.locator('.cart-row')).toHaveCount(4);
 const tiger=page.locator('.cart-row').filter({hasText:products[1].name});await expect(tiger.locator('.quantity span')).toHaveText('2');
 expect((await request.post('/api/ai/confirm',{headers:cashierHeaders,data:{recognitionId:data.items[0].recognitionId,productId:products[0]._id}})).status()).toBe(409);
 const empty=await request.post('/api/ai/recognize',{headers:cashierHeaders,data:{mode:'multiple',photo:'data:image/jpeg;base64,'+fixture.background,backgroundPhoto:'data:image/jpeg;base64,'+fixture.background}});
 expect(empty.ok()).toBe(true);expect((await empty.json()).items).toHaveLength(0);
 await page.screenshot({path:path.join(output,'multi-product-review.png'),fullPage:true});
 check('Five separated catalog cards localized and matched through real batched inference; duplicate Tiger merged into quantity two; replay rejected; empty scene returns no items',{physical_camera_validation:false,fixture:'Synthetic catalog cards on uniform counter; not general checkout accuracy'});
});

test('unknown rejection, fresh database prices, stock limits and store-bound confirmations',async({page,request})=>{
 await login(page);
 const unknown=await recognize(page,path.join(root,'models/product-pilot/images/mehmood.jpeg'));await expect(page.locator('.cart-row')).toHaveCount(0);await page.getByRole('button',{name:'None of these products',exact:true}).click();await expect(page.locator('.ai-candidate')).toHaveCount(0);
 const scans=await (await request.get('/api/scans',{headers:cashierHeaders})).json();expect(scans.some(s=>s.format==='AI'&&!s.verified)).toBe(true);
 await page.screenshot({path:path.join(output,'ai-rejected-unknown.png'),fullPage:true});
 const prediction=await recognize(page,path.join(dataDir,samples[1].query.image_file));
 const changed=await request.post(`/api/products/${products[1]._id}`,{headers:adminHeaders,data:{...products[1],price:12,stock:0}});expect(changed.ok()).toBe(true);
 const denied=await request.post('/api/ai/confirm',{headers:cashierHeaders,data:{recognitionId:prediction.recognitionId,productId:products[1]._id}});expect(denied.status()).toBe(400);
 await request.post(`/api/products/${products[1]._id}`,{headers:adminHeaders,data:{...products[1],price:12,stock:9}});
 await page.getByRole('button',{name:'Confirm AI match '+products[1].name,exact:true}).click();await expect(page.locator('.cart-row')).toContainText('Rs 12 each');
 await page.getByRole('button',{name:'New sale',exact:true}).click();await page.getByRole('button',{name:'Start new sale',exact:true}).click();
 const stale=await recognize(page,path.join(dataDir,samples[0].query.image_file));
 const store=await (await request.post('/api/stores',{headers:adminHeaders,data:{name:'AI empty branch',location:'Test only'}})).json();
 expect((await request.post('/api/profile/store',{headers:cashierHeaders,data:{storeId:store._id}})).ok()).toBe(true);
 expect((await request.post('/api/ai/confirm',{headers:cashierHeaders,data:{recognitionId:stale.recognitionId,productId:products[0]._id}})).status()).toBe(409);
 expect((await request.post('/api/ai/recognize',{data:{photo:null}})).status()).toBe(401);
 expect((await request.post('/api/ai/recognize',{headers:adminHeaders,data:{photo:null}})).status()).toBe(403);
 const invoices=await (await request.get('/api/invoices',{headers:cashierHeaders})).json();expect(invoices).toHaveLength(1);
 result.unknown_probe={name:'Mahmood coffee absent from references',suggested:unknown.candidates[0].product.name,automatically_rejected:false,cashier_rejected:true};
 check('Cashier rejects unknown photo; unverified AI event logged without creating a sale');check('Confirmation rechecks current price and stock; stale cross-store confirmation denied');expect(result.browser_errors).toEqual([]);
});

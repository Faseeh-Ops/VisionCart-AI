import {test,expect} from '@playwright/test';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import config from '../playwright.config.js';

const root=process.cwd(),dataDir=path.join(root,'datasets/retail-catalog'),output=path.join(dataDir,'ai-application-test');
const catalog=JSON.parse(await fs.readFile(path.join(dataDir,'products.json'),'utf8'));
const benchmark=JSON.parse(await fs.readFile(path.join(dataDir,'benchmark/test-pairs.json'),'utf8'));
const samples=benchmark.pairs.map(pair=>({
 product:catalog.find(p=>p.id===pair.query_id),
 reference:catalog.find(p=>p.id===pair.reference_id),
 query:catalog.find(p=>p.id===pair.query_id),
}));
if(samples.some(s=>!s.product||!s.reference||!s.query))throw Error('Required retail dataset samples are missing');
const captureIndex=2;
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
 await page.getByLabel('Scan a product photo').setInputFiles(file);
 const received=await response;expect(received.ok()).toBe(true);const data=await received.json();
 await expect(page.locator('.ai-candidate')).toHaveCount(3);expect(data.requiresConfirmation).toBe(true);expect(data.mode).toBe('focused_and_full_image');expect(['fast_single_product_path','yolo26n']).toContain(data.detector.name);return data;
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
  await page.locator(`.catalog-product[data-product-id="${p._id}"] .ai-photos-button`).evaluate(button=>button.click());
  const dialog=page.locator('.ai-reference-modal');
  const saved=page.waitForResponse(r=>new URL(r.url()).pathname===`/api/ai/products/${p._id}/references`&&r.request().method()==='POST');
  await dialog.getByLabel('Add AI reference photo').setInputFiles(path.join(dataDir,samples[i].reference.image_file));
  expect((await saved).ok()).toBe(true);await expect(dialog.locator('figure')).toHaveCount(1);await expect(dialog.getByLabel('Close AI photos')).toBeEnabled();
  if(i===0){await dialog.getByLabel('Add AI reference photo').setInputFiles(path.join(dataDir,samples[i].reference.image_file));await expect(dialog.getByLabel('Add AI reference photo')).toBeEnabled();await expect(dialog.locator('figure')).toHaveCount(1);}
  if(i===samples.length-1)await page.screenshot({path:path.join(output,'admin-ai-photos.png'),fullPage:true});
  await dialog.getByLabel('Close AI photos').click();
 }
 const status=await (await request.get('/api/ai/status',{headers:cashierHeaders})).json();expect(status.loaded).toBe(true);expect(status.referenceCount).toBe(samples.length);
 const thumbnails=await request.post('/api/ai/product-photos',{headers:cashierHeaders,data:{productIds:products.map(p=>p._id)}});expect(thumbnails.ok()).toBe(true);
 const thumbnailBody=await thumbnails.json();expect(Object.keys(thumbnailBody.photos)).toHaveLength(samples.length);expect(thumbnailBody.photos[products[0]._id]).toMatch(/^data:image\//);expect(JSON.stringify(thumbnailBody)).not.toContain('embedding');
 expect((await request.post('/api/ai/product-photos',{data:{productIds:[]}})).status()).toBe(401);
 expect((await request.post('/api/ai/product-photos',{headers:cashierHeaders,data:{productIds:['invalid']}})).status()).toBe(400);
 expect((await request.post('/api/ai/product-photos',{headers:cashierHeaders,data:{productIds:Array(61).fill(products[0]._id)}})).status()).toBe(400);
 const card=page.locator(`.catalog-product[data-product-id="${products[0]._id}"]`);await expect(card.getByRole('img',{name:'Product photo of '+products[0].name,exact:true})).toBeVisible();
 await expect.poll(()=>card.locator('img').evaluate(img=>img.naturalWidth)).toBeGreaterThan(0);
 check('Catalog displays stored product photos; cashier photo batches are authenticated, limited to 60 IDs and exclude vectors');
 expect((await request.get(`/api/ai/products/${products[0]._id}/references`,{headers:cashierHeaders})).status()).toBe(403);
 expect((await request.post(`/api/ai/products/${products[0]._id}/references`,{headers:cashierHeaders,data:{photo:null}})).status()).toBe(403);
 expect((await request.post(`/api/ai/products/${products[0]._id}/references`,{headers:adminHeaders,data:{photo:'data:image/jpeg;base64,broken'}})).status()).toBe(400);
 await mongoose.connect(`mongodb://127.0.0.1:27017/${config.metadata.database}?replicaSet=aspire-rs`);
 const vectors=await mongoose.connection.db.collection('aireferences').find().toArray();expect(vectors).toHaveLength(samples.length);expect(vectors.every(r=>r.embedding.length===768)).toBe(true);await mongoose.disconnect();
 check(`${samples.length} admin reference photos persisted with real 768-dimensional image embeddings; duplicate upload is idempotent`);check('Cashiers cannot manage references; malformed image rejected');
});

test('cashier recognizes the expanded cross-store dataset with AI, confirms exact products and saves a real invoice',async({page,request})=>{
 await login(page);
 await page.getByRole('button',{name:'Products',exact:true}).click();
 await expect(page.locator('.catalog-product').filter({hasText:products[captureIndex].barcode}).getByRole('img',{name:'Product photo of '+products[captureIndex].name,exact:true})).toBeVisible();
 await page.getByRole('button',{name:'New sale',exact:true}).click();
 const confirmed=[];
 for(const [i,p]of products.entries()){
  const start=Date.now(),data=await recognize(page,path.join(dataDir,samples[i].query.image_file));
  const expectedRank=data.candidates.findIndex(candidate=>candidate.product._id===p._id)+1;
  result.photos.push({name:p.name,reference:samples[i].reference.image_file,query:samples[i].query.image_file,same_image:samples[i].reference.image_file===samples[i].query.image_file,top1:data.candidates[0].product.name,correct_top1:data.candidates[0].product._id===p._id,expected_rank:expectedRank||null,similarity:data.candidates[0].similarity,elapsed_ms:Date.now()-start,mode:data.mode,yolo_detections:data.detector.detections,candidates:data.candidates.map(candidate=>({name:candidate.product.name,similarity:candidate.similarity}))});
  await expect(page.locator('.cart-row')).toHaveCount(confirmed.length); // Nothing billed before confirmation.
  if(i===0){expect((await request.post('/api/ai/confirm',{headers:otherHeaders,data:{recognitionId:data.recognitionId,productId:p._id}})).status()).toBe(409);await page.screenshot({path:path.join(output,'ai-suggestions.png'),fullPage:true});}
  if(expectedRank){
   await page.getByRole('button',{name:'Confirm AI match '+p.name,exact:true}).click();confirmed.push(i);
   await expect(page.locator('.cart-row')).toHaveCount(confirmed.length);
   expect((await request.post('/api/ai/confirm',{headers:cashierHeaders,data:{recognitionId:data.recognitionId,productId:p._id}})).status()).toBe(409);
  }else{
   await page.getByRole('button',{name:'None of these products',exact:true}).click();
   await expect(page.locator('.cart-row')).toHaveCount(confirmed.length);
  }
 }
 const total=confirmed.reduce((sum,i)=>sum+products[i].price,0);
 await page.screenshot({path:path.join(output,'ai-confirmed-bill.png'),fullPage:true});
 const saved=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/invoices'&&r.request().method()==='POST');
 await page.getByRole('button',{name:'Generate invoice',exact:true}).click();const response=await saved;expect(response.ok()).toBe(true);const invoice=await response.json();
 expect(invoice.total).toBe(total);expect(invoice.items).toHaveLength(confirmed.length);await expect(page.locator('.receipt-modal')).toContainText('AI Test Cashier');
 await page.screenshot({path:path.join(output,'ai-invoice.png'),fullPage:true});await page.pdf({path:path.join(output,'ai-invoice.pdf'),printBackground:true});
 const inventory=await (await request.get('/api/products',{headers:adminHeaders})).json();expect(products.every((p,i)=>inventory.find(x=>x._id===p._id).stock===(confirmed.includes(i)?9:10))).toBe(true);
 const reports=await (await request.get('/api/admin/sales',{headers:adminHeaders})).json();expect(reports.summary).toMatchObject({revenue:total,invoices:1,units:confirmed.length});
 await mongoose.connect(`mongodb://127.0.0.1:27017/${config.metadata.database}?replicaSet=aspire-rs`);const scans=await mongoose.connection.db.collection('scans').find({format:'AI'}).toArray();expect(scans).toHaveLength(samples.length);expect(scans.filter(scan=>scan.verified)).toHaveLength(confirmed.length);await mongoose.disconnect();
 result.metrics={total:samples.length,top1_correct:result.photos.filter(p=>p.correct_top1).length,top3_correct:result.photos.filter(p=>p.expected_rank).length,top1_accuracy:result.photos.filter(p=>p.correct_top1).length/samples.length,top3_accuracy:result.photos.filter(p=>p.expected_rank).length/samples.length,average_similarity:result.photos.reduce((sum,p)=>sum+p.similarity,0)/samples.length,average_scan_ms:result.photos.reduce((sum,p)=>sum+p.elapsed_ms,0)/samples.length};
 check('Dataset photos evaluated through the running application',{...result.metrics,cross_store_queries:result.photos.filter(p=>!p.same_image).length});
 check('Explicit confirmation required; another cashier and replayed confirmations are rejected');
 check('Correct candidates were cashier-confirmed; misses were rejected without adding the wrong product',{total,invoice:invoice.number,confirmed_products:confirmed.length,rejected_misses:samples.length-confirmed.length,stock_before:10,confirmed_stock_after:9,rejected_stock_after:10});
});

test('cross-store product photo, webcam and RTSP capture call actual inference',async({page})=>{
 await login(page);
 await page.getByText('Advanced scanning options').click();await page.getByLabel('Scan automatically when the product is steady').uncheck();
 const independent=await recognize(page,path.join(dataDir,samples[captureIndex].query.image_file));
 expect(independent.candidates[0].product._id).toBe(products[captureIndex]._id);await expect(page.locator('.cart-row')).toHaveCount(0);
 result.independent_cross_store={name:products[captureIndex].name,correct_top1:true,similarity:independent.candidates[0].similarity};await page.screenshot({path:path.join(output,'cross-store-camera-photo.png'),fullPage:true});
 await page.getByRole('button',{name:'New sale',exact:true}).click();
 const uri='data:image/jpeg;base64,'+(await fs.readFile(path.join(dataDir,samples[captureIndex].query.image_file))).toString('base64');
 await page.evaluate(async uri=>{const image=new Image();image.src=uri;await image.decode();const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const ctx=canvas.getContext('2d');const draw=()=>{ctx.drawImage(image,0,0);requestAnimationFrame(draw);};draw();navigator.mediaDevices.getUserMedia=async()=>canvas.captureStream(10);},uri);
 const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/ai/recognize'&&r.request().method()==='POST');
 await page.getByRole('button',{name:'Start smart camera',exact:true}).click();await expect(page.getByText(/Automatic scanning active/)).toBeVisible();
 const device=await page.getByLabel('Smart scanner camera',{exact:true}).locator('option').nth(1).getAttribute('value');
 await page.getByLabel('Smart scanner camera',{exact:true}).selectOption(device);await expect(page.getByLabel('Smart scanner camera',{exact:true})).toHaveValue(device);
 const prediction=await (await response).json();expect(prediction.candidates[0].product._id).toBe(products[captureIndex]._id);
 check('A different-retailer product camera photo ranked first',{product:products[captureIndex].name,similarity:independent.candidates[0].similarity});check('Webcam capture UI calls actual model inference',{camera_transport:'simulated MediaStream using a real dataset image; not physical hardware validation'});
 await page.getByRole('button',{name:'Stop smart camera',exact:true}).click();check('The unified smart camera releases its media stream cleanly');
 const frame=await fs.readFile(path.join(dataDir,samples[captureIndex].query.image_file));
 let frameMode='waiting';
 await page.route('**/api/cameras/rtsp/connect',route=>route.fulfill({status:201,json:{id:'ai-test-camera'}}));
 await page.route('**/api/cameras/rtsp/ai-test-camera/frame',route=>frameMode==='waiting'?route.fulfill({status:202,json:{pending:true}}):route.fulfill({contentType:'image/jpeg',body:frameMode==='broken'?Buffer.from('unreadable camera frame'):frame}));
 await page.route('**/api/cameras/rtsp/ai-test-camera/disconnect',route=>route.fulfill({json:{success:true}}));
 await page.getByLabel('Scan automatically when the product is steady').check();
 let recognitionCalls=0;page.on('request',r=>{if(new URL(r.url()).pathname==='/api/ai/recognize')recognitionCalls++;});
 await page.getByRole('button',{name:'Connect RTSP camera',exact:true}).click();
 const panel=page.locator('.ai-billing');await panel.getByLabel('RTSP camera address').fill('rtsp://192.168.1.50:8554/test');
 const captured=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/ai/recognize'&&r.request().method()==='POST');
 await panel.getByRole('button',{name:'Connect RTSP camera',exact:true}).click();
 await expect(panel.getByRole('button',{name:'Recognize RTSP product',exact:true})).toBeDisabled();
 await expect(panel.locator('.rtsp-controls').getByRole('status')).toContainText('Waiting for camera frames');frameMode='valid';
 await expect.poll(()=>panel.locator('.rtsp-controls img').evaluate(img=>img.naturalWidth)).toBeGreaterThan(0);
 const networkPrediction=await (await captured).json();expect(networkPrediction.candidates[0].product._id).toBe(products[captureIndex]._id);
 await expect(panel.locator('.ai-candidate')).toHaveCount(3);await page.waitForTimeout(2300);expect(recognitionCalls).toBe(1);
 await expect(page.locator('.cart-row')).toHaveCount(0);
 await page.getByRole('button',{name:'Confirm AI match '+products[captureIndex].name,exact:true}).click();
 await expect(page.locator('.cart-row')).toHaveCount(1);await expect(panel.getByRole('button',{name:'Scan next product',exact:true})).toBeVisible();
 await page.waitForTimeout(2300);expect(recognitionCalls).toBe(1);await expect(page.locator('.cart-row')).toHaveCount(1);
 const next=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/ai/recognize'&&r.request().method()==='POST');
 await panel.getByRole('button',{name:'Scan next product',exact:true}).click();expect((await next).ok()).toBe(true);expect(recognitionCalls).toBe(2);
 await expect(panel.locator('.ai-candidate')).toHaveCount(3);
 await page.getByRole('button',{name:'None of these products',exact:true}).click();
 await page.waitForTimeout(2300);expect(recognitionCalls).toBe(2);
 check('RTSP automatically calls actual model inference, pauses for review and after confirmation/rejection, and resumes only for the next unit',{camera_transport:'simulated RTSP transport with a real dataset frame; no physical camera or FFmpeg validation'});
 await page.getByLabel('Scan automatically when the product is steady').uncheck();
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
 const manualResult=await (await manual).json();expect(manualResult.candidates[0].product._id).toBe(products[captureIndex]._id);
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
 await page.getByText('Advanced scanning options').click();await page.getByLabel('Scan automatically when the product is steady').uncheck();
 const blank=Buffer.from(await page.evaluate(()=>{const c=document.createElement('canvas');c.width=640;c.height=480;const x=c.getContext('2d');x.fillStyle='#eeeeee';x.fillRect(0,0,640,480);return c.toDataURL('image/jpeg').split(',')[1];}),'base64');
 const packet=await fs.readFile(path.join(dataDir,samples[captureIndex].query.image_file));let current=blank,calls=0;
 page.on('request',r=>{if(new URL(r.url()).pathname==='/api/ai/recognize')calls++;});
 await page.route('**/api/cameras/rtsp/connect',route=>route.fulfill({status:201,json:{id:'cycle-test'}}));
 await page.route('**/api/cameras/rtsp/cycle-test/frame',route=>route.fulfill({contentType:'image/jpeg',body:current}));
 await page.route('**/api/cameras/rtsp/cycle-test/disconnect',route=>route.fulfill({json:{success:true}}));
 await page.getByRole('button',{name:'Connect RTSP camera',exact:true}).click();
 const panel=page.locator('.ai-billing');await panel.getByLabel('RTSP camera address').fill('rtsp://192.168.1.50:8554/test');
 await panel.getByRole('button',{name:'Connect RTSP camera',exact:true}).click();
 await expect(panel.getByRole('button',{name:'Recognize RTSP product',exact:true})).toBeEnabled();
 await panel.getByRole('button',{name:'Save empty counter',exact:true}).click();
 await expect(panel).toContainText('Scan area saved');
 await page.getByLabel('Scan automatically when the product is steady').check();
 await page.waitForTimeout(2400);expect(calls).toBe(0);
 for(const quantity of [1,2]){
  current=packet;
  await expect(panel.locator('.ai-candidate')).toHaveCount(3,{timeout:30000});
  await panel.getByRole('button',{name:'Confirm AI match '+products[captureIndex].name,exact:true}).click();
  await expect(page.locator('.cart-row')).toHaveCount(1);
  await expect(page.locator('.cart-row .quantity span')).toHaveText(String(quantity));
  await page.waitForTimeout(2400);expect(calls).toBe(quantity);
  current=blank;await page.waitForTimeout(2600);expect(calls).toBe(quantity);
 }
 check('Calibrated RTSP skips empty frames, blocks stationary duplicates and merges identical unit scans into quantity two without Scan next product clicks');
});

test('five separated catalog cards are localized, reviewed and merged by SKU',async({page,request})=>{
 await login(page);
 await page.getByText('Advanced scanning options').click();await page.getByLabel('Scan automatically when the product is steady').uncheck();
 await page.getByLabel('Multiple products on counter').check();
 const indices=[2,4,6,4,10];
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
 await page.getByLabel('Scan a product photo').setInputFiles({name:'five-catalog-cards.jpg',mimeType:'image/jpeg',buffer:Buffer.from(fixture.scene,'base64')});
 const received=await response;const data=await received.json();expect(received.ok(),JSON.stringify(data)).toBe(true);
 expect(data.mode).toBe('separated_counter_products');expect(data.items).toHaveLength(5);
 expect(new Set(data.items.map(i=>i.recognitionId)).size).toBe(5);
 for(let i=0;i<indices.length;i++){
  expect(data.items[i].candidates[0].product._id).toBe(products[indices[i]]._id);
  await page.getByRole('button',{name:'Confirm AI match '+products[indices[i]].name,exact:true}).click();
  await expect(page.locator('.ai-billing')).toContainText(`${indices.length-i-1} left to review`);
 }
 await expect(page.locator('.cart-row')).toHaveCount(4);
 const repeatedProduct=page.locator('.cart-row').filter({hasText:products[4].name});await expect(repeatedProduct.locator('.quantity span')).toHaveText('2');
 expect((await request.post('/api/ai/confirm',{headers:cashierHeaders,data:{recognitionId:data.items[0].recognitionId,productId:products[0]._id}})).status()).toBe(409);
 const empty=await request.post('/api/ai/recognize',{headers:cashierHeaders,data:{mode:'multiple',photo:'data:image/jpeg;base64,'+fixture.background,backgroundPhoto:'data:image/jpeg;base64,'+fixture.background}});
 expect(empty.ok()).toBe(true);expect((await empty.json()).items).toHaveLength(0);
 await page.screenshot({path:path.join(output,'multi-product-review.png'),fullPage:true});
 check(`Five separated catalog cards localized and matched through real batched inference; duplicate ${products[4].name} merged into quantity two; replay rejected; empty scene returns no items`,{physical_camera_validation:false,fixture:'Synthetic catalog cards on uniform counter; not general checkout accuracy'});
});

test('unknown rejection, fresh database prices, stock limits and store-bound confirmations',async({page,request})=>{
 await login(page);
 const unknown=await recognize(page,path.join(root,'models/product-pilot/images/mehmood.jpeg'));await expect(page.locator('.cart-row')).toHaveCount(0);await page.getByRole('button',{name:'None of these products',exact:true}).click();await expect(page.locator('.ai-candidate')).toHaveCount(0);
 const scans=await (await request.get('/api/scans',{headers:cashierHeaders})).json();expect(scans.some(s=>s.format==='AI'&&!s.verified)).toBe(true);
 await page.screenshot({path:path.join(output,'ai-rejected-unknown.png'),fullPage:true});
 const prediction=await recognize(page,path.join(dataDir,samples[captureIndex].query.image_file));
 const changed=await request.post(`/api/products/${products[captureIndex]._id}`,{headers:adminHeaders,data:{...products[captureIndex],price:12,stock:0}});expect(changed.ok()).toBe(true);
 const denied=await request.post('/api/ai/confirm',{headers:cashierHeaders,data:{recognitionId:prediction.recognitionId,productId:products[captureIndex]._id}});expect(denied.status()).toBe(400);
 await request.post(`/api/products/${products[captureIndex]._id}`,{headers:adminHeaders,data:{...products[captureIndex],price:12,stock:9}});
 await page.getByRole('button',{name:'Confirm AI match '+products[captureIndex].name,exact:true}).click();await expect(page.locator('.cart-row')).toContainText('Rs 12 each');
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

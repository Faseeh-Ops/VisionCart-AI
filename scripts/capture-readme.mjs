import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {mkdir,access,readFile} from 'node:fs/promises';
import path from 'node:path';
import {once} from 'node:events';
import {chromium} from '@playwright/test';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

// Screenshot fixtures use a separate database and never read production accounts.
const database=`aspire_readme_${Date.now()}`;
const uri=`mongodb://127.0.0.1:27017/${database}?replicaSet=aspire-rs`;
const base='http://127.0.0.1:4003',output='docs/screenshots';
const selectedScreens=process.argv.slice(2);
assert.ok(selectedScreens.every(name=>['dashboard','billing','store-details','invoice-search','stock-transfer','ai-recognition','multi-product'].includes(name)),'Unknown screenshot name.');
const includeAi=selectedScreens.some(name=>['ai-recognition','multi-product'].includes(name));
const password=randomUUID(),secret=randomUUID()+randomUUID();
let server,browser,serverOutput='';
async function api(route,token,body){
 const response=await fetch(base+'/api'+route,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});
 const data=await response.json();assert.ok(response.ok,route+': '+JSON.stringify(data));return data;
}
async function snapshot(page,name){
 if(selectedScreens.length&&!selectedScreens.includes(name))return;
 await page.evaluate(()=>document.fonts.ready);
 await page.locator('main').evaluate(element=>element.scrollTo(0,0));
 const viewport=page.viewportSize();
 // Match the viewport to the page before capture so the fixed sidebar fills
 // the entire image instead of leaving an empty strip below its original height.
 if(name==='dashboard')await page.setViewportSize({width:1600,height:Math.ceil(await page.evaluate(()=>document.documentElement.scrollHeight))});
 if(['store-details','billing','ai-recognition','multi-product'].includes(name))await page.setViewportSize({width:1600,height:name==='store-details'?1760:['ai-recognition','multi-product'].includes(name)?1700:1360});
 await page.evaluate(()=>document.activeElement?.blur());
 await page.evaluate(()=>{window.scrollTo(0,0);document.scrollingElement?.scrollTo(0,0);document.querySelector('main')?.scrollTo(0,0);});
 const sidebar=await page.locator('.sidebar').boundingBox();
 assert.ok(sidebar&&Math.abs(sidebar.height-page.viewportSize().height)<2,'Sidebar must cover the full screenshot height.');
 await page.screenshot({path:`${output}/${name==='dashboard'?'dashboard-overview':name}.png`,fullPage:false,animations:'disabled'});
 await page.setViewportSize(viewport);
 console.log('Captured '+name);
}
try{
 await access('dist/index.html');await mkdir(output,{recursive:true});
 server=spawn(process.execPath,['server/index.js'],{env:{...process.env,PORT:'4003',MONGODB_URI:uri,JWT_SECRET:secret},stdio:['ignore','pipe','pipe'],windowsHide:true});
 server.stdout.on('data',chunk=>{serverOutput+=chunk;});server.stderr.on('data',chunk=>{serverOutput+=chunk;});
 let ready=false;
 for(let i=0;i<150;i++){
  if(server.exitCode!==null)throw Error('Screenshot server exited: '+serverOutput);
  if(serverOutput.includes('store inventory ready.')){const response=await fetch(base+'/api/health');if(response.ok){ready=true;break;}}
  await new Promise(resolve=>setTimeout(resolve,100));
 }
 assert.ok(ready,'Screenshot server did not become ready.');
 await mongoose.connect(uri);const db=mongoose.connection.db,main='000000000000000000000001';
 await db.collection('stores').updateOne({_id:new mongoose.Types.ObjectId(main)},{$set:{name:'Gulberg Store',location:'Lahore'}});
 const hash=await bcrypt.hash(password,12);
 await db.collection('users').insertOne({name:'Store Manager',email:'manager@example.com',password:hash,role:'admin',active:true,selectedStore:new mongoose.Types.ObjectId(main)});
 const admin=await api('/auth/login',null,{email:'manager@example.com',password});
 const branch=await api('/stores',admin.token,{name:'Clifton Store',location:'Karachi'});
 await db.collection('users').insertMany([
  {name:'Naveed Ahmed',email:'naveed@example.com',password:hash,role:'cashier',active:true,selectedStore:new mongoose.Types.ObjectId(main)},
  {name:'Ayesha Khan',email:'ayesha@example.com',password:hash,role:'cashier',active:true,selectedStore:new mongoose.Types.ObjectId(branch._id)}
 ]);
 const naveed=await api('/auth/login',null,{email:'naveed@example.com',password});
 const ayesha=await api('/auth/login',null,{email:'ayesha@example.com',password});
 const products=await api('/products',admin.token);
 for(const p of products){await api('/products/'+p._id,admin.token,{...p,storeId:main,stock:240});await api('/inventory/restock',admin.token,{storeId:branch._id,barcode:p.barcode,quantity:100,requestId:randomUUID()});}
 const coffee=await api('/products',admin.token,{name:'Mahmood Cappuccino 25g',barcode:'8697449918281',price:250,stock:100,category:'Coffee',emoji:'\u2615',storeId:main});
 const tiger=await api('/products',admin.token,{name:'LU Tiger Biscuits',barcode:'8961003694271',price:10,stock:500,category:'Biscuits',emoji:'\ud83c\udf6a',storeId:main});
 await api('/products',admin.token,{name:'Innovative Choc n Chip',barcode:'8965310043173',price:10,stock:180,category:'Biscuits',emoji:'\ud83c\udf6a',storeId:main});
 const pepsi=includeAi?await api('/products',admin.token,{name:'Pepsi 1.5 L',barcode:'DOC-PEPSI-1500ML',price:200,stock:240,category:'Beverages',storeId:main}):products.find(p=>p.name.startsWith('Pepsi'));
 if(includeAi)await api('/inventory/restock',admin.token,{storeId:branch._id,barcode:pepsi.barcode,quantity:100,requestId:randomUUID()});
 let cream,referenceFiles;
 if(includeAi){
  const catalog=JSON.parse(await readFile('datasets/retail-catalog/products.json','utf8'));
  const ids=['carrefour:46313:offer_carrefour_:EXPRESS','rahim:34076','rahim:24567'];
  referenceFiles=ids.map(id=>{const row=catalog.find(p=>p.id===id);assert.ok(row?.image_file,'Documentation reference image is missing: '+id);return path.resolve('datasets/retail-catalog',row.image_file);});
  cream=await api('/products',admin.token,{name:'Nestle Milk Pak Dairy Cream 200ml',barcode:'DOC-CREAM-200ML',price:240,stock:200,category:'Dairy',storeId:main});
 }
 const lays=products.find(p=>p.name.startsWith("Lay"));
 for(let day=6;day>=0;day--){
  for(let n=0;n<3;n++){
   const account=n===2?ayesha:naveed,storeId=n===2?branch._id:main;
   const invoice=await api('/invoices',account.token,{storeId,items:[{productId:pepsi._id,quantity:2+((6-day+n)%4)},{productId:lays._id,quantity:1+((day+n)%3)}],payment:n===1?'Card':'Cash'});
   const createdAt=new Date();createdAt.setDate(createdAt.getDate()-day);createdAt.setHours(9+n*2,15+n*7,0,0);
   await db.collection('invoices').updateOne({_id:new mongoose.Types.ObjectId(invoice._id)},{$set:{number:`ASP-${createdAt.toISOString().slice(0,10).replaceAll('-','')}-${String(100+(6-day)*3+n)}`,createdAt}});
  }
 }
 await api('/inventory/transfers',admin.token,{productId:tiger._id,fromStoreId:main,toStoreId:branch._id,quantity:100,requestId:randomUUID()});
 await api('/scans',naveed.token,{barcode:pepsi.barcode});
 await api('/scans',naveed.token,{barcode:'PENDING-PRODUCT-01'});
 browser=await chromium.launch({channel:'msedge'});
 const context=await browser.newContext({viewport:{width:1600,height:1120},deviceScaleFactor:1,timezoneId:'Asia/Karachi'});
 await context.addInitScript(()=>{navigator.mediaDevices.enumerateDevices=async()=>[{kind:'videoinput',deviceId:'documentation-camera',label:'Checkout camera',groupId:'checkout'}];});
 const page=await context.newPage();
 let encodedReferences;
 if(includeAi){
  await page.goto(base);
  const originals=await Promise.all(referenceFiles.map(async file=>'data:image/jpeg;base64,'+(await readFile(file)).toString('base64')));
  encodedReferences=await page.evaluate(async sources=>{
   const photos=[];
   for(const source of sources){const image=new Image();image.src=source;await image.decode();const c=document.createElement('canvas');const scale=Math.min(1,640/Math.max(image.naturalWidth,image.naturalHeight));c.width=Math.round(image.naturalWidth*scale);c.height=Math.round(image.naturalHeight*scale);c.getContext('2d').drawImage(image,0,0,c.width,c.height);photos.push(c.toDataURL('image/jpeg',.85));}
   return photos;
  },originals);
  for(const [i,p]of [pepsi,tiger,cream].entries())await api('/ai/products/'+p._id+'/references',admin.token,{photo:encodedReferences[i]});
 }
 await page.goto(base);await page.evaluate(account=>localStorage.setItem('asp-session',JSON.stringify(account)),admin);await page.goto(base+'/#/dashboard');await page.reload();
 await page.getByText('Connected workspace',{exact:true}).waitFor();const stockUnits=(await api('/products',admin.token)).reduce((sum,p)=>sum+p.stock,0);await page.locator('.stat').filter({hasText:'Products in stock'}).getByText(String(stockUnits),{exact:true}).waitFor();
 await snapshot(page,'dashboard');
 await page.getByRole('button',{name:'Inventory management',exact:true}).click();await page.getByRole('heading',{name:'Product stock: Gulberg Store'}).waitFor();await snapshot(page,'store-details');
 await page.getByRole('button',{name:'Invoices',exact:true}).click();await page.locator('.invoice-history tbody tr').first().waitFor();await page.getByLabel('Invoice cashier',{exact:true}).selectOption({label:'Naveed Ahmed'});await page.getByRole('button',{name:'Search invoices',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.invoice-history .report-pagination')?.textContent.includes('14 invoices'));await snapshot(page,'invoice-search');
 await page.getByRole('button',{name:'Inventory management',exact:true}).click();await page.getByRole('button',{name:'Allocate stock between stores',exact:true}).click();const transfer=page.getByRole('dialog',{name:'Allocate stock between stores'});await transfer.getByLabel('To store',{exact:true}).selectOption(branch._id);await transfer.getByLabel('Product to allocate').selectOption(tiger._id);await transfer.getByLabel('Units to transfer').fill('50');await transfer.locator('.transfer-preview').waitFor();await snapshot(page,'stock-transfer');await page.getByRole('button',{name:'Close stock allocation'}).click();
 await page.evaluate(account=>localStorage.setItem('asp-session',JSON.stringify(account)),naveed);await page.reload();await page.getByRole('button',{name:'Billing station',exact:true}).click();await page.getByRole('heading',{name:'Current bill'}).waitFor();
 for(const p of [pepsi,coffee,tiger]){await page.getByRole('textbox',{name:'Barcode',exact:true}).fill(p.barcode);await page.getByRole('button',{name:'Scan',exact:true}).click();await page.locator('.cart-row').filter({hasText:p.name}).waitFor();}
 await page.getByRole('button',{name:'Increase '+pepsi.name,exact:true}).click();
 const dismiss=page.getByRole('button',{name:'Dismiss notification'});if(await dismiss.count())await dismiss.click();
 await snapshot(page,'billing');
 if(includeAi){
  const recognition=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/ai/recognize'&&r.request().method()==='POST');
  await page.getByLabel('Scan a product photo').setInputFiles(referenceFiles[0]);
  const prediction=await (await recognition).json();assert.equal(prediction.candidates[0].product._id,pepsi._id);
  await page.locator('.ai-candidate').first().waitFor();await snapshot(page,'ai-recognition');
  await page.getByRole('button',{name:'None of these products',exact:true}).click();
  await page.locator('.ai-candidate').first().waitFor({state:'detached'});
  await page.getByText('Advanced scanning options',{exact:true}).click();
  await page.getByLabel('Multiple products on counter').check();
  const fixture=await page.evaluate(async sources=>{
   const c=document.createElement('canvas');c.width=640;c.height=480;const ctx=c.getContext('2d');ctx.fillStyle='#eeeeee';ctx.fillRect(0,0,640,480);
   const background=c.toDataURL('image/jpeg',.85).split(',')[1];
   for(let i=0;i<sources.length;i++){const im=new Image();im.src=sources[i];await im.decode();const w=130,h=220,x=55+i*195,y=115;ctx.fillStyle=i?'#303ca8':'#b32028';ctx.fillRect(x,y,w,h);const scale=Math.min((w-24)/im.naturalWidth,(h-24)/im.naturalHeight),iw=im.naturalWidth*scale,ih=im.naturalHeight*scale;ctx.drawImage(im,x+(w-iw)/2,y+(h-ih)/2,iw,ih);}
   return {background,scene:c.toDataURL('image/jpeg',.85).split(',')[1]};
  },encodedReferences.slice(0,2));
  await page.getByLabel('Upload empty counter photo').setInputFiles({name:'documentation-empty-counter.jpg',mimeType:'image/jpeg',buffer:Buffer.from(fixture.background,'base64')});
  const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/ai/recognize'&&r.request().method()==='POST');
  await page.getByLabel('Scan a product photo').setInputFiles({name:'documentation-three-products.jpg',mimeType:'image/jpeg',buffer:Buffer.from(fixture.scene,'base64')});
  const multi=await (await response).json();assert.equal(multi.items.length,2);assert.equal(multi.items[0].candidates[0].product._id,pepsi._id);
  await page.getByRole('button',{name:'Confirm AI match '+pepsi.name,exact:true}).click();
  await page.getByText('2 complete products found. 1 left to review.',{exact:true}).waitFor();
  const toast=page.getByRole('button',{name:'Dismiss notification'});if(await toast.count())await toast.click();
  await snapshot(page,'multi-product');
 }
 console.log('README screenshots captured with fictional accounts and isolated sample data.');
}finally{
 if(browser)await browser.close();
 if(server&&server.exitCode===null){const ended=once(server,'exit');server.kill();await ended;}
 if(mongoose.connection.readyState===1){assert.match(database,/^aspire_readme_\d+$/);assert.equal(mongoose.connection.db.databaseName,database);await mongoose.connection.dropDatabase();await mongoose.disconnect();}
}

// Local admin maintenance import; no public API or account privileges are added.
import 'dotenv/config';
import mongoose from 'mongoose';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {createHash} from 'node:crypto';
import {buildImportPlan} from './retail-import-plan.mjs';
import {validatePhoto} from '../server/profile-photo.js';

const root=process.cwd(),data=path.join(root,'datasets/retail-catalog'),out=path.join(data,'library-import');
const apply=process.argv.includes('--apply'),MODEL='siglip2-base-patch16-224:image-v1';
let child;
try{
 await fs.mkdir(out,{recursive:true});
 await mongoose.connect(process.env.MONGODB_URI||'mongodb://127.0.0.1:27017/aspire_billing',{serverSelectionTimeoutMS:10000});
 const db=mongoose.connection.db,collection=db.collection('products'),references=db.collection('aireferences');
 const existing=await collection.find({}).toArray();
 const listings=JSON.parse(await fs.readFile(path.join(data,'products.json'),'utf8'));
 const validation=JSON.parse(await fs.readFile(path.join(data,'validation.json'),'utf8'));
 if(validation.errors.length||validation.records!==listings.length)throw Error('Run the catalog validator before importing.');
 const plan=buildImportPlan(listings,existing,validation.duplicate_image_groups);
 const summary={database:db.databaseName,listings:listings.length,consolidatedProducts:plan.products.length,newProducts:plan.products.filter(p=>!p.existingId).length,matchedExisting:plan.products.filter(p=>p.existingId).length,ambiguousPhotoListings:plan.ambiguousListingCount,referenceTasks:plan.products.reduce((sum,p)=>sum+p.photos.length,0),apply};
 console.log(JSON.stringify(summary));
 if(!apply){await mongoose.disconnect();process.exit(0);}
 const admin=await db.collection('users').findOne({role:'admin',active:{$ne:false}},{projection:{_id:1,name:1}});
 if(!admin)throw Error('An existing active administrator is required.');
 const before={date:new Date(),products:existing,storeInventory:await db.collection('storeinventories').find({}).toArray()};
 try{await fs.writeFile(path.join(out,'before.json'),JSON.stringify(before,null,2)+'\n',{flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;}
 const report={...summary,startedAt:new Date().toISOString(),pricePolicy:'Regular source price for new products; all existing prices, names, barcodes and branch quantities preserved.',stockPolicy:'No stock is fabricated. New products have zero stock in every branch until allocated by an admin.',barcodePolicy:'RETAIL codes are internal identifiers, not manufacturer barcodes.',mergedLabelPolicy:'Only identical normalized labels consolidate; no fuzzy product or pack-size matching.',skipped:[],referenceWrites:0};
 const targets=new Map(),operations=[];
 for(const p of plan.products){
  const id=p.existingId?new mongoose.Types.ObjectId(p.existingId):new mongoose.Types.ObjectId();targets.set(p.key,id);
  operations.push({updateOne:{filter:{_id:id},update:{$setOnInsert:{name:p.name,barcode:p.barcode,barcodeKind:'internal',catalogImportKey:p.key,retailImportedAt:new Date(),price:p.price,discountPercent:0,stock:0,category:p.category,verified:true},$addToSet:{retailSources:{$each:p.sources}}},upsert:true}});
 }
 for(let i=0;i<operations.length;i+=200)await collection.bulkWrite(operations.slice(i,i+200),{ordered:true});
 const photos=plan.products.flatMap(p=>p.photos.map(photo=>({...photo,key:p.key})));
 // The three supplied pack photos have known existing barcodes and remain linked
 // to their original products rather than guessed matches to retailer multipacks.
 for(const [filename,barcode]of [['tiger','8961003694271'],['innovita','8965310043173'],['mehmood','8697449918281']]){
  const product=existing.find(p=>p.barcode===barcode);if(!product)continue;
  const source=path.join(root,'models/product-pilot/images',filename+'.jpeg');
  try{await fs.copyFile(source,path.join(out,filename+'.jpeg'));}catch(e){if(e.code==='ENOENT')continue;throw e;}
  const key='known-pilot:'+barcode;targets.set(key,product._id);photos.unshift({key,file:'library-import/'+filename+'.jpeg',sourceId:key});
 }
 await fs.writeFile(path.join(out,'plan.json'),JSON.stringify({model:MODEL,photos},null,2)+'\n');
 const stderr=await fs.open(path.join(out,'encoder.log'),'a');
 const python=process.env.AI_PYTHON_PATH||path.join(root,'.venv-ai',process.platform==='win32'?'Scripts/python.exe':'bin/python');
 child=spawn(python,['-u',path.join(root,'scripts/encode-retail-library.py')],{windowsHide:true,stdio:['ignore','pipe',stderr.fd]});
 const done=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code)=>code===0?resolve():reject(Error('Image encoder failed. See local library-import/encoder.log.')));});
 // Register rejection immediately while draining stdout and committing batches.
 done.catch(()=>{});
 let lastProgress=0;
 for await(const line of createInterface({input:child.stdout})){
  const event=JSON.parse(line);
  if(event.type==='loading')console.log('Loading SigLIP locally; '+event.photos+' reference photos queued.');
  if(event.type==='cpu')console.log(JSON.stringify(event));
  if(event.type==='skipped')report.skipped.push(event);
  if(event.type==='batch'){
   const writes=[];
   for(const file of event.files){
    const cached=JSON.parse(await fs.readFile(file.cache,'utf8')),productId=targets.get(file.key);
    if(!productId||cached.model!==MODEL||cached.embedding.length!==768||!cached.embedding.every(Number.isFinite)||Math.abs(Math.hypot(...cached.embedding)-1)>.01)throw Error('Invalid cached vector or import target.');
    const photo=validatePhoto(cached.photo),hash=createHash('sha256').update(photo).digest('hex');
    if(hash!==cached.hash)throw Error('Reference checksum mismatch.');
    writes.push({updateOne:{filter:{productId,hash},update:{$setOnInsert:{productId,hash,photo,embedding:cached.embedding,model:MODEL,createdBy:String(admin._id),createdAt:new Date(),updatedAt:new Date(),sourceId:file.sourceId}},upsert:true}});
   }
   if(writes.length){const saved=await references.bulkWrite(writes,{ordered:true});report.referenceWrites+=saved.upsertedCount;}
   if(Date.now()-lastProgress>10000||event.completed===event.total){console.log(JSON.stringify({completed:event.completed,total:event.total,newReferences:report.referenceWrites,skipped:report.skipped.length,elapsedSeconds:event.elapsed}));lastProgress=Date.now();}
  }
 }
 await done;await stderr.close();child=null;
 for(const p of existing){
  const now=await collection.findOne({_id:p._id});
  for(const field of ['name','price','barcode','stock'])if(now[field]!==p[field])throw Error('Existing product field unexpectedly changed: '+p._id+' '+field);
 }
 const quantities=await db.collection('storeinventories').find({}).toArray();
 for(const row of before.storeInventory){const now=quantities.find(r=>String(r._id)===String(row._id));if(!now||now.stock!==row.stock)throw Error('Branch quantity changed during import; review the report.');}
 report.finishedAt=new Date().toISOString();
 report.totalProducts=await collection.countDocuments();report.totalReferences=await references.countDocuments({model:MODEL});
 const linked=await references.distinct('productId',{model:MODEL});report.productsWithReferences=linked.length;
 const original=JSON.parse(await fs.readFile(path.join(out,'before.json'),'utf8'));
 report.originalProductsPreserved=original.products.length;report.branchQuantitiesPreserved=before.storeInventory.length;
 report.addedProductsSinceSnapshot=report.totalProducts-original.products.length;
 report.productsWithoutReferences=await collection.countDocuments({_id:{$nin:linked}});
 report.excludedAmbiguous=plan.products.filter(p=>p.excludedPhotos.length).map(p=>({key:p.key,name:p.name,listingIds:p.excludedPhotos}));
 await fs.writeFile(path.join(out,'results.json'),JSON.stringify(report,null,2)+'\n');
 await db.collection('authlogs').insertOne({user:String(admin._id),name:admin.name,role:'admin',action:'retail-library-import',result:'success',createdAt:new Date(),details:{products:report.totalProducts,references:report.totalReferences,report:'datasets/retail-catalog/library-import/results.json'}});
 console.log(JSON.stringify({done:true,products:report.totalProducts,references:report.totalReferences,productsWithReferences:report.productsWithReferences,withoutReferences:report.productsWithoutReferences,report:'datasets/retail-catalog/library-import/results.json'}));
}catch(e){child?.kill();console.error(e.message);process.exitCode=1;}finally{await mongoose.disconnect();}

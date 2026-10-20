import {Router} from 'express';
import mongoose from 'mongoose';
import {createHash} from 'node:crypto';
import {validatePhoto} from './profile-photo.js';
import {aiAvailability,encodeProductPhoto} from './ai-runtime.js';
import {makeReferenceIndex,rankReferenceProducts,validEmbedding} from './ai-index.js';

const MODEL='siglip2-base-patch16-224:image-v1';
const referenceSchema=new mongoose.Schema({productId:{type:mongoose.Schema.Types.ObjectId,required:true,ref:'Product'},photo:String,embedding:[Number],model:String,hash:String,createdBy:String},{timestamps:true});
referenceSchema.index({productId:1,hash:1},{unique:true});
const Reference=mongoose.models.AiReference||mongoose.model('AiReference',referenceSchema);
const predictionSchema=new mongoose.Schema({user:String,storeId:String,candidates:[String],status:{type:String,default:'pending'},expiresAt:Date},{timestamps:true});
predictionSchema.index({expiresAt:1},{expireAfterSeconds:0});
const Prediction=mongoose.models.AiPrediction||mongoose.model('AiPrediction',predictionSchema);
const bad=(message,status=400)=>Object.assign(Error(message),{status});
function photoInput(value){let photo;try{photo=validatePhoto(value);}catch(e){throw bad(e.message.replace('Profile photo','Product photo'));}if(!photo)throw bad('Choose a product photo.');return photo;}
export function aiRecognitionRouter({Product,Store,Scan,branchProducts}){
  const router=Router();
  let cachedIndex=null,indexExpires=0,indexLoading=null,generation=0;
  const invalidateIndex=()=>{generation++;indexExpires=0;indexLoading=null;};
  const referenceIndex=async()=>{
    if(cachedIndex&&Date.now()<indexExpires)return cachedIndex;
    if(indexLoading)return indexLoading;
    const version=generation;
    const loading=Reference.find({model:MODEL}).select('productId embedding').lean().then(rows=>{
      const index=makeReferenceIndex(rows);if(version===generation){cachedIndex=index;indexExpires=Date.now()+15000;}return index;
    });indexLoading=loading;
    try{return await loading;}finally{if(indexLoading===loading)indexLoading=null;}
  };
  router.get('/status',async(req,res)=>res.json({...aiAvailability(),referenceCount:await Reference.countDocuments({model:MODEL})}));
  // Both signed-in roles can see catalog pictures, without reference vectors.
  router.post('/product-photos',async(req,res)=>{
    const ids=req.body.productIds;
    if(!Array.isArray(ids)||ids.length>60||ids.some(id=>typeof id!=='string'||!mongoose.isValidObjectId(id)))throw bad('Choose up to 60 valid products.');
    const rows=await Reference.aggregate([
      {$match:{productId:{$in:[...new Set(ids)].map(id=>new mongoose.Types.ObjectId(id))}}},
      {$sort:{createdAt:1,_id:1}},
      {$group:{_id:'$productId',photo:{$first:'$photo'}}},
    ]);
    res.json({photos:Object.fromEntries(rows.map(row=>[String(row._id),row.photo]))});
  });
  const admin=(req,res,next)=>req.user.role==='admin'?next():res.status(403).json({error:'Only administrators can manage AI reference photos.'});
  router.get('/products/:id/references',admin,async(req,res)=>{
    if(!mongoose.isValidObjectId(req.params.id))throw bad('Choose a valid product.');
    res.json(await Reference.find({productId:req.params.id}).select('photo model createdAt').sort({createdAt:1}));
  });
  router.post('/products/:id/references',admin,async(req,res)=>{
    if(!mongoose.isValidObjectId(req.params.id)||!await Product.exists({_id:req.params.id,verified:true}))throw bad('Verified product not found.',404);
    const photo=photoInput(req.body.photo),hash=createHash('sha256').update(photo).digest('hex');
    const old=await Reference.findOne({productId:req.params.id,hash}).select('photo model createdAt');
    if(old)return res.json(old);
    if(await Reference.countDocuments({productId:req.params.id})>=8)throw bad('Keep up to eight reference photos for each exact product size.');
    const encoded=await encodeProductPhoto(photo);
    if(encoded.model!==MODEL||!validEmbedding(encoded.embedding))throw bad('AI returned an invalid image embedding.',503);
    const reference=await Reference.create({productId:req.params.id,photo,hash,model:MODEL,embedding:encoded.embedding,createdBy:req.user.id});
    invalidateIndex();
    res.status(201).json({_id:reference.id,photo:reference.photo,model:reference.model,createdAt:reference.createdAt});
  });
  router.post('/references/:id/remove',admin,async(req,res)=>{
    if(!mongoose.isValidObjectId(req.params.id))throw bad('Choose a valid reference photo.');
    await Reference.deleteOne({_id:req.params.id});invalidateIndex();res.json({success:true});
  });
  router.post('/recognize',async(req,res)=>{
    if(req.user.role!=='cashier')throw bad('Only cashiers can recognize products for billing.',403);
    const store=await Store.findOne({_id:req.user.selectedStore,active:true});if(!store)throw bad('Select an active working store.');
    const mode=req.body.mode??'single';
    if(!['single','multiple'].includes(mode))throw bad('Choose single or multiple product scanning.');
    const photo=photoInput(req.body.photo),backgroundPhoto=mode==='multiple'?photoInput(req.body.backgroundPhoto):undefined;
    const references=await referenceIndex();
    if(!references.length)throw bad('Your administrator must add AI photos to inventory products first.',409);
    const encoded=await encodeProductPhoto(photo,{mode,backgroundPhoto});
    if(encoded.model!==MODEL)throw bad('AI returned an invalid model.',503);
    const makeCandidates=async embedding=>{
    if(!validEmbedding(embedding))throw bad('AI returned an invalid image embedding.',503);
    const ranked=rankReferenceProducts(embedding,references),scores=new Map(ranked.map(r=>[r.productId,r.similarity])),bestReferences=new Map(ranked.map(r=>[r.productId,r.referenceId]));
    const details=[];
    // Read live prices and stock only for the best verified catalog candidates.
    for(let offset=0;offset<ranked.length&&details.length<3;offset+=50){
      const batch=ranked.slice(offset,offset+50),found=await Product.find({_id:{$in:batch.map(r=>r.productId)},verified:true});
      const byId=new Map(found.map(p=>[p.id,p]));for(const row of batch){const p=byId.get(row.productId);if(p)details.push(p);if(details.length===3)break;}
    }
    const branch=await branchProducts(details,store._id);
    const candidates=branch.map(product=>({product,similarity:Math.round(scores.get(String(product._id))*10000)/10000})).sort((a,b)=>b.similarity-a.similarity).slice(0,3);
    if(!candidates.length)throw bad('No verified products have usable AI photos.',409);
    const photos=await Reference.find({_id:{$in:candidates.map(c=>bestReferences.get(String(c.product._id)))}}).select('photo').lean();
    const photoMap=new Map(photos.map(p=>[String(p._id),p.photo]));
    for(const candidate of candidates)candidate.referencePhoto=photoMap.get(bestReferences.get(String(candidate.product._id)));
    return candidates;
    };
    const savePrediction=async candidates=>{
      const prediction=await Prediction.create({user:req.user.id,storeId:store.id,candidates:candidates.map(c=>String(c.product._id)),expiresAt:new Date(Date.now()+5*60000)});
      return {recognitionId:prediction.id,candidates};
    };
    const common={requiresConfirmation:true,scoreType:'cosine_similarity_not_probability',mode:encoded.localization,detector:{name:encoded.detector,detections:encoded.detections},notice:'Confirm each detected item and exact pack size. Overlapping or hidden items may be missed; similarity is not a confidence percentage.'};
    if(mode==='multiple'){
      if(!Array.isArray(encoded.regions)||encoded.regions.length>10)throw bad('AI returned invalid product regions.',503);
      const candidates=await Promise.all(encoded.regions.map(region=>makeCandidates(region.embedding)));
      const items=[];
      for(let i=0;i<candidates.length;i++)items.push({...await savePrediction(candidates[i]),box:encoded.regions[i].box,photo:encoded.regions[i].photo});
      return res.json({...common,items,imageSize:encoded.imageSize});
    }
    res.json({...common,...await savePrediction(await makeCandidates(encoded.embedding))});
  });
  router.post('/confirm',async(req,res)=>{
    if(req.user.role!=='cashier')throw bad('Cashier access required.',403);
    const {recognitionId,productId}=req.body;
    if(!mongoose.isValidObjectId(recognitionId)||!mongoose.isValidObjectId(productId))throw bad('Choose a current product suggestion.');
    const pending=await Prediction.findOne({_id:recognitionId,user:req.user.id,storeId:req.user.selectedStore,status:'pending',expiresAt:{$gt:new Date()},candidates:productId});
    if(!pending)throw bad('This suggestion expired, was already confirmed, or belongs to another store. Scan again.',409);
    if(!await Store.exists({_id:req.user.selectedStore,active:true}))throw bad('Select an active store.');
    const found=await Product.findOne({_id:productId,verified:true});if(!found)throw bad('Product is no longer available.',404);
    const [product]=await branchProducts([found],req.user.selectedStore);if(product.stock<1)throw bad('This product is out of stock in your store.');
    const accepted=await Prediction.findOneAndUpdate({_id:pending._id,status:'pending'},{$set:{status:'confirmed'}},{new:true});
    if(!accepted)throw bad('Suggestion already confirmed. Scan again for another unit.',409);
    await Scan.create({barcode:product.barcode,format:'AI',verified:true,user:req.user.id,userName:req.user.name,storeId:req.user.selectedStore,productName:product.name});
    res.json({product,format:'AI',verified:true});
  });
  router.post('/reject',async(req,res)=>{
    if(req.user.role!=='cashier')throw bad('Cashier access required.',403);
    if(!mongoose.isValidObjectId(req.body.recognitionId))throw bad('Choose a current suggestion.');
    const prediction=await Prediction.findOneAndUpdate({_id:req.body.recognitionId,user:req.user.id,storeId:req.user.selectedStore,status:'pending',expiresAt:{$gt:new Date()}},{$set:{status:'rejected'}},{new:true});
    if(!prediction)throw bad('This suggestion expired or was already reviewed.',409);
    await Scan.create({barcode:`AI-${prediction.id}`,format:'AI',verified:false,user:req.user.id,userName:req.user.name,storeId:req.user.selectedStore,productName:'Unmatched product photo'});
    res.json({success:true});
  });
  return router;
}

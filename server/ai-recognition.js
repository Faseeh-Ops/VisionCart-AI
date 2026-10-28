import {Router} from 'express';
import mongoose from 'mongoose';
import {createHash} from 'node:crypto';
import {validatePhoto} from './profile-photo.js';
import {aiAvailability,encodeProductPhoto} from './ai-runtime.js';
import {makeReferenceIndex,rankReferenceProducts,validEmbedding} from './ai-index.js';
import {cleanImageSearch,downloadOpenFoodFactsImage,imageSearchTerms,searchOpenFoodFacts} from './product-image-search.js';

const MODEL='siglip2-base-patch16-224:image-v1';
const referenceSchema=new mongoose.Schema({productId:{type:mongoose.Schema.Types.ObjectId,required:true,ref:'Product'},photo:String,embedding:[Number],model:String,hash:String,createdBy:String,sourceProvider:String,sourceUrl:String,sourceLabel:String},{timestamps:true});
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
      const index=makeReferenceIndex(rows);if(version===generation){cachedIndex=index;indexExpires=Number.POSITIVE_INFINITY;}return index;
    });indexLoading=loading;
    try{return await loading;}finally{if(indexLoading===loading)indexLoading=null;}
  };
  router.get('/status',async(req,res)=>{const referenceCount=await Reference.countDocuments({model:MODEL});if(referenceCount&&!cachedIndex)await referenceIndex();res.json({...aiAvailability(),referenceCount,indexReady:!referenceCount||Boolean(cachedIndex)});});
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
  const addReference=async({productId,photo,userId,sourceProvider='upload',sourceUrl='',sourceLabel='Admin upload'})=>{
    const hash=createHash('sha256').update(photo).digest('hex');
    const old=await Reference.findOne({productId,hash}).select('photo model createdAt sourceProvider sourceUrl sourceLabel');
    if(old)return old;
    if(await Reference.countDocuments({productId})>=8)throw bad('Keep up to eight reference photos for each exact product size.');
    const encoded=await encodeProductPhoto(photo,{purpose:'reference'});
    if(encoded.model!==MODEL||!validEmbedding(encoded.embedding))throw bad('AI returned an invalid image embedding.',503);
    const reference=await Reference.create({productId,photo,hash,model:MODEL,embedding:encoded.embedding,createdBy:userId,sourceProvider,sourceUrl,sourceLabel});
    invalidateIndex();return reference;
  };
  router.get('/products/:id/references',admin,async(req,res)=>{
    if(!mongoose.isValidObjectId(req.params.id))throw bad('Choose a valid product.');
    res.json(await Reference.find({productId:req.params.id}).select('photo model createdAt sourceProvider sourceUrl sourceLabel').sort({createdAt:1}));
  });
  router.post('/products/:id/references',admin,async(req,res)=>{
    if(!mongoose.isValidObjectId(req.params.id)||!await Product.exists({_id:req.params.id,verified:true}))throw bad('Verified product not found.',404);
    const reference=await addReference({productId:req.params.id,photo:photoInput(req.body.photo),userId:req.user.id});
    res.status(201).json({_id:reference.id,photo:reference.photo,model:reference.model,createdAt:reference.createdAt});
  });
  router.get('/products/:id/image-suggestions',admin,async(req,res)=>{
    if(!mongoose.isValidObjectId(req.params.id))throw bad('Choose a valid product.');
    const product=await Product.findOne({_id:req.params.id,verified:true}).select('name barcode');if(!product)throw bad('Verified product not found.',404);
    const query=cleanImageSearch(req.query.q)||product.name,terms=imageSearchTerms(query),conditions=terms.map(term=>({name:new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'i')}));
    const similar=conditions.length?await Product.find({_id:{$ne:product._id},verified:true,$or:conditions}).select('name barcode retailSources').limit(24).lean():[];
    const ids=similar.map(row=>row._id),photos=ids.length?await Reference.aggregate([{$match:{productId:{$in:ids}}},{$sort:{createdAt:1,_id:1}},{$group:{_id:'$productId',referenceId:{$first:'$_id'},photo:{$first:'$photo'}}}]):[];
    const photoByProduct=new Map(photos.map(row=>[String(row._id),row]));
    const local=similar.map(row=>{const reference=photoByProduct.get(String(row._id));if(!reference)return null;const score=imageSearchTerms(row.name).filter(term=>terms.includes(term)).length;return {provider:'catalog',referenceId:String(reference.referenceId),name:row.name,details:`Existing catalog product · ${row.barcode}`,imageUrl:reference.photo,sourceUrl:row.retailSources?.[0]?.url||'',sourceLabel:'Aspire product library',score};}).filter(Boolean).sort((a,b)=>b.score-a.score||a.name.localeCompare(b.name)).slice(0,2).map(({score,...row})=>row);
    let external=[],externalError='';
    try{external=await searchOpenFoodFacts({query,barcode:product.barcode,limit:4,userAgent:process.env.OPEN_FOOD_FACTS_USER_AGENT});}catch(error){externalError=local.length?'Showing matches from your Aspire product library. Open Food Facts is temporarily unavailable.':'Open Food Facts is temporarily unavailable. Use Google Images or upload a photo from this device.';}
    res.json({query,candidates:[...local,...external].slice(0,4),externalError,attribution:'Open Food Facts product images are offered under CC BY-SA. Confirm the exact pack before saving.'});
  });
  router.post('/products/:id/reference-from-suggestion',admin,async(req,res)=>{
    if(!mongoose.isValidObjectId(req.params.id)||!await Product.exists({_id:req.params.id,verified:true}))throw bad('Verified product not found.',404);
    let photo,sourceProvider,sourceUrl='',sourceLabel;
    if(req.body.provider==='catalog'){
      if(!mongoose.isValidObjectId(req.body.referenceId))throw bad('Choose a valid catalog suggestion.');
      const source=await Reference.findById(req.body.referenceId).select('photo sourceProvider sourceUrl sourceLabel');if(!source)throw bad('The catalog suggestion is no longer available.',404);
      photo=photoInput(source.photo);sourceProvider=source.sourceProvider||'catalog';sourceUrl=source.sourceUrl||'';sourceLabel=source.sourceLabel||'Aspire product library';
    }else if(req.body.provider==='openfoodfacts'){
      sourceProvider='openfoodfacts';sourceUrl=String(req.body.imageUrl||'');sourceLabel='Open Food Facts';
      photo=photoInput(await downloadOpenFoodFactsImage(sourceUrl,{userAgent:process.env.OPEN_FOOD_FACTS_USER_AGENT}));
    }else throw bad('Choose a product image suggestion.');
    const reference=await addReference({productId:req.params.id,photo,userId:req.user.id,sourceProvider,sourceUrl,sourceLabel});
    res.status(201).json({_id:reference.id,photo:reference.photo,model:reference.model,createdAt:reference.createdAt,sourceProvider:reference.sourceProvider,sourceUrl:reference.sourceUrl,sourceLabel:reference.sourceLabel});
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
    const photo=photoInput(req.body.photo),backgroundPhoto=req.body.backgroundPhoto?photoInput(req.body.backgroundPhoto):undefined;
    if(mode==='multiple'&&!backgroundPhoto)throw bad('Set an empty counter image before scanning multiple products.');
    const references=await referenceIndex();
    if(!references.length)throw bad('Your administrator must add AI photos to inventory products first.',409);
    const encoded=await encodeProductPhoto(photo,{mode,backgroundPhoto});
    if(encoded.model!==MODEL)throw bad('AI returned an invalid model.',503);
    const cameraMinimum=Number(process.env.AI_CAMERA_MIN_SIMILARITY||-1),legacyCameraMinimum=Number(process.env.AI_LEGACY_CAMERA_MIN_SIMILARITY||.675),uploadMinimum=Number(process.env.AI_MIN_SIMILARITY||.72);
    const minimum=req.body.cameraTriggered===true?(encoded.sceneChanged===true?cameraMinimum:backgroundPhoto?uploadMinimum:legacyCameraMinimum):uploadMinimum;
    // Camera motion can make a textured counter look different pixel-by-pixel.
    // Semantic similarity may suppress it only when OpenCV also finds no large
    // foreground. This keeps a real packet from being hidden by the counter.
    const backgroundLimit=Number(process.env.AI_BACKGROUND_SIMILARITY||.88),strongBackgroundLimit=Number(process.env.AI_STRONG_BACKGROUND_SIMILARITY||.82),foregroundLimit=Number(process.env.AI_BACKGROUND_MAX_FOREGROUND||.18),regionLimit=Number(process.env.AI_BACKGROUND_MAX_REGION||.05);
    const semanticEmpty=Number(encoded.backgroundSimilarity)>=backgroundLimit&&Number(encoded.foregroundRatio)<foregroundLimit&&Number(encoded.largestForegroundRatio)<regionLimit;
    const strongSemanticEmpty=Number(encoded.backgroundSimilarity)>=strongBackgroundLimit;
    const sameBackground=backgroundPhoto&&(encoded.sceneChanged===false||semanticEmpty||strongSemanticEmpty);
    if(req.body.cameraTriggered===true&&sameBackground)return res.json({requiresConfirmation:true,scoreType:'cosine_similarity_not_probability',mode:encoded.localization,detector:{name:encoded.detector,detections:encoded.detections},noMatch:true,noMatchReason:'aligned_empty_background',bestSimilarity:0,minimumSimilarity:minimum,backgroundSimilarity:encoded.backgroundSimilarity??1,foregroundRatio:encoded.foregroundRatio??0,largestForegroundRatio:encoded.largestForegroundRatio??0,backgroundAligned:Boolean(encoded.backgroundAligned)});
    const makeCandidates=async embedding=>{
    const queryEmbeddings=Array.isArray(embedding?.[0])?embedding:[embedding];
    if(!queryEmbeddings.length||queryEmbeddings.length>3||queryEmbeddings.some(value=>!validEmbedding(value)))throw bad('AI returned an invalid image embedding.',503);
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
    const common={requiresConfirmation:true,scoreType:'cosine_similarity_not_probability',mode:encoded.localization,detector:{name:encoded.detector,detections:encoded.detections},backgroundSimilarity:encoded.backgroundSimilarity,foregroundRatio:encoded.foregroundRatio,largestForegroundRatio:encoded.largestForegroundRatio,skippedEdgeRegions:Number(encoded.skippedEdgeRegions)||0,notice:'Confirm each detected item and exact pack size. Overlapping or hidden items may be missed; similarity is not a confidence percentage.'};
    if(mode==='multiple'){
      if(!Array.isArray(encoded.regions)||encoded.regions.length>10)throw bad('AI returned invalid product regions.',503);
      if(req.body.cameraTriggered===true&&encoded.regions.length===0&&!encoded.skippedEdgeRegions)return res.json({...common,noMatch:true,noMatchReason:'aligned_empty_background',foregroundRatio:encoded.foregroundRatio??0,largestForegroundRatio:encoded.largestForegroundRatio??0,backgroundAligned:Boolean(encoded.backgroundAligned)});
      const candidates=await Promise.all(encoded.regions.map(region=>makeCandidates(region.embedding)));
      const items=[];
      for(let i=0;i<candidates.length;i++)items.push({...await savePrediction(candidates[i]),box:encoded.regions[i].box,photo:encoded.regions[i].photo});
      return res.json({...common,items,imageSize:encoded.imageSize});
    }
    const candidates=await makeCandidates(encoded.embeddings||encoded.embedding);
    if(!candidates[0]||candidates[0].similarity<minimum)return res.json({...common,noMatch:true,noMatchReason:'weak_product_match',bestSimilarity:candidates[0]?.similarity||0,minimumSimilarity:minimum,foregroundRatio:encoded.foregroundRatio??0});
    res.json({...common,...await savePrediction(candidates)});
  });
  router.post('/confirm',async(req,res)=>{
    if(req.user.role!=='cashier')throw bad('Cashier access required.',403);
    const {recognitionId,productId}=req.body,quantity=Number(req.body.quantity??1);
    if(!mongoose.isValidObjectId(recognitionId)||!mongoose.isValidObjectId(productId))throw bad('Choose a current product suggestion.');
    if(!Number.isSafeInteger(quantity)||quantity<1||quantity>99)throw bad('Choose a quantity between 1 and 99.');
    const pending=await Prediction.findOne({_id:recognitionId,user:req.user.id,storeId:req.user.selectedStore,status:'pending',expiresAt:{$gt:new Date()},candidates:productId});
    if(!pending)throw bad('This suggestion expired, was already confirmed, or belongs to another store. Scan again.',409);
    if(!await Store.exists({_id:req.user.selectedStore,active:true}))throw bad('Select an active store.');
    const found=await Product.findOne({_id:productId,verified:true});if(!found)throw bad('Product is no longer available.',404);
    const [product]=await branchProducts([found],req.user.selectedStore);if(product.stock<quantity)throw bad(quantity===1?'This product is out of stock in your store.':'Your store does not have enough stock for that quantity.');
    const accepted=await Prediction.findOneAndUpdate({_id:pending._id,status:'pending'},{$set:{status:'confirmed'}},{new:true});
    if(!accepted)throw bad('Suggestion already confirmed. Scan again for another unit.',409);
    await Scan.create({barcode:product.barcode,format:'AI',verified:true,user:req.user.id,userName:req.user.name,storeId:req.user.selectedStore,productName:product.name});
    res.json({product,quantity,format:'AI',verified:true});
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

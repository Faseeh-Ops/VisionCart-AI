import {accountControlsRouter} from './account-controls.js';
import {aiRecognitionRouter} from './ai-recognition.js';
import {aiAvailability,warmAiRuntime} from './ai-runtime.js';
import {invoiceSearchRouter} from './invoice-search.js';
import {storeReportsRouter} from './store-reports.js';
import 'dotenv/config';
import express from 'express';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {calculateInvoice} from './billing.js';
import {starterProducts} from '../shared/catalog.js';
import {dateRange,reportPage} from './reports.js';
import {validatePhoto} from './profile-photo.js';
import {rtspRouter} from './rtsp.js';
const app=express(); app.use(express.json({limit:'800kb'}));
const DEFAULT_STORE_ID='000000000000000000000001';
const Store=mongoose.model('Store',new mongoose.Schema({name:{type:String,required:true,trim:true,maxLength:100},location:{type:String,required:true,trim:true,maxLength:150},code:{type:String,unique:true,required:true},active:{type:Boolean,default:true},cardPaymentsEnabled:{type:Boolean,default:true}},{timestamps:true}));
const User=mongoose.model('User',new mongoose.Schema({name:String,email:{type:String,unique:true},password:String,active:{type:Boolean,default:true},mustChangePassword:{type:Boolean,default:false},tokenVersion:{type:Number,default:0},photo:{type:String,default:null},selectedStore:{type:mongoose.Schema.Types.ObjectId,ref:'Store',default:DEFAULT_STORE_ID},role:{type:String,enum:['admin','cashier'],default:'cashier'},createdBy:{type:mongoose.Schema.Types.ObjectId,ref:'User'}}));
const Product=mongoose.model('Product',new mongoose.Schema({name:{type:String,required:true},barcode:{type:String,unique:true,required:true},price:{type:Number,min:0,required:true},stock:{type:Number,min:0,default:0},category:String,emoji:String,barcodeKind:String,catalogImportKey:String,retailImportedAt:Date,retailSources:[{listingId:String,store:String,url:String,currency:String,regularPrice:Number,scrapedAt:Date}],discountPercent:{type:Number,min:0,max:100,default:0},verified:{type:Boolean,default:true}}));
// Product details are shared; quantities belong exclusively to a branch.
const inventorySchema=new mongoose.Schema({storeId:{type:mongoose.Schema.Types.ObjectId,ref:'Store',required:true},productId:{type:mongoose.Schema.Types.ObjectId,ref:'Product',required:true},stock:{type:Number,min:0,required:true},discountPercent:{type:Number,min:0,max:100,default:null}},{timestamps:true});
inventorySchema.index({storeId:1,productId:1},{unique:true});
const StoreInventory=mongoose.model('StoreInventory',inventorySchema);
const inventoryStore=async req=>{const id=req.user.role==='admin'?(req.body?.storeId||req.query.storeId||DEFAULT_STORE_ID):req.user.selectedStore;if(!mongoose.isValidObjectId(id))throw Error('Choose a valid inventory store.');const store=await Store.findById(id);if(!store)throw Error('Inventory store not found.');return store;};
const branchProducts=async(products,storeId,session=null)=>{const rows=await StoreInventory.find({storeId,productId:{$in:products.map(p=>p._id)}}).session(session).lean(),inventory=new Map(rows.map(row=>[String(row.productId),row]));return products.map(p=>{const row=inventory.get(String(p._id)),plain=typeof p.toObject==='function'?p.toObject():p,globalDiscountPercent=plain.discountPercent??0,hasStoreDiscount=Number.isFinite(row?.discountPercent);return {...plain,stock:row?.stock||0,storeId:String(storeId),globalDiscountPercent,storeDiscountPercent:hasStoreDiscount?row.discountPercent:null,discountPercent:hasStoreDiscount?row.discountPercent:globalDiscountPercent,discountScope:hasStoreDiscount?'store':'all'};});};
const Invoice=mongoose.model('Invoice',new mongoose.Schema({number:{type:String,unique:true},items:Array,total:Number,payment:String,cashier:String,cashierName:String,cashierEmail:String,storeId:String,storeName:String,storeLocation:String,subtotal:Number,discountTotal:Number},{timestamps:true}));
const Scan=mongoose.model('Scan',new mongoose.Schema({barcode:String,format:{type:String,default:'MANUAL'},verified:Boolean,user:String,userName:String,storeId:String,productName:String},{timestamps:true}));
const Setup=mongoose.model('Setup',new mongoose.Schema({_id:String}));
const StockMovement=mongoose.model('StockMovement',new mongoose.Schema({requestId:{type:String,unique:true},productId:{type:mongoose.Schema.Types.ObjectId,ref:'Product'},quantity:Number,storeId:String,admin:String,productName:String,barcode:String},{timestamps:true}));
const StockTransfer=mongoose.model('StockTransfer',new mongoose.Schema({requestId:{type:String,required:true,unique:true},productId:{type:mongoose.Schema.Types.ObjectId,ref:'Product',required:true},productName:String,barcode:String,fromStoreId:{type:String,required:true},fromStoreName:String,toStoreId:{type:String,required:true},toStoreName:String,quantity:{type:Number,min:1,required:true},admin:String,adminName:String},{timestamps:true}));
const AuthLog=mongoose.model('AuthLog',new mongoose.Schema({user:String,name:String,email:String,role:String,action:String,result:String,ip:String,userAgent:String,storeId:String,performedBy:String,performedByName:String},{timestamps:true}));
const StoreEvent=mongoose.model('StoreEvent',new mongoose.Schema({storeId:String,actorId:String,actorName:String,action:String,productId:mongoose.Schema.Types.ObjectId,product:String,barcode:String,quantity:Number,details:String},{timestamps:true}));
const resetSchema=new mongoose.Schema({user:{type:mongoose.Schema.Types.ObjectId,ref:'User',required:true},name:String,email:String,status:{type:String,enum:['pending','resolved'],default:'pending'},resolvedBy:String,resolvedAt:Date},{timestamps:true});
resetSchema.index({user:1},{unique:true,partialFilterExpression:{status:'pending'}});
const PasswordResetRequest=mongoose.model('PasswordResetRequest',resetSchema);
const resetRequestLimits=new Map();
const logAuth=(req,user,action,result)=>AuthLog.create({user:user?.id,name:user?.name,email:user?.email||String(req.body.email||'').trim().toLowerCase().slice(0,254),role:user?.role,action,result,storeId:user?.selectedStore?String(user.selectedStore):undefined,ip:req.socket.remoteAddress,userAgent:String(req.headers['user-agent']||'').slice(0,300)});
const publicUser=async user=>({name:user.name,email:user.email,role:user.role,active:user.active!==false,mustChangePassword:Boolean(user.mustChangePassword),photo:user.photo||null,selectedStore:await Store.findById(user.selectedStore||DEFAULT_STORE_ID).select('name location active cardPaymentsEnabled')});
const authResponse=async user=>({token:jwt.sign({id:user.id,role:user.role,version:user.tokenVersion||0},process.env.JWT_SECRET,{expiresIn:'8h'}),user:await publicUser(user)});
let inventoryReady=false;
const ready=(req,res,next)=>inventoryReady&&mongoose.connection.readyState===1?next():res.status(503).json({error:'MongoDB is unavailable. Configure MONGODB_URI and restart the server.'});
app.get('/api/health',(req,res)=>res.status(inventoryReady?200:503).json({database:inventoryReady&&mongoose.connection.readyState===1?'connected':'initializing',ai:aiAvailability().loaded?'ready':'warming'}));
app.use('/api',ready);
// Initial setup is permanently closed. All further admins require an admin session.
app.get('/api/auth/setup-status',(req,res)=>res.json({needsAdmin:false}));
app.post('/api/auth/setup',(req,res)=>res.status(403).json({error:'Administrator self-registration is disabled. Ask a signed-in administrator to create your account.'}));
const validPassword=password=>typeof password==='string'&&password.length>=8&&Buffer.byteLength(password,'utf8')<=72;
const validAccount=({name,email,password}={})=>typeof name==='string'&&name.trim().length>0&&typeof email==='string'&&/^\S+@\S+\.\S+$/.test(email.trim())&&validPassword(password);
app.post('/api/auth/register',(req,res)=>res.status(403).json({error:'Public signup is disabled. Ask an administrator to create your account.'}));
app.post('/api/auth/password-reset-request',async(req,res)=>{
 const email=typeof req.body.email==='string'?req.body.email.trim().toLowerCase():'';
 if(!/^\S+@\S+\.\S+$/.test(email)||email.length>254)return res.status(400).json({error:'Enter a valid email address.'});
 const now=Date.now(),key=req.socket.remoteAddress;
 for(const [ip,entry] of resetRequestLimits)if(entry.until<now)resetRequestLimits.delete(ip);
 const limit=resetRequestLimits.get(key)||{count:0,until:now+15*60000};
 if(limit.count>=10)return res.status(429).json({error:'Too many requests. Please try again later.'});
 limit.count++;resetRequestLimits.set(key,limit);
 const user=await User.findOne({email,role:'cashier',active:{$ne:false}}).select('name email');
 if(user){try{await PasswordResetRequest.updateOne({user:user._id,status:'pending'},{$setOnInsert:{user:user._id,name:user.name,email:user.email,status:'pending'}},{upsert:true});}catch(error){if(error.code!==11000)throw error;}}
 res.status(202).json({message:'If this email belongs to a cashier account, a password reset request has been submitted for administrator review.'});
});
app.post('/api/auth/login',async(req,res)=>{const user=await User.findOne({email:String(req.body.email).toLowerCase().trim()});if(!user||!await bcrypt.compare(String(req.body.password),user.password)){await logAuth(req,user,'login','failed');return res.status(401).json({error:'Invalid email or password.'});}if(user.active===false){await logAuth(req,user,'login','inactive');return res.status(403).json({error:'Your account is inactive. Contact your administrator.',code:'ACCOUNT_INACTIVE'});}if(req.body.role&&req.body.role!==user.role){await logAuth(req,user,'login','role-mismatch');return res.status(403).json({error:`This account is a ${user.role} account. Select the matching sign-in tab.`});}await logAuth(req,user,'login','success');res.json(await authResponse(user));});
app.use('/api',async(req,res,next)=>{let claims;try{claims=jwt.verify(req.headers.authorization?.replace('Bearer ',''),process.env.JWT_SECRET);}catch{return res.status(401).json({error:'Please sign in.'});}if(!mongoose.isValidObjectId(claims.id))return res.status(401).json({error:'Please sign in.'});const user=await User.findById(claims.id).select('role name email selectedStore mustChangePassword tokenVersion active');if(user?.active===false)return res.status(401).json({error:'Your account is inactive. Contact your administrator.',code:'ACCOUNT_INACTIVE'});if(!user||(claims.version||0)!==(user.tokenVersion||0))return res.status(401).json({error:'Please sign in.'});if(user.mustChangePassword&&!['/api/auth/change-password','/api/auth/logout','/api/profile'].includes(req.originalUrl.split('?')[0]))return res.status(403).json({error:'Change your temporary password before using the app.',code:'PASSWORD_CHANGE_REQUIRED'});req.user={id:user.id,role:user.role,name:user.name,email:user.email,selectedStore:String(user.selectedStore||DEFAULT_STORE_ID)};next();});
app.get('/api/admin/password-resets',async(req,res)=>{
 if(req.user.role!=='admin')return res.status(403).json({error:'Admin access required.'});
 res.json(await PasswordResetRequest.find({status:'pending'}).select('name email createdAt').sort({createdAt:1}).limit(200));
});
app.post('/api/admin/password-resets/:id/resolve',async(req,res)=>{
 if(req.user.role!=='admin')return res.status(403).json({error:'Admin access required.'});
 if(!mongoose.isValidObjectId(req.params.id)||!validPassword(req.body.temporaryPassword))return res.status(400).json({error:'Enter a valid request and a temporary password of at least 8 characters, up to 72 UTF-8 bytes.'});
 const session=await mongoose.startSession();
 try{await session.withTransaction(async()=>{
  const request=await PasswordResetRequest.findOne({_id:req.params.id,status:'pending'}).session(session);
  if(!request){const error=Error('This request was already resolved or is unavailable.');error.status=409;throw error;}
  const user=await User.findOne({_id:request.user,role:'cashier'}).session(session);
  if(!user)throw Error('Cashier account not found.');
  if(await bcrypt.compare(req.body.temporaryPassword,user.password))throw Error('Choose a temporary password different from the current password.');
  user.password=await bcrypt.hash(req.body.temporaryPassword,12);user.mustChangePassword=true;user.tokenVersion=(user.tokenVersion||0)+1;await user.save({session});
  request.status='resolved';request.resolvedBy=req.user.id;request.resolvedAt=new Date();await request.save({session});
  await AuthLog.create([{user:user.id,name:user.name,email:user.email,role:user.role,action:'password-reset',result:'success',performedBy:req.user.id,performedByName:req.user.name,storeId:String(user.selectedStore||DEFAULT_STORE_ID),ip:req.socket.remoteAddress,userAgent:String(req.headers['user-agent']||'').slice(0,300)}],{session});
 });res.json({success:true,message:'Temporary password assigned. Share it with the cashier privately.'});}finally{await session.endSession();}
});
app.use('/api/users',accountControlsRouter({User,AuthLog,StoreEvent,PasswordResetRequest,validPassword}));
app.use('/api/cameras/rtsp',rtspRouter());
app.use('/api/ai',aiRecognitionRouter({Product,Store,Scan,branchProducts}));
app.post('/api/auth/change-password',async(req,res)=>{
 const {currentPassword,newPassword}=req.body;
 if(typeof currentPassword!=='string'||!validPassword(newPassword))return res.status(400).json({error:'Use at least 8 characters and at most 72 UTF-8 bytes for your new password.'});
 const user=await User.findById(req.user.id);
 if(!await bcrypt.compare(currentPassword,user.password))return res.status(400).json({error:'Temporary/current password is incorrect.'});
 if(await bcrypt.compare(newPassword,user.password))return res.status(400).json({error:'Choose a different password from your temporary password.'});
 const updated=await User.findOneAndUpdate({_id:user._id,password:user.password},{$set:{password:await bcrypt.hash(newPassword,12),mustChangePassword:false},$inc:{tokenVersion:1}},{new:true});
 if(!updated)return res.status(409).json({error:'Password already changed. Sign in again.'});
 await logAuth(req,updated,'password-change','success');res.json(await authResponse(updated));
});
app.post('/api/users/cashiers',async(req,res)=>{
 if(req.user.role!=='admin')return res.status(403).json({error:'Only administrators can create cashier accounts.'});
 if(!validAccount(req.body))return res.status(400).json({error:'Enter a name, valid email and temporary password between 8 and 72 characters.'});
 const {name,email,password}=req.body;
 const user=await User.create({name:name.trim(),email:email.trim().toLowerCase(),password:await bcrypt.hash(password,12),role:'cashier',createdBy:req.user.id,mustChangePassword:true});
 res.status(201).json({_id:user.id,...await publicUser(user)});
});
app.post('/api/auth/logout',async(req,res)=>{await logAuth(req,req.user,'logout','success');res.json({success:true});});
app.get('/api/profile',async(req,res)=>res.json(await publicUser(await User.findById(req.user.id))));
app.post('/api/profile/photo',async(req,res)=>{const photo=validatePhoto(req.body.photo);const user=await User.findByIdAndUpdate(req.user.id,{photo},{new:true});res.json(await publicUser(user));});
app.post('/api/users/:id/photo',async(req,res)=>{if(req.user.role!=='admin')return res.status(403).json({error:'Admin access required.'});const photo=validatePhoto(req.body.photo);const user=await User.findOneAndUpdate({_id:req.params.id,role:'cashier'},{photo},{new:true});if(!user)return res.status(404).json({error:'Cashier account not found.'});res.json({_id:user.id,...await publicUser(user)});});
app.get('/api/stores',async(req,res)=>res.json(await Store.find(req.user.role==='admin'?{}:{active:true}).sort({createdAt:1,_id:1})));
app.post('/api/stores/:id/status',async(req,res)=>{if(req.user.role!=='admin')return res.status(403).json({error:'Only administrators can change store status.'});if(!mongoose.isValidObjectId(req.params.id)||typeof req.body.active!=='boolean')return res.status(400).json({error:'Supply a valid store and an active/inactive status.'});const store=await Store.findByIdAndUpdate(req.params.id,{active:req.body.active},{new:true});if(!store)return res.status(404).json({error:'Store not found.'});res.json(store);});
app.post('/api/stores',async(req,res)=>{if(req.user.role!=='admin')return res.status(403).json({error:'Only administrators can add stores.'});const {name,location}=req.body;if(typeof name!=='string'||!name.trim()||name.trim().length>100||typeof location!=='string'||!location.trim()||location.trim().length>150)return res.status(400).json({error:'Enter a store name and location.'});res.status(201).json(await Store.create({name:name.trim(),location:location.trim(),code:randomUUID()}));});
app.post('/api/profile/store',async(req,res)=>{if(req.user.role!=='cashier')return res.status(403).json({error:'Store selection is available to cashiers.'});if(typeof req.body.storeId!=='string'||!mongoose.isValidObjectId(req.body.storeId))return res.status(400).json({error:'Choose a valid store.'});const store=await Store.findOne({_id:req.body.storeId,active:true});if(!store)return res.status(404).json({error:'Store not found or unavailable.'});const session=await mongoose.startSession();let user;try{await session.withTransaction(async()=>{user=await User.findById(req.user.id).session(session);const oldStore=String(user.selectedStore||DEFAULT_STORE_ID);user.selectedStore=store._id;await user.save({session});if(oldStore!==store.id){await StoreEvent.create([{storeId:store.id,actorId:user.id,actorName:user.name,action:'Store selected',details:'Working store changed to '+store.name},{storeId:oldStore,actorId:user.id,actorName:user.name,action:'Store left',details:'Working store changed to '+store.name}],{session,ordered:true});}});res.json(await publicUser(user));}finally{await session.endSession();}});
app.post('/api/profile/store-payment',async(req,res)=>{
 if(req.user.role!=='cashier')return res.status(403).json({error:'Store payment settings are available to cashiers.'});
 if(typeof req.body.enabled!=='boolean')return res.status(400).json({error:'Choose whether card payments are enabled.'});
 const store=await Store.findOneAndUpdate({_id:req.user.selectedStore,active:true},{cardPaymentsEnabled:req.body.enabled},{new:true});
 if(!store)return res.status(404).json({error:'Select an active working store before changing payment settings.'});
 await StoreEvent.create({storeId:store.id,actorId:req.user.id,actorName:req.user.name,action:'Card payments '+(req.body.enabled?'enabled':'disabled'),details:`${req.user.name} ${req.body.enabled?'enabled':'disabled'} card payments for ${store.name}`});
 res.json(await publicUser(await User.findById(req.user.id)));
});
app.get('/api/products',async(req,res)=>{const store=await inventoryStore(req),fields='name barcode price category emoji discountPercent verified';const query=Product.find().select(fields).sort({name:1}).lean();if(req.user.role==='admin')query.select('+retailSources').slice('retailSources',1);res.json(await branchProducts(await query,store._id));});
app.get('/api/inventory/lookup',async(req,res)=>{if(req.user.role!=='admin')return res.status(403).json({error:'Admin access required.'});const barcode=String(req.query.barcode||'').trim();if(!barcode||barcode.length>128)return res.status(400).json({error:'Enter a valid barcode.'});const store=await inventoryStore(req),product=await Product.findOne({barcode});res.json({product:product?(await branchProducts([product],store._id))[0]:null});});
app.get('/api/inventory/snapshot',async(req,res)=>{const store=await inventoryStore(req),rows=await StoreInventory.find({storeId:store._id}).select('productId stock discountPercent').lean();res.json({storeId:store.id,items:rows.map(row=>[String(row.productId),row.stock,Number.isFinite(row.discountPercent)?row.discountPercent:null])});});
app.post('/api/inventory/restock',async(req,res)=>{
  if(req.user.role!=='admin')return res.status(403).json({error:'Admin access required.'});
  const {quantity,requestId}=req.body,barcode=String(req.body.barcode||'').trim();
  if(!barcode||barcode.length>128||!Number.isSafeInteger(quantity)||quantity<1||quantity>100000||typeof requestId!=='string'||!/^[-a-zA-Z0-9]{10,80}$/.test(requestId))return res.status(400).json({error:'Enter a valid barcode and stock quantity between 1 and 100,000.'});
  const store=await inventoryStore(req);if(!store.active)return res.status(400).json({error:'Activate this store before adding stock.'});const session=await mongoose.startSession();let product;
  try{await session.withTransaction(async()=>{const previous=await StockMovement.findOne({requestId}).session(session);if(previous){if(previous.admin!==req.user.id||previous.quantity!==quantity||String(previous.storeId||DEFAULT_STORE_ID)!==store.id)throw Error('Stock request already used. Scan again.');product=await Product.findOne({_id:previous.productId,barcode}).session(session);if(!product)throw Error('Stock request does not match this product.');return;}
    product=await Product.findOne({barcode,verified:true}).session(session);
    if(!product)throw Error('Register this barcode as a product before adding stock.');
    await StoreInventory.updateOne({storeId:store._id,productId:product._id},{$inc:{stock:quantity}},{upsert:true,session,runValidators:true});
    await StockMovement.create([{requestId,productId:product._id,quantity,storeId:store.id,admin:req.user.id,productName:product.name,barcode:product.barcode}],{session});
  });res.json({product:(await branchProducts([product],store._id))[0]});}finally{await session.endSession();}
});
app.get('/api/inventory/transfers',async(req,res)=>{
 if(req.user.role!=='admin')return res.status(403).json({error:'Admin access required.'});
 res.json(await StockTransfer.find().sort({createdAt:-1,_id:-1}).limit(50));
});
app.get('/api/inventory/transfer-products',async(req,res)=>{
 if(req.user.role!=='admin')return res.status(403).json({error:'Admin access required.'});
 const store=await inventoryStore(req),search=String(req.query.search||'').trim().slice(0,100),filter={storeId:store._id,stock:{$gt:0}};
 const inventory=await StoreInventory.find(filter).select('productId stock').sort({updatedAt:-1}).limit(search?500:50).lean();
 if(!inventory.length)return res.json([]);
 const ids=inventory.map(row=>row.productId),productFilter={_id:{$in:ids},verified:true};
 if(search){const escaped=search.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');productFilter.$or=[{name:new RegExp(escaped,'i')},{barcode:new RegExp(escaped,'i')}];}
 const products=await Product.find(productFilter).select('name barcode').sort({name:1}).limit(50).lean(),stock=new Map(inventory.map(row=>[String(row.productId),row.stock]));
 res.json(products.map(product=>({...product,stock:stock.get(String(product._id))||0})));
});
app.get('/api/inventory/transfer-stock',async(req,res)=>{
 if(req.user.role!=='admin')return res.status(403).json({error:'Admin access required.'});
 const store=await inventoryStore(req),productId=String(req.query.productId||'');if(!mongoose.isValidObjectId(productId))return res.status(400).json({error:'Choose a valid product.'});
 const row=await StoreInventory.findOne({storeId:store._id,productId}).select('stock').lean();res.json({stock:row?.stock||0});
});
app.post('/api/inventory/transfers',async(req,res)=>{
 if(req.user.role!=='admin')return res.status(403).json({error:'Only administrators can allocate stock between stores.'});
 const {productId,fromStoreId,toStoreId,quantity,requestId}=req.body;
 if(![productId,fromStoreId,toStoreId].every(id=>typeof id==='string'&&mongoose.isValidObjectId(id))||fromStoreId===toStoreId||!Number.isSafeInteger(quantity)||quantity<1||quantity>100000||typeof requestId!=='string'||!/^[-a-zA-Z0-9]{10,80}$/.test(requestId))return res.status(400).json({error:'Choose a product, two different stores and a whole quantity between 1 and 100,000.'});
 const session=await mongoose.startSession();let transfer;
 try{await session.withTransaction(async()=>{
  const previous=await StockTransfer.findOne({requestId}).session(session);
  if(previous){if(previous.admin!==req.user.id||String(previous.productId)!==productId||previous.fromStoreId!==fromStoreId||previous.toStoreId!==toStoreId||previous.quantity!==quantity)throw Error('This transfer request was already used for a different allocation.');transfer=previous;return;}
  const from=await Store.findOne({_id:fromStoreId,active:true}).session(session),to=await Store.findOne({_id:toStoreId,active:true}).session(session);
  if(!from||!to)throw Error('Both source and destination stores must be active.');
  const product=await Product.findOne({_id:productId,verified:true}).session(session);if(!product)throw Error('Choose a verified product.');
  const deducted=await StoreInventory.updateOne({storeId:fromStoreId,productId,stock:{$gte:quantity}},{$inc:{stock:-quantity}},{session});
  if(!deducted.modifiedCount)throw Error('Insufficient stock in the source store. Refresh quantities and try again.');
  await StoreInventory.updateOne({storeId:toStoreId,productId},{$inc:{stock:quantity}},{upsert:true,session,runValidators:true});
  [transfer]=await StockTransfer.create([{requestId,productId,productName:product.name,barcode:product.barcode,fromStoreId,fromStoreName:from.name,toStoreId,toStoreName:to.name,quantity,admin:req.user.id,adminName:req.user.name}],{session});
 });const balances=await StoreInventory.find({storeId:{$in:[fromStoreId,toStoreId]},productId}).select('storeId stock').lean(),stockByStore=new Map(balances.map(row=>[String(row.storeId),row.stock]));res.json({transfer,fromStock:stockByStore.get(fromStoreId)||0,toStock:stockByStore.get(toStoreId)||0});}finally{await session.endSession();}
});
app.get('/api/users',async(req,res)=>{if(req.user.role!=='admin')return res.status(403).json({error:'Admin access required.'});res.json(await User.find().select('name email role photo active mustChangePassword').sort({name:1}));});
app.post('/api/users/admins',async(req,res)=>{if(req.user.role!=='admin')return res.status(403).json({error:'Only administrators can create administrator accounts.'});if(!validAccount(req.body))return res.status(400).json({error:'Enter a name, valid email and password of at least 8 characters, up to 72 UTF-8 bytes.'});const {name,email,password}=req.body;const user=await User.create({name:name.trim(),email:email.toLowerCase().trim(),password:await bcrypt.hash(password,12),role:'admin',createdBy:req.user.id});res.status(201).json({_id:user.id,name:user.name,email:user.email,role:user.role});});
const saveProduct=async(req,res)=>{
 if(req.user.role!=='admin')return res.status(403).json({error:'Admin access required.'});
 const {name,barcode,price,stock,category,emoji,discountPercent=0}=req.body,discountScope=req.body.discountScope??'all';
 if(typeof name!=='string'||!name.trim()||typeof barcode!=='string'||!barcode.trim()||barcode.trim().length>128||!Number.isFinite(price)||price<0||!Number.isSafeInteger(stock)||stock<0||!Number.isFinite(discountPercent)||discountPercent<0||discountPercent>100||!['all','store'].includes(discountScope))return res.status(400).json({error:'Enter a product name, barcode, valid price, whole stock quantity, discount from 0 to 100 and discount scope.'});
 const store=await inventoryStore(req);if(!store.active)return res.status(400).json({error:'Activate this store before editing inventory.'});
 const session=await mongoose.startSession();let product;
 try{await session.withTransaction(async()=>{
 const details={name:name.trim(),barcode:barcode.trim(),price,category,emoji};
 const before=await StoreInventory.findOne({storeId:store._id,productId:req.params.id||null}).session(session);
 const previousProduct=req.params.id?await Product.findById(req.params.id).session(session):null;
 if(req.params.id){product=await Product.findByIdAndUpdate(req.params.id,{...details,...(discountScope==='all'?{discountPercent}:{})},{new:true,runValidators:true,session});if(!product)throw Error('Product not found.');}
 else [product]=await Product.create([{...details,discountPercent:discountScope==='all'?discountPercent:0,stock:0,verified:true}],{session});
 if(discountScope==='all')await StoreInventory.updateMany({productId:product._id},{$unset:{discountPercent:1}},{session,runValidators:true});
 await StoreInventory.updateOne({storeId:store._id,productId:product._id},discountScope==='store'?{$set:{stock,discountPercent}}:{$set:{stock},$unset:{discountPercent:1}},{upsert:true,session,runValidators:true});
 const previousEffectiveDiscount=Number.isFinite(before?.discountPercent)?before.discountPercent:(previousProduct?.discountPercent||0);
 await StoreEvent.create([{storeId:store.id,actorId:req.user.id,actorName:req.user.name,action:req.params.id?'Product / stock updated':'Product registered',productId:product._id,product:product.name,barcode:product.barcode,quantity:stock-(before?.stock||0),details:`Stock: ${before?.stock||0} to ${stock}; shared price (Rs): ${previousProduct?.price??price} to ${price}; ${discountScope==='all'?'all-store':'store-only'} discount: ${previousEffectiveDiscount}% to ${discountPercent}%`}],{session});
 });res.json((await branchProducts([product],store._id))[0]);}finally{await session.endSession();}
};
app.post('/api/products/:id',saveProduct);
app.post('/api/products',saveProduct);
app.post('/api/products/:id/discount',async(req,res)=>{
 if(req.user.role!=='admin')return res.status(403).json({error:'Only administrators can manage discounts.'});
 const discountPercent=req.body.discountPercent,storeId=String(req.body.storeId||'');
 if(!mongoose.isValidObjectId(req.params.id)||!Number.isFinite(discountPercent)||discountPercent<0||discountPercent>100||!(storeId==='all'||mongoose.isValidObjectId(storeId)))return res.status(400).json({error:'Choose a product, a discount from 0 to 100%, and either All stores or a valid store.'});
 const session=await mongoose.startSession();let product,store;
 try{await session.withTransaction(async()=>{
  product=await Product.findOne({_id:req.params.id,verified:true}).session(session);if(!product)throw Error('Verified product not found.');
  if(storeId==='all'){
   const previous=product.discountPercent||0;product.discountPercent=discountPercent;await product.save({session});
   await StoreInventory.updateMany({productId:product._id},{$unset:{discountPercent:1}},{session,runValidators:true});
   const stores=await Store.find().select('_id').session(session);
   if(stores.length)await StoreEvent.insertMany(stores.map(item=>({storeId:item.id,actorId:req.user.id,actorName:req.user.name,action:'Company-wide discount updated',productId:product._id,product:product.name,barcode:product.barcode,details:`Company-wide discount: ${previous}% to ${discountPercent}%; branch overrides cleared`})),{session});
  }else{
   store=await Store.findById(storeId).session(session);if(!store)throw Error('Store not found.');
   const previous=await StoreInventory.findOne({storeId,productId:product._id}).select('discountPercent').session(session);
   await StoreInventory.updateOne({storeId,productId:product._id},{$set:{discountPercent},$setOnInsert:{stock:0}},{upsert:true,session,runValidators:true});
   await StoreEvent.create([{storeId,actorId:req.user.id,actorName:req.user.name,action:'Store discount updated',productId:product._id,product:product.name,barcode:product.barcode,details:`Store discount: ${Number.isFinite(previous?.discountPercent)?previous.discountPercent:product.discountPercent||0}% to ${discountPercent}%`}],{session});
  }
 });
 const resultStore=storeId==='all'?DEFAULT_STORE_ID:storeId;
 res.json({target:storeId==='all'?'all':'store',store:store?{_id:store.id,name:store.name}:null,product:(await branchProducts([product],resultStore))[0]});
 }finally{await session.endSession();}
});
app.post('/api/scans',async(req,res)=>{if(req.user.role!=='cashier')return res.status(403).json({error:'Only cashiers can scan products for sales.'});const barcode=String(req.body.barcode||'').trim();if(!barcode||barcode.length>128)return res.status(400).json({error:'Invalid barcode.'});const formats=['QR_CODE','EAN_13','EAN_8','UPC_A','UPC_E','CODE_128','CODE_39','ITF','MANUAL','USB_SCANNER'];const format=formats.includes(req.body.format)?req.body.format:'MANUAL';const store=await inventoryStore(req);if(!store.active)throw Error('Select an active store before scanning.');const found=await Product.findOne({barcode});const product=found?(await branchProducts([found],store._id))[0]:null;await Scan.create({barcode,format,verified:!!product?.verified,user:req.user.id,userName:req.user.name,storeId:store.id,productName:product?.name});res.json({product,format,verified:!!product?.verified});});
app.get('/api/scans',async(req,res)=>res.json(await Scan.find({verified:false,...(req.user.role==='cashier'?{user:req.user.id}:{})}).sort({createdAt:-1}).limit(500)));
app.use('/api/invoices',invoiceSearchRouter(Invoice));
app.get('/api/invoices',async(req,res)=>res.json(await Invoice.find(req.user.role==='cashier'?{cashier:req.user.id}:{}).sort({createdAt:-1}).limit(100)));
app.post('/api/invoices',async(req,res)=>{if(req.user.role!=='cashier')return res.status(403).json({error:'Only cashiers can generate sales invoices.'});if(req.body.storeId&&req.body.storeId!==req.user.selectedStore)return res.status(409).json({error:'Working store changed. Refresh your bill before checkout.'});if(!Array.isArray(req.body.items)||!req.body.items.length||req.body.items.length>200||req.body.items.some(item=>!item||typeof item.productId!=='string'||!mongoose.isValidObjectId(item.productId)||!Number.isSafeInteger(item.quantity)||item.quantity<1||item.quantity>10000))return res.status(400).json({error:'Supply valid product IDs and whole quantities between 1 and 10,000.'});const session=await mongoose.startSession();try{let invoice;await session.withTransaction(async()=>{const store=await Store.findOne({_id:req.user.selectedStore,active:true}).session(session);if(!store)throw Error('Select an available store in your profile before creating an invoice.');if(req.body.payment==='Card'&&store.cardPaymentsEnabled===false)throw Error('Card payments are disabled for this store. Choose Cash to continue.');const products=await branchProducts(await Product.find({_id:{$in:req.body.items.map(i=>i.productId)}}).session(session),store._id,session);const items=calculateInvoice(req.body.items,products);for(const item of items){const result=await StoreInventory.updateOne({storeId:store._id,productId:item.productId,stock:{$gte:item.quantity}},{$inc:{stock:-item.quantity}},{session});if(!result.modifiedCount)throw new Error('Stock changed. Try again.');}const total=items.reduce((sum,i)=>sum+Math.round(i.total*100),0)/100;[invoice]=await Invoice.create([{number:`ASP-${Date.now()}-${Math.random().toString(36).slice(2,6).toUpperCase()}`,items,total,payment:['Cash','Card'].includes(req.body.payment)?req.body.payment:'Cash',cashier:req.user.id,cashierName:req.user.name,cashierEmail:req.user.email,storeId:store.id,storeName:store.name,storeLocation:store.location,subtotal:items.reduce((s,i)=>s+Math.round(i.originalPrice*100)*i.quantity,0)/100,discountTotal:items.reduce((s,i)=>s+Math.round(i.discountTotal*100),0)/100}],{session});});res.json(invoice);}finally{await session.endSession();}});
app.use('/api/admin/store-reports',storeReportsRouter({Store,Product,StoreInventory,Invoice}));
app.get('/api/admin/login-logs',async(req,res)=>{
  if(req.user.role!=='admin')return res.status(403).json({error:'Admin access required.'});
  const page=reportPage(req.query),filter=dateRange(req.query);
  if(req.query.user)filter.user=String(req.query.user);
  if(req.query.result)filter.result=String(req.query.result);
  const [logs,total]=await Promise.all([AuthLog.find(filter).sort({createdAt:-1,_id:-1}).skip((page-1)*50).limit(50),AuthLog.countDocuments(filter)]);
  res.json({logs,total,page,pages:Math.ceil(total/50)});
});
app.get('/api/admin/sales',async(req,res)=>{
  if(req.user.role!=='admin')return res.status(403).json({error:'Admin access required.'});
  const page=reportPage(req.query),filter=dateRange(req.query);if(req.query.cashier)filter.cashier=String(req.query.cashier);if(req.query.store)filter.storeId=String(req.query.store);
  const rowStages=[{$unwind:'$items'},{$group:{_id:{day:'$day',cashier:'$cashier',product:'$items.productId',store:'$storeId'},storeName:{$first:{$ifNull:['$storeName','Legacy / unassigned store']}},cashierName:{$first:'$reportCashier'},productName:{$first:'$items.name'},barcode:{$first:'$items.barcode'},quantity:{$sum:'$items.quantity'},revenue:{$sum:'$items.total'},discount:{$sum:{$ifNull:['$items.discountTotal',0]}},invoiceIds:{$addToSet:'$_id'}}},{$sort:{'_id.day':-1,cashierName:1,productName:1}}];
  const aggregate=await Invoice.aggregate([
    {$match:filter},
    {$lookup:{from:'users',let:{cashier:'$cashier'},pipeline:[{$match:{$expr:{$eq:[{$toString:'$_id'},'$$cashier']}}},{$project:{name:1,email:1}}],as:'account'}},
    {$addFields:{reportCashier:{$ifNull:['$cashierName',{$ifNull:[{$arrayElemAt:['$account.name',0]},'Legacy / unavailable account']}]},day:{$dateToString:{date:'$createdAt',format:'%Y-%m-%d',timezone:'Asia/Karachi'}}}},
    {$facet:{summary:[{$group:{_id:null,revenue:{$sum:'$total'},invoices:{$sum:1},discount:{$sum:{$ifNull:['$discountTotal',0]}},units:{$sum:{$sum:'$items.quantity'}}}}],
      rows:[...rowStages,{$skip:(page-1)*100},{$limit:100}],count:[...rowStages,{$count:'total'}]}}

  ]);
  const data=aggregate[0],total=data?.count?.[0]?.total||0;
  res.json({summary:data?.summary?.[0]||{revenue:0,invoices:0,units:0,discount:0},rows:data?.rows||[],total,page,pages:Math.ceil(total/100)});
});
app.use('/api',(req,res)=>res.status(404).json({error:'API endpoint not found.'}));
app.use(express.static(path.resolve('dist')));
app.get('/{*path}',(req,res)=>res.sendFile(path.resolve('dist/index.html')));
app.use((err,req,res,next)=>{if(res.headersSent)return next(err);res.status(err.code===11000?409:err.status||400).json({error:err.code===11000?'This email or barcode already exists.':err.message});});
if(!process.env.JWT_SECRET||process.env.JWT_SECRET.length<32){console.error('Set JWT_SECRET to at least 32 characters in .env');process.exit(1);}
mongoose.connect(process.env.MONGODB_URI||'mongodb://127.0.0.1:27017/aspire_billing',{serverSelectionTimeoutMS:5000}).then(async()=>{await Store.updateOne({_id:DEFAULT_STORE_ID},{$setOnInsert:{name:'Aspire Retail Store',location:'Main branch - Karachi',code:'MAIN',active:true,cardPaymentsEnabled:true}},{upsert:true});await Store.updateMany({cardPaymentsEnabled:{$exists:false}},{$set:{cardPaymentsEnabled:true}});const session=await mongoose.startSession();try{await session.withTransaction(async()=>{if(!await Setup.findById('starter-catalog-v1').session(session)){for(const p of starterProducts)await Product.updateOne({barcode:p.barcode},{$setOnInsert:{...p,verified:true}},{upsert:true,session});await Setup.create([{_id:'starter-catalog-v1'}],{session});}});}finally{await session.endSession();}await StoreInventory.init();await StockTransfer.init();await StoreEvent.init();
const migration=await mongoose.startSession();try{await migration.withTransaction(async()=>{
 if(await Setup.findById('store-inventory-v1').session(migration))return;
 const products=await Product.find().session(migration);
 for(const product of products)await StoreInventory.updateOne({storeId:DEFAULT_STORE_ID,productId:product._id},{$setOnInsert:{stock:product.stock||0}},{upsert:true,session:migration});
 await Product.updateMany({},{$set:{stock:0}},{session:migration});
 await Setup.create([{_id:'store-inventory-v1'}],{session:migration});
});}finally{await migration.endSession();}
inventoryReady=true;console.log('MongoDB connected; store inventory ready.');if(process.env.AI_PREWARM!=='0')warmAiRuntime().then(()=>console.log('Local AI ready.')).catch(error=>console.error('AI warm-up:',error.message));}).catch(e=>console.error('MongoDB:',e.message));
app.listen(process.env.PORT||4000,()=>console.log('Aspire billing server: http://localhost:'+(process.env.PORT||4000)));

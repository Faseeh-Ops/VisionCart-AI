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
const app=express(); app.use(express.json({limit:'400kb'}));
const DEFAULT_STORE_ID='000000000000000000000001';
const Store=mongoose.model('Store',new mongoose.Schema({name:{type:String,required:true,trim:true,maxLength:100},location:{type:String,required:true,trim:true,maxLength:150},code:{type:String,unique:true,required:true},active:{type:Boolean,default:true}},{timestamps:true}));
const User=mongoose.model('User',new mongoose.Schema({name:String,email:{type:String,unique:true},password:String,photo:{type:String,default:null},selectedStore:{type:mongoose.Schema.Types.ObjectId,ref:'Store',default:DEFAULT_STORE_ID},role:{type:String,enum:['admin','cashier'],default:'cashier'},createdBy:{type:mongoose.Schema.Types.ObjectId,ref:'User'}}));
const Product=mongoose.model('Product',new mongoose.Schema({name:{type:String,required:true},barcode:{type:String,unique:true,required:true},price:{type:Number,min:0,required:true},stock:{type:Number,min:0,required:true},category:String,emoji:String,discountPercent:{type:Number,min:0,max:100,default:0},verified:{type:Boolean,default:true}}));
const Invoice=mongoose.model('Invoice',new mongoose.Schema({number:{type:String,unique:true},items:Array,total:Number,payment:String,cashier:String,cashierName:String,cashierEmail:String,storeId:String,storeName:String,storeLocation:String,subtotal:Number,discountTotal:Number},{timestamps:true}));
const Scan=mongoose.model('Scan',new mongoose.Schema({barcode:String,verified:Boolean,user:String},{timestamps:true}));
const Setup=mongoose.model('Setup',new mongoose.Schema({_id:String}));
const StockMovement=mongoose.model('StockMovement',new mongoose.Schema({requestId:{type:String,unique:true},productId:{type:mongoose.Schema.Types.ObjectId,ref:'Product'},quantity:Number,admin:String},{timestamps:true}));
const AuthLog=mongoose.model('AuthLog',new mongoose.Schema({user:String,name:String,email:String,role:String,action:String,result:String,ip:String,userAgent:String},{timestamps:true}));
const logAuth=(req,user,action,result)=>AuthLog.create({user:user?.id,name:user?.name,email:user?.email||String(req.body.email||'').trim().toLowerCase().slice(0,254),role:user?.role,action,result,ip:req.socket.remoteAddress,userAgent:String(req.headers['user-agent']||'').slice(0,300)});
const publicUser=async user=>({name:user.name,email:user.email,role:user.role,photo:user.photo||null,selectedStore:await Store.findById(user.selectedStore||DEFAULT_STORE_ID).select('name location active')});
const authResponse=async user=>({token:jwt.sign({id:user.id,role:user.role},process.env.JWT_SECRET,{expiresIn:'8h'}),user:await publicUser(user)});
const ready=(req,res,next)=>mongoose.connection.readyState===1?next():res.status(503).json({error:'MongoDB is unavailable. Configure MONGODB_URI and restart the server.'});
app.get('/api/health',(req,res)=>res.json({database:mongoose.connection.readyState===1?'connected':'offline'}));
app.use('/api',ready);
// Initial setup is permanently closed. All further admins require an admin session.
app.get('/api/auth/setup-status',(req,res)=>res.json({needsAdmin:false}));
app.post('/api/auth/setup',(req,res)=>res.status(403).json({error:'Administrator self-registration is disabled. Ask a signed-in administrator to create your account.'}));
const validAccount=({name,email,password})=>typeof name==='string'&&name.trim().length>0&&typeof email==='string'&&/^\S+@\S+\.\S+$/.test(email.trim())&&typeof password==='string'&&password.length>=8;
app.post('/api/auth/register',async(req,res)=>{if(req.body.role&&req.body.role!=='cashier')return res.status(403).json({error:'Public signup is for cashier accounts only.'});if(!validAccount(req.body))return res.status(400).json({error:'Enter a name, valid email and password of at least 8 characters.'});const {name,email,password}=req.body;const user=await User.create({name:name.trim(),email:email.toLowerCase().trim(),password:await bcrypt.hash(password,12),role:'cashier'});await logAuth(req,user,'register','success');res.json(await authResponse(user));});
app.post('/api/auth/login',async(req,res)=>{const user=await User.findOne({email:String(req.body.email).toLowerCase().trim()});if(!user||!await bcrypt.compare(String(req.body.password),user.password)){await logAuth(req,user,'login','failed');return res.status(401).json({error:'Invalid email or password.'});}if(req.body.role&&req.body.role!==user.role){await logAuth(req,user,'login','role-mismatch');return res.status(403).json({error:`This account is a ${user.role} account. Select the matching sign-in tab.`});}await logAuth(req,user,'login','success');res.json(await authResponse(user));});
app.use('/api',async(req,res,next)=>{let claims;try{claims=jwt.verify(req.headers.authorization?.replace('Bearer ',''),process.env.JWT_SECRET);}catch{return res.status(401).json({error:'Please sign in.'});}const user=await User.findById(claims.id).select('role name email selectedStore');if(!user)return res.status(401).json({error:'Please sign in.'});req.user={id:user.id,role:user.role,name:user.name,email:user.email,selectedStore:String(user.selectedStore||DEFAULT_STORE_ID)};next();});
app.post('/api/auth/logout',async(req,res)=>{await logAuth(req,req.user,'logout','success');res.json({success:true});});
app.get('/api/profile',async(req,res)=>res.json(await publicUser(await User.findById(req.user.id))));
app.post('/api/profile/photo',async(req,res)=>{const photo=validatePhoto(req.body.photo);const user=await User.findByIdAndUpdate(req.user.id,{photo},{new:true});res.json(await publicUser(user));});
app.post('/api/users/:id/photo',async(req,res)=>{if(req.user.role!=='admin')return res.status(403).json({error:'Admin access required.'});const photo=validatePhoto(req.body.photo);const user=await User.findOneAndUpdate({_id:req.params.id,role:'cashier'},{photo},{new:true});if(!user)return res.status(404).json({error:'Cashier account not found.'});res.json({_id:user.id,...await publicUser(user)});});
app.get('/api/stores',async(req,res)=>res.json(await Store.find(req.user.role==='admin'?{}:{active:true}).sort({createdAt:1,_id:1})));
app.post('/api/stores/:id/status',async(req,res)=>{if(req.user.role!=='admin')return res.status(403).json({error:'Only administrators can change store status.'});if(!mongoose.isValidObjectId(req.params.id)||typeof req.body.active!=='boolean')return res.status(400).json({error:'Supply a valid store and an active/inactive status.'});const store=await Store.findByIdAndUpdate(req.params.id,{active:req.body.active},{new:true});if(!store)return res.status(404).json({error:'Store not found.'});res.json(store);});
app.post('/api/stores',async(req,res)=>{if(req.user.role!=='admin')return res.status(403).json({error:'Only administrators can add stores.'});const {name,location}=req.body;if(typeof name!=='string'||!name.trim()||name.trim().length>100||typeof location!=='string'||!location.trim()||location.trim().length>150)return res.status(400).json({error:'Enter a store name and location.'});res.status(201).json(await Store.create({name:name.trim(),location:location.trim(),code:randomUUID()}));});
app.post('/api/profile/store',async(req,res)=>{if(req.user.role!=='cashier')return res.status(403).json({error:'Store selection is available to cashiers.'});if(typeof req.body.storeId!=='string'||!mongoose.isValidObjectId(req.body.storeId))return res.status(400).json({error:'Choose a valid store.'});const store=await Store.findOne({_id:req.body.storeId,active:true});if(!store)return res.status(404).json({error:'Store not found or unavailable.'});const user=await User.findByIdAndUpdate(req.user.id,{selectedStore:store._id},{new:true});res.json(await publicUser(user));});
app.get('/api/products',async(req,res)=>res.json(await Product.find().sort({name:1})));
app.get('/api/inventory/lookup',async(req,res)=>{if(req.user.role!=='admin')return res.status(403).json({error:'Admin access required.'});const barcode=String(req.query.barcode||'').trim();if(!barcode||barcode.length>128)return res.status(400).json({error:'Enter a valid barcode.'});res.json({product:await Product.findOne({barcode})});});
app.post('/api/inventory/restock',async(req,res)=>{
  if(req.user.role!=='admin')return res.status(403).json({error:'Admin access required.'});
  const {quantity,requestId}=req.body,barcode=String(req.body.barcode||'').trim();
  if(!barcode||barcode.length>128||!Number.isSafeInteger(quantity)||quantity<1||quantity>100000||typeof requestId!=='string'||!/^[-a-zA-Z0-9]{10,80}$/.test(requestId))return res.status(400).json({error:'Enter a valid barcode and stock quantity between 1 and 100,000.'});
  const session=await mongoose.startSession();let product;
  try{await session.withTransaction(async()=>{const previous=await StockMovement.findOne({requestId}).session(session);if(previous){if(previous.admin!==req.user.id||previous.quantity!==quantity)throw Error('Stock request already used. Scan again.');product=await Product.findOne({_id:previous.productId,barcode}).session(session);if(!product)throw Error('Stock request does not match this product.');return;}
    product=await Product.findOneAndUpdate({barcode,verified:true},{$inc:{stock:quantity}},{new:true,session,runValidators:true});
    if(!product)throw Error('Register this barcode as a product before adding stock.');
    await StockMovement.create([{requestId,productId:product._id,quantity,admin:req.user.id}],{session});
  });res.json({product});}finally{await session.endSession();}
});
app.get('/api/users',async(req,res)=>{if(req.user.role!=='admin')return res.status(403).json({error:'Admin access required.'});res.json(await User.find().select('name email role photo').sort({name:1}));});
app.post('/api/users/admins',async(req,res)=>{if(req.user.role!=='admin')return res.status(403).json({error:'Only administrators can create administrator accounts.'});if(!validAccount(req.body))return res.status(400).json({error:'Enter a name, valid email and password of at least 8 characters.'});const {name,email,password}=req.body;const user=await User.create({name:name.trim(),email:email.toLowerCase().trim(),password:await bcrypt.hash(password,12),role:'admin',createdBy:req.user.id});res.status(201).json({_id:user.id,name:user.name,email:user.email,role:user.role});});
app.post('/api/products/:id',async(req,res)=>{if(req.user.role!=='admin')return res.status(403).json({error:'Admin access required.'});const {name,barcode,price,stock,category,emoji,discountPercent=0}=req.body;if(typeof name!=='string'||!name.trim()||typeof barcode!=='string'||!barcode.trim()||!Number.isFinite(price)||price<0||!Number.isSafeInteger(stock)||stock<0||!Number.isFinite(discountPercent)||discountPercent<0||discountPercent>100)return res.status(400).json({error:'Enter a name, barcode, valid price and whole stock quantity.'});const product=await Product.findByIdAndUpdate(req.params.id,{name:name.trim(),barcode:barcode.trim(),price,stock,category,emoji,discountPercent},{new:true,runValidators:true});if(!product)return res.status(404).json({error:'Product not found.'});res.json(product);});
app.post('/api/products',async(req,res)=>{if(req.user.role!=='admin')return res.status(403).json({error:'Admin access required.'});const {name,barcode,price,stock,category,emoji,discountPercent=0}=req.body;if(typeof name!=='string'||!name.trim()||typeof barcode!=='string'||!barcode.trim()||barcode.trim().length>128||!Number.isFinite(price)||price<0||!Number.isSafeInteger(stock)||stock<0||!Number.isFinite(discountPercent)||discountPercent<0||discountPercent>100)return res.status(400).json({error:'Enter a product name, barcode, valid price and whole stock quantity.'});res.json(await Product.create({name:name.trim(),barcode:barcode.trim(),price,stock,category,emoji,discountPercent,verified:true}));});
app.post('/api/scans',async(req,res)=>{if(req.user.role!=='cashier')return res.status(403).json({error:'Only cashiers can scan products for sales.'});const barcode=String(req.body.barcode||'').trim();if(!barcode||barcode.length>128)return res.status(400).json({error:'Invalid barcode.'});const product=await Product.findOne({barcode});await Scan.create({barcode,verified:!!product?.verified,user:req.user.id});res.json({product,verified:!!product?.verified});});
app.get('/api/scans',async(req,res)=>res.json(await Scan.find({verified:false,...(req.user.role==='cashier'?{user:req.user.id}:{})}).sort({createdAt:-1}).limit(500)));
app.get('/api/invoices',async(req,res)=>res.json(await Invoice.find(req.user.role==='cashier'?{cashier:req.user.id}:{}).sort({createdAt:-1}).limit(100)));
app.post('/api/invoices',async(req,res)=>{if(req.user.role!=='cashier')return res.status(403).json({error:'Only cashiers can generate sales invoices.'});const session=await mongoose.startSession();try{let invoice;await session.withTransaction(async()=>{const store=await Store.findOne({_id:req.user.selectedStore,active:true}).session(session);if(!store)throw Error('Select an available store in your profile before creating an invoice.');const products=await Product.find({_id:{$in:req.body.items?.map(i=>i.productId)}}).session(session);const items=calculateInvoice(req.body.items,products);for(const item of items){const result=await Product.updateOne({_id:item.productId,stock:{$gte:item.quantity}},{$inc:{stock:-item.quantity}},{session});if(!result.modifiedCount)throw new Error('Stock changed. Try again.');}const total=items.reduce((sum,i)=>sum+Math.round(i.total*100),0)/100;[invoice]=await Invoice.create([{number:`ASP-${Date.now()}-${Math.random().toString(36).slice(2,6).toUpperCase()}`,items,total,payment:['Cash','Card'].includes(req.body.payment)?req.body.payment:'Cash',cashier:req.user.id,cashierName:req.user.name,cashierEmail:req.user.email,storeId:store.id,storeName:store.name,storeLocation:store.location,subtotal:items.reduce((s,i)=>s+Math.round(i.originalPrice*100)*i.quantity,0)/100,discountTotal:items.reduce((s,i)=>s+Math.round(i.discountTotal*100),0)/100}],{session});});res.json(invoice);}finally{await session.endSession();}});
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
app.use(express.static(path.resolve('dist')));
app.get('/{*path}',(req,res)=>res.sendFile(path.resolve('dist/index.html')));
app.use((err,req,res,next)=>res.status(err.code===11000?409:400).json({error:err.code===11000?'This email or barcode already exists.':err.message}));
if(!process.env.JWT_SECRET||process.env.JWT_SECRET.length<32){console.error('Set JWT_SECRET to at least 32 characters in .env');process.exit(1);}
mongoose.connect(process.env.MONGODB_URI||'mongodb://127.0.0.1:27017/aspire_billing',{serverSelectionTimeoutMS:5000}).then(async()=>{await Store.updateOne({_id:DEFAULT_STORE_ID},{$setOnInsert:{name:'Aspire Retail Store',location:'Main branch - Karachi',code:'MAIN',active:true}},{upsert:true});const session=await mongoose.startSession();try{await session.withTransaction(async()=>{if(!await Setup.findById('starter-catalog-v1').session(session)){for(const p of starterProducts)await Product.updateOne({barcode:p.barcode},{$setOnInsert:{...p,verified:true}},{upsert:true,session});await Setup.create([{_id:'starter-catalog-v1'}],{session});}});}finally{await session.endSession();}console.log('MongoDB connected; starter catalog ready.');}).catch(e=>console.error('MongoDB:',e.message));
app.listen(process.env.PORT||4000,()=>console.log('Aspire billing server: http://localhost:4000'));

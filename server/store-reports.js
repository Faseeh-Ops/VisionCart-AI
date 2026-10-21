import express from 'express';
import mongoose from 'mongoose';
import {dateRange,reportPage} from './reports.js';

export function csvCell(value){
 let text=String(value??'');
 if(/^[\s\u0000-\u001f]*[=+@-]/.test(text))text="'"+text;
 return '"'+text.replaceAll('"','""')+'"';
}
const pkt=date=>new Date(date).toLocaleString('en-GB',{timeZone:'Asia/Karachi',hour12:false});
export function storeReportsRouter({Store,Product,StoreInventory,Invoice}){
 const router=express.Router();
 router.use((req,res,next)=>req.user.role==='admin'?next():res.status(403).json({error:'Administrator access required.'}));
 router.use('/:storeId',async(req,res,next)=>{
  if(!mongoose.isValidObjectId(req.params.storeId))return res.status(400).json({error:'Choose a valid store.'});
  req.reportStore=await Store.findById(req.params.storeId).lean();
  if(!req.reportStore)return res.status(404).json({error:'Store not found.'});next();
 });
 const activityPipeline=(req)=>{
  const storeId=String(req.reportStore._id),filter={storeId,...dateRange(req.query)};
  if(req.query.actor){if(!mongoose.isValidObjectId(req.query.actor))throw Error('Choose a valid account.');filter.actorId=String(req.query.actor);}
  const sources=[
   ['invoices',[{$unwind:'$items'},{$project:{createdAt:1,storeId:1,action:{$literal:'Sale'},actorId:'$cashier',actorName:'$cashierName',product:'$items.name',barcode:'$items.barcode',quantity:'$items.quantity',amount:'$items.total',details:'$number'}}]],
   ['scans',[{$project:{createdAt:1,storeId:1,action:{$cond:['$verified','Product scan','Unverified scan']},actorId:'$user',actorName:'$userName',product:'$productName',barcode:1,quantity:{$literal:1},details:'$format'}}]],
   ['authlogs',[{$project:{createdAt:1,storeId:1,action:'$action',actorId:'$user',actorName:'$name',details:'$result'}}]],
   ['stockmovements',[{$project:{createdAt:1,storeId:1,action:{$literal:'Stock added'},actorId:'$admin',productId:1,product:'$productName',barcode:1,quantity:1}}]],
   ['stocktransfers',[{$project:{createdAt:1,actorId:'$admin',actorName:'$adminName',product:'$productName',barcode:1,quantity:1,branches:[{storeId:'$fromStoreId',action:'Transfer out',details:{$concat:['To: ','$toStoreName']}},{storeId:'$toStoreId',action:'Transfer in',details:{$concat:['From: ','$fromStoreName']}}]}},{$unwind:'$branches'},{$set:{storeId:'$branches.storeId',action:'$branches.action',details:'$branches.details'}}]],
   ['storeevents',[]]
  ];
  return [{$match:{_id:{$exists:false}}},...sources.map(([coll,pipeline])=>({$unionWith:{coll,pipeline}})),{$match:filter},
   {$lookup:{from:'users',let:{actor:'$actorId'},pipeline:[{$match:{$expr:{$eq:[{$toString:'$_id'},'$$actor']}}},{$project:{name:1}}],as:'account'}},
   {$lookup:{from:'products',localField:'productId',foreignField:'_id',as:'catalog'}},
   {$set:{actorName:{$ifNull:['$actorName',{$ifNull:[{$arrayElemAt:['$account.name',0]},'Unavailable account']}]},product:{$ifNull:['$product',{$arrayElemAt:['$catalog.name',0]}]},barcode:{$ifNull:['$barcode',{$arrayElemAt:['$catalog.barcode',0]}]}}},
   {$project:{account:0,catalog:0,branches:0}},{$sort:{createdAt:-1,_id:-1,action:1,product:1}}];
 };
 const inventory=async(req)=>{
  const products=await Product.find().sort({name:1}).lean(),rows=await StoreInventory.find({storeId:req.reportStore._id}).lean(),map=new Map(rows.map(r=>[String(r.productId),r]));
  return products.map(p=>{const row=map.get(String(p._id));return {productId:p._id,name:p.name,barcode:p.barcode,category:p.category||'',price:p.price,discountPercent:Number.isFinite(row?.discountPercent)?row.discountPercent:(p.discountPercent||0),discountScope:Number.isFinite(row?.discountPercent)?'Store only':'All stores',stock:row?.stock||0};});
 };
 router.get('/:storeId/details',async(req,res)=>{
  const products=await inventory(req);
  res.json({store:req.reportStore,products,summary:{units:products.reduce((s,p)=>s+p.stock,0),stockedProducts:products.filter(p=>p.stock>0).length,catalogProducts:products.length,retailValue:products.reduce((s,p)=>s+Math.round(p.price*100)*p.stock,0)/100}});
 });
 router.get('/:storeId/activity',async(req,res)=>{
  const page=reportPage(req.query),pipeline=activityPipeline(req);
  const [data]=await Invoice.aggregate([...pipeline,{$facet:{rows:[{$skip:(page-1)*50},{$limit:50}],count:[{$count:'total'}]}}]).allowDiskUse(true);
  const total=data?.count?.[0]?.total||0;res.json({rows:data?.rows||[],total,page,pages:Math.ceil(total/50)});
 });
 router.get('/:storeId/export',async(req,res)=>{
  const kind=req.query.kind;if(!['inventory','activity'].includes(kind))return res.status(400).json({error:'Choose inventory or activity export.'});
  // Validate filters before sending headers, so invalid dates return a normal API error.
  const pipeline=kind==='activity'?activityPipeline(req):null;
  const rows=kind==='inventory'?await inventory(req):null;
  const headers=kind==='inventory'?['Store','Product','Barcode','Category','Stock units','Price (Rs)','Discount (%)','Discount scope','Snapshot time (PKT)']:['Time (PKT)','Store','Account','Action','Product','Barcode','Quantity','Amount (Rs)','Details'];
  res.set({'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="store-${req.reportStore._id}-${kind}.csv"`});
  res.write('\uFEFF'+headers.map(csvCell).join(',')+'\r\n');
  const snapshot=pkt(new Date());
  if(rows){for(const p of rows)res.write([req.reportStore.name,p.name,p.barcode,p.category,p.stock,p.price,p.discountPercent,p.discountScope,snapshot].map(csvCell).join(',')+'\r\n');res.end();return;}
  const cursor=Invoice.aggregate(pipeline).allowDiskUse(true).cursor({batchSize:100});
  try{for await(const row of cursor){if(res.destroyed)break;const line=[pkt(row.createdAt),req.reportStore.name,row.actorName,row.action,row.product,row.barcode,row.quantity,row.amount,row.details].map(csvCell).join(',')+'\r\n';if(!res.write(line))await new Promise(resolve=>{const done=()=>{res.off('drain',done);res.off('close',done);resolve();};res.once('drain',done);res.once('close',done);});}res.end();}finally{await cursor.close();}
 });
 return router;
}

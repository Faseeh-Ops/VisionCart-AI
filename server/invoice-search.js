import express from 'express';
import mongoose from 'mongoose';
import {dateRange,reportPage} from './reports.js';

export function invoiceFilter(query,user){
 const filter={...dateRange(query)};
 if(user.role==='cashier')filter.cashier=user.id;
 if(query.cashier){
  if(typeof query.cashier!=='string'||!mongoose.isValidObjectId(query.cashier))throw Error('Choose a valid cashier.');
  if(user.role==='cashier'&&query.cashier!==user.id){const error=Error('You can only view your own invoices.');error.status=403;throw error;}
  filter.cashier=query.cashier;
 }
 if(query.store){if(typeof query.store!=='string'||!mongoose.isValidObjectId(query.store))throw Error('Choose a valid store.');filter.storeId=query.store;}
 if(query.q){if(typeof query.q!=='string'||query.q.length>100)throw Error('Invoice search must be at most 100 characters.');const value=query.q.trim();if(value)filter.number={$regex:value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),$options:'i'};}
 return filter;
}

export function invoiceSearchRouter(Invoice){
 const router=express.Router();
 router.get('/filters',async(req,res)=>{
  const filter=req.user.role==='cashier'?{cashier:req.user.id}:{};
  
  const [result]=await Invoice.aggregate([{$match:filter},{$sort:{createdAt:-1}},{$facet:{cashiers:[{$match:{cashier:{$type:'string',$ne:''}}},{$group:{_id:'$cashier',name:{$first:'$cashierName'}}},{$sort:{name:1,_id:1}}],stores:[{$match:{storeId:{$type:'string',$ne:''}}},{$group:{_id:'$storeId',name:{$first:'$storeName'}}},{$sort:{name:1,_id:1}}]}}]);
  res.json({cashiers:result?.cashiers||[],stores:result?.stores||[]});
 });
 router.get('/search',async(req,res)=>{
  const filter=invoiceFilter(req.query,req.user),page=reportPage(req.query),pageSize=25;
  const [invoices,total]=await Promise.all([Invoice.find(filter).sort({createdAt:-1,_id:-1}).skip((page-1)*pageSize).limit(pageSize).lean(),Invoice.countDocuments(filter)]);
  res.json({invoices,total,page,pageSize,pages:Math.ceil(total/pageSize)});
 });
 return router;
}

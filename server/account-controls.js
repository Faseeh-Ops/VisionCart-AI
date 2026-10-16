import express from 'express';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

export function accountControlsRouter({User,AuthLog,StoreEvent,PasswordResetRequest,validPassword}){
 const router=express.Router();
 router.use((req,res,next)=>req.user.role==='admin'?next():res.status(403).json({error:'Only administrators can manage cashier access.'}));
 const view=user=>({_id:user.id,name:user.name,email:user.email,role:user.role,photo:user.photo||null,active:user.active!==false,mustChangePassword:Boolean(user.mustChangePassword)});
 const audit=async(req,user,action,session)=>{
  const storeId=String(user.selectedStore||'000000000000000000000001');
  await AuthLog.create([{user:user.id,name:user.name,email:user.email,role:user.role,action,result:'success',storeId,performedBy:req.user.id,performedByName:req.user.name,ip:req.socket.remoteAddress,userAgent:String(req.headers['user-agent']||'').slice(0,300)}],{session});
  await StoreEvent.create([{storeId,actorId:req.user.id,actorName:req.user.name,action,details:`Cashier: ${user.name} (${user.email})`}],{session});
 };
 router.post('/:id/status',async(req,res)=>{
  if(!mongoose.isValidObjectId(req.params.id)||typeof req.body.active!=='boolean')return res.status(400).json({error:'Choose a valid cashier and an active/inactive status.'});
  const session=await mongoose.startSession();let user;
  try{await session.withTransaction(async()=>{
   user=await User.findOne({_id:req.params.id,role:'cashier'}).session(session);
   if(!user){const error=Error('Cashier account not found. Administrator accounts cannot be changed here.');error.status=404;throw error;}
   if((user.active!==false)===req.body.active)return;
   user.active=req.body.active;user.tokenVersion=(user.tokenVersion||0)+1;await user.save({session});
   await audit(req,user,user.active?'Cashier reactivated':'Cashier deactivated',session);
  });res.json({user:view(user)});}finally{await session.endSession();}
 });
 router.post('/:id/reset-access',async(req,res)=>{
  if(!mongoose.isValidObjectId(req.params.id)||!validPassword(req.body.temporaryPassword))return res.status(400).json({error:'Choose a valid cashier and a temporary password with at least 8 characters and at most 72 UTF-8 bytes.'});
  const session=await mongoose.startSession();let user;
  try{await session.withTransaction(async()=>{
   user=await User.findOne({_id:req.params.id,role:'cashier'}).session(session);
   if(!user){const error=Error('Cashier account not found. Administrator accounts cannot be changed here.');error.status=404;throw error;}
   if(await bcrypt.compare(req.body.temporaryPassword,user.password))throw Error('Choose a temporary password different from the current password.');
   user.password=await bcrypt.hash(req.body.temporaryPassword,12);user.mustChangePassword=true;user.tokenVersion=(user.tokenVersion||0)+1;await user.save({session});
   await PasswordResetRequest.updateMany({user:user._id,status:'pending'},{$set:{status:'resolved',resolvedBy:req.user.id,resolvedAt:new Date()}},{session});
   await audit(req,user,'Cashier access reset',session);
  });res.json({user:view(user),message:'Temporary password assigned. The cashier must choose a new password at sign-in.'+(user.active===false?' This account remains inactive until you reactivate it.':'')});}finally{await session.endSession();}
 });
 return router;
}

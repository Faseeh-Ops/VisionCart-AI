import 'dotenv/config';
import mongoose from 'mongoose';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
try{
 await mongoose.connect(process.env.MONGODB_URI||'mongodb://127.0.0.1:27017/aspire_billing');
 const db=mongoose.connection.db;
 const [products,stores,inventory,setup]=await Promise.all(['products','stores','storeinventories','setups'].map(name=>db.collection(name).find().toArray()));
 const directory=path.resolve('.tools/backups');await mkdir(directory,{recursive:true});
 const file=path.join(directory,`inventory-${Date.now()}.json`);
 await writeFile(file,JSON.stringify({createdAt:new Date().toISOString(),database:db.databaseName,products,stores,inventory,setup},null,2),{flag:'wx'});
 console.log(`Inventory backup saved: ${file}`);
 console.log(JSON.stringify({products:products.length,sharedUnits:products.reduce((sum,p)=>sum+(p.stock||0),0),branchUnits:inventory.reduce((sum,p)=>sum+p.stock,0),stores:stores.map(s=>({id:s._id,name:s.name}))}));
}finally{await mongoose.disconnect();}

import 'dotenv/config';
import mongoose from 'mongoose';

// Explicit stock-count reconciliation, not an additive restock operation.
// Dry-run by default. Never include this script in application startup.
const products = [
  {name:'Mahmood Cappuccino Classic coffee 25 g',barcode:'8697449918281',price:250,stock:100,category:'Coffee',emoji:'☕'},
  {name:'Innovative Choc n Chip biscuits',barcode:'8965310043173',price:10,stock:50,category:'Biscuits',emoji:'🍪'},
  {name:'LU Tiger biscuits',barcode:'8961003694271',price:10,stock:50,category:'Biscuits',emoji:'🍪'},
];
try {
  await mongoose.connect(process.env.MONGODB_URI,{serverSelectionTimeoutMS:5000});
  const collection=mongoose.connection.collection('products');
  if(process.argv.includes('--apply')) {
    const session=await mongoose.startSession();
    try {
      await session.withTransaction(async()=>{
        for(const product of products) {
          await collection.updateOne({barcode:product.barcode},{$set:product,$setOnInsert:{discountPercent:0,verified:true}},{upsert:true,session});
        }
      });
    } finally {await session.endSession();}
  }
  const saved=await collection.find({barcode:{$in:products.map(p=>p.barcode)}},{projection:{name:1,barcode:1,price:1,stock:1,verified:1,discountPercent:1}}).toArray();
  console.log(JSON.stringify({applied:process.argv.includes('--apply'),products:saved},null,2));
} catch(error) {
  console.error('Pilot registration failed:',error.name);
  process.exitCode=1;
} finally {await mongoose.disconnect();}

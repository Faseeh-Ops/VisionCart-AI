import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import mongoose from 'mongoose';
const database=`aspire_test_${Date.now()}`,uri=`mongodb://127.0.0.1:27017/${database}?replicaSet=aspire-rs`;
let server;
async function start(){
 server=spawn(process.execPath,['server/index.js'],{env:{...process.env,PORT:'4002',MONGODB_URI:uri,JWT_SECRET:'migration-test-secret-only-123456789012345'},stdio:['ignore','pipe','pipe']});
 let output='';server.stdout.on('data',chunk=>output+=chunk);server.stderr.on('data',chunk=>output+=chunk);
 for(let attempt=0;attempt<100;attempt++){try{if((await fetch('http://127.0.0.1:4002/api/health')).ok)return;}catch{}await new Promise(resolve=>setTimeout(resolve,100));}
 throw Error('Migration server failed: '+output);
}
async function stop(){if(server&&server.exitCode===null){const closed=new Promise(resolve=>server.once('exit',resolve));server.kill();await closed;}server=null;}
try{
 await mongoose.connect(uri);const db=mongoose.connection.db;
 const product=new mongoose.Types.ObjectId();
 await db.collection('products').insertOne({_id:product,name:'Legacy biscuits',barcode:'MIGRATION-TEST',stock:12,price:10,verified:true});
 await db.collection('setups').insertOne({_id:'starter-catalog-v1'});
 await start();
 const filter={storeId:new mongoose.Types.ObjectId('000000000000000000000001'),productId:product};
 assert.equal((await db.collection('storeinventories').findOne(filter)).stock,12);
 assert.equal((await db.collection('products').findOne({_id:product})).stock,0);
 assert.equal(await db.collection('storeinventories').countDocuments(),1);
 await stop();await start();
 assert.equal((await db.collection('storeinventories').findOne(filter)).stock,12);
 assert.equal(await db.collection('storeinventories').countDocuments(),1);
 console.log('PASS: existing quantities preserved once; restarting does not duplicate inventory.');
}finally{await stop();if(mongoose.connection.readyState===1){assert.match(database,/^aspire_test_\d+$/);await mongoose.connection.dropDatabase();await mongoose.disconnect();}}

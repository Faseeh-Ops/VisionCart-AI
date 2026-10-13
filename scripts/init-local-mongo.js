import mongoose from 'mongoose';
try {
  await mongoose.connect('mongodb://127.0.0.1:27017/aspire_billing?directConnection=true', {serverSelectionTimeoutMS:15000});
  const admin = mongoose.connection.db.admin();
  const hello = await admin.command({hello:1});
  if (!hello.setName) {
    await admin.command({replSetInitiate:{_id:'aspire-rs',members:[{_id:0,host:'127.0.0.1:27017'}]}});
  } else if (hello.setName !== 'aspire-rs') {
    throw new Error('Another replica set is already configured; use its name instead.');
  }
  let ready = false;
  for (let attempt=0; attempt<30; attempt++) {
    if ((await admin.command({hello:1})).isWritablePrimary) {ready=true;break;}
    await new Promise(resolve=>setTimeout(resolve,1000));
  }
  if (!ready) throw new Error('Replica set is not primary yet. Try the script again shortly.');
  console.log('Local replica set is initialized and writable.');
} catch (error) {console.error(error.message);process.exitCode=1;}
finally {await mongoose.disconnect();}

// Real recognition API, existing reference library; never confirms or invoices items.
import 'dotenv/config';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
const dir=path.resolve(process.env.STRESS_DATA_DIR||'datasets/retail-catalog/multiframe-stress');
const manifest=JSON.parse(await readFile(path.join(dir,'manifest.json'),'utf8'));
const origin=process.env.STRESS_API_ORIGIN||'http://127.0.0.1:4000';
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function iou(a,b){const overlap=Math.max(0,Math.min(a[2],b[2])-Math.max(a[0],b[0]))*Math.max(0,Math.min(a[3],b[3])-Math.max(a[1],b[1]));return overlap/((a[2]-a[0])*(a[3]-a[1])+(b[2]-b[0])*(b[3]-b[1])-overlap);}
await mongoose.connect(process.env.MONGODB_URI);
try{
 const db=mongoose.connection.db;
 const user=await db.collection('users').findOne({role:'cashier',active:{$ne:false},mustChangePassword:{$ne:true}});
 if(!user)throw Error('An active cashier with completed password setup is required.');
 const expectedNames={tiger:'LU Tiger biscuits',innovative:'Innovative Choc n Chip biscuits',mahmood:'Mahmood Cappuccino Classic coffee 25 g'};
 const expected={};
 const productSpecs=manifest.products||Object.entries(expectedNames).map(([key,name])=>({key,name}));
 for(const spec of productSpecs){
  const {key,name}=spec;
  const p=await db.collection('products').findOne(spec.sourceId?{'retailSources.listingId':spec.sourceId}:{name});if(!p)throw Error('Missing enrolled product: '+name);
  expected[key]={id:String(p._id),name:p.name,referenceCount:await db.collection('aireferences').countDocuments({productId:p._id}),querySourceAlreadyIndexed:spec.sourceId?await db.collection('aireferences').countDocuments({sourceId:spec.sourceId})>0:null};
 }
 const snapshot=async()=>({invoices:await db.collection('invoices').countDocuments({}),scans:await db.collection('scans').countDocuments({}),inventory:await db.collection('storeinventories').aggregate([{$group:{_id:null,rows:{$sum:1},units:{$sum:'$stock'}}}]).toArray()});
 const before=await snapshot();
 const token=jwt.sign({id:String(user._id),role:user.role,version:user.tokenVersion||0},process.env.JWT_SECRET,{expiresIn:'20m'});
 const photo=async name=>'data:image/jpeg;base64,'+(await readFile(path.join(dir,name))).toString('base64');
 const cameraProbe=await readFile(path.join(dir,'camera-probe.json'),'utf8').then(JSON.parse).catch(error=>{if(error.code==='ENOENT')return [];throw error;});
 const results={testedAt:new Date().toISOString(),physicalCameraCapture:false,cameraProbe,method:manifest.source_note,expectedProducts:expected,before,cases:[]};
 for(const fixture of manifest.cases){
  const start=Date.now();
  const response=await fetch(origin+'/api/ai/recognize',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({mode:'multiple',photo:await photo(fixture.photo),backgroundPhoto:await photo(fixture.background)}),signal:AbortSignal.timeout(150000)});
  const data=await response.json();
  const items=(data.items||[]).map(item=>({box:item.box,candidates:item.candidates.map(c=>({id:String(c.product._id),name:c.product.name,similarity:c.similarity}))}));
  // One-to-one localization matching, without using predicted identities to select pairs.
  const edges=fixture.truth.flatMap((truth,t)=>items.map((item,p)=>({t,p,iou:iou(truth.box,item.box)}))).filter(e=>e.iou>=.5).sort((a,b)=>b.iou-a.iou);
  const usedTruth=new Set(),usedPredicted=new Set(),matches=[];
  for(const edge of edges){if(usedTruth.has(edge.t)||usedPredicted.has(edge.p))continue;usedTruth.add(edge.t);usedPredicted.add(edge.p);const key=fixture.truth[edge.t].key;matches.push({...edge,key,correctTop1:items[edge.p].candidates[0]?.id===expected[key].id,expected:expected[key].name,predicted:items[edge.p].candidates[0]?.name});}
  const perfect=response.ok&&matches.length===fixture.truth.length&&items.length===fixture.truth.length&&matches.every(m=>m.correctTop1);
  const row={...fixture,httpStatus:response.status,error:data.error,elapsedMs:Date.now()-start,items,matches,missed:fixture.truth.length-matches.length,extra:items.length-matches.length,correctTop1:matches.filter(m=>m.correctTop1).length,outcome:perfect?'pass':response.ok?'incorrect_or_missed':'rejected'};
  results.cases.push(row);
  console.log(JSON.stringify({case:row.name,status:row.httpStatus,expected:row.truth.length,detected:items.length,localized:matches.length,correctTop1:row.correctTop1,outcome:row.outcome,error:row.error}));
  await writeFile(path.join(dir,'results.json'),JSON.stringify(results,null,2)+'\n');
 }
 results.after=await snapshot();results.businessDataUnchanged=JSON.stringify(results.before)===JSON.stringify(results.after);
 results.summary={products:Object.keys(expected).length,cases:results.cases.length,appearances:results.cases.reduce((n,c)=>n+c.truth.length,0),passed:results.cases.filter(c=>c.outcome==='pass').length,rejected:results.cases.filter(c=>c.outcome==='rejected').length,incorrectOrMissed:results.cases.filter(c=>c.outcome==='incorrect_or_missed').length};
 await writeFile(path.join(dir,'results.json'),JSON.stringify(results,null,2)+'\n');
 const rows=results.cases.map(c=>`| ${c.name} | ${c.truth.length} | ${c.items.length} | ${c.matches.length} | ${c.correctTop1} | ${c.outcome} |`).join('\n');
 await writeFile(path.join(dir,'RESULTS.md'),`# Multi-product stress results\n\nTested ${results.testedAt}. Simulated scenes, not fresh physical captures. No physical camera frames were used in these simulated tests.\n\n${results.method}\n\nThe real recognition API and existing full inventory reference library were used. Each prediction was left unconfirmed to expire. Invoices, scan logs and stock totals unchanged: **${results.businessDataUnchanged}**.\n\n| Case | Expected items | Regions returned | Localized at IoU ≥ 0.5 | Correct top SKU | Outcome |\n| --- | ---: | ---: | ---: | ---: | --- |\n${rows}\n\n“Rejected” means a scene error stopped suggestions; “incorrect_or_missed” means the API returned suggestions but count, localization or exact product ID was wrong. A correct count alone does not pass. This correlated test is not a checkout accuracy estimate.\n`);
 const cards=results.cases.map(c=>`<article><h2>${escape(c.name)} — ${escape(c.outcome)}</h2><svg viewBox="0 0 640 480"><image href="${escape(c.photo)}" width="640" height="480"/>${c.truth.map(t=>`<rect x="${t.box[0]}" y="${t.box[1]}" width="${t.box[2]-t.box[0]}" height="${t.box[3]-t.box[1]}" fill="none" stroke="#00ee77" stroke-width="2" stroke-dasharray="7 4"/>`).join('')}${c.items.map((p,i)=>`<rect x="${p.box[0]}" y="${p.box[1]}" width="${p.box[2]-p.box[0]}" height="${p.box[3]-p.box[1]}" fill="none" stroke="#ffb020" stroke-width="3"/><text x="${p.box[0]+3}" y="${p.box[1]+18}" fill="white" stroke="black" stroke-width=".4">${i+1}</text>`).join('')}</svg><p>Expected ${c.truth.length}; detected ${c.items.length}; localized ${c.matches.length}; correct exact SKU ${c.correctTop1}.</p>${c.error?`<p>${escape(c.error)}</p>`:''}<ol>${c.items.map(p=>`<li>${escape(p.candidates[0]?.name)} (${p.candidates[0]?.similarity})</li>`).join('')}</ol></article>`).join('');
 await writeFile(path.join(dir,'RESULTS.html'),`<!doctype html><meta charset="utf-8"><title>Multi-product stress evidence</title><style>body{font:16px system-ui;max-width:1250px;margin:30px auto;background:#111827;color:#eee}main{display:grid;grid-template-columns:1fr 1fr;gap:20px}article{background:#202b40;padding:16px;border-radius:12px}svg{width:100%}h2{font-size:18px}li{font-size:13px}</style><h1>Multi-product stress evidence</h1><p>${escape(results.method)} No physical camera frames acquired. Green dashed: expected object bounds; orange: detected region. Correlated sources, not a general accuracy benchmark.</p><p>${Object.keys(expected).length} products; ${results.summary.cases} scenes; ${results.summary.passed} passed; ${results.summary.rejected} rejected; ${results.summary.incorrectOrMissed} incorrect or missed.</p><main>${cards}</main>`);
 console.log(JSON.stringify({summary:results.summary,businessDataUnchanged:results.businessDataUnchanged,report:path.join(dir,'RESULTS.html')}));
 if(!results.businessDataUnchanged)throw Error('Business data changed during testing. Review concurrent activity.');
}finally{await mongoose.disconnect();}

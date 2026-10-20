// Audit extracted data and local photos without changing application inventory.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const base=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../datasets/retail-catalog');
const products=JSON.parse(await fs.readFile(path.join(base,'products.json'),'utf8'));
const categories=JSON.parse(await fs.readFile(path.join(base,'categories.json'),'utf8'));
const errors=[], warnings=[], ids=new Set(), hashes=new Map();
let images=0, bytes=0;
for(const p of products){
  if(ids.has(p.id))errors.push({id:p.id,error:'Duplicate record ID'});ids.add(p.id);
  if(!p.name || !p.source_product_id)errors.push({id:p.id,error:'Missing product identity'});
  for(const key of ['regular_price','selling_price'])if(p[key]!==null&&(!Number.isFinite(p[key])||p[key]<0))errors.push({id:p.id,error:`Invalid ${key}`});
  if(p.currency!=='PKR')warnings.push({id:p.id,warning:'Unexpected currency'});
  if(p.regular_price===null)warnings.push({id:p.id,warning:'No exposed regular price'});
  if(p.regular_price!==null&&p.selling_price>p.regular_price)warnings.push({id:p.id,warning:'Selling price exceeds marked price'});
  if(p.image_status==='downloaded'){
    const target=path.resolve(base,p.image_file||'');
    if(!target.startsWith(base+path.sep)){errors.push({id:p.id,error:'Unsafe image path'});continue;}
    try{
      const data=await fs.readFile(target);
      const valid=data[0]===255&&data[1]===216&&data[2]===255 || data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || data.toString('ascii',0,4)==='RIFF'&&data.toString('ascii',8,12)==='WEBP' || /^GIF8[79]a$/.test(data.toString('ascii',0,6));
      if(!valid)errors.push({id:p.id,error:'Invalid image signature'});
      if(p.image_bytes!==data.length)errors.push({id:p.id,error:'Image size does not match manifest'});
      const hash=createHash('sha256').update(data).digest('hex');
      if(!hashes.has(hash))hashes.set(hash,[]);hashes.get(hash).push(p.id);
      images++;bytes+=data.length;
    }catch(e){errors.push({id:p.id,error:`Cannot read downloaded image: ${e.code||e.message}`});}
  }
}
const mismatches=categories.filter(c=>c.store==='rahim'&&c.status==='ok'&&c.reported_total!==c.products_collected);
errors.push(...mismatches.map(c=>({category:c.id,error:'Collected count differs from reported total'})));
const duplicates=[...hashes.entries()].filter(([,list])=>list.length>1).map(([sha256,product_ids])=>({sha256,product_ids}));
const report={checked_at:new Date().toISOString(),records:products.length,unique_record_ids:ids.size,downloaded_images_checked:images,image_bytes:bytes,regular_prices_missing:products.filter(p=>p.regular_price===null).length,discounted_listings:products.filter(p=>p.regular_price>p.selling_price).length,errors,warnings,duplicate_image_groups:duplicates,note:'Identical images may be shared packshots or placeholders; review them before indexing or training. This audit checks files and fields, not recognition accuracy.'};
await fs.writeFile(path.join(base,'validation.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({records:report.records,images,megabytes:Math.round(bytes/1e6),errors:errors.length,warnings:warnings.length,duplicate_image_groups:duplicates.length}));
if(errors.length)process.exitCode=1;

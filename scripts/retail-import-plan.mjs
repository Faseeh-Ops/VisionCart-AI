import {createHash} from 'node:crypto';

// Keep decimal points, sizes and pack wording: similar names are not SKU proof.
export const productIdentity=name=>String(name).normalize('NFKC').trim().toLowerCase().replace(/\s+/g,' ');
export function buildImportPlan(listings,existing,duplicateGroups=[]){
 const groups=new Map(),byId=new Map(listings.map(p=>[p.id,p]));
 for(const p of listings){
  if(!p.name?.trim()||p.currency!=='PKR'||!Number.isFinite(p.regular_price)||p.regular_price<0)throw Error('Invalid regular-price listing: '+p.id);
  const key=productIdentity(p.name);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(p);
 }
 const ambiguous=new Set();
 for(const group of duplicateGroups){
  const identities=new Set(group.product_ids.map(id=>byId.get(id)).filter(Boolean).map(p=>productIdentity(p.name)));
  if(identities.size>1)group.product_ids.forEach(id=>ambiguous.add(id));
 }
 const used=new Map();for(const p of existing){const key=productIdentity(p.name);if(!used.has(key))used.set(key,[]);used.get(key).push(p);}
 const products=[];
 for(const [identity,rows]of groups){
  rows.sort((a,b)=>(a.store==='rahim'?0:1)-(b.store==='rahim'?0:1)||a.id.localeCompare(b.id));
  const primary=rows[0],importKey='retail-v1:'+createHash('sha256').update(identity).digest('hex').slice(0,24);
  const old=existing.find(p=>p.catalogImportKey===importKey)||(used.get(identity)?.length===1?used.get(identity)[0]:null);
  products.push({key:importKey,existingId:old?String(old._id):null,barcode:old?.barcode||'RETAIL-'+importKey.slice(10).toUpperCase(),name:primary.name.trim(),price:primary.regular_price,category:primary.category_names?.join(' / ')||'Retail catalog',sources:rows.map(p=>({listingId:p.id,store:p.store,url:p.source_url,currency:'PKR',regularPrice:p.regular_price,scrapedAt:p.scraped_at})),photos:rows.filter(p=>p.image_status==='downloaded'&&p.image_file&&!ambiguous.has(p.id)).slice(0,8).map(p=>({file:p.image_file,sourceId:p.id})),excludedPhotos:rows.filter(p=>ambiguous.has(p.id)).map(p=>p.id)});
 }
 return {listingCount:listings.length,products,ambiguousListingCount:ambiguous.size};
}

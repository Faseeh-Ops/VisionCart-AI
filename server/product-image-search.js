const OFF_HOST='world.openfoodfacts.org';
const OFF_IMAGE_HOST='images.openfoodfacts.org';

export function cleanImageSearch(value){
  return String(value||'').trim().replace(/\s+/g,' ').slice(0,120);
}

export function imageSearchTerms(value){
  const ignored=new Set(['the','and','for','with','pack','packet','product']);
  return cleanImageSearch(value).toLowerCase().split(/[^a-z0-9]+/).filter(word=>word.length>1&&!ignored.has(word)).slice(0,8);
}

export function isOpenFoodFactsImage(value){
  try{const url=new URL(value);return url.protocol==='https:'&&url.hostname===OFF_IMAGE_HOST&&url.pathname.startsWith('/images/products/');}catch{return false;}
}

function productCandidate(product){
  if(!product||typeof product!=='object')return null;
  const imageUrl=product.image_front_small_url||product.image_front_url;
  if(!isOpenFoodFactsImage(imageUrl))return null;
  const name=cleanImageSearch(product.product_name)||cleanImageSearch(product.generic_name)||'Unnamed product';
  const details=[cleanImageSearch(product.brands),cleanImageSearch(product.quantity)].filter(Boolean).join(' · ');
  return {provider:'openfoodfacts',name,details,imageUrl,sourceUrl:product.url||`https://${OFF_HOST}/product/${encodeURIComponent(product.code||'')}`,sourceLabel:'Open Food Facts'};
}

async function getJson(url,fetchImpl,userAgent){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),9000);
  try{
    const response=await fetchImpl(url,{headers:{'User-Agent':userAgent,Accept:'application/json'},signal:controller.signal});
    if(!response.ok)throw Error(`Product image service returned ${response.status}.`);
    return await response.json();
  }finally{clearTimeout(timer);}
}

export async function searchOpenFoodFacts({query,barcode,limit=4,fetchImpl=fetch,userAgent='AspireAIBilling/1.0 (local-demo@example.invalid)'}){
  const candidates=[];
  if(/^\d{8,14}$/.test(String(barcode||''))){
    const fields='code,product_name,generic_name,brands,quantity,image_front_small_url,image_front_url,url';
    const data=await getJson(`https://${OFF_HOST}/api/v2/product/${encodeURIComponent(barcode)}.json?fields=${fields}`,fetchImpl,userAgent);
    const candidate=productCandidate(data.product);if(candidate)candidates.push(candidate);
  }
  if(candidates.length<limit&&cleanImageSearch(query)){
    const params=new URLSearchParams({action:'process',search_simple:'1',json:'1',page_size:'8',fields:'code,product_name,generic_name,brands,quantity,image_front_small_url,image_front_url,url',search_terms:cleanImageSearch(query)});
    const data=await getJson(`https://${OFF_HOST}/cgi/search.pl?${params}`,fetchImpl,userAgent);
    for(const product of data.products||[]){const candidate=productCandidate(product);if(candidate&&!candidates.some(row=>row.imageUrl===candidate.imageUrl))candidates.push(candidate);if(candidates.length>=limit)break;}
  }
  return candidates.slice(0,limit);
}

export async function downloadOpenFoodFactsImage(value,{fetchImpl=fetch,userAgent='AspireAIBilling/1.0 (local-demo@example.invalid)',maxBytes=256*1024}={}){
  if(!isOpenFoodFactsImage(value))throw Object.assign(Error('Choose an image returned by Open Food Facts.'),{status:400});
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
  try{
    const response=await fetchImpl(value,{headers:{'User-Agent':userAgent,Accept:'image/jpeg,image/png,image/webp'},signal:controller.signal,redirect:'error'});
    if(!response.ok)throw Object.assign(Error('The selected product image could not be downloaded.'),{status:502});
    const mime=String(response.headers.get('content-type')||'').split(';')[0].toLowerCase();
    if(!['image/jpeg','image/png','image/webp'].includes(mime))throw Object.assign(Error('The selected result is not a supported product image.'),{status:400});
    const declared=Number(response.headers.get('content-length')||0);if(declared>maxBytes)throw Object.assign(Error('The selected image is too large. Choose another result or upload a photo.'),{status:413});
    const bytes=Buffer.from(await response.arrayBuffer());if(bytes.length>maxBytes)throw Object.assign(Error('The selected image is too large. Choose another result or upload a photo.'),{status:413});
    return `data:${mime};base64,${bytes.toString('base64')}`;
  }finally{clearTimeout(timer);}
}

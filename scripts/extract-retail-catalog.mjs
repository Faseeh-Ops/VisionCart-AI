// Read-only, resumable retailer catalog snapshot. Does not connect to MongoDB.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {rahimCategories, rahimListing, carrefourCategories, carrefourListing, csv} from './retail-catalog-parsers.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'datasets/retail-catalog');
const cache = path.join(root, '.tools/retail-catalog-cache');
await fs.mkdir(output, {recursive:true}); await fs.mkdir(cache, {recursive:true});
const args = new Set(process.argv.slice(2));
const stores = ['rahim','carrefour','imtiaz'];
const categories = [], products = new Map(), failures = [], sources = [];
const started = new Date().toISOString();
let stopped = false;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const readJSON = async file => { try { return JSON.parse(await fs.readFile(file,'utf8')); } catch { return null; } };
async function writeJSON(file, data) {
  const temporary=file+'.'+randomUUID()+'.tmp';
  await fs.writeFile(temporary,JSON.stringify(data,null,2)+'\n');
  await fs.rename(temporary,file);
}
async function request(url, options = {}) {
  let error;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(url, {...options, headers:{'User-Agent':'VisionCartCatalog/1.0 (user-requested public catalog snapshot)',...options.headers}, signal:AbortSignal.timeout(20000)});
      if (!response.ok) { const e = Error(`HTTP ${response.status}`); e.status = response.status; e.retryAfter = response.headers.get('retry-after'); throw e; }
      return response;
    } catch (e) { error = e; if (e.status && e.status < 500) break; if (!attempt) await pause(1500); }
  }
  throw error;
}
function merge(list) {
  for (const p of list) {
    const previous = products.get(p.id);
    if (previous) {
      previous.category_ids = [...new Set([...previous.category_ids,...p.category_ids])];
      previous.category_names = [...new Set([...previous.category_names,...p.category_names])];
      if (previous.regular_price !== p.regular_price || previous.selling_price !== p.selling_price) previous.price_varies_between_listings = true;
    } else products.set(p.id, p);
  }
}
const fields = ['id','store','source_product_id','name','barcode','currency','regular_price','selling_price','price_unit','price_basis','availability','category_ids','category_names','source_url','image_url','image_file','image_status','location_context','service_context','seller','scraped_at','price_varies_between_listings'];
async function save() {
  const rows = [...products.values()].sort((a,b) => a.id.localeCompare(b.id));
  const categoryNames=new Map(categories.filter(c=>c.name&&c.name!=='View All').map(c=>[`${c.store}:${c.id}`,c.name]));
  for(const p of rows)p.category_names=[...new Set(p.category_ids.map(id=>categoryNames.get(`${p.store}:${id}`)).filter(Boolean))];
  await writeJSON(path.join(output,'products.json'),rows);
  await fs.writeFile(path.join(output,'products.csv'),csv(rows,fields));
  await writeJSON(path.join(output,'categories.json'),categories);
  await writeJSON(path.join(output,'coverage.json'),{started_at:started,updated_at:new Date().toISOString(),complete_catalog:false,notes:['All discovered categories are scheduled; actual attempted and remaining counts are reported below. Access failures and rate limits can prevent completing discovery. Carrefour pagination URLs are excluded by its robots.txt; first-page coverage is incomplete where totalResults exceeds returned products.','Retail catalog photos are reference images, not YOLO bounding-box training data. Products sold in Pakistan are not necessarily manufactured in Pakistan.','Retailer product IDs are not barcodes. Missing barcodes remain null.','Prices are retailer/location snapshots and must be confirmed before importing into a live store.'],sources,counts:Object.fromEntries(stores.map(store => [store,{products:rows.filter(p=>p.store===store).length,categories_discovered:categories.filter(c=>c.store===store).length,categories_attempted:categories.filter(c=>c.store===store&&c.status).length,categories_remaining:categories.filter(c=>c.store===store&&!c.status).length,images_downloaded:rows.filter(p=>p.store===store&&p.image_status==='downloaded').length,images_failed:rows.filter(p=>p.store===store&&p.image_status==='failed').length}])),failures});
}
async function pool(items, worker, concurrency = 2, delay = 300) {
  let index = 0;
  await Promise.all(Array.from({length:concurrency},async()=>{ while(index<items.length && !stopped) { const i=index++; await worker(items[i],i); await pause(delay); } }));
}
async function runRahim() {
  const html = await (await request('https://www.rahimstore.com/index')).text();
  const list = rahimCategories(html); categories.push(...list);
  sources.push({store:'rahim',url:'https://www.rahimstore.com/index',status:'public_catalog',regular_price_rule:'Struck-through Was price when present, otherwise the displayed price.',pagination:'Public category listing and its pagination; no cart operations.'});
  let done = 0;
  await pool(list,async category => {
    const file = path.join(cache,`rahim-${category.id}.json`);
    let data = args.has('--refresh') ? null : await readJSON(file);
    try {
      if (!data) {
        const post = params => request('https://www.rahimstore.com/actionShopping.php',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(params)}).then(r=>r.text());
        const first = rahimListing(await post({shopping_navbar_option_by_hitemcode:'1',hitem_code:category.id,start_row:'0'}),category,new Date().toISOString());
        if (first.total > 0 && !first.products.length) throw Error('Product listing could not be parsed');
        data = {products:first.products,total:first.total,pages:1};
        if (first.total != null) for (let page=2;page<=Math.ceil(first.total/20);page++) {
          await pause(300);
          const next = rahimListing(await post({shop_by_group_page:'1',row_count:String(first.total),page_no:String(page),table_flag:'group',code:category.id,price:'0'}),category,new Date().toISOString());
          if (!next.products.length) throw Error(`Empty pagination response on page ${page}`);
          if (next.products.every(p=>data.products.some(old=>old.id===p.id))) throw Error(`Pagination repeated products on page ${page}`);
          data.products.push(...next.products); data.pages++;
        }
        await writeJSON(file,data);
      }
      merge(data.products); Object.assign(category,{status:data.total==null?'parsed_total_unknown':'ok',reported_total:data.total,products_collected:new Set(data.products.map(p=>p.id)).size,pages:data.pages});
    } catch (e) { category.status='failed'; failures.push({store:'rahim',url:category.url,error:e.message}); if ([403,429].includes(e.status)) stopped=true; }
    done++; if (done%10===0 || done===list.length) { console.log(`Rahim ${done}/${list.length} categories; ${products.size} products overall`); await save(); }
  });
}
async function runCarrefour() {
  const [html, sitemap] = await Promise.all(['https://www.carrefour.pk/mafpak/en/all-categories','https://www.carrefour.pk/sitemaps/plp_en.xml'].map(url => request(url).then(r=>r.text())));
  const list = carrefourCategories(html,sitemap); categories.push(...list);
  const source={store:'carrefour',url:'https://www.carrefour.pk/mafpak/en/all-categories',sitemap:'https://www.carrefour.pk/sitemaps/plp_en.xml',status:'public_catalog_partial',regular_price_rule:'Explicit markedPrice field; sellingPrice stored separately.',pagination:'First page of each accessible category, subject to rate limits. currentPage URLs excluded by retailer robots.txt.',location_context:'Public website default; observed Akram Abad Walton - Lahore during inspection. Availability and prices may vary by address.'};
  sources.push(source);
  let done = 0;
  await pool(list,async category => {
    const file=path.join(cache,`carrefour-${category.id}.json`);
    let data=args.has('--refresh') ? null : await readJSON(file);
    try {
      if (!data) {
        data = carrefourListing(await (await request(category.url)).text(),category,new Date().toISOString());
        if (!data.products.length && !data.pagination) data.empty_or_unrecognized=true;
        await writeJSON(file,data);
      }
      if (data.title) category.name=data.title;
      if (category.name) data.products.forEach(p=>p.category_names=[category.name]);
      merge(data.products);
      Object.assign(category,{status:data.empty_or_unrecognized?'empty_or_unrecognized':'ok',products_collected:data.products.length,reported_total:data.pagination?.totalResults ?? null,pages:1,pagination_incomplete:(data.pagination?.totalPages||0)>1});
    } catch(e) { category.status='failed'; failures.push({store:'carrefour',url:category.url,error:e.message,retry_after:e.retryAfter||null}); if ([403,429].includes(e.status)) {stopped=true;source.status=e.status===429?'rate_limited_partial':'access_denied_partial';} }
    done++; if(done%20===0 || done===list.length) { console.log(`Carrefour ${done}/${list.length} categories; ${products.size} products overall`); await save(); }
  },1,1500);
}
async function runImtiaz() {
  const source={store:'imtiaz',url:'https://imtiaz.com.pk/',catalog_url:'https://shop.imtiaz.com.pk/',status:'unavailable',products:0};
  try { const r=await request(source.catalog_url); source.status='requires_catalog_adapter'; source.http_status=r.status; source.note='Shopping domain responded; no verified product parser is available. No prices inferred from corporate promotional materials.'; }
  catch(e) { source.error=e.cause?.code || e.message; source.note='Corporate site is accessible, but its shopping catalog could not be retrieved. No product prices fabricated.'; }
  sources.push(source);
}
function imageType(b) {
  if(b[0]===255&&b[1]===216&&b[2]===255)return 'jpg';
  if(b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'png';
  if(b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WEBP')return 'webp';
  if(b.toString('ascii',0,6).match(/^GIF8[79]a$/))return 'gif';
  return null;
}
async function downloadImages() {
  const rows=[...products.values()].filter(p=>p.image_url); let done=0;
  const blockedHosts=new Set();
  const dir=path.join(output,'images'); await fs.mkdir(dir,{recursive:true});
  await pool(rows,async p=>{
    const host=new URL(p.image_url).hostname;
    if(blockedHosts.has(host)){p.image_status='skipped_host_limit';return;}
    const safe=p.id.replace(/[^a-zA-Z0-9_-]/g,'_');
    const old=await readJSON(path.join(cache,`image-${safe}.json`));
    if(old?.image_file && old.image_url===p.image_url && await fs.stat(path.join(output,old.image_file)).catch(()=>null))Object.assign(p,old);
    else try {
      const response=await request(p.image_url);
      const bytes=Buffer.from(await response.arrayBuffer()), ext=imageType(bytes);
      if(!response.headers.get('content-type')?.startsWith('image/')||!ext||bytes.length<100)throw Error('Response is not a supported image');
      if(bytes.length>15*1024*1024)throw Error('Image exceeds 15 MB limit');
      p.image_file=`images/${safe}.${ext}`; await fs.writeFile(path.join(output,p.image_file),bytes); p.image_status='downloaded'; p.image_bytes=bytes.length;
      await writeJSON(path.join(cache,`image-${safe}.json`),{image_url:p.image_url,image_file:p.image_file,image_status:p.image_status,image_bytes:p.image_bytes});
    }catch(e){p.image_status='failed';p.image_error=e.message;if([403,429].includes(e.status))blockedHosts.add(host);}
    done++;if(done%100===0||done===rows.length){console.log(`Images ${done}/${rows.length}`);await save();}
  },8,300);
}
if (args.has('--images-only') || args.has('--finalize-only')) {
  const old=await readJSON(path.join(output,'products.json')); if(!old)throw Error('Run catalog extraction first'); merge(old);
  const oldCategories=await readJSON(path.join(output,'categories.json')); categories.push(...oldCategories||[]);
  const oldCoverage=await readJSON(path.join(output,'coverage.json')); sources.push(...oldCoverage?.sources||[]);failures.push(...oldCoverage?.failures||[]);
  if(!sources.some(s=>s.store==='imtiaz')&&!args.has('--finalize-only'))await runImtiaz();
  const cf=sources.find(s=>s.store==='carrefour');if(cf&&failures.some(f=>f.store==='carrefour'&&f.error==='HTTP 429'))cf.status='rate_limited_partial';
  if(cf)cf.pagination='First page of each accessible category, subject to rate limits. currentPage URLs excluded by retailer robots.txt.';
} else {
  for(const [name,run] of [['rahim',runRahim],['carrefour',runCarrefour],['imtiaz',runImtiaz]]) {
    stopped=false;
    try{await run();}catch(e){failures.push({store:name,error:e.message});console.error(name,e.message);}
    await save();
  }
}
if(args.has('--download-images')||args.has('--images-only')){stopped=false;await downloadImages();}
await save();
console.log(JSON.stringify({output,products:products.size,failures:failures.length,stopped}));

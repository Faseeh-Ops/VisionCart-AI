import {build} from 'esbuild';
import {createServer} from 'node:http';
import {chromium} from '@playwright/test';
import {writeFile,readFile} from 'node:fs/promises';
const bundle=await build({entryPoints:['models/product-pilot/barcode-browser.js'],bundle:true,format:'esm',write:false});
const server = createServer(async(req,res)=>{
  try {
    if(req.url==='/decoder.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].text);return;}
    const name=decodeURIComponent(req.url.slice(1));
    if(['mehmood barcode.jpeg','innovita barcode.jpeg','tiger barcode.jpeg'].includes(name)){res.setHeader('Content-Type','image/jpeg');res.end(await readFile('models/product-pilot/images/'+name));return;}
    res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Barcode test</title>');
  } catch {res.statusCode=500;res.end('Failed to read test image');}
});
await new Promise(resolve=>server.listen(5189,'127.0.0.1',resolve));
let browser;
try {
  browser = await chromium.launch({channel:'msedge',headless:true});
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:5189', {waitUntil:'domcontentloaded'});
  const rows=[];
  for(const [key,expected,price] of [['mehmood','8697449918281',250],['innovita','8965310043173',10],['tiger','8961003694271',10]]) {
    const result=await page.evaluate(async key=>{const {decodePhoto}=await import('/decoder.js');return decodePhoto('/'+key+' barcode.jpeg');},key);
    rows.push({key,expected,price,...result,matched:result.barcode===expected});
    console.log(JSON.stringify(rows.at(-1)));
  }
  await writeFile('models/product-pilot/barcode-results.json',JSON.stringify(rows,null,2));
} finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}

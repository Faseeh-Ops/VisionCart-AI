import {test} from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {rtspRouter,validateRtspUrl} from './rtsp.js';
test('RTSP address validation accepts camera IPs and rejects unsafe protocols',()=>{
 assert.equal(validateRtspUrl('rtsp://192.168.1.50:554/stream1'),'rtsp://192.168.1.50:554/stream1');
 for(const url of ['file:///etc/passwd','http://192.168.1.50','rtsp://127.0.0.1/','rtsp://169.254.169.254/','rtsp://localhost/'])assert.throws(()=>validateRtspUrl(url));
});
test('RTSP bridge isolates sessions, delivers split JPEG frames and terminates on disconnect',async()=>{
 const process=new EventEmitter();process.stdout=new PassThrough();process.stderr=new PassThrough();let killed=false;process.kill=()=>{killed=true;};
 const app=express();app.use(express.json());app.use((req,res,next)=>{req.user={id:req.headers['x-user']||'cashier'};next();});app.use('/rtsp',rtspRouter({spawnProcess:()=>process}));
 const server=app.listen(0);await new Promise(resolve=>server.once('listening',resolve));const base='http://127.0.0.1:'+server.address().port;
 try {
  const connect=await fetch(base+'/rtsp/connect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:'rtsp://user:secret@192.168.1.50/stream'})});assert.equal(connect.status,201);const {id}=await connect.json();
  assert.equal((await fetch(base+'/rtsp/'+id+'/frame')).status,202);
  assert.equal((await fetch(base+'/rtsp/'+id+'/frame',{headers:{'x-user':'other'}})).status,404);
  const jpeg=Buffer.from([255,216,1,2,3,255,217]);process.stdout.write(jpeg.subarray(0,4));process.stdout.write(jpeg.subarray(4));
  const frame=await fetch(base+'/rtsp/'+id+'/frame');assert.equal(frame.status,200);assert.deepEqual(Buffer.from(await frame.arrayBuffer()),jpeg);
  assert.equal((await fetch(base+'/rtsp/'+id+'/disconnect',{method:'POST'})).status,200);assert.equal(killed,true);
  assert.equal((await fetch(base+'/rtsp/'+id+'/frame')).status,404);
 }finally{await new Promise(resolve=>server.close(resolve));}
});

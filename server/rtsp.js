import {Router} from 'express';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {readdirSync,existsSync} from 'node:fs';
import path from 'node:path';
import {isIP} from 'node:net';

export function validateRtspUrl(value) {
 if(typeof value!=='string'||value.length>2048)throw Error('Enter a valid RTSP address.');
 let url;try{url=new URL(value);}catch{throw Error('Enter an address such as rtsp://192.168.1.50:554/stream1.');}
 if(url.protocol!=='rtsp:'||!isIP(url.hostname)||url.hash)throw Error('Use rtsp:// with the camera’s IPv4 address.');
 const octets=url.hostname.split('.').map(Number);
 if(octets.length!==4||octets[0]===0||octets[0]===127||octets[0]>=224||(octets[0]===169&&octets[1]===254))throw Error('Use a camera IP address, not a loopback, link-local or multicast address.');
 return url.href;
}
function ffmpegPath() {
 if(process.env.FFMPEG_PATH)return process.env.FFMPEG_PATH;
 const folder=path.resolve('.tools/rtsp-dependencies/imageio_ffmpeg/binaries');
 if(existsSync(folder)){const binary=readdirSync(folder).find(name=>/^ffmpeg.*\.exe$/i.test(name));if(binary)return path.join(folder,binary);}
 return 'ffmpeg';
}
export function rtspRouter({spawnProcess=spawn}={}) {
 const router=Router(),streams=new Map();
 const stop=id=>{const stream=streams.get(id);if(stream){stream.process.kill();streams.delete(id);}};
 const cleanup=setInterval(()=>{for(const [id,stream] of streams)if(Date.now()-stream.touched>30000)stop(id);},5000);cleanup.unref();
 const own=(req,res)=>{const stream=streams.get(req.params.id);if(!stream||stream.user!==req.user.id){res.status(404).json({error:'Camera session expired. Connect again.'});return;}stream.touched=Date.now();return stream;};
 router.post('/connect',(req,res)=>{
  let url;try{url=validateRtspUrl(req.body.url);}catch(error){return res.status(400).json({error:error.message});}
  for(const [id,stream] of streams)if(stream.user===req.user.id)stop(id);
  if(streams.size>=4)return res.status(429).json({error:'Camera limit reached. Try again shortly.'});
  const id=randomUUID();
  const process=spawnProcess(ffmpegPath(),['-hide_banner','-loglevel','error','-nostdin','-rtsp_transport','tcp','-timeout','10000000','-protocol_whitelist','rtsp,tcp,udp,rtp','-i',url,'-an','-vf','fps=3,scale=1280:-2','-c:v','mjpeg','-q:v','4','-f','image2pipe','pipe:1'],{stdio:['ignore','pipe','pipe'],windowsHide:true});
  const stream={user:req.user.id,process,touched:Date.now(),started:Date.now(),frame:null,error:null,buffer:Buffer.alloc(0)};streams.set(id,stream);
  process.stdout.on('data',data=>{
   stream.buffer=Buffer.concat([stream.buffer,data]);
   if(stream.buffer.length>8*1024*1024){stream.buffer=Buffer.alloc(0);return;}
   while(true){const start=stream.buffer.indexOf(Buffer.from([255,216]));if(start<0){stream.buffer=stream.buffer.at(-1)===255?stream.buffer.subarray(-1):Buffer.alloc(0);break;}const end=stream.buffer.indexOf(Buffer.from([255,217]),start+2);if(end<0)break;stream.frame=stream.buffer.subarray(start,end+2);stream.buffer=stream.buffer.subarray(end+2);}
  });
  // FFmpeg errors can contain credentials in the input URL; never return/log them.
  process.stderr.on('data',()=>{});
  process.on('error',()=>{stream.error='FFmpeg is unavailable. Configure FFMPEG_PATH or install the documented local RTSP dependency.';});
  process.on('close',()=>{stream.error ||= 'RTSP connection ended. Check the address, camera credentials and network connection.';});
  res.status(201).json({id});
 });
 router.get('/:id/frame',(req,res)=>{const stream=own(req,res);if(!stream)return;if(stream.error)return res.status(502).json({error:stream.error});if(!stream.frame){if(Date.now()-stream.started>15000){stop(req.params.id);return res.status(504).json({error:'No frames received. Check the RTSP path, credentials and whether this computer can reach the camera.'});}return res.status(202).json({pending:true});}res.set('Cache-Control','no-store').type('image/jpeg').send(stream.frame);});
 router.post('/:id/disconnect',(req,res)=>{if(!own(req,res))return;stop(req.params.id);res.json({success:true});});
 return router;
}

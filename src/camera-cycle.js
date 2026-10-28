// A visual change gate, not a product identity or quantity detector.
export function frameDistance(a,b){
 if(!a||!b||a.length!==b.length)return Infinity;
 let total=0;for(let i=0;i<a.length;i++)total+=Math.abs(a[i]-b[i]);
 return total/a.length;
}
function changedPixelRatio(a,b,threshold=28){
 if(!a||!b||a.length!==b.length)return 1;
 let changed=0,pixels=0;
 for(let i=0;i<a.length;i+=3){
  const difference=(Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2]))/3;
  if(difference>threshold)changed++;pixels++;
 }
 return pixels?changed/pixels:1;
}
function exposureAdjustedDifference(a,b,threshold=24){
 if(!a||!b||a.length!==b.length)return {distance:Infinity,ratio:1};
 const shift=[0,0,0],pixels=a.length/3;
 for(let i=0;i<a.length;i+=3){shift[0]+=b[i]-a[i];shift[1]+=b[i+1]-a[i+1];shift[2]+=b[i+2]-a[i+2];}
 shift[0]/=pixels;shift[1]/=pixels;shift[2]/=pixels;
 let total=0,changed=0;
 for(let i=0;i<a.length;i+=3){
  const difference=(Math.abs((b[i]-a[i])-shift[0])+Math.abs((b[i+1]-a[i+1])-shift[1])+Math.abs((b[i+2]-a[i+2])-shift[2]))/3;
  total+=difference;if(difference>threshold)changed++;
 }
 return {distance:total/pixels,ratio:changed/pixels};
}
function alignedExposureDifference(a,b,threshold=24){
 // Camera drivers can move or resize the image by a few pixels after
 // autofocus. Compare nearby offsets so the same textured counter remains
 // empty instead of becoming a false product.
 if(!a||!b||a.length!==32*24*3||b.length!==a.length)return exposureAdjustedDifference(a,b,threshold);
 let best={distance:Infinity,ratio:1};
 for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){
  const shifts=[0,0,0],xStart=Math.max(0,-dx),xEnd=Math.min(32,32-dx),yStart=Math.max(0,-dy),yEnd=Math.min(24,24-dy),pixels=(xEnd-xStart)*(yEnd-yStart);
  for(let y=yStart;y<yEnd;y++)for(let x=xStart;x<xEnd;x++){
   const left=(y*32+x)*3,right=((y+dy)*32+x+dx)*3;
   for(let channel=0;channel<3;channel++)shifts[channel]+=b[right+channel]-a[left+channel];
  }
  shifts[0]/=pixels;shifts[1]/=pixels;shifts[2]/=pixels;
  let total=0,changed=0;
  for(let y=yStart;y<yEnd;y++)for(let x=xStart;x<xEnd;x++){
   const left=(y*32+x)*3,right=((y+dy)*32+x+dx)*3;
   const difference=(Math.abs((b[right]-a[left])-shifts[0])+Math.abs((b[right+1]-a[left+1])-shifts[1])+Math.abs((b[right+2]-a[left+2])-shifts[2]))/3;
   total+=difference;if(difference>threshold)changed++;
  }
  const result={distance:total/pixels,ratio:changed/pixels};
  if(result.distance+result.ratio*40<best.distance+best.ratio*40)best=result;
 }
 return best;
}
export function meaningfulFrameChange(a,b){
 if(!a||!b||a.length!==b.length)return false;
 if(a.length!==32*24*3){
  const rawRatio=changedPixelRatio(a,b,20),direct=exposureAdjustedDifference(a,b,18);
  return direct.distance>6||(rawRatio>.012&&direct.ratio>.012);
 }
 const adjusted=alignedExposureDifference(a,b,18);
 // Require localized structural change after compensating for exposure. This
 // catches a small replacement packet without reacting to exposure or a
 // two-pixel autofocus shift.
 return adjusted.distance>6||adjusted.ratio>.012;
}
function resemblesBackground(background,frame){
 // Uniform exposure changes and JPEG noise should remain "empty". A product
 // creates a localized group of strongly changed pixels instead.
 const rawDistance=frameDistance(background,frame),rawRatio=changedPixelRatio(background,frame);
 if(background?.length!==32*24*3){
  const direct=exposureAdjustedDifference(background,frame);
  return (rawDistance<26&&rawRatio<.015)||(rawDistance<45&&direct.distance<8&&direct.ratio<.015);
 }
 const adjusted=alignedExposureDifference(background,frame);
 return (rawDistance<26&&rawRatio<.015)||(adjusted.distance<9&&adjusted.ratio<.015);
}
export function createCameraCycle(){
 let captured=null,previous=null,stableSince=0,changed=false,departed=false,background=null,backgroundSeenAt=0;
 return {
  reset(){background=null;captured=null;previous=null;stableSince=0;changed=false;departed=false;backgroundSeenAt=0;},
  setBackground(frame){background=frame;captured=null;previous=frame;stableSince=0;changed=false;departed=false;backgroundSeenAt=0;},
  // Prepare for another unit without replacing the trusted empty-counter
  // reference with a transitional frame that may still contain a product.
  rearm(frame=background){captured=null;previous=frame;stableSince=0;changed=false;departed=false;backgroundSeenAt=0;},
  capture(frame){captured=frame;previous=frame;stableSince=0;changed=false;departed=false;backgroundSeenAt=0;},
  isBackground(frame){return Boolean(background&&resemblesBackground(background,frame));},
  observe(frame,now){
   // Compressed webcam and RTSP feeds change slightly even when the scene is
   // still. Ignore that normal noise so checkout does not wait indefinitely.
   const moving=frameDistance(previous,frame)>10;previous=frame;
   if(background){
    const empty=resemblesBackground(background,frame);
    if(empty){if(!backgroundSeenAt)backgroundSeenAt=now;if(now-backgroundSeenAt>=500)departed=true;if(moving)stableSince=now;return false;}
    if(backgroundSeenAt&&now-backgroundSeenAt>=500)departed=true;
    backgroundSeenAt=0;
    if(moving){stableSince=now;return false;}
    if(!stableSince)stableSince=now;
    if(captured&&frameDistance(captured,frame)>22)changed=true;
    return now-stableSince>=150&&(!captured||departed);
   }
   if(moving){stableSince=now;return false;}
   if(!stableSince)stableSince=now;
   if(captured&&frameDistance(captured,frame)>22)changed=true;
   // A sustained departure lets an identical-looking next packet be scanned.
   // Brief movement away and back does not rearm the camera.
   if(captured&&frameDistance(captured,frame)>22&&now-stableSince>=500)departed=true;
   return now-stableSince>=600&&(!captured||(changed&&(departed||frameDistance(captured,frame)>18)));
  },
 };
}
export function cameraFingerprint(element){
 const w=element.videoWidth||element.naturalWidth,h=element.videoHeight||element.naturalHeight;
 if(!w||!h)return null;
 const canvas=document.createElement('canvas');canvas.width=32;canvas.height=24;
 const ctx=canvas.getContext('2d',{willReadFrequently:true});
 ctx.drawImage(element,w*.15,h*.1,w*.7,h*.8,0,0,32,24);
 const rgba=ctx.getImageData(0,0,32,24).data,result=[];
 for(let i=0;i<rgba.length;i+=4)result.push(rgba[i],rgba[i+1],rgba[i+2]);
 return result;
}

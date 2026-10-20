// A visual change gate, not a product identity or quantity detector.
export function frameDistance(a,b){
 if(!a||!b||a.length!==b.length)return Infinity;
 let total=0;for(let i=0;i<a.length;i++)total+=Math.abs(a[i]-b[i]);
 return total/a.length;
}
export function createCameraCycle(){
 let captured=null,previous=null,stableSince=0,changed=false,departed=false,background=null;
 return {
  reset(){background=null;captured=null;previous=null;stableSince=0;changed=false;departed=false;},
  setBackground(frame){background=frame;captured=null;previous=frame;stableSince=0;changed=false;departed=false;},
  capture(frame){captured=frame;previous=frame;stableSince=0;changed=false;departed=false;},
  observe(frame,now){
   const moving=frameDistance(previous,frame)>6;previous=frame;
   if(moving){stableSince=now;return false;}
   if(!stableSince)stableSince=now;
   if(captured&&frameDistance(captured,frame)>22)changed=true;
   if(background){
    const empty=frameDistance(background,frame)<12;
    if(empty&&now-stableSince>=500)departed=true;
    if(empty)return false;
    return now-stableSince>=800&&(!captured||departed);
   }
   // A sustained departure lets an identical-looking next packet be scanned.
   // Brief movement away and back does not rearm the camera.
   if(captured&&frameDistance(captured,frame)>22&&now-stableSince>=500)departed=true;
   return now-stableSince>=800&&(!captured||(changed&&(departed||frameDistance(captured,frame)>18)));
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

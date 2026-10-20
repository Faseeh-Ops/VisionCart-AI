export function productPhotoFromElement(element){
 const width=element.videoWidth||element.naturalWidth,height=element.videoHeight||element.naturalHeight;
 if(!width||!height)throw Error('Camera or image is not ready.');
 const scale=Math.min(1,640/Math.max(width,height)),canvas=document.createElement('canvas');
 canvas.width=Math.max(1,Math.round(width*scale));canvas.height=Math.max(1,Math.round(height*scale));
 const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(element,0,0,canvas.width,canvas.height);
 for(const quality of [.88,.72,.5]){const photo=canvas.toDataURL('image/jpeg',quality);if(photo.length<340000)return photo;}
 throw Error('Choose a smaller product photo.');
}
export async function prepareProductPhoto(file){
 if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>15*1024*1024)throw Error('Choose a JPEG, PNG or WebP product photo under 15 MB.');
 const url=URL.createObjectURL(file);
 try{const image=new Image();image.src=url;await image.decode();return productPhotoFromElement(image);}finally{URL.revokeObjectURL(url);}
}

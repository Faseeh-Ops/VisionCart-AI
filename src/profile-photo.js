export async function preparePhoto(file){
  if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw Error('Choose a JPEG, PNG or WebP photo.');
  if(file.size>5*1024*1024)throw Error('Choose a photo smaller than 5 MB.');
  const url=URL.createObjectURL(file);
  try{const image=new Image();image.src=url;await image.decode();const size=Math.min(image.naturalWidth,image.naturalHeight);if(!size)throw Error('Invalid image.');const canvas=document.createElement('canvas');canvas.width=canvas.height=256;const ctx=canvas.getContext('2d');ctx.fillStyle='#ffffff';ctx.fillRect(0,0,256,256);ctx.drawImage(image,(image.naturalWidth-size)/2,(image.naturalHeight-size)/2,size,size,0,0,256,256);return canvas.toDataURL('image/jpeg',.85);}catch(error){throw Error(error.message||'Could not read the photo.');}finally{URL.revokeObjectURL(url);}
}

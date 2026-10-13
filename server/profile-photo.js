export function validatePhoto(photo) {
  if(photo===null)return null;
  if(typeof photo!=='string')throw Error('Choose a JPEG, PNG or WebP image.');
  const match=photo.match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
  if(!match)throw Error('Choose a JPEG, PNG or WebP image.');
  const bytes=Buffer.from(match[2],'base64');
  if(bytes.length>256*1024||bytes.length<12||bytes.toString('base64')!==match[2])throw Error('Profile photo must be a valid image under 256 KB.');
  const valid=match[1]==='jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:match[1]==='png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
  if(!valid)throw Error('Image format does not match its contents.');
  return photo;
}


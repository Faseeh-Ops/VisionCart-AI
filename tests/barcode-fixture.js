// A real EAN-13 encoding used to test the scanner decoder, not an image mock.
export function barcodeImage() {
  const code='1234567890128';
  const left=['0001101','0011001','0010011','0111101','0100011','0110001','0101111','0111011','0110111','0001011'];
  const alternate=['0100111','0110011','0011011','0100001','0011101','0111001','0000101','0010001','0001001','0010111'];
  const right=left.map(bits=>bits.replace(/[01]/g,b=>b==='0'?'1':'0'));
  const parity='LLGLGG';
  let bits='101';
  for(let i=1;i<=6;i++)bits+=(parity[i-1]==='L'?left:alternate)[Number(code[i])];
  bits+='01010';
  for(let i=7;i<=12;i++)bits+=right[Number(code[i])];
  bits+='101';
  const canvas=document.createElement('canvas');canvas.width=460;canvas.height=220;
  const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,460,220);ctx.fillStyle='black';
  [...bits].forEach((bit,index)=>{if(bit==='1')ctx.fillRect(40+index*4,30,4,150);});
  return canvas.toDataURL('image/png').split(',')[1];
}

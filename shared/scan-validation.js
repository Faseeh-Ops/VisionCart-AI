const gtinFormats=new Set(['EAN_13','EAN_8','UPC_A']);

function validGtin(text){
 const digits=text.split('').map(Number),check=digits.pop();
 const sum=digits.reverse().reduce((total,digit,index)=>total+digit*(index%2===0?3:1),0);
 return (10-sum%10)%10===check;
}

export function validScannedCode(value,format='UNKNOWN'){
 const text=String(value||'').trim(),type=String(format||'UNKNOWN');
 if(text.length<4||text.length>128||/[\u0000-\u001f\u007f]/.test(text))return false;
 if(type==='EAN_13'&&!/^\d{13}$/.test(text))return false;
 if(type==='EAN_8'&&!/^\d{8}$/.test(text))return false;
 if(type==='UPC_A'&&!/^\d{12}$/.test(text))return false;
 if(gtinFormats.has(type)&&!validGtin(text))return false;
 if(type==='UPC_E'&&!/^\d{8}$/.test(text))return false;
 if(type==='ITF'&&(!/^\d+$/.test(text)||text.length<6||text.length%2!==0))return false;
 return true;
}

export function createScanConsensus({required=2,windowMs=2200}={}){
 let candidate='',format='',hits=0,lastAt=0;
 return {
  add(value,type='UNKNOWN',now=Date.now()){
   const text=String(value||'').trim(),nextFormat=String(type||'UNKNOWN');
   if(!validScannedCode(text,nextFormat)){candidate='';format='';hits=0;lastAt=0;return null;}
   if(text===candidate&&nextFormat===format&&now-lastAt<=windowMs)hits++;
   else{candidate=text;format=nextFormat;hits=1;}
   lastAt=now;
   return hits>=required?{text,format}:null;
  },
  reset(){candidate='';format='';hits=0;lastAt=0;},
 };
}

import {decodeBarcodePhoto} from '../../src/barcode-scanner.js';
export async function decodePhoto(url) {
  try {const result=await decodeBarcodePhoto(url);return {barcode:result.getText()};}
  catch(error) {return {barcode:null,error:error.message};}
}

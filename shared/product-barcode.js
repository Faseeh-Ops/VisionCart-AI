const INTERNAL_CODE_PATTERN=/^(?:ASPIRE|RETAIL)-/i;

export const normalizeProductBarcode=value=>String(value??'').trim();

export const hasInternalProductCode=product=>product?.barcodeKind==='internal'||INTERNAL_CODE_PATTERN.test(normalizeProductBarcode(product?.barcode));

export const canManageProductBarcode=product=>Boolean(product?._id);

export const validPhysicalProductBarcode=value=>{
  const barcode=normalizeProductBarcode(value);
  return barcode.length>=4&&barcode.length<=128&&!INTERNAL_CODE_PATTERN.test(barcode)&&!/[^\x20-\x7E]/.test(barcode);
};

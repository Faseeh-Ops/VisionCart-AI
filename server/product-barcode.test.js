import test from 'node:test';
import assert from 'node:assert/strict';
import {hasInternalProductCode,normalizeProductBarcode,validPhysicalProductBarcode} from '../shared/product-barcode.js';

test('recognizes imported placeholder codes as products without printed barcodes',()=>{
  assert.equal(hasInternalProductCode({barcode:'RETAIL-123',barcodeKind:'internal'}),true);
  assert.equal(hasInternalProductCode({barcode:'ASPIRE-COFFEE-01'}),true);
  assert.equal(hasInternalProductCode({barcode:'8961003694271',barcodeKind:'physical'}),false);
});

test('normalizes and validates scanned physical product barcodes',()=>{
  assert.equal(normalizeProductBarcode(' 8961003694271\r\n'),'8961003694271');
  assert.equal(validPhysicalProductBarcode('8961003694271'),true);
  assert.equal(validPhysicalProductBarcode('RETAIL-123'),false);
  assert.equal(validPhysicalProductBarcode('12'),false);
});

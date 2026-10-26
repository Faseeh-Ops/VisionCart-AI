import test from 'node:test';
import assert from 'node:assert/strict';
import {createScanConsensus,validScannedCode} from '../shared/scan-validation.js';

test('validates GTIN checksums and rejects malformed live detections',()=>{
 assert.equal(validScannedCode('8961003694271','EAN_13'),true);
 assert.equal(validScannedCode('8961003694272','EAN_13'),false);
 assert.equal(validScannedCode('12','CODE_128'),false);
 assert.equal(validScannedCode('ASPIRE-LAYS-52','CODE_128'),true);
});

test('requires the same live code in consecutive frames',()=>{
 const consensus=createScanConsensus({required:2,windowMs:1000});
 assert.equal(consensus.add('ASPIRE-LAYS-52','CODE_128',1000),null);
 assert.deepEqual(consensus.add('ASPIRE-LAYS-52','CODE_128',1500),{text:'ASPIRE-LAYS-52',format:'CODE_128'});
 consensus.reset();
 assert.equal(consensus.add('FALSE-LINES','CODE_39',3000),null);
 assert.equal(consensus.add('DIFFERENT-LINES','CODE_39',3200),null);
});

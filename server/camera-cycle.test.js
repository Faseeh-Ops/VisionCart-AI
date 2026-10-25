import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createCameraCycle} from '../src/camera-cycle.js';
const frame=value=>Array(48).fill(value);
test('waits for stable view and does not repeat a stationary product',()=>{
 const gate=createCameraCycle();
 assert.equal(gate.observe(frame(80),1000),false);
 assert.equal(gate.observe(frame(80),1900),true);
 gate.capture(frame(80));
 for(const now of [2000,3000,6000])assert.equal(gate.observe(frame(82),now),false);
});
test('replacement must settle before the next scan',()=>{
 const gate=createCameraCycle();gate.capture(frame(80));
 assert.equal(gate.observe(frame(140),1000),false);
 assert.equal(gate.observe(frame(160),1300),false);
 assert.equal(gate.observe(frame(160),1700),false);
 assert.equal(gate.observe(frame(160),2200),true);
 gate.capture(frame(160));
 assert.equal(gate.observe(frame(160),4000),false);
});
test('returning to the captured view does not trigger a repeated scan',()=>{
 const gate=createCameraCycle();gate.capture(frame(80));
 gate.observe(frame(160),1000);gate.observe(frame(160),1300);
 gate.observe(frame(80),1600);
 assert.equal(gate.observe(frame(80),3000),false);
 gate.reset();assert.equal(gate.observe(frame(80),4000),false);
 assert.equal(gate.observe(frame(80),4900),true);
});

test('a sustained departure permits an identical-looking next unit',()=>{
 const gate=createCameraCycle();gate.capture(frame(80));
 assert.equal(gate.observe(frame(160),1000),false);
 assert.equal(gate.observe(frame(160),1550),false);
 assert.equal(gate.observe(frame(80),1600),false);
 assert.equal(gate.observe(frame(80),2450),true);
 gate.capture(frame(80));
 assert.equal(gate.observe(frame(80),4000),false);
});

test('calibrated empty area never submits a product, including after removal',()=>{
 const gate=createCameraCycle();gate.setBackground(frame(160));
 for(const now of [1000,2000,5000])assert.equal(gate.observe(frame(160),now),false);
 assert.equal(gate.observe(frame(80),6000),false);
 assert.equal(gate.observe(frame(80),6900),true);gate.capture(frame(80));
 gate.observe(frame(160),7000);
 for(const now of [7600,9000])assert.equal(gate.observe(frame(160),now),false);
 gate.observe(frame(80),10000);
 assert.equal(gate.observe(frame(80),10900),true);
});

test('calibrated cycle requires clearing the area, even if the same packet moves',()=>{
 const gate=createCameraCycle();gate.setBackground(frame(200));gate.capture(frame(80));
 gate.observe(frame(120),1000);
 assert.equal(gate.observe(frame(120),2000),false);
 gate.observe(frame(80),3000);
 assert.equal(gate.observe(frame(80),4000),false);
});

test('a brief empty frame does not rearm calibrated scanning',()=>{
 const gate=createCameraCycle();gate.setBackground(frame(200));gate.capture(frame(80));
 gate.observe(frame(200),1000);gate.observe(frame(200),1250);
 gate.observe(frame(80),1400);
 assert.equal(gate.observe(frame(80),2400),false);
});

test('a held empty area rearms even when slow processing yields one empty frame',()=>{
 const gate=createCameraCycle();gate.setBackground(frame(200));gate.capture(frame(80));
 assert.equal(gate.observe(frame(200),1000),false);
 assert.equal(gate.observe(frame(80),3700),false);
 assert.equal(gate.observe(frame(80),4600),true);
});

test('reports when a calibrated camera has returned to its empty scan area',()=>{
 const gate=createCameraCycle();gate.setBackground(frame(200));
 assert.equal(gate.isBackground(frame(200)),true);
 assert.equal(gate.isBackground(frame(190)),true);
 assert.equal(gate.isBackground(frame(80)),false);
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createCameraCycle,meaningfulFrameChange} from '../src/camera-cycle.js';
const frame=value=>Array(48).fill(value);
const texturedFrame=()=>{
 const output=[];
 for(let y=0;y<24;y++)for(let x=0;x<32;x++){
  const value=35+(x*19+y*13+x*y*3)%180;output.push(value,Math.min(255,value+17),Math.max(0,value-11));
 }
 return output;
};
const shiftedFrame=(source,dx,dy)=>{
 const output=Array(source.length).fill(0);
 for(let y=0;y<24;y++)for(let x=0;x<32;x++){
  const fromX=Math.max(0,Math.min(31,x-dx)),fromY=Math.max(0,Math.min(23,y-dy));
  for(let channel=0;channel<3;channel++)output[(y*32+x)*3+channel]=source[(fromY*32+fromX)*3+channel];
 }
 return output;
};
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

test('rearming preserves the original empty-counter reference',()=>{
 const gate=createCameraCycle();gate.setBackground(frame(200));gate.capture(frame(80));
 gate.rearm(frame(198));
 assert.equal(gate.isBackground(frame(200)),true);
 assert.equal(gate.isBackground(frame(80)),false);
 assert.equal(gate.observe(frame(80),1000),false);
 assert.equal(gate.observe(frame(80),1200),true);
});

test('a textured empty counter remains empty after a small camera shift',()=>{
 const background=texturedFrame(),shifted=shiftedFrame(background,2,-1),product=[...shifted];
 for(let y=8;y<16;y++)for(let x=12;x<20;x++){
  const index=(y*32+x)*3;product[index]=235;product[index+1]=35;product[index+2]=70;
 }
 const gate=createCameraCycle();gate.setBackground(background);
 assert.equal(gate.isBackground(shifted),true);
 assert.equal(meaningfulFrameChange(background,shifted),false);
 assert.equal(gate.isBackground(product),false);
 assert.equal(meaningfulFrameChange(background,product),true);
});

test('a guarded rolling empty reference follows gradual camera drift',()=>{
 const gate=createCameraCycle();let current=texturedFrame();gate.setBackground(current);
 for(let shift=1;shift<=6;shift++){
  const next=shiftedFrame(texturedFrame(),shift,0);
  assert.equal(gate.isBackground(next),true);
  gate.setBackground(next);current=next;
 }
 assert.equal(gate.isBackground(current),true);
});

test('camera exposure changes remain empty but a localized product does not',()=>{
 const background=Array(300).fill(120),brighter=Array(300).fill(155),product=Array(300).fill(120);
 for(let pixel=0;pixel<2;pixel++)for(let channel=0;channel<3;channel++)product[pixel*3+channel]=220;
 const gate=createCameraCycle();gate.setBackground(background);
 assert.equal(gate.isBackground(brighter),true);
 assert.equal(gate.isBackground(product),false);
 assert.equal(meaningfulFrameChange(background,brighter),false);
 assert.equal(meaningfulFrameChange(background,product),true);
});

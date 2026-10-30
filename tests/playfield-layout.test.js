import test from 'node:test';
import assert from 'node:assert/strict';
import {PLAYFIELD_REFERENCE,playfieldLayout} from '../studio/playfield-layout.js';

test('proportional viewport resizing preserves every normalized design dimension',()=>{
 const {width,height}=PLAYFIELD_REFERENCE;
 for(const factor of [.5,.8,1,1.25,2,3]){
  const layout=playfieldLayout(width*factor,height*factor);
  assert(Math.abs(layout.scale-factor)<1e-10);
  assert(Math.abs(layout.lift)<1e-10);
 }
});
test('aspect changes fit the composition and split only the additional vertical room',()=>{
 assert.deepEqual(playfieldLayout(359,945),{scale:1,lift:100});
 assert.deepEqual(playfieldLayout(559,745),{scale:1,lift:0});
 const a=playfieldLayout(320,900),b=playfieldLayout(640,1800);
 assert.equal(b.scale,a.scale*2);assert.equal(b.lift,a.lift*2);
});
test('hidden or invalid viewport measurements cannot overwrite a valid layout',()=>{
 for(const [w,h] of [[0,745],[359,0],[-1,745],[Infinity,745],[359,NaN]])assert.equal(playfieldLayout(w,h),null);
});

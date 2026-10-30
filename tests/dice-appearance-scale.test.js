import test from 'node:test';
import assert from 'node:assert/strict';
import {diceAppearanceScale} from '../dice/appearance-scale.js';

test('game dice keep their design scale while the rendered viewport scales proportionally',()=>{
 const settings={referenceWidth:250,referenceHeight:200,referenceViewportHeight:300,sizeMultiplier:1.2};
 const baseline=diceAppearanceScale(400,300,settings);
 for(const factor of [.5,1,1.5,2]){
  const scale=diceAppearanceScale(400*factor,300*factor,settings);
  assert.equal(scale,baseline);
  assert.equal(scale*300*factor,baseline*300*factor);
 }
});
test('other dice hosts preserve their existing fixed physical pixel size',()=>{
 const settings={referenceWidth:250,referenceHeight:200,sizeMultiplier:1.2};
 const baseline=diceAppearanceScale(400,300,settings)*300;
 for(const factor of [.5,1,1.5,2])assert(Math.abs(diceAppearanceScale(400*factor,300*factor,settings)*300*factor-baseline)<1e-10);
});

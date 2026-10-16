import test from 'node:test';
import assert from 'node:assert/strict';
import { PresentationReadiness, withinVisualTolerance, DEFAULT_PRESENTATION_POLICY } from '../engine/presentationReadiness.js';
import { spring, springStep, DEFAULT_SETTINGS } from '../engine/motion.js';

test('visual readiness requires both small residual and low velocity in rendered units',()=>{
 assert.equal(withinVisualTolerance({state:{x:1,target:1,v:2},kind:'fan'}),false,'crossing the target at speed is not ready');
 assert.equal(withinVisualTolerance({state:{x:.9,target:1,v:0},kind:'fan'}),false);
 assert.equal(withinVisualTolerance({state:{x:.98,target:1,v:.2},kind:'fan'}),true);
 assert.equal(withinVisualTolerance({state:{x:.04,target:0,v:.4},scale:40}),true,'depth units convert to pixels');
 assert.equal(withinVisualTolerance({state:{x:.04,target:0,v:.4},scale:180,kind:'angle'}),false,'flip units convert to degrees');
});

test('default fan tolerance leads full spring settlement by roughly a quarter second',()=>{
 const signal=new PresentationReadiness(),fan=spring();fan.target=1;let visibleAt,settledAt;
 for(let i=0;i<200;i++) {
  springStep(fan,1/60,{...DEFAULT_SETTINGS,precision:.01});
  const state=signal.update({revision:1,eligible:true,motions:[{state:fan,kind:'fan'}]});
  if(state.visualReady&&visibleAt===undefined)visibleAt=i*1000/60;
  if(state.fullySettled){settledAt=i*1000/60;break;}
 }
 assert.ok(settledAt-visibleAt>=200&&settledAt-visibleAt<=300,`lead: ${settledAt-visibleAt}ms`);
});

test('milestones latch per presentation, respect eligibility, and do not mutate springs',()=>{
 const signal=new PresentationReadiness();const state={x:0,target:0,v:0},before={...state};
 assert.equal(signal.update({revision:1,eligible:false,motions:[{state}]}).visualReady,false);
 assert.equal(signal.update({revision:1,eligible:true,motions:[{state}]}).fullySettled,true);
 state.x=10;
 assert.equal(signal.update({revision:1,eligible:false,motions:[{state}]}).visualReady,true,'later gestures retain the milestone');
 assert.equal(signal.update({revision:2,eligible:true,motions:[{state}]}).visualReady,false,'new revision resets readiness');
 state.x=0;signal.update({revision:2,eligible:true,motions:[{state}]});assert.deepEqual(state,before);
});

test('presentation policy is configurable and rejects invalid thresholds',()=>{
 const signal=new PresentationReadiness({fan:.1,fanSpeed:.8,angle:NaN,position:-1});
 assert.equal(signal.policy.fan,.1);assert.equal(signal.policy.angle,DEFAULT_PRESENTATION_POLICY.angle);
 assert.equal(signal.policy.position,DEFAULT_PRESENTATION_POLICY.position);
});

test('full settlement waits for planned hint and additional motion without delaying visual readiness',()=>{
 const signal=new PresentationReadiness(),rest=spring(),hint=spring(.5);hint.target=0;
 const sample={revision:1,eligible:true,motions:[{state:rest}],settlementMotions:[{state:rest},{state:hint}]};
 assert.deepEqual(signal.update({...sample,canSettle:false}),{revision:1,eligible:true,itemsExposed:false,visualReady:true,fullySettled:false});
 assert.equal(signal.update(sample).fullySettled,false,'hint motion is still running');
 hint.x=hint.target;hint.v=0;
 assert.equal(signal.update(sample).fullySettled,true);
});

test('same-container continuation carries an established visual milestone only',()=>{
 const signal=new PresentationReadiness(),state=spring();
 signal.update({revision:1,eligible:true,motions:[{state}]});
 state.x=10;
 const continued=signal.update({revision:2,eligible:true,motions:[{state}],preserveEstablished:true});
 assert.equal(continued.visualReady,true);assert.equal(continued.fullySettled,false);
 assert.equal(signal.update({revision:3,eligible:true,motions:[{state}]}).visualReady,false,'ordinary replacement resets');
 assert.equal(signal.update({revision:4,eligible:true,motions:[{state}],preserveEstablished:true}).visualReady,false,'preservation cannot invent readiness');
});

test('items exposure is a separate earlier milestone shared by single and stacked items',()=>{
 const signal=new PresentationReadiness(),fan={x:.36,target:1,v:3};
 const motions=[{state:fan,kind:'fan'}];
 const ready=signal.update({revision:1,eligible:true,motions,exposure:{fan:.36,angle:0}});
 assert.equal(ready.itemsExposed,true);assert.equal(ready.visualReady,false);assert.equal(ready.fullySettled,false);
 const continued=signal.update({revision:2,eligible:false,motions,exposure:{fan:0,angle:180},preserveEstablished:true});
 assert.equal(continued.itemsExposed,true,'an established item run keeps its exposure');
 assert.equal(signal.update({revision:3,eligible:true,motions,exposure:{fan:.36,angle:90}}).itemsExposed,false,'edge-on faces are not exposed');
 assert.equal(signal.update({revision:4,eligible:false,motions,exposure:{fan:1,angle:0}}).itemsExposed,false,'outgoing or closed presentations cannot latch');
});

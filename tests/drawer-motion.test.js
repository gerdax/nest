import test from 'node:test';
import assert from 'node:assert/strict';
import { DrawerMotion, DRAWER_MOTION } from '../studio/drawer-motion.js';

function fixture() {
 const animations=[],events=[],classes=new Set();
 const environment={hidden:false,reduced:false,paint:{opacity:'1',transform:'matrix(1, 0, 0, 1, 0, 0)'}};
 const media=new EventTarget();Object.defineProperty(media,'matches',{get:()=>environment.reduced});
 const document=new EventTarget();Object.defineProperty(document,'hidden',{get:()=>environment.hidden});
 document.defaultView={getComputedStyle:()=>environment.paint,matchMedia:()=>media};
 const root={hidden:true,style:{},classList:{add:name=>classes.add(name),remove:name=>classes.delete(name)},setAttribute(){},removeAttribute(){},
  ownerDocument:document,
  animate(frames,options){
   let finish,reject;const finished=new Promise((resolve,fail)=>{finish=resolve;reject=fail;});
   const animation={frames,options,finished,finish,cancel(){this.cancelled=true;reject(new Error('cancelled'));}};
   animations.push(animation);return animation;
  }};
 const motion=new DrawerMotion(root,{onMotion:event=>events.push(event)});
 return {root,motion,animations,events,environment,document,media};
}
const flush=async()=>{await Promise.resolve();await Promise.resolve();};

test('drawer entrance and exit use250ms/50px and exit hides only after finishing',async()=>{
 const {root,motion,animations,events}=fixture();
 motion.setVisible(true);
 assert.equal(root.hidden,false);assert.equal(root.inert,false);
 assert.deepEqual(animations[0].frames,[{opacity:0,transform:'translateY(50px)'},{opacity:1,transform:'translateY(0px)'}]);
 assert.equal(animations[0].options.duration,DRAWER_MOTION.duration);
 motion.setVisible(true);assert.equal(animations.length,1,'repeated visibility does not restart animation');
 animations[0].finish();await flush();
 motion.setVisible(false);assert.equal(root.hidden,false);assert.equal(root.inert,true);
 assert.equal(motion.exiting,true);assert.equal(animations[1].options.duration,250);
 assert.deepEqual(animations[1].frames,[{opacity:1,transform:'translateY(0px)'},{opacity:0,transform:'translateY(50px)'}]);
 animations[1].finish();await flush();assert.equal(root.hidden,true);assert.equal(motion.exiting,false);
 assert.deepEqual(events,['entrance-started','entrance-finished','exit-started','exit-finished']);
});

test('reversals capture the painted pose and stale completions cannot hide a reopened drawer',async()=>{
 const {root,motion,animations,environment}=fixture();
 motion.setVisible(true);environment.paint={opacity:'.4',transform:'matrix(1, 0, 0, 1, 0, 30)'};
 motion.setVisible(false);assert.equal(animations[0].cancelled,true);
 assert.deepEqual(animations[1].frames[0],{opacity:.4,transform:'translateY(30px)'});
 environment.paint={opacity:'.2',transform:'matrix(1, 0, 0, 1, 0, 40)'};
 motion.setVisible(true);assert.equal(animations[1].cancelled,true);
 assert.deepEqual(animations[2].frames[0],{opacity:.2,transform:'translateY(40px)'});
 animations[1].finish();await flush();assert.equal(root.hidden,false);
 animations[2].finish();await flush();assert.equal(root.hidden,false);assert.equal(root.inert,false);
});

for(const mode of ['reduced','hidden','immediate'])test(`${mode} settles drawer immediately and cancels pending motion`,async()=>{
 const {root,motion,animations,environment}=fixture();motion.setVisible(true);
 if(mode==='reduced')environment.reduced=true;
 if(mode==='hidden')environment.hidden=true;
 motion.setVisible(false,{immediate:mode==='immediate'});
 assert.equal(root.hidden,true);assert.equal(animations.length,1);assert.equal(animations[0].cancelled,true);
 animations[0].finish();await flush();assert.equal(root.hidden,true);
});

test('destroy invalidates completion callbacks and releases the animation',async()=>{
 const {root,motion,animations,events}=fixture();motion.setVisible(true);motion.destroy();
 const before=events.length;animations[0].finish();await flush();
 assert.equal(root.hidden,true);assert.equal(events.length,before);assert.equal(animations[0].cancelled,true);
 motion.setVisible(true);assert.equal(root.hidden,true);
});

for(const policy of ['hidden','reduced'])for(const exiting of [false,true])test(`live ${policy} change settles an active ${exiting?'exit':'entrance'} without a visibility request`,async()=>{
 const {root,motion,animations,environment,document,media}=fixture();motion.setVisible(true);
 if(exiting)motion.setVisible(false);
 const animation=animations.at(-1);environment[policy]=true;
 (policy==='hidden'?document:media).dispatchEvent(new Event(policy==='hidden'?'visibilitychange':'change'));
 assert.equal(root.hidden,exiting);assert.equal(motion.animation,null);assert.equal(animation.cancelled,true);
 animation.finish();await flush();assert.equal(root.hidden,exiting);
 motion.destroy();
});

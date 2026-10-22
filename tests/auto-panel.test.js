import test from 'node:test';
import assert from 'node:assert/strict';
import {mountAutoPanel} from '../studio/auto-panel.js';

class Checkbox extends EventTarget {
 checked=false;
 change(value){this.checked=value;this.dispatchEvent(new Event('change'));}
}
const card={chapterId:'chapter',nodeId:'node',placementId:'one'};
function setup(saved=null){
 const checkbox=new Checkbox(),calls=[],writes=[];
 let target=card;
 const panel=mountAutoPanel(checkbox,{getTarget:()=>target,onReveal:t=>calls.push(t),storage:{getItem:()=>saved,setItem:(...args)=>writes.push(args)}});
 return {checkbox,panel,calls,writes,target:t=>target=t};
}
test('defaults off; enabling immediately reveals the current card and persists the preference',()=>{
 const f=setup();assert.equal(f.checkbox.checked,false);f.panel.follow(card);assert.deepEqual(f.calls,[]);
 f.checkbox.change(true);assert.deepEqual(f.calls,[card]);assert.deepEqual(f.writes,[['nest.editor.autoPanel','true']]);
 f.checkbox.change(false);f.panel.follow({...card,placementId:'two'});assert.deepEqual(f.calls,[card]);
 f.target({...card,placementId:'two'});f.checkbox.change(true);assert.equal(f.calls.at(-1).placementId,'two');
});
test('restored preference follows exact placement changes, deduplicates notifications and tolerates transition gaps',()=>{
 const f=setup('true');assert.equal(f.checkbox.checked,true);assert.deepEqual(f.calls,[]);
 f.panel.follow(card);f.panel.follow({...card});assert.deepEqual(f.calls,[card]);
 f.panel.follow(null);assert.deepEqual(f.calls,[card]);f.panel.follow(card);assert.equal(f.calls.length,2);
 for(const patch of [{chapterId:'other'},{nodeId:'other'},{sequenceId:'other'},{slot:'choices'},{parentCardId:'other'},{placementId:'two'}]){
  const next={...card,...patch};f.panel.follow(next);assert.deepEqual(f.calls.at(-1),next);
 }
});
test('enabling without a visible card waits for playback; destroy stops notifications and checkbox changes',()=>{
 const f=setup();f.target(null);f.checkbox.change(true);assert.deepEqual(f.calls,[]);
 f.panel.follow(card);assert.deepEqual(f.calls,[card]);f.panel.destroy();
 f.panel.follow({...card,placementId:'two'});f.checkbox.change(true);assert.deepEqual(f.calls,[card]);
});
test('unavailable storage leaves the control usable',()=>{
 for(const storage of [null,{getItem(){throw Error('blocked');},setItem(){throw Error('blocked');}}]){
  const checkbox=new Checkbox(),calls=[];
  const panel=mountAutoPanel(checkbox,{storage,getTarget:()=>card,onReveal:t=>calls.push(t)});
  checkbox.change(true);assert.deepEqual(calls,[card]);panel.destroy();
 }
});

// Exercise the editor navigation callback with selection/render doubles: these
// checks cover playback isolation and stale snapshots, not browser layout.
const {readFileSync}=await import('node:fs');
const {runInNewContext}=await import('node:vm');
const editorSource=readFileSync(new URL('../studio/editor.js',import.meta.url),'utf8');
const navigation=editorSource.slice(editorSource.indexOf('function goToPreviewCard('),editorSource.indexOf('\nconst selection='));
function editorFixture(){
 const calls=[],source={chapter:{id:'chapter'},node:{id:'next'}};
 const context={project:{},chapterId:'chapter',selected:'previous',mode:'chapter',graph:{selectedIds:new Set(['previous']),fit:()=>calls.push('fit')},
  sourceCard:(_project,target)=>target.placementId==='deleted'?null:source,
  report:()=>calls.push('report'),render:options=>calls.push(['render',options]),
  revealCardEntry:(_inspector,target,options)=>{calls.push(['reveal',target,options]);return true;},$:()=>({})};
 runInNewContext(navigation,context);
 return {context,calls};
}
test('automatic editor navigation selects the playing node without autoplay or focus and preserves settings',()=>{
 const {context,calls}=editorFixture();context.goToPreviewCard(card,{automatic:true});
 assert.equal(context.selected,'next');assert.deepEqual([...context.graph.selectedIds],['next']);
 assert.equal(calls[0][0],'render');assert.equal(calls[0][1].preserveProjectSettings,true);
 assert.equal(calls[1][0],'reveal');assert.equal(calls[1][2].focus,false);
 calls.length=0;context.goToPreviewCard({...card,placementId:'two'},{automatic:true});
 assert.equal(calls.length,1);assert.equal(calls[0][0],'reveal','same-node card changes do not rebuild the inspector');
 calls.length=0;context.goToPreviewCard({...card,placementId:'deleted'},{automatic:true});
 assert.deepEqual(calls,[],'stale playback sources leave the current editor selection intact');
});

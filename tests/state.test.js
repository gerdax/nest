import test from 'node:test';
import assert from 'node:assert/strict';
import { initialValues, conditionsMet, applyEffects } from '../chapter/state.js';
import { createStarterChapter, validateChapter, parseChapter } from '../chapter/model.js';
import { ChapterController } from '../chapter/ChapterController.js';

class Deck extends EventTarget {
 content={id:'wait',actions:[]};busy=false;
 replaceContent(c){if(this.busy)this.pending=c;else this.content=c;}
 endContent(){this.ending=true;}
 reset(){this.busy=false;this.pending=null;}
 emit(name,detail){const event=new Event(name);event.detail={contentId:this.content.id,...detail};this.dispatchEvent(event);}
 choose(id){this.busy=true;this.emit('commit',{action:this.content.actions.find(a=>a.id===id)});if(this.pending){this.content=this.pending;this.pending=null;}this.busy=false;this.emit('transitioncomplete',{transition:'commit'});}
}
const chapter=()=>{const c=createStarterChapter();c.variables=[{id:'opened',type:'flag',initial:false},{id:'energy',type:'number',initial:2}];return c;};
const condition={source:'variable',key:'opened',op:'eq',value:true};
test('flags, numeric comparisons and inventory conditions are conjunctive',()=>{
 const values=initialValues(chapter().variables);
 assert.equal(conditionsMet([{source:'variable',key:'energy',op:'gte',value:2},{source:'inventory',key:'key',op:'has'}],values,[{id:'key'}]),true);
 assert.equal(conditionsMet([condition],values),false);
 assert.equal(conditionsMet([{source:'variable',key:'missing',op:'eq',value:false}],values),false);
 assert.equal(conditionsMet([{source:'inventory',key:'key',op:'missing'}],values,[]),true);
});
test('effects preserve input and can set flags, add/subtract numbers',()=>{
 const original=initialValues(chapter().variables);
 assert.deepEqual(applyEffects(original,[{op:'set',key:'opened',value:true},{op:'add',key:'energy',value:-1}]),{opened:true,energy:1});
 assert.equal(original.opened,false);assert.throws(()=>applyEffects(original,[{op:'set',key:'unknown',value:true}]),/Unknown/);
});
test('strict validation catches unknown refs, wrong types, malformed expressions and duplicate variables',()=>{
 for(const mutate of [c=>c.variables.push({...c.variables[0]}),c=>c.variables[0].initial=1,c=>c.sequences[0].cards[0].effects=[{op:'add',key:'opened',value:1}],c=>c.sequences.at(-1).cards[0].choices[0].conditions=[{...condition,key:'unknown'}],c=>c.sequences.at(-1).cards[0].choices[0].conditions=[{source:'inventory',key:'unknown',op:'has'}],c=>c.nodes[0].conditions=[]]){
  const c=chapter();mutate(c);assert.ok(validateChapter(c).length);assert.throws(()=>parseChapter(JSON.stringify(c)));
 }
});
test('rules and variables round-trip; unresolved draft refs can be saved',()=>{
 const c=chapter();c.sequences.at(-1).cards[0].choices[0].conditions=[{...condition}];c.sequences[0].cards[0].effects=[{op:'set',key:'opened',value:true}];
 assert.deepEqual(parseChapter(JSON.stringify(c)),c);
 c.sequences.at(-1).cards[0].choices[0].conditions[0].key='unknown';assert.deepEqual(parseChapter(JSON.stringify(c),{allowDraft:true}),c);
});
test('story acceptance applies effects once, restart restores initial snapshot',()=>{
 const c=chapter();c.sequences[0].cards[0].effects=[{op:'add',key:'energy',value:1}];const deck=new Deck(),controller=new ChapterController(deck,c);
 const id=deck.content.id;deck.choose('continue');assert.equal(controller.state.variables.energy,3);
 controller.commit({contentId:id,action:{id:'continue'}});assert.equal(controller.state.variables.energy,3);
 c.variables[1].initial=100;controller.restart();assert.equal(controller.state.variables.energy,2);controller.destroy();
});
test('choices hide or disable unmet requirements, show after accepted state change',()=>{
 const c=chapter(),fork=c.sequences.at(-1);fork.cards[0].choices[0].conditions=[{...condition}];fork.cards[0].choices[1].conditions=[{...condition}];fork.cards[0].choices[1].unavailable='hidden';
 const deck=new Deck(),controller=new ChapterController(deck,c,{startNode:'crossing'});
 assert.equal(deck.content.actions.length,1);assert.equal(deck.content.actions[0].disabled,true);
 controller.commit({contentId:deck.content.id,action:deck.content.actions[0]});assert.equal(controller.state.completed,false);
 controller.destroy();
});
test('taking final item predicts requirements for staged destination but applies effects only at completion',()=>{
 const c=chapter();const seq=c.sequences.find(s=>s.type==='container');seq.items=[{...seq.items[0],effects:[{op:'set',key:'opened',value:true}]}];
 c.sequences.at(-1).cards[0].choices[0].conditions=[condition,{source:'inventory',key:'flashlight',op:'has'}];
 const deck=new Deck(),controller=new ChapterController(deck,c,{startNode:'supplies'});deck.busy=true;const old=deck.content.id;
 deck.emit('collect',{action:deck.content.actions[0],final:true});
 assert.equal(controller.state.variables.opened,false);assert.equal(controller.state.collectedItems.length,0);
 assert.equal(deck.pending.actions[0].disabled,undefined);
 deck.emit('transitioncomplete',{transition:'collect'});assert.equal(controller.state.variables.opened,true);assert.equal(controller.state.collectedItems.length,1);
 deck.emit('transitioncomplete',{transition:'collect'});assert.equal(controller.state.collectedItems.length,1);
 deck.content=deck.pending;deck.emit('transitioncomplete',{transition:'commit'});assert.equal(controller.state.activeNodeId,'crossing');controller.destroy();
});
test('discarding item never applies its effects',()=>{
 const c=chapter(),seq=c.sequences.find(s=>s.type==='container');seq.items=[{...seq.items[0],effects:[{op:'set',key:'opened',value:true}]}];
 const deck=new Deck(),controller=new ChapterController(deck,c,{startNode:'supplies'});deck.busy=true;deck.emit('discard',{action:deck.content.actions[0],final:true});deck.emit('transitioncomplete',{transition:'discard'});
 assert.equal(controller.state.variables.opened,false);assert.equal(controller.state.collectedItems.length,0);controller.destroy();
});

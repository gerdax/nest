import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parseProject,validateProject,compileChapter,importChapter} from '../project/model.js';
import {ProjectController} from '../project/ProjectController.js';
import {chapterEntryState} from '../project/chapter-entry.js';
import {variableIdFromName} from '../studio/variable-ids.js';

const read=name=>JSON.parse(fs.readFileSync(new URL(`../editor/exports/${name}`,import.meta.url),'utf8'));
const pkg=read('Lazarus-Awakening-EN.nest.json');
const project=parseProject(JSON.stringify(pkg));

test('English Awakening round-trips, imports beside Polish original and uses current scoped mechanics',()=>{
 assert.deepEqual(validateProject(project),[]);
 const full=parseProject(JSON.stringify(read('Lazarus-Awakening-EN.project.json')));
 assert.equal(full.startChapterId,pkg.chapter.id);assert.deepEqual(full.chapters[0],project.chapters[0]);
 assert.deepEqual(new Set(project.variables.map(v=>v.id)),new Set(['health','energy','agility','intelligence','composure']));
 for(const v of pkg.chapter.variables)assert.equal(v.id,variableIdFromName(v.name));
 for(const d of pkg.library){assert.equal(d.image,'');assert.equal(d.use,undefined);if(d.visibility==='local')assert.equal(d.chapterId,pkg.chapter.id);}
 assert.equal(pkg.library.find(d=>d.id==='awakening_tag').visibility,'shared');
 assert.equal(pkg.library.find(d=>d.id==='awakening_water').kind,'energy');
 assert.equal(pkg.library.find(d=>d.id==='awakening_sterile_dressing').kind,'health');
 const polish=parseProject(JSON.stringify(read('Lazarus-Przebudzenie.nest.json'))),before=structuredClone(polish);
 const combined=importChapter(polish,pkg);
 assert.deepEqual(polish,before);assert.deepEqual(validateProject(combined),[]);assert.equal(combined.variables.length,5);
 assert.equal(combined.chapters.length,2);assert.notEqual(combined.chapters[0].id,combined.chapters[1].id);
 assert.equal(combined.startChapterId,polish.startChapterId);
});

class Deck extends EventTarget {
 reset(){this.busy=false;this.pending=null;}
 replaceContent(content){if(this.busy)this.pending=content;else this.content=content;}
 endContent(){this.ended=true;}
 emit(name,detail={}){const event=new Event(name);event.detail={contentId:this.content.id,...detail};this.dispatchEvent(event);}
 accept(action){this.busy=true;this.emit('commit',{action});this.settle();}
 take(action,final){this.busy=true;this.emit('collect',{action,final});this.emit('transitioncomplete',{transition:'collect'});this.settle();}
 leave(action){this.busy=true;this.emit('discard',{action,all:true,final:true});this.emit('transitioncomplete',{transition:'discard'});this.settle();}
 settle(){if(this.pending){this.content=this.pending;this.pending=null;}this.busy=false;this.emit('transitioncomplete',{transition:'commit'});}
}
async function play({look='look_up',gate='use_tag',ending='secure',roll=6,explore=true,collect=true}={}){
 const deck=new Deck(),errors=[],visited=new Set();
 const controller=new ProjectController(deck,compileChapter(project),{rollCheck:async()=>[roll,roll,roll],onError:error=>errors.push(error)});
 let aidState;
 for(let step=0;step<120&&!controller.state.completed;step++){
  const id=controller.state.activeNodeId.replace('awakening_','');visited.add(id);
  if(id==='supplies'){
   aidState??={...controller.state.variables};
   const items=controller.items();
   if(collect&&items.length){const item=items[0];deck.take({id:item.id},items.length===1);continue;}
   if(!collect&&items.length){deck.leave({id:items[0].id});continue;}
  }
  let action;
  const choose=suffix=>deck.content.actions.find(a=>a.id===`awakening_p_${suffix}`&&!a.disabled);
  if(id==='first_choice')action=choose(look);
  if(id==='hub')action=explore&&(!controller.variables.records_read?choose('records'):!controller.variables.adas_fate_known?choose('locker'):!controller.variables.stairs_checked?choose('stairs'):null)||choose('go_door');
  if(id==='pressure')action=choose('steady');
  if(id==='courier')action=choose('quiet_pass')||choose('listen_pass')||choose('sneak');
  if(id==='gate')action=choose(gate)||choose('laundry');
  if(id==='emma_choice')action=choose('tell_ada')||choose('dont_know')||choose('promise');
  if(id==='last_choice')action=choose(ending)||choose('descend');
  action??=deck.content.actions.find(a=>!a.disabled);
  assert.ok(action,`No available action in ${id}`);
  deck.accept(action);
  for(let i=0;i<5;i++)await Promise.resolve();
  if(controller.state.checking)throw new Error('Check did not resolve');
 }
 assert.deepEqual(errors,[]);assert.equal(controller.state.completed,true);
 const result={state:controller.state,visited,aidState};controller.destroy();return result;
}

test('exploration, tags, resources and the one-use wedge reach the secured ending',async()=>{
 const {state,visited,aidState}=await play();
 assert.ok(visited.has('end_secure'));assert.ok(visited.has('tag_open'));
 assert.equal(aidState.health,10);assert.equal(aidState.energy,6);
 assert.equal(state.variables.truth_told_to_emma,true);
 assert.equal(state.collectedItems.some(item=>item.definitionId==='awakening_wedge'),false);
 assert.equal(state.collectedItems.some(item=>item.definitionId==='awakening_tag'),true);
 const carried=chapterEntryState(project,pkg.chapter.id,state);
 assert.deepEqual(carried.inventory.map(item=>item.definitionId),['awakening_tag']);
 assert.equal(carried.variables.records_read,false);
});
test('failed checks and an empty inventory still have a complete escape route',async()=>{
 const {visited}=await play({look:'look_self',gate:'rewire',ending:'descend',roll:1,explore:false,collect:false});
 assert.ok(visited.has('steady_bad'));assert.ok(visited.has('chase'));assert.ok(visited.has('wire_fail'));assert.ok(visited.has('end_descent'));
});
test('the tagged rod and shelter branch remain playable',async()=>{
 const {visited}=await play({gate:'use_rod',ending:'shelter'});
 assert.ok(visited.has('rod_open'));assert.ok(visited.has('end_shelter'));
});

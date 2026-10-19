import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cardFace } from '../project/presentation.js';
import { resolvePlacement, cardSummary } from '../project/cards.js';
import { compileChapter, createProject, validateProject, parseProject, exportChapter, importChapter } from '../project/model.js';
import { definitionReferences, deleteDefinition, cleanupLocalDefinitions } from '../project/dependencies.js';
import { ProjectController } from '../project/ProjectController.js';
import { addInventory } from '../project/state.js';
import { placementInspector } from '../studio/inspectors.js';

const fixture=()=>parseProject(readFileSync(new URL('./fixtures/contextual-door.json',import.meta.url),'utf8'));
const door=project=>project.chapters[0].nodes.find(n=>n.id==='door');
class Deck extends EventTarget {
  reset(){this.busy=false;this.resets=(this.resets??0)+1;}
  replaceContent(content,options){this.content=content;this.options=options;this.phase=options.presentation==='open'?'choices':'closed';}
  updateActions(actions){this.content={...this.content,actions};this.updates=(this.updates??0)+1;return true;}
  endContent(){this.ended=true;}
  commit(id){const e=new Event('commit');e.detail={contentId:this.content.id,action:{id}};this.dispatchEvent(e);}
}
function runtime(options={}) {
  const project=fixture(),compiled=compileChapter(project);compiled.startNode='door';
  const deck=new Deck(),errors=[];
  const controller=new ProjectController(deck,compiled,{onError:e=>errors.push(e),...options});
  const own=(...ids)=>{controller.inventory=ids.reduce((inventory,id)=>addInventory(inventory,compiled.library.find(d=>d.id===id)),[]);controller.show({presentation:'open'});};
  return {project,compiled,deck,controller,errors,own};
}
const ids=deck=>deck.content.actions.map(a=>a.id);
const flush=async()=>{for(let i=0;i<6;i++)await Promise.resolve();};

test('contextual choices resolve item artwork and ownership while preserving Action mechanics and text',()=>{
  const project=fixture(),source=structuredClone(project),placement=door(project).choices[0];
  placement.contextOverrideImage=true;
  placement.conditions=[{source:'variable',key:'energy',op:'gte',value:1}];
  const card=resolvePlacement(project,placement);
  assert.equal(card.kind,'action');assert.equal(card.name,'Pick the lock');assert.equal(card.text,'Work the lock with your lockpick.');
  assert.equal(card.image,'./assets/img/flashlight.png');assert.equal(card.imageScale,140);assert.equal(card.imageOffsetX,12);assert.equal(card.imageOffsetY,-8);assert.equal(card.flipImage,true);
  assert.equal(card.inventoryLabel,'Inventory · Lockpick');assert.equal(cardFace(card).inventoryLabel,'Inventory · Lockpick');assert.equal(card.entrance,'bottom');
  assert.deepEqual(card.conditions.at(-1),{source:'inventory',key:'old:key',op:'has'});
  assert.deepEqual(card.costs,source.library.find(d=>d.id==='unlock').costs);
  const compiled=compileChapter(project);assert.equal(door({chapters:[compiled]}).choices[0].contextItemId,'key');
  assert.equal(project.library.find(d=>d.id==='unlock').image,'./assets/img/corridor_02.png');
  assert.equal(placement.conditions.length,1,'implicit rule stays detached');
  const unlinked=resolvePlacement(project,{id:'normal',definitionId:'unlock'});
  assert.equal(unlinked.image,'./assets/img/corridor_02.png');assert.equal(unlinked.contextItemId,undefined);
  assert.deepEqual(validateProject(createProject()),[]);
});

test('context is accepted only on native fork Action choices with a real item definition',()=>{
  for(const value of [null,42,{},'missing','unlock']) {
    const project=fixture();door(project).choices[0].contextItemId=value;
    assert.ok(validateProject(project).some(e=>e.message.includes('inventory context')));
    assert.throws(()=>parseProject(JSON.stringify(project)),/inventory context/);
  }
  for(const slot of ['cards','items','intro']) {
    const project=fixture(),node=project.chapters[0].nodes[0];
    if(slot==='cards'){node.type='linear';node.cards=[{id:'invalid',definitionId:'unlock',contextItemId:'key'}];delete node.intro;delete node.items;}
    else node[slot]=slot==='intro'?{id:'invalid',definitionId:'door-intro',contextItemId:'key'}:[{id:'invalid',definitionId:'key',contextItemId:'key'}];
    assert.ok(validateProject(project,{allowDraft:true}).some(e=>e.message.includes('inventory context')));
  }
  const project=fixture();door(project).choices[3].contextItemId='key';
  assert.ok(validateProject(project).some(e=>e.message.includes('inventory context')));
  project.library[0].contextItemId='key';assert.ok(validateProject(project).some(e=>e.message.includes('belongs to a fork')));
  const blank=fixture();door(blank).choices[0].contextItemId='';
  assert.equal(Object.hasOwn(door(parseProject(JSON.stringify(blank))).choices[0],'contextItemId'),false);
});

test('missing linked ownership always hides; owned cards keep disabled/hidden rules and stable IDs',()=>{
  const {deck,controller,own}=runtime();
  assert.deepEqual(ids(deck),['force-choice','leave-choice']);
  own('key','pry');assert.deepEqual(ids(deck),['key-choice','pry-choice','force-choice','leave-choice']);
  assert.equal(deck.content.actions[0].disabled,false);assert.equal(deck.content.actions[2].disabled,true);
  const pry=controller.choices().find(c=>c.id==='pry-choice');pry.conditions.push({source:'variable',key:'energy',op:'gte',value:3});
  controller.show();assert.equal(deck.content.actions.find(a=>a.id==='pry-choice').disabled,true);
  pry.unavailable='disabled';controller.compiled.unavailableActions='hidden';controller.show();assert.equal(ids(deck).includes('pry-choice'),false);
  controller.destroy();
});

test('context ownership uses inventory aliases and rejects stale visible commits without spending',()=>{
  const {deck,controller,own}=runtime();own('key');
  assert.equal(deck.content.actions.find(a=>a.id==='key-choice').disabled,false);
  controller.inventory=[];deck.commit('key-choice');assert.equal(controller.completed,false);assert.equal(controller.variables.energy,2);assert.equal(ids(deck).includes('key-choice'),false);
  own('key');controller.choices().find(c=>c.id==='key-choice').costs=[{source:'inventory',key:'key',amount:1}];deck.commit('key-choice');assert.equal(controller.completed,true);assert.deepEqual(controller.inventory,[]);
  controller.destroy();
});

for(const roll of [2,6])test(`contextual check retains success/failure routing and does not consume reusable item, roll=${roll}`,async()=>{
  const {deck,controller,own}=runtime({rollCheck:async()=>[roll]});own('pry');
  for(const id of ['win','lose'])controller.nodes.set(id,{id,type:'linear',cards:[{id:`${id}-story`,kind:'event',text:id}],connections:{next:null}});
  controller.location.node.connections['pry-choice:success']='win';controller.location.node.connections['pry-choice:failure']='lose';
  const source=controller.choices().find(c=>c.id==='pry-choice');source.effects=[{op:'add',key:'energy',value:1}];source.successEffects=[{op:'add',key:'energy',value:2}];
  deck.commit('pry-choice');await flush();
  assert.equal(controller.state.activeNodeId,roll>=4?'win':'lose');assert.equal(controller.variables.energy,roll>=4?4:2);assert.equal(controller.inventory[0].definitionId,'pry');controller.destroy();
});

test('pending contextual check rechecks ownership before transaction',async()=>{
  let finish;const {deck,controller,own,errors}=runtime({rollCheck:()=>new Promise(resolve=>finish=resolve)});own('pry');
  deck.commit('pry-choice');controller.inventory=[];finish([6]);await flush();
  assert.equal(controller.completed,false);assert.equal(controller.variables.energy,2);assert.match(errors[0].message,/requirements changed/);assert.equal(ids(deck).includes('pry-choice'),false);controller.destroy();
});

for(const presentation of ['open','closed'])test(`explicit state refresh reconciles the same native fork without resetting its ${presentation} presentation`,()=>{
  const {deck,controller,own}=runtime();own('key','potion');controller.show({presentation});
  const before={id:deck.content.id,resets:deck.resets,phase:deck.phase};
  controller.variables.energy=5;controller.inventory=controller.inventory.filter(i=>i.definitionId!=='potion');deck.updateActions(controller.content().actions);assert.equal(deck.updates,1);assert.equal(deck.content.id,before.id);assert.equal(deck.resets,before.resets);assert.equal(deck.phase,before.phase);
  assert.equal(deck.content.actions.find(a=>a.id==='force-choice').disabled,false);assert.equal(controller.inventory.length,1);
  controller.inventory=[];deck.updateActions(controller.content().actions);
 assert.equal(ids(deck).includes('key-choice'),false);controller.destroy();
});

test('context item dependencies export transitively, remap collisions and protect local cleanup/deletion',()=>{
  const project=fixture();project.chapters[0].nodes=project.chapters[0].nodes.filter(n=>n.id==='door');project.chapters[0].startNode='door';
  const key=project.library.find(d=>d.id==='key');key.visibility='local';key.onCollect=[{op:'addItem',key:'potion'}];
  const references=definitionReferences(project,'key');assert.equal(references.some(r=>r.kind==='contextItem'),true);
  assert.throws(()=>deleteDefinition(project,'key'),/still used/);assert.equal(cleanupLocalDefinitions(project),0);
  const pkg=exportChapter(project);assert.ok(pkg.library.some(d=>d.id==='key'));assert.ok(pkg.library.some(d=>d.id==='potion'));
  const target=fixture();target.library.find(d=>d.id==='key').text='different';
  const merged=importChapter(target,pkg),chapter=merged.chapters.at(-1),linked=chapter.nodes[0].choices[0].contextItemId;
  assert.notEqual(linked,'key');assert.equal(merged.library.find(d=>d.id===linked).name,'Lockpick');assert.deepEqual(validateProject(merged),[]);
  const compiled=compileChapter(merged,chapter.id),choice=compiled.nodes[0].choices[0];assert.notEqual(choice.contextInventoryKey,'old:key');
  delete door(project).choices[0].contextItemId;project.library.find(d=>d.id==='unlock').costs=[];deleteDefinition(project,'key');assert.equal(project.library.some(d=>d.id==='key'),false);
});

test('editor explicitly offers None and items only for Action choice placements',()=>{
  const project=fixture(),choice=door(project).choices[0],html=placementInspector(project,choice,'action',0,'choices');
  assert.match(html,/Inventory trigger/);assert.match(html,/data-path="contextItemId"/);assert.match(html,/<option value=""\s*>None<\/option>/);assert.match(html,/<option value="key" selected>Item: Lockpick<\/option>/);
  const selector=html.match(/<select[^>]*data-path="contextItemId"[^>]*>(.*?)<\/select>/s)[1];assert.doesNotMatch(selector,/value="unlock"|value="door-intro"/);
  assert.doesNotMatch(placementInspector(project,{id:'linear',definitionId:'unlock'},'action',0,'cards'),/data-path="contextItemId"/);
  assert.doesNotMatch(placementInspector(project,door(project).choices[3],'event',3,'choices'),/data-path="contextItemId"/);
});


test('fork introduction gain effects reconcile linked choices after reveal without replacing content',()=>{
  const {deck,controller}=runtime();
  controller.card().effects=[{op:'addItem',key:'key'}];
  const before={id:deck.content.id,resets:deck.resets};
  controller.reveal({contentId:before.id});assert.equal(controller.pendingIntro.contentId,before.id);
  assert.equal(ids(deck).includes('key-choice'),false,'wait for reveal completion');
  deck.phase='choices';controller.transitionComplete({transition:'reveal',contentId:before.id});
  assert.equal(deck.updates,1);assert.equal(deck.content.id,before.id);assert.equal(deck.resets,before.resets);assert.equal(ids(deck).includes('key-choice'),true);
  controller.reveal({contentId:before.id});assert.equal(controller.inventory.length,1,'introduction applies once');controller.destroy();
});


test('contextual action defaults to its own artwork and transforms, including a blank image',()=>{
 const project=fixture(),placement=door(project).choices[0],definition=project.library.find(d=>d.id===placement.definitionId);
 Object.assign(definition,{imageScale:80,imageOffsetX:-5,imageOffsetY:7,flipImage:false});
 for(const value of [undefined,false]){
  placement.contextOverrideImage=value;const card=resolvePlacement(project,placement);
  assert.equal(card.image,definition.image);assert.equal(card.imageScale,80);assert.equal(card.imageOffsetX,-5);assert.equal(card.imageOffsetY,7);assert.equal(card.flipImage,false);
  assert.equal(card.contextOverrideImage,false);assert.equal(card.contextItemId,'key');assert.equal(card.entrance,'bottom');
 }
 definition.image='';assert.equal(resolvePlacement(project,placement).image,'');
 const compiled=compileChapter(project);assert.equal(compiled.nodes.find(n=>n.id==='door').choices[0].image,'');
});

test('Override img is per placement, reversible, and portable without changing shared definitions',()=>{
 const project=fixture(),placement=door(project).choices[0],before=structuredClone(project.library);
 placement.contextOverrideImage=true;
 const copy={...structuredClone(placement),id:'second',contextOverrideImage:false};
 door(project).choices.push(copy);door(project).connections.second=null;
 assert.equal(resolvePlacement(project,placement).image,'./assets/img/flashlight.png');
 assert.equal(resolvePlacement(project,copy).image,'./assets/img/corridor_02.png');
 assert.deepEqual(project.library,before);
 const parsed=parseProject(JSON.stringify(project));assert.equal(door(parsed).choices[0].contextOverrideImage,true);
 const pkg=exportChapter(project),merged=importChapter(createProject(),pkg),chapter=merged.chapters.at(-1);
 const imported=chapter.nodes.find(n=>n.id==='door').choices[0];assert.equal(imported.contextOverrideImage,true);
 assert.equal(compileChapter(merged,chapter.id).nodes.find(n=>n.id==='door').choices[0].image,'./assets/img/flashlight.png');
 placement.contextOverrideImage=false;assert.equal(resolvePlacement(project,placement).image,'./assets/img/corridor_02.png');
});

test('Action placement panel omits the image override checkbox',()=>{
 const project=fixture(),placement=door(project).choices[0];
 for(const value of [undefined,true,false]){
  placement.contextOverrideImage=value;
  const html=placementInspector(project,placement,'action',0,'choices');
  assert.doesNotMatch(html,/Override img|data-path="contextOverrideImage"/);
  assert.match(html,/Inventory trigger/);
 }
});

test('Override img rejects malformed values and unsupported placement kinds',()=>{
 for(const value of ['true',1,null]){const project=fixture();door(project).choices[0].contextOverrideImage=value;assert.ok(validateProject(project).some(e=>e.message.includes('Override img')));}
 const project=fixture();door(project).choices[3].contextOverrideImage=true;assert.ok(validateProject(project).some(e=>e.message.includes('Override img')));
});


test('inventory trigger summary is separate from explicit ownership requirements',()=>{
 const project=fixture(),placement=door(project).choices[0];
 let summary=cardSummary(resolvePlacement(project,placement),project.variables,project.library);
 assert.match(summary,/Triggered by: Lockpick/);assert.doesNotMatch(summary,/Requires: Own Lockpick/);
 placement.conditions=[{source:'inventory',key:'key',op:'has'}];
 summary=cardSummary(resolvePlacement(project,placement),project.variables,project.library);
 assert.match(summary,/Triggered by: Lockpick/);assert.match(summary,/Requires: Own Lockpick/);
});

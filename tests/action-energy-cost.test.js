import test from 'node:test';
import assert from 'node:assert/strict';
import { cardFace } from '../project/presentation.js';
import { createDefinition, resolvePlacement, cardSummary } from '../project/cards.js';
import { createProject, compileChapter } from '../project/model.js';
import { decorateCard, stageActionDeck } from '../engine/renderer.js';
import { ProjectController } from '../project/ProjectController.js';
import { renderCardPreviews } from '../studio/card-preview.js';

class Element {
  constructor() { this.children=[]; this.style={}; this.attrs={}; this.dataset={}; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children=nodes; }
  setAttribute(key,value) { this.attrs[key]=value; }
  removeAttribute(key) { delete this.attrs[key]; }
}
globalThis.document={createElement:()=>new Element(),body:new Element()};
const energy = amount => ({source:'variable',key:'energy',amount});
const marker = front => front.children.find(child=>child.className==='nest-action-energy-cost');
function render(face) {
  const front=new Element();
  decorateCard(null,front,face.image,face.heading,face.text,false,face);
  return front;
}

test('Action markers show only positive upfront energy totals, never consequences or other costs',()=>{
  for (const [costs,total] of [[[],0],[[energy(0)],0],[[energy(1)],1],[[energy(3)],3],[[energy(1),energy(2)],3]]) {
    const card={...createDefinition('action','try'),costs,effects:[{op:'add',key:'energy',value:-2}],text:'Lose 2 energy if the attempt fails.'};
    const face=cardFace(card),front=render(face);
    assert.equal(face.actionEnergyCost,total);
    assert.equal(face.text,card.text,'authored prose is never heuristically stripped');
    assert.equal(face.summary,'Effects: Lose 2 energy');
    if (total>0) {
      assert.equal(marker(front).children[0].textContent,`-${total}`);
      assert.equal(marker(front).children[1].children[0].attrs.src,'./assets/img/ui/hud-energy.png');
      assert.equal(marker(front).attrs['aria-label'],`Energy cost: ${total}`);
    } else assert.equal(marker(front),undefined);
  }
  const mixed=cardFace({...createDefinition('action','mixed'),costs:[energy(2),{source:'variable',key:'health',amount:1},{source:'inventory',key:'energy'}]});
  assert.equal(mixed.actionEnergyCost,2);
  assert.equal(mixed.actionHealthCost,1);
  assert.equal(mixed.summary,'Cost: energy');
  assert.equal(marker(render(cardFace({...createDefinition('item','item'),costs:[energy(2)]}))),undefined);
});

test('resolved placement cost matches editor and player, and failure loss is additional to the attempt cost',()=>{
  const project=createProject(),node=project.chapters[0].nodes.find(node=>node.type==='fork');
  const placement=node.choices[0];
  const definition=project.library.find(card=>card.id===placement.definitionId);
  Object.assign(definition,{text:'Try the door. On failure, lose 2 energy.',costs:[energy(1)],resolution:'check',
    failureEffects:[{op:'add',key:'energy',value:-2}]});
  placement.overrides={costs:[energy(2)]};
  node.connections={[`${placement.id}:success`]:null,[`${placement.id}:failure`]:null};
  project.variables.find(variable=>variable.id==='energy').initial=6;
  project.chapters[0].startNode=node.id;
  const resolved=resolvePlacement(project,placement),face=cardFace(resolved,project.variables,project.library);
  assert.match(cardSummary(resolved,project.variables,project.library),/Cost: 2 Energy/,'source-rule inspector still explains the cost');
  assert.equal(face.actionEnergyCost,2);
  assert.match(face.summary,/Failure: Lose 2 Energy/);
  assert.doesNotMatch(face.summary,/Cost:/);
  const mount=new Element(); mount.dataset.previewPlacement=placement.id;
  renderCardPreviews({querySelectorAll:()=>[mount]},project,node,project.chapters[0].id);
  assert.equal(marker(mount.children[0]).children[0].textContent,'-2');
  class Deck extends EventTarget { reset(){} replaceContent(content){this.content=content;} endContent(){} }
  const deck=new Deck(),controller=new ProjectController(deck,compileChapter(project));
  const live=deck.content.actions[0];
  assert.equal(live.actionEnergyCost,face.actionEnergyCost);
  assert.equal(live.text,face.text);
  assert.match(live.summary || live.checkInfo.rules,/Failure: Lose 2 Energy/);
  assert.equal(controller.transaction(resolved).variables.energy,4,'attempt cost only');
  assert.equal(controller.transaction(resolved,true).variables.energy,4,'success pays attempt cost');
  assert.equal(controller.transaction(resolved,false).variables.energy,2,'failure also loses energy');
  controller.destroy();
});

test('retained card refreshes when only its displayed cost changes, including removal',()=>{
  const deck={mount:new Element(),decorate:(...args)=>decorateCard(null,...args)};
  let previous=null;
  for (const amount of [1,3,0]) {
    const face=cardFace({...createDefinition('action','retained'),costs:[energy(amount)]});
    const bundle=stageActionDeck(deck,{actions:[{id:'retained',...face}]},0,previous);
    assert.equal(marker(bundle.cards[0])?.children[0].textContent,amount>0?`-${amount}`:undefined);
    if(previous) assert.equal(bundle.cards[0],previous.cards[0]);
    previous=bundle;
  }
});


test('Health costs use the Health icon and remain distinct from progression losses',()=>{
 const card={...createDefinition('action','health-cost'),costs:[{source:'variable',key:'health',amount:1},{source:'variable',key:'health',amount:2}],effects:[{op:'add',key:'health',value:-4}]};
 const face=cardFace(card),badge=marker(render(face));
 assert.equal(face.actionHealthCost,3);assert.equal(face.actionEnergyCost,0);
 assert.equal(badge.attrs['aria-label'],'Health cost: 3');assert.equal(badge.children[0].textContent,'-3');assert.equal(badge.children[1].children[0].attrs.src,'./assets/img/ui/hud-health.png');
 assert.equal(face.summary,'Effects: Lose 4 health');
 const noCost=cardFace({...card,costs:[]});assert.equal(marker(render(noCost)),undefined);
});

test('mixed Health and Energy costs have separate signed amounts and matching icons',()=>{
 const face=cardFace({...createDefinition('action','both'),costs:[energy(2),{source:'variable',key:'health',amount:1}]});
 const badge=marker(render(face));
 assert.equal(badge.attrs['aria-label'],'Health cost: 1, Energy cost: 2');
 assert.deepEqual(badge.children.map(child=>child.textContent??child.children[0].attrs.src),['-1','./assets/img/ui/hud-health.png','-2','./assets/img/ui/hud-energy.png']);
});

test('retained action refreshes when only Health cost changes or disappears',()=>{
 const deck={mount:new Element(),decorate:(...args)=>decorateCard(null,...args)};let previous=null;
 for(const amount of [1,3,0]){
  const face=cardFace({...createDefinition('action','retained'),costs:amount?[{source:'variable',key:'health',amount}]:[]});
  const bundle=stageActionDeck(deck,{actions:[{id:'retained',...face}]},0,previous);
  assert.equal(marker(bundle.cards[0])?.children[0].textContent,amount?`-${amount}`:undefined);
  if(previous)assert.equal(bundle.cards[0],previous.cards[0]);previous=bundle;
 }
});

test('Hide badge omits only that cost entry without changing payment or other markers',()=>{
 const project=createProject(),card={...createDefinition('action','hidden-cost'),costs:[
  {source:'variable',key:'health',amount:1,hideBadge:true},{source:'variable',key:'health',amount:2},energy(1)
 ]};
 const face=cardFace(card),badge=marker(render(face));
 assert.equal(face.actionHealthCost,2);assert.equal(face.actionEnergyCost,1);
 assert.equal(badge.attrs['aria-label'],'Health cost: 2, Energy cost: 1');
 const host={compiled:{variables:project.variables,library:project.library},variables:{health:10,energy:3},inventory:[]};
 const paid=ProjectController.prototype.transaction.call(host,card);
 assert.equal(paid.variables.health,7);assert.equal(paid.variables.energy,2);
 card.costs.forEach(cost=>cost.hideBadge=true);assert.equal(marker(render(cardFace(card))),undefined);
});

test('retained preview refreshes when Hide badge changes without changing the cost amount',()=>{
 const deck={mount:new Element(),decorate:(...args)=>decorateCard(null,...args)};let previous=null;
 for(const hideBadge of [false,true,false]){
  const face=cardFace({...createDefinition('action','retained'),costs:[{...energy(2),hideBadge}]});
  const bundle=stageActionDeck(deck,{actions:[{id:'retained',...face}]},0,previous);
  assert.equal(!!marker(bundle.cards[0]),!hideBadge);previous=bundle;
 }
});


test('unavailable mixed-cost cards retain one independently tinted icon per resource',()=>{
 const face=cardFace({...createDefinition('action','disabled'),costs:[energy(2),{source:'variable',key:'health',amount:1}]});
 const badge=marker(render({...face,disabled:true}));
 const icons=badge.children.filter(child=>child.className==='nest-action-cost-icon');
 assert.deepEqual(icons.map(icon=>icon.attrs['data-resource']),['health','energy']);
 assert.deepEqual(icons.map(icon=>icon.children[0].attrs.src),['./assets/img/ui/hud-health.png','./assets/img/ui/hud-energy.png']);
});

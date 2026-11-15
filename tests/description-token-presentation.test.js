import test from 'node:test';
import assert from 'node:assert/strict';
import {cardFace} from '../project/presentation.js';
import {combatChoices,combatCard,enemyActionCard} from '../project/combat-presentation.js';
import {ProjectController} from '../project/ProjectController.js';
import {createProject,compileChapter} from '../project/model.js';
import {PlayerUI} from '../studio/PlayerUI.js';
const variables=[{id:'health',type:'number',initial:10},{id:'energy',type:'number',initial:3},{id:'agility',type:'number',initial:3}];
const values={health:7,energy:2,agility:4};
const attack={id:'hit',kind:'combatAction',name:'Editor only',headline:'[HP]',type:'attack',resolution:'direct',description:'[DMG] [ICON:damage]; base [BASEDMG]; [HP] HP',attack:{source:'self',damage:{min:1,max:2}}};

test('captions and descriptions expand; combat choices use live preparation and caption labels',()=>{
 const before=structuredClone(attack);
 const choice=combatChoices([{id:'hit',action:attack}], 'choices',values,variables,{preparationBonus:2}).actions[0];
 assert.equal(choice.text,'3–4 ⚔; base 1–2; 7 HP');assert.equal(choice.heading,'7');assert.equal(choice.label,'7');
 assert.equal(cardFace(attack,variables,[],values).text,'1–2 ⚔; base 1–2; 7 HP');assert.deepEqual(attack,before);
});

test('Feedback and Enemy captions resolve tokens independently of editor labels',()=>{
 assert.equal(combatCard({kind:'effect',text:'[HP] left'},'feedback',{variables,values}).heading,'7 left');
 assert.equal(combatCard({kind:'event',headline:'[HP]',description:'[ENERGY]'},'story',{variables,values}).heading,'7');
 const enemy=enemyActionCard({...attack,headline:attack.description,description:''},'enemy',{variables,values,preparationBonus:9});
 assert.equal(enemy.heading,'1–2 ⚔; base 1–2; 7 HP');assert.equal(enemy.text,'');
});

class Deck extends EventTarget {reset(){} replaceContent(content){this.content=content;} endContent(){}}
test('story gameplay resolves current and predicted values while compiled captions stay raw',()=>{
 const project=createProject(),chapter=project.chapters[0],node=chapter.nodes.find(n=>n.type==='linear');
 chapter.startNode=node.id;
 const definition=project.library.find(d=>d.id===node.cards[0].definitionId);definition.headline='Energy: [ENERGY] [ICON:energy]';
 const compiled=compileChapter(project),raw=compiled.nodes.find(n=>n.id===node.id).cards[0].headline;
 const deck=new Deck(),controller=new ProjectController(deck,compiled);
 try{
  assert.match(deck.content.heading,/^Energy: \d+ ϟ$/);
  assert.equal(controller.content(controller.location,{...controller.variables,energy:8}).heading,'Energy: 8 ϟ');
  assert.equal(compiled.nodes.find(n=>n.id===node.id).cards[0].headline,raw);
  assert.equal(definition.headline,'Energy: [ENERGY] [ICON:energy]');
 }finally{controller.destroy();}
});

test('held inventory descriptions resolve at viewing time without rewriting stored tokens',()=>{
 const item={kind:'item',name:'Tool',text:'[ENERGY] energy'},shown=[];
 const ui={input:{definitions:{variables},run:{variables:values}},cardPreview:{show:item=>shown.push(item)}};
 PlayerUI.prototype.showInventoryCard.call(ui,item);ui.input.run.variables.energy=1;
 PlayerUI.prototype.showInventoryCard.call(ui,item);
 assert.equal(shown[0].description,'2 energy');assert.equal(shown[1].description,'1 energy');assert.equal(item.text,'[ENERGY] energy');
});

test('combat descriptions hide prepared-only copy when preparation is consumed and keep names literal',()=>{
 const text='[BASEDMG] ⚔[IF:PREPARED], +[PREPBONUS] ⚔ or breaks defence[ENDIF]';
 const action={...attack,name:'Editor only',headline:'[HP]',description:text};
 for(const [preparationBonus,want] of [[0,'1–2 ⚔'],[2,'1–2 ⚔, +2 ⚔ or breaks defence'],[0,'1–2 ⚔']]){
  const shown=combatChoices([{id:'attack',action}], 'choices',values,variables,{preparationBonus}).actions[0];
  assert.equal(shown.text,want);assert.equal(shown.heading,'7');assert.equal(action.description,text);
 }
});


test('prepared attack type labels show only PREPARED while active',()=>{
 for(const bonus of [0,2,0]){
  const expected=bonus?'PREPARED':'ATTACK';
  assert.equal(combatChoices([{id:'attack',action:attack}],'choices',values,variables,{preparationBonus:bonus}).actions[0].typeLabel,expected);
  assert.equal(cardFace(attack,variables,[],values,{preparationBonus:bonus}).typeLabel,expected);
 }
 const defend={...attack,type:'defend'};
 assert.equal(combatChoices([{id:'defend',action:defend}],'choices',values,variables,{preparationBonus:2}).actions[0].typeLabel,'DEFEND');
});

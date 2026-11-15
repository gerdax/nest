import test from 'node:test';
import assert from 'node:assert/strict';
import {cardKinds, cardEditorTint, createDefinition, isStoryKind, placementOverrideKeys} from '../project/cards.js';
import {nodeSlotCardKinds} from '../project/nodeTypes.js';
import {createProject, createEnemy, validateProject, parseProject, compileChapter} from '../project/model.js';
import {cardFace} from '../project/presentation.js';
import {combatCard, enemyActionCard} from '../project/combat-presentation.js';
import {createAlternativeRatCombatProject} from '../project/combat-fixture.js';

const discovery=id=>({...createDefinition('discovery',id),headline:'You discover a hidden path.',image:'discovery.png'});

test('Discovery has its own registry identity and the Vignette story mechanics',()=>{
 const card=discovery('discovery');
 assert.equal(cardKinds.discovery.label,'Discovery');
 assert.equal(cardEditorTint('discovery'),'#f4f1da');
 assert(isStoryKind('discovery'));
 assert.deepEqual(placementOverrideKeys('discovery'),placementOverrideKeys('event'));
 assert.deepEqual(card.effects,[]);
 assert.equal(card.resolution,undefined);
 assert.deepEqual(cardKinds.discovery.validate(card),[]);
 assert.match(cardKinds.discovery.validate({...card,headline:null})[0],/Discovery.*string/);
 for(const [type,slot] of [['linear','cards'],['death','cards'],['fork','intro'],['fork','choices'],['container','intro']]){
  assert(nodeSlotCardKinds(type,slot).includes('discovery'),`${type}.${slot}`);
 }
 assert(!nodeSlotCardKinds('container','items').includes('discovery'));
});

test('Discovery validates, roundtrips and compiles in every Vignette beat slot',()=>{
 const project=createProject(),chapter=project.chapters[0],card=discovery('discovery');
 project.library.push(card);
 const placement=id=>({id,definitionId:card.id,effects:[{op:'add',key:'energy',value:1}]});
 const node=(id,type,fields)=>({id,name:id,type,x:0,y:0,...fields});
 chapter.startNode='linear';chapter.deathNode='death';
 chapter.nodes=[
  node('linear','linear',{cards:[placement('linear-card')],connections:{next:'fork'}}),
  node('fork','fork',{introEnabled:true,intro:placement('fork-intro'),choices:[placement('fork-choice')],connections:{'fork-choice':'container'}}),
  node('container','container',{introEnabled:true,intro:placement('container-intro'),items:[],connections:{next:false}}),
  node('death','death',{cards:[{id:'death-card',definitionId:card.id}],connections:{}})
 ];
 assert.deepEqual(validateProject(project),[]);
 const original=structuredClone(project),parsed=parseProject(JSON.stringify(project)),compiled=compileChapter(project);
 assert.deepEqual(project,original);
 assert.deepEqual(parseProject(JSON.stringify(parsed)),parsed);
 for(const beat of compiled.nodes){
  for(const resolved of [...(beat.cards??[]),...(beat.choices??[]),...(beat.intro?[beat.intro]:[])]){
   assert.equal(resolved.kind,'discovery');assert.equal(resolved.headline,card.headline);
   assert.deepEqual(resolved.effects,beat.type==='death'?[]:[{op:'add',key:'energy',value:1}]);
  }
 }
 card.headline=null;
 assert(validateProject(project).some(issue=>/Discovery text must be a string/.test(issue.message)));
 assert.throws(()=>parseProject(JSON.stringify(project)));
});

test('Discovery keeps its story face and combat presentation identity',()=>{
 const card={...discovery('discovery'),effects:[{op:'add',key:'energy',value:1}]};
 const face=cardFace(card);
 assert.equal(face.cardKind,'discovery');assert.equal(face.heading,card.headline);assert.equal(face.summary,'');assert.equal(face.text,'');
 assert.equal(combatCard(card,'combat').cardKind,'discovery');
 const action={kind:'combatAction',presentationKind:'discovery',type:'wait',resolution:'direct',headline:card.headline};
 const prepared=enemyActionCard(action,'prepared');
 assert.equal(prepared.cardKind,'discovery');assert.equal(prepared.heading,card.headline);assert.equal(prepared.advanceDisabled,false);
});

test('Discovery is accepted in embedded Enemy introduction, death, reaction and prepared presentation',()=>{
 const project=createProject(),enemy=createEnemy('enemy');
 enemy.intro=[discovery('enemy-intro')];enemy.death=[discovery('enemy-death')];
 enemy.reactions=[{id:'enemy-reaction',threshold:{numerator:1,denominator:2},card:discovery('enemy-reaction-card')}];
 enemy.actions[0].presentationKind='discovery';project.library.push(enemy);
 assert.deepEqual(validateProject(project),[]);
 for(const result of [parseProject(JSON.stringify(project)),compileChapter(project)]){
  const resolved=result.library.find(card=>card.id===enemy.id);
  assert.equal(resolved.intro[0].kind,'discovery');assert.equal(resolved.death[0].kind,'discovery');
  assert.equal(resolved.reactions[0].card.kind,'discovery');assert.equal(resolved.actions[0].presentationKind,'discovery');
 }
 enemy.reactions[0].card.headline=null;
 assert(validateProject(project).some(issue=>/invalid embedded card/.test(issue.message)));
});

test('legacy preparation cards preserve Discovery during migration to prepared Actions',()=>{
 const project=createAlternativeRatCombatProject(),enemy=project.library.find(card=>card.kind==='enemy');
 for(const action of enemy.actions)delete action.preparedActions;
 delete enemy.preparedActions;
 for(const card of Object.values(enemy.preparationCards))card.kind='discovery';
 assert.deepEqual(validateProject(project),[]);
 const parsed=parseProject(JSON.stringify(project)),resolved=parsed.library.find(card=>card.id===enemy.id);
 assert(resolved.preparedActions.length>0);
 assert(resolved.preparedActions.every(action=>action.presentationKind==='discovery'));
 assert(Object.values(resolved.preparationCards).every(card=>card.kind==='discovery'));
 assert.deepEqual(validateProject(parsed),[]);
});

test('legacy player Block reveals accept Discovery and retain their authored source',()=>{
 const project=createProject(),action=project.library.find(card=>card.kind==='combatAction'&&card.type==='defend');
 action.blockReveal=discovery('discovery-block');delete action.reveal;
 assert.deepEqual(validateProject(project),[]);
 const parsed=parseProject(JSON.stringify(project)),resolved=parsed.library.find(card=>card.id===action.id);
 assert.deepEqual(resolved.blockReveal,action.blockReveal);
 const promoted=parsed.library.find(card=>card.id===resolved.reveal.definitionId);
 assert.equal(promoted.kind,'effect');assert.equal(promoted.headline,action.blockReveal.headline);
 assert.deepEqual(validateProject(parsed),[]);
});

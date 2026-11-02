import test from 'node:test';
import assert from 'node:assert/strict';
import {createAlternativeRatCombatProject,createRatCombatProject} from '../project/combat-fixture.js';
import {parseProject,validateProject,compileChapter,exportChapter,importChapter} from '../project/model.js';
import {ensureEnemyPreparationCards} from '../project/combat-model.js';

const rat=project=>project.library.find(definition=>definition.id==='rat');
test('older alternative projects gain stable editable cards without changing their original data',()=>{
 const project=createAlternativeRatCombatProject();delete rat(project).preparationCards;for(const action of rat(project).actions)delete action.preparedActions;
 rat(project).text='My custom rat';rat(project).actions[0].image='custom-bite.png';
 const original=structuredClone(project),parsed=parseProject(JSON.stringify(project));
 assert.deepEqual(project,original);assert.equal(rat(parsed).text,'My custom rat');assert.equal(rat(parsed).actions[0].image,'custom-bite.png');
 assert.deepEqual(Object.keys(rat(parsed).preparationCards),['block','charge','hold']);
 assert.deepEqual(Object.values(rat(parsed).preparationCards).map(card=>card.name),['Dodge','Rush','Skip']);
 assert.deepEqual(parseProject(JSON.stringify(parsed)),parsed);assert.deepEqual(validateProject(parsed),[]);
});
test('authored preparation cards preserve blank text, artwork transforms and identity through compile/export/import',()=>{
 const project=createAlternativeRatCombatProject(),cards=rat(project).preparationCards;
 for(const [key,card] of Object.entries(cards))Object.assign(card,{text:key==='block'?'':`Edited ${key}`,kind:'event',image:`${key}.png`,imageScale:123,imageOffsetX:7,imageOffsetY:-4,flipImage:true});
 const parsed=parseProject(JSON.stringify(project));assert.deepEqual(rat(parsed).preparationCards,cards);
 assert.deepEqual(rat(compileChapter(parsed)).preparationCards,cards);
 const imported=importChapter(createRatCombatProject(),exportChapter(parsed));
 const importedRat=imported.library.find(definition=>definition.kind==='enemy'&&definition.mechanics==='opposed-preparation');
 assert.deepEqual(importedRat.preparationCards,cards);
});
test('partial migration retains authored cards and allocates missing card identities without collisions',()=>{
 const enemy=rat(createAlternativeRatCombatProject()),block=structuredClone(enemy.preparationCards.block);
 enemy.preparationCards={block};enemy.hit.id=`${enemy.id}-preparation-charge`;
 ensureEnemyPreparationCards(enemy);assert.deepEqual(enemy.preparationCards.block,block);assert.notEqual(enemy.preparationCards.charge.id,enemy.hit.id);
 const again=structuredClone(enemy);ensureEnemyPreparationCards(enemy);assert.deepEqual(enemy,again);
});
test('legacy migration reserves project-wide IDs so feedback cannot navigate to an unrelated shared card',()=>{
 const project=createAlternativeRatCombatProject();delete rat(project).preparationCards;for(const action of rat(project).actions)delete action.preparedActions;
 project.library.push({id:'rat-preparation-block',kind:'caption',name:'Unrelated caption',text:'Unrelated',image:'',effects:[]});
 const parsed=parseProject(JSON.stringify(project));assert.notEqual(rat(parsed).preparationCards.block.id,'rat-preparation-block');assert.deepEqual(validateProject(parsed),[]);
 assert.deepEqual(parseProject(JSON.stringify(parsed)),parsed);
});
test('invalid authored preparation cards are diagnosed rather than repaired or executed',()=>{
 for(const mutate of [enemy=>enemy.preparationCards=null,enemy=>enemy.preparationCards.block=null,enemy=>enemy.preparationCards.charge.kind='combatAction',enemy=>enemy.preparationCards.block.effects=[{op:'add',key:'health',value:2}],enemy=>enemy.preparationCards.hold.id=enemy.hit.id]){
  const project=createAlternativeRatCombatProject();mutate(rat(project));assert(validateProject(project).length>0);assert.throws(()=>parseProject(JSON.stringify(project)));
 }
});
test('classic enemies do not acquire alternative cards',()=>{
 const project=createRatCombatProject();assert.equal(rat(project).preparationCards,undefined);assert.equal(rat(parseProject(JSON.stringify(project))).preparationCards,undefined);
});

test('legacy prepared checks snapshot original behavior without aliasing or later Attack inheritance',()=>{
 const project=createAlternativeRatCombatProject(),enemy=rat(project),attack=enemy.actions.find(a=>a.type==='attack');
 delete enemy.preparationCards.block.check;delete enemy.preparationCards.charge.check;delete enemy.preparationCards.charge.resolution;
 attack.check={mode:'stat',modifierVariable:'composure',difficulty:7};
 const original=structuredClone(project),parsed=parseProject(JSON.stringify(project)),migrated=rat(parsed);
 assert.deepEqual(project,original);
 assert.deepEqual(migrated.preparationCards.block.check,{pool:[{sides:6,count:3}],modifier:0,target:10});
 assert.equal(migrated.preparationCards.block.resolution,'check');
 assert.deepEqual(migrated.preparationCards.charge.check,attack.check);assert.equal(migrated.preparationCards.charge.resolution,'check');
 migrated.actions.find(a=>a.type==='attack').check.difficulty=1;
 assert.equal(migrated.preparationCards.charge.check.difficulty,7);
 assert.deepEqual(parseProject(JSON.stringify(parsed)),parsed);
 const direct=structuredClone(project);rat(direct).actions.find(a=>a.type==='attack').resolution='direct';
 assert.equal(rat(parseProject(JSON.stringify(direct))).preparationCards.charge.resolution,'direct');
});

test('prepared check validation rejects malformed settings instead of silently restoring defaults',()=>{
 for(const key of ['block','charge'])for(const check of [null,{pool:[],modifier:0,target:10},{pool:[{sides:7,count:1}],modifier:0,target:10},{mode:'stat',modifierVariable:'health',difficulty:3},{mode:'stat',modifierVariable:'agility',difficulty:11}]){
  const project=createAlternativeRatCombatProject();rat(project).preparationCards[key].check=check;
  assert(validateProject(project).some(error=>/check/i.test(error.message)));
  assert.throws(()=>parseProject(JSON.stringify(project)));
 }
 const project=createAlternativeRatCombatProject();rat(project).preparationCards.charge.resolution='unknown';
 assert(validateProject(project).length>0);assert.throws(()=>parseProject(JSON.stringify(project)));
});

test('prepared stat checks round-trip and remap colliding variables with their owner',()=>{
 const project=createAlternativeRatCombatProject(),cards=rat(project).preparationCards;
 cards.block.check={mode:'stat',modifierVariable:'composure',difficulty:4};
 cards.charge.check={mode:'stat',modifierVariable:'agility',difficulty:6};
 const parsed=parseProject(JSON.stringify(project));
 assert.deepEqual(rat(parsed).preparationCards,cards);
 assert.deepEqual(rat(compileChapter(parsed)).preparationCards,cards);
 const target=createRatCombatProject();target.variables.find(v=>v.id==='composure').name='Other composure';
 const imported=importChapter(target,exportChapter(parsed));
 const importedRat=imported.library.find(d=>d.kind==='enemy'&&d.mechanics==='opposed-preparation');
 assert.deepEqual(validateProject(imported),[]);
 assert(imported.variables.some(v=>v.id===importedRat.preparationCards.block.check.modifierVariable));
 assert.deepEqual(importedRat.preparationCards.charge.check,cards.charge.check);
});


for(const legacy of ['missing-type','attacks'])test(`prepared Rush snapshots the normalized legacy Attack: ${legacy}`,()=>{
 const project=createAlternativeRatCombatProject(),enemy=rat(project);
 const attack=enemy.actions.find(action=>action.type==='attack');
 attack.check={pool:[{sides:20,count:1}],modifier:4,target:18};delete attack.type;
 delete enemy.preparationCards.charge.check;delete enemy.preparationCards.charge.resolution;
 if(legacy==='attacks'){enemy.attacks=enemy.actions;delete enemy.actions;}
 const parsed=parseProject(JSON.stringify(project)),migrated=rat(parsed);
 assert.deepEqual(migrated.preparationCards.charge.check,attack.check);
 assert.equal(migrated.preparationCards.charge.resolution,'check');
 assert.deepEqual(validateProject(parsed),[]);
});


test('Direct Dodge survives save/load and invalid Dodge resolution is rejected',()=>{
 const project=createAlternativeRatCombatProject(),dodge=rat(project).preparationCards.block;
 dodge.resolution='direct';const check=structuredClone(dodge.check);
 const parsed=parseProject(JSON.stringify(project));
 assert.equal(rat(parsed).preparationCards.block.resolution,'direct');
 assert.deepEqual(rat(parsed).preparationCards.block.check,check);
 dodge.resolution='invalid';assert(validateProject(project).length>0);
 assert.throws(()=>parseProject(JSON.stringify(project)));
});

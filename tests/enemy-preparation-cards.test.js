import test from 'node:test';
import assert from 'node:assert/strict';
import {createAlternativeRatCombatProject,createRatCombatProject} from '../project/combat-fixture.js';
import {parseProject,validateProject,compileChapter,exportChapter,importChapter} from '../project/model.js';
import {ensureEnemyPreparationCards} from '../project/combat-model.js';

const rat=project=>project.library.find(definition=>definition.id==='rat');
test('older alternative projects gain stable editable cards without changing their original data',()=>{
 const project=createAlternativeRatCombatProject();delete rat(project).preparationCards;
 rat(project).text='My custom rat';rat(project).actions[0].image='custom-bite.png';
 const original=structuredClone(project),parsed=parseProject(JSON.stringify(project));
 assert.deepEqual(project,original);assert.equal(rat(parsed).text,'My custom rat');assert.equal(rat(parsed).actions[0].image,'custom-bite.png');
 assert.deepEqual(Object.keys(rat(parsed).preparationCards),['block','charge','hold']);
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
 const project=createAlternativeRatCombatProject();delete rat(project).preparationCards;
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

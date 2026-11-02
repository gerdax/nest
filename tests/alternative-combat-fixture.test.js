import test from 'node:test';
import assert from 'node:assert/strict';
import {createAlternativeRatCombatProject,createRatCombatProject} from '../project/combat-fixture.js';
import {validateProject,parseProject,compileChapter} from '../project/model.js';

const actions=project=>project.combat.defaultActions.map(reference=>project.library.find(definition=>definition.id===reference.definitionId));

test('alternative rat fixture validates, roundtrips and compiles with its explicit mechanics',()=>{
 const project=createAlternativeRatCombatProject();
 assert.deepEqual(validateProject(project),[]);
 const parsed=parseProject(JSON.stringify(project));
 assert.deepEqual(actions(parsed),actions(project));
 assert.deepEqual(parsed.library.find(definition=>definition.id==='rat'),project.library.find(definition=>definition.id==='rat'));
 const compiled=compileChapter(parsed),enemy=compiled.library.find(definition=>definition.id==='rat');
 assert.equal(enemy.mechanics,'opposed-preparation');
 assert.equal(enemy.health,8);
 assert.deepEqual(enemy.reactions,[]);
 assert.equal(project.chapters[0].startNode,'rat-fight');
 assert(!project.chapters[0].nodes.some(node=>node.type==='container'));
 assert(!project.library.some(definition=>definition.subtype==='weapon'));
});

test('alternative fixture provides exactly the intended player costs and zero cooldown Actions',()=>{
 const project=createAlternativeRatCombatProject(),[attack,defend,preparation]=actions(project);
 assert.deepEqual(actions(project).map(action=>action.name),['Attack','Defend','Preparation']);
 assert.equal(attack.type,'attack');assert.equal(attack.resolution,'check');
 assert.deepEqual(attack.check,{mode:'stat',modifierVariable:'agility',difficulty:3});
 assert.deepEqual(attack.attack,{source:'self',damage:{min:2,max:2},minBonus:0,maxBonus:0});
 assert.equal(defend.type,'defend');assert.equal(defend.resolution,'direct');assert.equal(defend.damageReduction,4);
 assert.deepEqual(defend.costs,[{source:'variable',key:'energy',amount:1}]);
 assert.equal(preparation.type,'prepare');assert.equal(preparation.resolution,'direct');assert.equal(preparation.preparationBonus,2);
 assert.deepEqual(attack.costs,[]);assert.deepEqual(preparation.costs,[]);
 const enemy=project.library.find(definition=>definition.id==='rat'),[bite,prepare]=enemy.actions;
 assert.deepEqual(enemy.actions.map(action=>action.type),['attack','prepare']);
 assert.equal(enemy.stats,undefined);assert.equal(enemy.attributes,undefined);
 assert.deepEqual(bite.check,{pool:[{sides:6,count:3}],modifier:0,target:10});assert.deepEqual(bite.attack,attack.attack);
 assert.equal(prepare.resolution,'direct');assert.equal(prepare.text,'The rat prepares…');assert.equal(prepare.damageReduction,4);assert.equal(prepare.preparationBonus,2);
 for(const action of [...actions(project),...enemy.actions])assert.equal(action.cooldown,0);
});

test('alternative construction and mutation leave classic and other fresh fixtures untouched',()=>{
 const classic=createRatCombatProject(),before=structuredClone(classic),alternative=createAlternativeRatCombatProject(),fresh=createAlternativeRatCombatProject();
 alternative.library.find(definition=>definition.id==='rat').actions[0].check.target=99;
 actions(alternative)[1].costs[0].amount=99;
 assert.deepEqual(classic,before);
 assert.deepEqual(createRatCombatProject(),before);
 assert.equal(fresh.library.find(definition=>definition.id==='rat').actions[0].check.target,10);
 assert.equal(actions(fresh)[1].costs[0].amount,1);
 assert.equal(classic.chapters[0].startNode,'take-pistol');
 assert.equal(classic.library.find(definition=>definition.id==='rat').mechanics,undefined);
 assert.equal(classic.library.find(definition=>definition.id==='rat').health,4);
});

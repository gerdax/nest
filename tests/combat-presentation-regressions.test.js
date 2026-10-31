import {checkChanceLabel} from '../project/checks.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {combatChoices} from '../project/combat-presentation.js';
import {playerChoices,checkOdds} from '../project/combat-rules.js';
import {createRatCombatProject} from '../project/combat-fixture.js';
import {compileChapter} from '../project/model.js';

for(const [name,check,values,formula] of [
 ['custom positive',{pool:[{count:2,sides:6},{count:1,sides:4}],modifier:2,modifierVariable:'energy',target:12},{energy:3},'2d6 + 1d4 + 5 ≥ 12'],
 ['custom negative',{pool:[{count:3,sides:6}],modifier:-5,modifierVariable:'energy',target:11},{energy:3},'3d6 − 2 ≥ 11'],
 ['custom zero',{pool:[{count:3,sides:6}],modifier:-3,modifierVariable:'energy',target:11},{energy:3},'3d6 ≥ 11'],
 ['stat',{mode:'stat',modifierVariable:'agility',difficulty:4},{agility:7},'3d6 + 7 ≥ 14'],
])test(`combat choice formula reflects the resolved ${name} modifier`,()=>{
 const compiled=compileChapter(createRatCombatProject());
 const action=compiled.library.find(d=>d.name==='Punch');action.check=check;
 const choices=playerChoices(compiled,{variables:{health:10,energy:3,...values},inventory:[]},{cooldowns:{}});
 const content=combatChoices(choices,'choices',values);
 const info=content.actions.find(a=>a.label==='Punch').checkInfo;
 assert.equal(info.label,checkChanceLabel(checkOdds(check,values).probability));assert.equal(info.formula,formula);
 assert.equal(info.chance,String(checkOdds(check,values).probability*100));
});

import {combatCard,enemyActionCard} from '../project/combat-presentation.js';
import {cardFace} from '../project/presentation.js';
for(const type of ['attack','defend','wait'])test(`combat ${type} labels distinguish player and enemy cards`,()=>{
 const action={id:type,kind:'combatAction',type,name:'Custom name',resolution:'direct',text:'Description'};
 assert.equal(cardFace(action).typeLabel,type.toUpperCase());
 assert.equal(combatCard(action,'card').typeLabel,type.toUpperCase());
 assert.equal(combatChoices([{id:type,action}], 'choices').actions[0].typeLabel,type.toUpperCase());
 assert.equal(enemyActionCard(action,'enemy').typeLabel,'');
});
test('combat shortage identifies the first unaffordable resource including cumulative costs',()=>{
 const action={id:'wait',kind:'combatAction',type:'wait',resolution:'direct',costs:[{source:'variable',key:'energy',amount:2},{source:'variable',key:'energy',amount:2}]};
 const compiled={library:[action],variables:[{id:'energy',name:'Energy',type:'number',min:0}],combat:{defaultActions:[{definitionId:'wait'}]}};
 const run={variables:{energy:3},inventory:[]};
 assert.equal(playerChoices(compiled,run,{cooldowns:{}})[0].disabledReason,'Not enough Energy');
 assert.equal(run.variables.energy,3);
 action.costs=[{source:'inventory',key:'ammo'}];compiled.library.push({id:'ammo',name:'Ammunition',kind:'item'});
 assert.equal(playerChoices(compiled,run,{cooldowns:{}})[0].disabledReason,'No required item');
});

test('combat requirements explain shortages and treat Health/Energy equality as minimums',()=>{
 const action={id:'wait',kind:'combatAction',type:'wait',resolution:'direct',conditions:[]};
 const compiled={library:[action],variables:[{id:'energy',name:'Energy'},{id:'health',name:'Health'},{id:'door',name:'Door unlocked'},{id:'level',name:'Level'}],combat:{defaultActions:[{definitionId:'wait'}]}};
 const reason=(condition,variables,inventory=[])=>{action.conditions=[condition];return playerChoices(compiled,{variables,inventory},{cooldowns:{}})[0].disabledReason;};
 for(const key of ['energy','health']) {
  const condition={source:'variable',key,op:'eq',value:3};
  assert.equal(reason(condition,{[key]:0}),`Not enough ${key==='energy'?'Energy':'Health'}`);
  assert.equal(reason(condition,{[key]:3}),'');
  assert.equal(reason(condition,{[key]:4}),'');
  assert.equal(condition.op,'eq');
 }
 assert.equal(reason({source:'inventory',key:'torch',op:'has'},{}),'No required item');
 assert.equal(reason({source:'variable',key:'door',op:'eq',value:true},{door:false}),'Requires Door unlocked');
 assert.equal(reason({source:'variable',key:'level',op:'eq',value:3},{level:4}),'Requires Level = 3');
 assert.equal(reason({source:'variable',key:'energy',op:'lte',value:3},{energy:4}),'Requires Energy ≤ 3');
});

test('Weapon card faces use WEAPON while ordinary Items retain their standard label',()=>{
 assert.equal(cardFace({kind:'item',subtype:'weapon',name:'Pistol'}).typeLabel,'WEAPON');
 assert.equal(cardFace({kind:'item',name:'Key'}).typeLabel,undefined);
});

test('combat odds show the tested stat name and the regular action chance description',()=>{
 const action={name:'Attack',resolution:'check',check:{mode:'stat',modifierVariable:'agility',difficulty:1}};
 const choice=combatChoices([{id:'attack',action}],'choices',{agility:3},[{id:'agility',name:'Agility'}]).actions[0];
 assert.equal(choice.checkInfo.stat,'Agility');
 assert.equal(choice.checkInfo.label,'Very high');
 assert.equal(Math.round(Number(choice.checkInfo.chance)),84);
 assert.equal(choice.checkInfo.formula,'3d6 + 3 ≥ 11');
 const custom={...action,check:{pool:[{count:3,sides:6}],target:11,modifier:0}};
 const info=combatChoices([{id:'custom',action:custom}],'choices').actions[0].checkInfo;
 assert.equal(info.stat,'ATTACK');assert.equal(info.label,'Medium');
});

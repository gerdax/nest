import {checkChanceLabel} from '../project/checks.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {combatChoices} from '../project/combat-presentation.js';
import {playerChoices,checkOdds} from '../project/combat-rules.js';
import {createRatCombatProject} from '../project/combat-fixture.js';
import {compileChapter} from '../project/model.js';

for(const [name,check,values,formula] of [
 ['custom positive',{pool:[{count:2,sides:6},{count:1,sides:4}],modifier:2,modifierVariable:'energy',target:12},{energy:3},'Roll 7 or higher'],
 ['custom negative',{pool:[{count:3,sides:6}],modifier:-5,modifierVariable:'energy',target:11},{energy:3},'Roll 13 or higher'],
 ['custom zero',{pool:[{count:3,sides:6}],modifier:-3,modifierVariable:'energy',target:11},{energy:3},'Roll 11 or higher'],
 ['stat',{mode:'stat',modifierVariable:'agility',difficulty:4},{agility:7},'Roll 7 or higher'],
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

test('combat odds show the tested stat name and value and the regular action chance description',()=>{
 const action={name:'Attack',resolution:'check',check:{mode:'stat',modifierVariable:'agility',difficulty:1}};
 const choice=combatChoices([{id:'attack',action}],'choices',{agility:3},[{id:'agility',name:'Agility'}]).actions[0];
 assert.equal(choice.checkInfo.stat,'TARGET: 8');
 assert.equal(choice.checkInfo.label,'Very high');
 assert.equal(Math.round(Number(choice.checkInfo.chance)),84);
 assert.equal(choice.checkInfo.formula,'Roll 8 or higher');
 const custom={...action,check:{pool:[{count:3,sides:6}],target:11,modifier:0}};
 const info=combatChoices([{id:'custom',action:custom}],'choices').actions[0].checkInfo;
 assert.equal(info.stat,'TARGET: 11');assert.equal(info.label,'Medium');
});

test('combat choices preserve cooldown metadata when requirements or costs explain the disabled state',()=>{
 const action=(id,extra={})=>({id,name:id,kind:'combatAction',type:'wait',resolution:'direct',...extra});
 const costly=action('costly',{costs:[{source:'variable',key:'energy',amount:2}]});
 const locked=action('locked',{conditions:[{source:'variable',key:'door',op:'eq',value:true}]});
 const ready=action('ready');
 const weapon={id:'sword',definitionId:'sword',inventoryKey:'sword-1',name:'Sword',subtype:'weapon',combat:{actions:[locked,ready]}};
 const compiled={library:[costly,ready],variables:[{id:'energy',name:'Energy',type:'number',min:0},{id:'door',name:'Door unlocked'}],combat:{defaultActions:[{definitionId:'costly'},{definitionId:'ready'}]}};
 const run={variables:{energy:0,door:false},inventory:[weapon]};
 const encounter={cooldowns:{'costly@default':2,'locked@sword-1':3}};
 const before=structuredClone({compiled,run,encounter});
 const choices=playerChoices(compiled,run,encounter);
 assert.deepEqual(choices.map(({id,cooldownRemaining,disabledReason})=>({id,cooldownRemaining,disabledReason})),[
  {id:'costly@default',cooldownRemaining:2,disabledReason:'Not enough Energy'},
  {id:'ready@default',cooldownRemaining:0,disabledReason:''},
  {id:'locked@sword-1',cooldownRemaining:3,disabledReason:'Requires Door unlocked'},
  {id:'ready@sword-1',cooldownRemaining:0,disabledReason:''},
 ]);
 assert.deepEqual(combatChoices(choices,'choices').actions.map(choice=>choice.id),['ready@sword-1','ready@default','costly@default','locked@sword-1']);
 assert.deepEqual({compiled,run,encounter},before);
});

test('combat choices stably group source actions, defaults, and all cooling actions without mutating choices',()=>{
 const source={id:'blade',definitionId:'blade',inventoryKey:'blade-1',name:'Blade'};
 const choice=(id,{source=null,cooldownRemaining=0,disabled=false,disabledReason=''}={})=>({id,action:{name:id,resolution:'direct'},source,cooldownRemaining,disabled,disabledReason});
 const choices=[
  choice('default-cooling',{cooldownRemaining:1,disabled:true,disabledReason:'Cooldown: 1 turn'}),
  choice('default-ready'),
  choice('default-locked',{disabled:true,disabledReason:'No required item'}),
  choice('source-cooling',{source,cooldownRemaining:2,disabled:true,disabledReason:'Not enough Energy'}),
  choice('source-ready',{source}),
  choice('source-locked',{source,disabled:true,disabledReason:'No required item'}),
  choice('other-source-ready',{source:{...source,inventoryKey:'blade-2'}}),
  choice('default-cooling-late',{cooldownRemaining:3,disabled:true,disabledReason:'Requires Door unlocked'}),
 ];
 const before=structuredClone(choices);
 const actions=combatChoices(choices,'choices').actions;
 assert.deepEqual(actions.map(action=>action.id),['source-ready','source-locked','other-source-ready','default-ready','default-locked','default-cooling','source-cooling','default-cooling-late']);
 assert.equal(actions.find(action=>action.id==='source-cooling').disabledReason,'Not enough Energy');
 assert.equal(actions.find(action=>action.id==='source-locked').disabled,true);
 assert.equal(actions.find(action=>action.id==='source-ready').contextInventoryKey,'blade-1');
 assert.equal(actions.find(action=>action.id==='source-ready').contextItemId,'blade');
 assert.equal(actions.find(action=>action.id==='source-ready').inventoryLabel,'USING · Blade');
 assert.deepEqual(choices,before);
});

test('source action entrances default to enabled and can be suppressed on later presentations',()=>{
 const source={id:'sword',name:'Sword'};
 const choices=[
  {id:'ready',action:{name:'Ready',resolution:'direct'},source,disabled:false},
  {id:'disabled',action:{name:'Disabled',resolution:'direct'},source,disabled:true,disabledReason:'No required item'},
  {id:'default',action:{name:'Default',resolution:'direct'},disabled:false},
 ];
 const first=combatChoices(choices,'first').actions;
 const later=combatChoices(choices,'later',{},[],{animateItemActions:false}).actions;
 assert.deepEqual(first.map(action=>action.entrance),['bottom',undefined,undefined]);
 assert.deepEqual(later.map(action=>action.entrance),[undefined,undefined,undefined]);
 assert.deepEqual(later,first.map(action=>({...action,...(action.contextItemId?{entrance:undefined}:{})})));
});


test('Attack descriptions contain only authored text, including when prepared',()=>{
 for(const text of [undefined,'','My editable description.']){
  const action={id:'attack',name:'Attack',type:'attack',resolution:'direct',text};
  const choices=[{id:'attack',action,profile:{min:1,max:2}}];
  for(const preparationBonus of [0,2]){
   const shown=combatChoices(choices,'choices',{},[],{preparationBonus}).actions[0];
   assert.equal(shown.text,text??'');
  }
 }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {playerChoices,completePlayerTurn,cooldownKey,createEncounter} from '../project/combat-rules.js';
import {selectTriggerItem} from '../project/state.js';

function fixture(mode='multiple',cooldown=2){
 const action={id:'shoot',kind:'combatAction',type:'attack',headline:'Shoot',resolution:'direct',cooldown,attack:{source:'weapon'}};
 const weapon={id:'pistol',definitionId:'pistol',inventoryKey:'pistol',subtype:'weapon',kind:'item',permability:3,combat:{damage:{min:1,max:1},actions:[action]}};
 const inventory=[{...weapon,instanceId:'a',remainingTriggers:2},{...weapon,instanceId:'b',remainingTriggers:3}];
 const compiled={ownedItemsVisibility:mode,variables:[],library:[],combat:{defaultActions:[]}},run={variables:{},inventory};
 const encounter=createEncounter({health:10,actions:[{type:'wait'}]},'fight');
 const choices=()=>playerChoices(compiled,run,encounter);
 return {action,inventory,compiled,run,encounter,choices};
}

for(const mode of ['multiple','disabled'])test(`Allow multiple selects a ready physical weapon before fewer remaining uses (${mode})`,()=>{
 const f=fixture(mode);f.encounter.cooldowns[cooldownKey(f.action,f.inventory[0],{perInstance:true})]=2;
 const before=structuredClone(f.encounter);
 for(let i=0;i<4;i++){
  const choices=f.choices();assert.equal(choices.length,1);assert.equal(choices[0].source.instanceId,'b');assert.equal(choices[0].disabled,false);
 }
 assert.deepEqual(f.encounter,before);
 // Non-combat triggers retain the least-use rule independently of combat cooldown.
 assert.equal(selectTriggerItem(f.inventory,'pistol').instanceId,'a');
});

test('each physical cooldown is written and ticks separately while exposing one logical action',()=>{
 const f=fixture();let encounter=f.encounter;
 const choose=()=>playerChoices(f.compiled,f.run,encounter)[0];
 assert.equal(choose().source.instanceId,'a');
 encounter=completePlayerTurn(encounter,f.action,choose().source,{perInstance:true});
 assert.deepEqual(encounter.cooldowns,{'shoot@a':2});
 assert.equal(choose().source.instanceId,'b');
 encounter=completePlayerTurn(encounter,f.action,choose().source,{perInstance:true});
 assert.deepEqual(encounter.cooldowns,{'shoot@a':1,'shoot@b':2});
 assert.equal(choose().source.instanceId,'a');assert.equal(choose().cooldownRemaining,1);assert.equal(choose().disabled,true);
 encounter=completePlayerTurn(encounter,{id:'wait',type:'wait'},null,{perInstance:true});
 assert.equal(choose().source.instanceId,'a');assert.equal(choose().disabled,false);
});

test('equal ready or blocked cooldowns use the least-used equivalent source with stable ties',()=>{
 const f=fixture();
 assert.equal(f.choices()[0].source.instanceId,'a');
 f.encounter.cooldowns={'shoot@a':3,'shoot@b':1};assert.equal(f.choices()[0].source.instanceId,'b');
 f.encounter.cooldowns={'shoot@a':2,'shoot@b':2};assert.equal(f.choices()[0].source.instanceId,'a');
 f.inventory[1].remainingTriggers=2;assert.equal(f.choices()[0].source.instanceId,'a');
 f.inventory[0].remainingTriggers=0;assert.equal(f.choices()[0].source.instanceId,'b');
});

for(const mode of ['hidden',undefined])test(`without Allow multiple cooldown remains shared (${mode})`,()=>{
 const f=fixture();f.compiled.ownedItemsVisibility=mode;
 f.encounter.cooldowns={'shoot@pistol':2,'shoot@a':0,'shoot@b':0};
 const choice=f.choices()[0];assert.equal(choice.id,'shoot@pistol');assert.equal(choice.source.instanceId,'a');assert.equal(choice.disabled,true);
});

test('actions without cooldown retain their shared identity and least-use selection',()=>{
 const f=fixture('multiple',0);f.encounter.cooldowns={'shoot@a':5};
 const choice=f.choices()[0];assert.equal(choice.id,'shoot@pistol');assert.equal(choice.source.instanceId,'a');assert.equal(choice.disabled,false);
});

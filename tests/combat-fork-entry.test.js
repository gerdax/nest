import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CombatScenario} from '../combat/scenario.js';
import {initial} from '../combat/rules.js';
function harness({introduced=false,reload=0}={}){
 const s=Object.create(CombatScenario.prototype),transitions=[],updates=[];
 Object.assign(s,{state:{...initial(),actor:'hero',burstReload:reload},weaponIntroduced:introduced,epoch:1,abort:new AbortController(),setPhase(p){this.phase=p;},ready:async()=>true,deck:{transitionContent:async content=>{transitions.push(content);return true;},updateActions:actions=>updates.push(actions)}});
 return {s,transitions,updates};
}
test('first weapon appearance retains the special bottom entrance',async()=>{
 const {s,transitions,updates}=harness();await s.showChoices();
 assert.deepEqual(transitions[0].actions.map(a=>a.id),['attack']);assert.equal(updates[0][1].entrance,'bottom');assert.equal(s.weaponIntroduced,true);
});
for(const reload of [0,1])test(`returning Fork stages both cards together, reload ${reload}`,async()=>{
 const {s,transitions,updates}=harness({introduced:true,reload});await s.showChoices();
 assert.deepEqual(transitions[0].actions.map(a=>a.id),['attack','weapon']);assert.equal(updates.length,0);
 assert.ok(transitions[0].actions.every(a=>a.entrance===undefined));assert.equal(transitions[0].actions[1].disabled,reload>0);
});
test('returning Fork from LINEAR also uses a complete normal fan',async()=>{
 const {s}=harness({introduced:true});let received;s.incoming=async content=>{received=content;return true};await s.showChoices({fromLinear:true});
 assert.equal(received.actions.length,2);assert.ok(received.actions.every(a=>a.entrance===undefined));
});

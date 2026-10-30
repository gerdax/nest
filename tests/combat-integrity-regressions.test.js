import test from 'node:test';
import assert from 'node:assert/strict';
import {createRatCombatProject} from '../project/combat-fixture.js';
import {validateProject, parseProject} from '../project/model.js';
import {createDefinition} from '../project/cards.js';
import {initialValues, transact, affordCosts} from '../project/state.js';
import {chapterEntryState} from '../project/chapter-entry.js';
import {attackProfile} from '../project/combat-rules.js';

const healthIssue = issues => issues.some(issue => /integer.*Health|Health.*integer/.test(issue.message));
for (const [name, change] of [
 ['chapter override', p => p.chapters[0].initialValues={health:9.5}],
 ['base initial', p => p.variables.find(v=>v.id==='health').initial=9.5],
 ['fractional minimum', p => p.variables.find(v=>v.id==='health').min=-.5],
 ['fractional maximum', p => p.variables.find(v=>v.id==='health').max=10.5],
 ['ordinary collection', p => p.library.find(d=>d.id==='pistol').onCollect=[{op:'add',key:'health',value:-.5}]],
 ['ordinary story effect', p => p.library.push({...createDefinition('caption','fractional-story'),effects:[{op:'set',key:'health',value:9.5}]})],
 ['consumable value', p => p.library.push({...createDefinition('health','fractional-consumable'),value:.5})],
 ['ordinary action cost', p => p.library.push({...createDefinition('action','fractional-cost'),costs:[{source:'variable',key:'health',amount:.5}]})],
]) test(`fractional Health is diagnosed before playback: ${name}`,()=>{
 const project=createRatCombatProject();change(project);const before=structuredClone(project);
 assert(healthIssue(validateProject(project)));
 assert.throws(()=>parseProject(JSON.stringify(project)),/integer.*Health|Health.*integer/);
 assert.deepEqual(project,before,'diagnostics preserve authored values');
});

test('runtime Health invariant rejects fractional carry and atomic transactions without rounding',()=>{
 const project=createRatCombatProject();
 assert.throws(()=>chapterEntryState(project,project.activeChapterId,{variables:{health:9.5}}),/integer Health/);
 const defs=project.variables,values=initialValues(defs),before={...values};
 assert.throws(()=>transact(values,[],{effects:[{op:'add',key:'energy',value:1},{op:'add',key:'health',value:-.5}]},defs),/integer Health/);
 assert.deepEqual(values,before);
 assert.equal(affordCosts(values,[],[{source:'variable',key:'health',amount:.5}],defs),false);
 assert.throws(()=>initialValues([{id:'health',type:'number',initial:9.5}]),/integer Health/);
 assert.throws(()=>initialValues([{id:'health',type:'number',initial:1,min:1.5}]),/integer Health/);
 assert.throws(()=>transact({health:1},[],{effects:[{op:'set',key:'health',value:Number.MAX_SAFE_INTEGER+1}]},[{id:'health',type:'number'}]),/integer Health/);
 assert.equal(transact(values,[],{effects:[{op:'add',key:'energy',value:.5}]},defs).variables.energy,values.energy+.5);
 assert.equal(transact(values,[],{effects:[{op:'add',key:'health',value:-1}]},defs).variables.health,values.health-1);
});

for(const [name,change] of [
 ['reversed Weapon range', action=>action.attack.minBonus=3],
 ['negative effective damage', action=>action.attack.minBonus=-2],
 ['overflowing damage', action=>action.attack.maxBonus=Number.MAX_SAFE_INTEGER],
])test(`effective Weapon damage is diagnosed: ${name}`,()=>{
 const project=createRatCombatProject(),weapon=project.library.find(d=>d.id==='pistol'),action=weapon.combat.actions[0];change(action);
 assert.throws(()=>attackProfile(action,weapon),/damage range/);
 assert(validateProject(project).some(issue=>issue.message.includes('effective attack damage range')));
});
test('effective own damage is validated and valid Weapon bonuses use the runtime resolver',()=>{
 const project=createRatCombatProject(),punch=project.library.find(d=>d.name==='Punch');
 punch.attack.minBonus=2;
 assert(validateProject(project).some(issue=>issue.message.includes('effective attack damage range')));
 punch.attack.minBonus=0;
 const weapon=project.library.find(d=>d.id==='pistol');weapon.combat.actions[0].attack={source:'weapon',minBonus:1,maxBonus:1};
 assert.deepEqual(attackProfile(weapon.combat.actions[0],weapon),{min:2,max:3});
 assert.deepEqual(validateProject(project),[]);
});

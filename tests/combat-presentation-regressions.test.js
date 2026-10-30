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
 assert.equal(info.label,formula);assert.equal(info.formula,formula);
 assert.equal(info.chance,String(checkOdds(check,values).probability*100));
});

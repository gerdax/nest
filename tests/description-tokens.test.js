import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveDescription,listDescriptionTokens} from '../project/description-tokens.js';

const punch = {kind:'combatAction',type:'attack',attack:{source:'self',damage:{min:2,max:4}},costs:[{source:'variable',key:'energy',amount:2}]};
const weapon = {kind:'item',subtype:'weapon',combat:{damage:{min:3,max:5}}};
const variables = [{id:'agility',name:'Agility',type:'number',showInHud:false},{id:'custom',stat:true},{id:'secret',type:'number'}];
const expand = (text, context) => resolveDescription(text,context).text;

test('resources and explicitly declared stats resolve finite own values without mutation', () => {
  const context = {variables,values:{health:10,energy:0,agility:4,custom:2,secret:91}};
  const before = structuredClone(context);
  assert.deepEqual(resolveDescription('[HP]/[ENERGY], [STAT:agility] + [STAT:custom]',context),{text:'10/0, 4 + 2',warnings:[]});
  assert.deepEqual(context,before);
  for (const token of ['[STAT:secret]','[STAT:missing]','[secret]','[agility]','[STAT:Agility]']) {
    const result = resolveDescription(token,context);
    assert.equal(result.text,token);
    assert.equal(result.warnings.length,1);
    assert.ok(!result.warnings[0].includes('91'));
  }
  assert.equal(expand('[STAT:agility]',{values:{agility:4}}),'[STAT:agility]');
});

test('missing, nonnumeric, nonfinite and inherited values remain literal with warnings', () => {
  for (const health of [undefined,null,'2',NaN,Infinity,-Infinity,'[ENERGY]']) {
    assert.deepEqual(resolveDescription('[HP]',{values:{health}}),{text:'[HP]',warnings:['Unavailable description token: [HP]']});
  }
  assert.equal(expand('[HP]',{values:Object.create({health:12})}),'[HP]');
  assert.deepEqual(resolveDescription('[UNKNOWN] [STAT:health]',{values:{health:2}}),{
    text:'[UNKNOWN] [STAT:health]',warnings:['Unknown description token: [UNKNOWN]','Unavailable description token: [STAT:health]']
  });
});

test('damage uses effective authored range, then adds player preparation before protection or health caps', () => {
  assert.equal(expand('[BASEDMG] / [DMG] / [PREPBONUS]',{card:punch,preparationBonus:3,targetHp:1,damageReduction:99,enemyPreparation:{kind:'block',value:99}}),'2–4 / 5–7 / 3');
  assert.equal(expand('[DMG]',{card:{...punch,attack:{source:'self',damage:{min:2,max:2}}}}),'2');
  const shot = {...punch,attack:{source:'weapon',minBonus:1,maxBonus:2}};
  assert.equal(expand('[BASEDMG] / [DMG]',{card:shot,source:weapon,preparationBonus:2}),'4–7 / 6–9');
  assert.equal(expand('[BASEDMG] [DMG]',{card:weapon,preparationBonus:2}),'3–5 3–5');
  assert.equal(expand('[DMG]',{card:shot}),'[DMG]');
  assert.equal(expand('[DMG]',{card:shot,source:{subtype:'tool',combat:weapon.combat}}),'[DMG]');
});

test('only attack actions and weapon items provide damage, without revealing enemy preparation', () => {
  for (const card of [{...punch,type:'prepare'},{...punch,type:'defend'},{...punch,type:'wait'},{...punch,kind:'event'},{...punch,kind:'action'},{...punch,attack:{source:'none'}},{kind:'enemy',damage:{min:2,max:3}}]) {
    assert.equal(expand('[BASEDMG] [DMG]',{card}),'[BASEDMG] [DMG]');
  }
  const enemy = {type:'attack',damage:{min:1,max:3}};
  assert.equal(expand('[DMG] [PREPBONUS]',{card:enemy,enemy:true,preparationBonus:7,enemyPreparation:{kind:'attack',value:9}}),'1–3 [PREPBONUS]');
  assert.equal(expand('[DMG]',{card:enemy}),'[DMG]');
  assert.equal(expand('[DMG]',{card:{...punch,attack:{source:'self',damage:{min:4,max:2}}}}),'[DMG]');
  assert.equal(expand('[DMG]',{card:punch,preparationBonus:Infinity}),'[DMG]');
  assert.equal(expand('[DMG]',{card:{...punch,attack:{source:'self',damage:{min:Number.MAX_SAFE_INTEGER,max:Number.MAX_SAFE_INTEGER}}},preparationBonus:1}),'[DMG]');
});

test('preparation uses authored prepare bonus and energy cost includes every paid energy cost, even with a hidden badge', () => {
  assert.equal(expand('[PREPBONUS]',{card:{...punch,type:'prepare',preparationBonus:4},preparationBonus:2}),'4');
  assert.equal(expand('[PREPBONUS]',{card:{...punch,type:'prepare'}}),'[PREPBONUS]');
  assert.equal(expand('[ENERGYCOST]',{card:punch}),'2');
  assert.equal(expand('[ENERGYCOST]',{card:{kind:'action',costs:[{key:'energy',amount:2},{key:'energy',amount:7,hideBadge:true},{source:'inventory',key:'energy',amount:9},{key:'health',amount:8}]}}),'9');
  assert.equal(expand('[ENERGYCOST]',{card:{kind:'action'}}),'0');
  assert.equal(expand('[ENERGYCOST]',{card:{type:'wait'},enemy:true}),'0');
  assert.equal(expand('[ENERGYCOST]',{card:weapon}),'[ENERGYCOST]');
  assert.equal(expand('[ENERGYCOST]',{card:{...punch,costs:[{key:'energy',amount:'2'}]}}),'[ENERGYCOST]');
});

test('icons are plain Unicode and authored markup, expressions and unknown tokens stay inert', () => {
  assert.deepEqual(resolveDescription('[ICON:damage] [ICON:energy] [ICON:health]'),{text:'⚔ ϟ ♥',warnings:[]});
  const raw = '<img src=x onerror="alert(1)"> & [card.name] [STAT:constructor] [ICON:__proto__] [HP + 1]';
  const result = resolveDescription(raw,{card:{name:'secret'},variables,values:{health:2}});
  assert.equal(result.text,raw);
  assert.equal(result.warnings.length,4);
  assert.equal(expand('{HP} [HP', {values:{health:2}}),'{HP} [HP');
});

test('palette offers resolvable tokens only and never arbitrary or unavailable state', () => {
  const base = listDescriptionTokens();
  assert.deepEqual(base.map(entry => entry.token),['[ICON:damage]','[ICON:energy]','[ICON:health]']);
  const tokens = listDescriptionTokens({card:punch,variables,values:{health:10,agility:4,secret:91},preparationBonus:0});
  assert.deepEqual(tokens.map(entry => entry.token),['[HP]','[BASEDMG]','[DMG]','[PREPBONUS]','[ENERGYCOST]','[STAT:agility]','[ICON:damage]','[ICON:energy]','[ICON:health]','[IF:PREPARED][ENDIF]']);
  assert.ok(tokens.every(entry => typeof entry.label === 'string' && resolveDescription(entry.token,{card:punch,variables,values:{health:10,agility:4},preparationBonus:0}).warnings.length === 0));
});

test('prepared sections show only for a prepared player Attack, including line breaks and repeated sections',()=>{
 const text='[BASEDMG] ⚔[IF:PREPARED], +[PREPBONUS] ⚔ or breaks defence[ENDIF].';
 for(const [bonus,want] of [[0,'2–4 ⚔.'],[2,'2–4 ⚔, +2 ⚔ or breaks defence.']]){
  assert.deepEqual(resolveDescription(text,{card:punch,preparationBonus:bonus}),{text:want,warnings:[]});
 }
 assert.equal(expand('a[IF:PREPARED]\nb[IF:PREPARED]c[ENDIF]d[ENDIF]e[IF:PREPARED]f[ENDIF]',{card:punch,preparationBonus:0}),'ae');
 assert.equal(expand('a[IF:PREPARED]\nb[IF:PREPARED]c[ENDIF]d[ENDIF]e[IF:PREPARED]f[ENDIF]',{card:punch,preparationBonus:2}),'a\nbcdef');
});

test('broken or unavailable conditions remain visible and warn instead of hiding authored text',()=>{
 for(const text of ['[IF:PREPARED]bonus','bonus[ENDIF]','[IF:OTHER]bonus[ENDIF]']){
  const resolved=resolveDescription(text,{card:punch,preparationBonus:0});
  assert.equal(resolved.text,text);assert.ok(resolved.warnings.length);
 }
 for(const context of [{card:{kind:'event'}},{card:punch,enemy:true,preparationBonus:2}]){
  const text='[IF:PREPARED]bonus[ENDIF]',result=resolveDescription(text,context);
  assert.equal(result.text,text);assert.match(result.warnings.join(' '),/requires a player Attack/);
 }
 assert.match(resolveDescription('[IF:PREPARED][TYPO][ENDIF]',{card:punch,preparationBonus:0}).warnings[0],/Unknown description token/);
});

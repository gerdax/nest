import test from 'node:test';
import assert from 'node:assert/strict';
import {createAlternativeRatCombatProject} from '../project/combat-fixture.js';
import {parseProject,compileChapter,validateProject,exportChapter,importChapter} from '../project/model.js';
import {createCombatAction,createWeapon,ensureCombatDefaults} from '../project/combat-model.js';
import {enumerateDefinitionReferences} from '../project/dependencies.js';
import {previewCardTarget} from '../studio/preview-card-target.js';
const defend=id=>({...createCombatAction(id),type:'defend',resolution:'direct',damageReduction:4});

test('legacy dodge promotes to a separate shared effect once, preserving copy, artwork, identity and original input',()=>{
 const p=createAlternativeRatCombatProject(),action=p.library.find(d=>d.id==='alternative-defend');
 delete p.combat.playerDodge;delete action.reveal;
 Object.assign(action.blockReveal,{kind:'event',text:'You dodge!',image:'dodge.png',imageScale:141,imageOffsetX:8,imageOffsetY:4,flipImage:true,onCollect:[]});
 const original=structuredClone(p),parsed=parseProject(JSON.stringify(p)),a=parsed.library.find(d=>d.id===action.id);
 const effect=parsed.library.find(d=>d.id===parsed.combat.playerDodge.definitionId);
 assert.deepEqual(p,original);assert.deepEqual(a.blockReveal,action.blockReveal);
 assert.equal(effect.kind,'effect');assert.equal(effect.showValue,undefined);assert.equal(effect.name,'Dodge');
 for(const key of ['text','image','imageScale','imageOffsetX','imageOffsetY','flipImage'])assert.equal(effect[key],action.blockReveal[key]);
 assert.equal(effect.onCollect,undefined);assert.deepEqual(a.blockReveal.onCollect,[]);
 assert.notEqual(effect.id,a.blockReveal.id);assert.deepEqual(a.reveal,parsed.combat.playerDodge);
 assert.deepEqual(parseProject(JSON.stringify(parsed)),parsed);assert.deepEqual(validateProject(parsed),[]);
 assert.deepEqual(compileChapter(p).combat.playerDodge,parsed.combat.playerDodge);
 effect.text='Updated separately';assert.equal(a.blockReveal.text,'You dodge!');
});

test('custom Weapon reveals promote independently, remain typed dependencies, and survive chapter transfer',()=>{
 const p=createAlternativeRatCombatProject(),weapon=createWeapon('shield'),action=defend('parry');
 action.blockReveal={id:'custom-parry',kind:'caption',name:'Parry',text:'',image:'parry.png',effects:[]};
 weapon.combat.actions=[action];p.library.push(weapon);p.chapters[0].entryEffects=[{op:'addItem',key:weapon.id}];ensureCombatDefaults(p);
 const effect=p.library.find(d=>d.id===action.reveal.definitionId);
 assert.equal(effect.kind,'effect');assert.equal(effect.text,'');assert.equal(effect.image,'parry.png');assert.notEqual(effect.id,p.combat.playerDodge.definitionId);
 assert.equal(enumerateDefinitionReferences(weapon).find(r=>r.definitionId===effect.id).kind,'effect');
 const parsed=importChapter(createAlternativeRatCombatProject(),exportChapter(p));
 const copy=parsed.library.find(d=>d.id===weapon.id);
 assert(copy);assert(parsed.library.some(d=>d.id===copy.combat.actions[0].reveal.definitionId));assert.deepEqual(validateProject(parsed),[]);
});

test('Dodge and custom Reveal references reject missing, wrong-kind, local, and Damage received sources',()=>{
 for(const mutate of [p=>p.combat.playerDodge={definitionId:'missing'},p=>p.combat.playerDodge={definitionId:'rat'},p=>p.combat.playerDodge=p.combat.playerHit,p=>p.library.find(d=>d.id==='alternative-defend').reveal={definitionId:'missing'},p=>p.library.find(d=>d.id==='alternative-defend').reveal=p.combat.playerHit,p=>Object.assign(p.library.find(d=>d.id===p.combat.playerDodge.definitionId),{visibility:'local',chapterId:p.chapters[0].id})]){
  const p=createAlternativeRatCombatProject();mutate(p);assert(validateProject(p).length>0);assert.throws(()=>parseProject(JSON.stringify(p)));
 }
});

test('Go to card targets the independent Dodge effect definition during feedback',()=>{
 const p=createAlternativeRatCombatProject(),chapter=p.chapters[0],node=chapter.nodes.find(n=>n.type==='combat'),card=p.library.find(d=>d.id===p.combat.playerDodge.definitionId);
 const controller={state:{idle:true,activeNodeId:node.id},location:{node},combat:{phase:'effects',enemy:{id:'rat'},sequence:{index:0,steps:[{contentId:'feedback',definitionId:card.id,card}]}}};
 const target=previewCardTarget({project:p,chapterId:chapter.id,controller,deck:{phase:'closed',content:{id:'feedback'}}});
 assert.equal(target.definitionId,card.id);assert.equal(target.cardId,card.id);assert.equal(target.definitionPath,'');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {createRatCombatProject} from '../project/combat-fixture.js';
import {ensureCombatDefaults,ensurePlayerBlockReveal,createCombatAction,createWeapon} from '../project/combat-model.js';
import {parseProject,validateProject,compileChapter,exportChapter,importChapter} from '../project/model.js';
import {definitionInspector} from '../studio/inspectors.js';
import {applyDocumentCommand} from '../studio/document-commands.js';
import {sourceCard} from '../studio/card-navigation.js';
const defend=id=>({...createCombatAction(id),type:'defend',resolution:'direct',damageReduction:1});
function fixture(){
 const project=createRatCombatProject(),action=defend('custom-defend'),weapon=createWeapon('test-shield');
 weapon.combat.actions=[defend('shield-defend')];project.library.push(action,weapon);
 return {project,action,weapon};
}
test('legacy standalone and Weapon Defend cards gain stable collision-free presentation defaults, including raw compilation',()=>{
 const {project,action,weapon}=fixture();
 project.library.push({id:'custom-defend-block-reveal',kind:'caption',name:'Reserved',text:'',image:'',effects:[]});
 const original=structuredClone(project),parsed=parseProject(JSON.stringify(project));
 assert.deepEqual(project,original);
 for(const id of [action.id,weapon.id]){
  const definition=parsed.library.find(d=>d.id===id),card=(definition.kind==='item'?definition.combat.actions[0]:definition).blockReveal;
  assert.equal(card.kind,'effect');assert.equal(card.name,'Reveal');assert.equal(card.text,'You blocked the attack');assert.deepEqual(card.effects,[]);
 }
 assert.equal(parsed.library.find(d=>d.id===action.id).blockReveal.id,'custom-defend-block-reveal-2');
 assert.deepEqual(parseProject(JSON.stringify(parsed)),parsed);assert.deepEqual(validateProject(parsed),[]);
 assert.equal(compileChapter(project).library.find(d=>d.id===action.id).blockReveal.text,'You blocked the attack');
});
test('authored blank copy, identity and artwork survive parse and compile without repair',()=>{
 const {project,action,weapon}=fixture();ensureCombatDefaults(project);
 Object.assign(action.blockReveal,{kind:'event',text:'',image:'shield.png',imageScale:153,imageOffsetX:8,imageOffsetY:-9,flipImage:true});
 Object.assign(weapon.combat.actions[0].blockReveal,{text:'Weapon parry'});
 for(const result of [parseProject(JSON.stringify(project)),compileChapter(project)]){
  assert.deepEqual(result.library.find(d=>d.id===action.id).blockReveal,action.blockReveal);
  assert.deepEqual(result.library.find(d=>d.id===weapon.id).combat.actions[0].blockReveal,weapon.combat.actions[0].blockReveal);
 }
});
test('explicit invalid block cards are retained and diagnosed, while Enemy Defend needs no player card',()=>{
 for(const mutate of [a=>a.blockReveal=null,a=>a.blockReveal.kind='combatAction',a=>a.blockReveal.id=a.id,a=>a.blockReveal.text=null,a=>a.blockReveal.effects=[{op:'add',key:'health',value:1}],a=>a.blockReveal.onCollect=[{op:'add',key:'health',value:1}],a=>a.blockReveal.effects=null]){
  const {project,action}=fixture();ensureCombatDefaults(project);mutate(action);const original=structuredClone(action.blockReveal);
  ensureCombatDefaults(project);assert.deepEqual(action.blockReveal,original);assert(validateProject(project).some(e=>/Block reveal/.test(e.message)));assert.throws(()=>parseProject(JSON.stringify(project)));
 }
 const {project}=fixture(),enemy=project.library.find(d=>d.kind==='enemy');Object.assign(enemy.actions[0],{type:'defend',resolution:'direct',damageReduction:1});
 ensureCombatDefaults(project);assert.equal(enemy.actions[0].blockReveal,undefined);assert.deepEqual(validateProject(project),[]);
});
test('Defend Reveal selects a common Feedback effect below artwork without an embedded editor',()=>{
 const {project,action,weapon}=fixture();ensureCombatDefaults(project);
 const dodge=project.library.find(d=>d.id===project.combat.playerDodge.definitionId);
 for(const [owner,defend,prefix] of [[action,action,''],[weapon,weapon.combat.actions[0],'combat.actions.0.']]){
  const original=structuredClone(defend.blockReveal);
  let html=definitionInspector(project,owner);
  const revealIndex=html.indexOf('<summary>Reveal</summary>');
  assert(revealIndex>html.indexOf(`data-path="${prefix}image"`));
  assert(revealIndex>html.indexOf('<summary>Image scale and position</summary>'));
  assert(html.includes(`data-path="${prefix}reveal.definitionId"`));
  assert(html.includes('Default Dodge'));
  assert(html.includes(`data-definition="${defend.reveal?.definitionId||dodge.id}"`));
  assert(!html.includes(`data-path="${prefix}blockReveal.text"`));
  assert(!html.includes(`data-path="${prefix}blockReveal.image"`));
  const custom={...dodge,id:'custom-'+owner.id,name:'Parry'};project.library.push(custom);defend.reveal={definitionId:custom.id};
  html=definitionInspector(project,owner);
  assert(html.includes(`data-definition="${custom.id}"`));
  assert(html.includes(`<option value="${custom.id}" selected`));
  assert.deepEqual(defend.blockReveal,original);
 }
});
test('preview navigation resolves player child card identity under its correct owner',()=>{
 const {project,action,weapon}=fixture();ensureCombatDefaults(project);
 const chapter=project.chapters[0],node=chapter.nodes.find(n=>n.type==='combat');
 for(const [owner,card,path] of [[action,action.blockReveal,'blockReveal'],[weapon,weapon.combat.actions[0].blockReveal,'combat.actions.0.blockReveal']]){
  const target={kind:'definition',chapterId:chapter.id,nodeId:node.id,definitionId:owner.id,cardId:card.id};
  const result=sourceCard(project,target);assert.equal(result.card,card);assert.equal(result.definitionPath,path);
  assert.equal(sourceCard(project,{...target,cardId:'stale'}),null);
 }
});
test('standalone helper reserves its owner ID and does not overwrite explicit authored fields',()=>{
 const action=defend('single');ensurePlayerBlockReveal(action,new Set(['single-block-reveal']));assert.equal(action.blockReveal.id,'single-block-reveal-2');
 action.blockReveal=null;ensurePlayerBlockReveal(action);assert.equal(action.blockReveal,null);
});

test('conflict imports retain block reveal identity under separately remapped owners',()=>{
 const {project,action}=fixture();project.combat.defaultActions.push({definitionId:action.id});ensureCombatDefaults(project);
 Object.assign(action.blockReveal,{kind:'event',text:'Imported parry',image:'parry.png',imageScale:125});
 const pkg=exportChapter(project),destination=structuredClone(project);
 destination.library.find(d=>d.id===action.id).text='Conflicting original';
 const imported=importChapter(destination,pkg),copy=imported.library.find(d=>d.id===`${action.id}-2`);
 assert(copy);assert.deepEqual(copy.blockReveal,action.blockReveal);
 assert.deepEqual(validateProject(imported),[]);
 const parsed=parseProject(JSON.stringify(imported));assert.deepEqual(parsed.library.find(d=>d.id===copy.id).blockReveal,action.blockReveal);
 const chapter=parsed.chapters.at(-1),node=chapter.nodes.find(n=>n.type==='combat');
 const target={kind:'definition',chapterId:chapter.id,nodeId:node.id,definitionId:copy.id,cardId:copy.blockReveal.id};
 assert.equal(sourceCard(parsed,target).definition.id,copy.id);
});
test('block reveal IDs remain unique within their Weapon and cannot shadow Library definitions',()=>{
 for(const collide of [(project,weapon)=>weapon.combat.actions[0].blockReveal.id=weapon.combat.actions[1].id,(project,weapon)=>weapon.combat.actions[1].blockReveal.id=weapon.combat.actions[0].blockReveal.id,(project,weapon)=>weapon.combat.actions[0].blockReveal.id=project.library.find(d=>d.kind==='enemy').id]){
  const {project,weapon}=fixture();weapon.combat.actions.push(defend('other-shield-defend'));ensureCombatDefaults(project);collide(project,weapon);
  assert(validateProject(project).some(e=>/Block reveal: duplicate embedded identity/.test(e.message)));
 }
});

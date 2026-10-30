import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject,createEnemy,parseProject,compileChapter,validateProject} from '../project/model.js';
import {definitionInspector} from '../studio/inspectors.js';
import {cardFace} from '../project/presentation.js';
import {combatCard} from '../project/combat-presentation.js';

test('Enemy Health damage hides its internal editor Name',()=>{
 const p=createProject(),enemy=createEnemy('rat');p.library.push(enemy);
 const html=definitionInspector(p,enemy);
 assert(html.includes('<h3>Effects Feedback</h3>'));assert(html.includes('<summary>Health damage</summary>'));
 assert(!html.includes('data-path="hit.name"'));assert(html.includes('data-path="hit.text"'));
});
test('Enemy damage Description is the large heading in both preview and combat',()=>{
 const enemy=createEnemy('rat');enemy.hit.text='The rat reels!';enemy.hit.name='Internal name';
 const preview=cardFace(enemy.hit),runtime=combatCard(enemy.hit,'hit',{value:-3});
 for(const face of [preview,runtime]){assert.equal(face.heading,'The rat reels!');assert.equal(face.text,'');assert.equal(face.typeLabel,'EFFECT');}
 assert.equal(runtime.value,-3);
});
test('legacy name-only Enemy damage copy migrates once and cleared descriptions stay empty',()=>{
 const p=createProject(),enemy=createEnemy('rat');delete enemy.hit.headingFromDescription;
 Object.assign(enemy.hit,{name:'Rat takes damage!',text:'',image:'rat-hit.png'});p.library.push(enemy);
 const original=JSON.stringify(p),loaded=parseProject(original),hit=loaded.library.find(d=>d.id==='rat').hit;
 assert.equal(hit.text,'Rat takes damage!');assert.equal(hit.image,'rat-hit.png');assert.equal(JSON.stringify(p),original);
 hit.text='';const again=parseProject(JSON.stringify(loaded));assert.equal(again.library.find(d=>d.id==='rat').hit.text,'');
 assert.equal(compileChapter(p).library.find(d=>d.id==='rat').hit.text,'Rat takes damage!');assert.deepEqual(validateProject(again),[]);
});
test('legacy Description is preserved rather than replaced with its old name',()=>{
 const p=createProject(),enemy=createEnemy('rat');delete enemy.hit.headingFromDescription;enemy.hit.name='Old name';enemy.hit.text='Existing Description';p.library.push(enemy);
 assert.equal(parseProject(JSON.stringify(p)).library.find(d=>d.id==='rat').hit.text,'Existing Description');
});

test('player and Enemy Feedback presentations display Description and never their editor Name',()=>{
 const p=createProject(),player=p.library.find(d=>d.id===p.combat.playerHit.definitionId),enemy=createEnemy('rat');
 for(const card of [player,enemy.hit]){
  Object.assign(card,{name:'Editor label only',text:'You feel the impact.',headingFromDescription:false});
  for(const face of [cardFace(card),combatCard(card,'feedback',{value:-2})]){
   assert.equal(face.heading,'You feel the impact.');assert.equal(face.text,'');
  }
  card.text='';assert.equal(combatCard(card,'empty').heading,'');assert.equal(cardFace(card).heading,'');
 }
});
test('legacy player feedback migrates name-only text once without changing the editor label',()=>{
 const p=createProject(),player=p.library.find(d=>d.id===p.combat.playerHit.definitionId);
 delete player.headingFromDescription;player.name='You have been hit!';player.text='';
 const loaded=parseProject(JSON.stringify(p)),hit=loaded.library.find(d=>d.id===player.id);
 assert.equal(hit.name,player.name);assert.equal(hit.text,player.name);
 hit.text='';const again=parseProject(JSON.stringify(loaded));assert.equal(again.library.find(d=>d.id===player.id).text,'');
});

test('Enemy Actions use authored Description as their headline, without repeating the editor Name',async()=>{
 const {enemyActionCard,combatChoices}=await import('../project/combat-presentation.js');
 for(const type of ['attack','defend','wait']){
  const action={...createEnemy('rat').actions[0],type,name:'Internal action label',text:'The rat lunges at you!'};
  const face=enemyActionCard(action,'enemy-action');assert.equal(face.heading,action.text);assert.equal(face.text,'');
  action.text='';assert.equal(enemyActionCard(action,'empty').heading,'');
  const player=combatChoices([{id:'player',action,profile:null}],'choices').actions[0];assert.equal(player.heading,action.name);
 }
});

test('player health damage edits Description without exposing its internal Name',()=>{
 const p=createProject(),hit=p.library.find(d=>d.id===p.combat.playerHit.definitionId);
 const html=definitionInspector(p,hit);assert(!html.includes('data-path="name"'));assert(html.includes('data-path="text"'));
});

test('Enemy reactions allow Caption and Vignette; old Effect reactions preserve their presentation on import',()=>{
 const p=createProject(),enemy=createEnemy('rat');p.library.push(enemy);
 enemy.reactions=[{id:'reaction',threshold:{numerator:1,denominator:2},card:{id:'reaction-card',kind:'caption',name:'Hurt',text:'The rat retreats.',image:''}}];
 for(const kind of ['caption','event']){enemy.reactions[0].card.kind=kind;assert.deepEqual(validateProject(p),[]);}
 enemy.reactions[0].card.kind='effect';assert(validateProject(p).length>0);
 for(const image of ['', 'rat-hurt.png']){
  Object.assign(enemy.reactions[0].card,{image,text:'The rat retreats.'});
  const loaded=parseProject(JSON.stringify(p)).library.find(d=>d.id===enemy.id).reactions[0].card;
  assert.equal(loaded.kind,image?'event':'caption');assert.equal(loaded.text,'The rat retreats.');assert.equal(loaded.image,image);
 }
});

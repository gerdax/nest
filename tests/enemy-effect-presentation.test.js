import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject,createEnemy,parseProject,compileChapter,validateProject} from '../project/model.js';
import {definitionInspector} from '../studio/inspectors.js';
import {cardFace} from '../project/presentation.js';
import {combatCard} from '../project/combat-presentation.js';

test('Enemy Effect cards uses a fixed Health damage label without an editable name',()=>{
 const p=createProject(),enemy=createEnemy('rat');p.library.push(enemy);
 const html=definitionInspector(p,enemy);
 assert(html.includes('<h3>Effect cards</h3>'));assert(html.includes('<summary>Health damage</summary>'));
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

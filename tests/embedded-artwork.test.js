import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject,createEnemy} from '../project/model.js';
import {definitionInspector} from '../studio/inspectors.js';
import {applyDocumentCommand} from '../studio/document-commands.js';
import {artworkEditor} from '../studio/forms.js';

test('embedded Enemy artwork uses the same sliders and reset/copy/paste controls as ordinary cards',()=>{
 const p=createProject(),enemy=createEnemy('enemy');enemy.death[0].kind='event';p.library.push(enemy);
 const html=definitionInspector(p,enemy);
 for(const path of ['actions.0','hit','death.0']){
  assert(html.includes(`type="range" min="10" max="400" step="1" value="100" data-scope="definition" data-path="${path}.imageScale" data-artwork-slider`));
  for(const command of ['reset-artwork','copy-artwork','paste-artwork'])assert(html.includes(`data-command="${command}" data-scope="definition" data-artwork-path="${path}"`));
 }
 assert(artworkEditor(enemy).includes('class="state-panel artwork-positioning"'));
});
test('reset and paste target only the selected embedded card, preserving its identity and its neighbours',()=>{
 const p=createProject(),enemy=createEnemy('enemy');p.library.push(enemy);
 Object.assign(enemy,{imageScale:180,imageOffsetX:30});Object.assign(enemy.actions[0],{imageScale:140,imageOffsetX:20,imageOffsetY:-10});
 const selection={chapterId:p.activeChapterId,selected:p.chapters[0].startNode,definitionId:enemy.id};
 applyDocumentCommand(p,selection,'inspector',{command:'reset-artwork',scope:'definition',artworkPath:'actions.0'});
 assert.equal(enemy.actions[0].imageScale,undefined);assert.equal(enemy.imageScale,180);assert.equal(enemy.imageOffsetX,30);
 const name=enemy.hit.name,id=enemy.hit.id;
 applyDocumentCommand(p,selection,'paste-artwork',{id:enemy.id,path:'hit',settings:{image:'hit.png',imageScale:125,imageOffsetX:5,imageOffsetY:8,flipImage:true}});
 assert.equal(enemy.hit.image,'hit.png');assert.equal(enemy.hit.imageScale,125);assert.equal(enemy.hit.name,name);assert.equal(enemy.hit.id,id);
 assert.equal(enemy.imageScale,180);assert.equal(enemy.actions[0].imageScale,undefined);
});

test('embedded Captions retain their preview but hide artwork controls until switched to Vignette',()=>{
 const p=createProject(),enemy=createEnemy('enemy');p.library.push(enemy);
 enemy.reactions=[{id:'reaction',threshold:{numerator:1,denominator:2},card:{id:'caption',kind:'caption',name:'Reaction',text:'Hurt',image:'saved-art.png'}}];
 let html=definitionInspector(p,enemy);
 for(const path of ['reactions.0.card','death.0']){
  assert(html.includes(`data-preview-path="${path}"`));assert(!html.includes(`data-path="${path}.image"`));assert(!html.includes(`data-path="${path}.imageScale"`));
 }
 enemy.reactions[0].card.kind='event';html=definitionInspector(p,enemy);
 assert(html.includes('data-path="reactions.0.card.image"'));assert(html.includes('data-path="reactions.0.card.imageScale"'));
 assert.equal(enemy.reactions[0].card.image,'saved-art.png');
});

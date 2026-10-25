import test from 'node:test';
import assert from 'node:assert/strict';
import {imageField} from '../studio/forms.js';
import {cardFields,nodeInspector} from '../studio/inspectors.js';
import {createProject} from '../project/model.js';

test('card artwork controls put Reload immediately left of Clear and retain field scope',()=>{
 for(const scope of ['definition','local-definition']){
  const html=imageField('Artwork path','./assets/img/scene.jpeg','image',scope,{clearable:true});
  assert.match(html,new RegExp(`data-command="reload-image" data-scope="${scope}" data-path="image"`));
  assert.match(html,/aria-label="Reload card image"[^>]*>Reload<\/button><button[^>]*data-command="clear-image"/);
  assert.doesNotMatch(html,/<button[^>]*data-command="reload-image"[^>]*\bdisabled\b/);
 }
});

test('empty artwork disables Reload and Clear; project card-back fields keep their existing controls',()=>{
 const empty=imageField('Artwork path','','image','definition',{clearable:true});
 assert.match(empty,/<button[^>]*data-command="reload-image"[^>]*\bdisabled\b/);
 assert.match(empty,/<button[^>]*data-command="clear-image"[^>]*\bdisabled\b/);
 const back=imageField('Background','./assets/img/cardback.png','cardBack.background','project');
 assert.doesNotMatch(back,/reload-image|clear-image/);
});

test('shared and chapter-local image sections show Reload while caption cards omit artwork controls',()=>{
 const project=createProject(),chapter=project.chapters[0],fork=chapter.nodes.find(node=>node.type==='fork');
 const shared=project.library.find(card=>card.kind==='action');
 assert.match(cardFields(project,shared),/data-command="reload-image"/);
 const definition=project.library.find(card=>card.id===fork.choices[0].definitionId);
 definition.visibility='local';definition.chapterId=chapter.id;
 assert.match(nodeInspector(project,chapter,fork),/data-command="reload-image" data-scope="local-definition"/);
 assert.doesNotMatch(cardFields(project,{id:'caption',kind:'caption',text:'Caption'}),/data-command="reload-image"/);
});
